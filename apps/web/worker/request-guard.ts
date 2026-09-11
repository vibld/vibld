import type { GenerationRequest } from '@vibld/core';
import { MAX_BASE_CONTENT_CHARS, MAX_KNOWLEDGE_CHARS } from '@vibld/ai/limits';
import { findModel, isKnownModel } from '@vibld/ai';
import { isStylePresetId } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';

/**
 * Request validation for /api/plan.
 *
 * Every request past this point costs money, so the checks here are about
 * spend as much as correctness: an oversized or cross-site request is a bill
 * someone else wrote. Kept as pure functions so each rule is directly
 * testable without a Worker runtime.
 */

export interface GuardLimits {
  maxBodyBytes: number;
  maxPromptChars: number;
  maxFiles: number;
  maxPathChars: number;
  maxTotalPathChars: number;
  maxTotalContentChars: number;
  maxKnowledgeChars: number;
}

export const DEFAULT_LIMITS: GuardLimits = {
  maxBodyBytes: 256 * 1024,
  maxPromptChars: 4000,
  maxFiles: 50,
  maxPathChars: 256,
  // The base snapshot's paths are sent to the model, so this is the real
  // input-token ceiling. Without it a caller can push a 4 KB prompt into
  // hundreds of KB of paths and multiply the cost of a request by orders of
  // magnitude while staying inside the prompt cap.
  maxTotalPathChars: 8000,
  // The base project's file contents now go to the model, so this is the
  // input-token ceiling that matters. Set to @vibld/ai's own budget: the
  // guard refuses an oversized project before a run starts, rather than
  // letting the provider throw after the request has been paid for.
  maxTotalContentChars: MAX_BASE_CONTENT_CHARS,
  maxKnowledgeChars: MAX_KNOWLEDGE_CHARS,
};

export interface GuardFailure {
  status: number;
  error: string;
}

export type GuardResult<T> =
  { ok: true; value: T } | ({ ok: false } & GuardFailure);

function fail(status: number, error: string): GuardResult<never> {
  return { ok: false, status, error };
}

/**
 * Reject cross-site requests.
 *
 * A cross-origin `<form enctype="text/plain">` is a CORS simple request: no
 * preflight, so nothing stops it being sent, and its body can be shaped into
 * valid JSON. The attacker cannot read the response, but the generation still
 * runs and still bills. Requiring a JSON content type and a same-origin
 * `Origin` removes that path regardless of how Access sets its cookie's
 * SameSite attribute.
 */
export function checkRequestOrigin(
  headers: { get(name: string): string | null },
  selfOrigin: string,
): GuardResult<true> {
  const contentType = headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return fail(415, 'Content-Type must be application/json.');
  }

  const origin = headers.get('origin');
  if (origin !== null && origin !== selfOrigin) {
    return fail(403, 'Cross-site requests are not allowed.');
  }

  return { ok: true, value: true };
}

/** Refuse an oversized body before it is read into memory. */
export function checkBodySize(
  headers: { get(name: string): string | null },
  limits: GuardLimits = DEFAULT_LIMITS,
): GuardResult<true> {
  const declared = Number(headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limits.maxBodyBytes) {
    return fail(413, 'Request body is too large.');
  }
  return { ok: true, value: true };
}

/**
 * Validate the generation request.
 *
 * Malformed entries are rejected rather than filtered away: silently dropping
 * part of a caller's project would make the model edit a snapshot the caller
 * never sent.
 */
export function parseGenerationRequest(
  body: unknown,
  limits: GuardLimits = DEFAULT_LIMITS,
): GuardResult<GenerationRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }

  const { prompt, base } = body as { prompt?: unknown; base?: unknown };
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return fail(400, 'A non-empty "prompt" is required.');
  }
  if (prompt.length > limits.maxPromptChars) {
    return fail(
      413,
      `Prompt must be ${limits.maxPromptChars} characters or fewer.`,
    );
  }
  if (base === undefined || base === null) {
    return { ok: true, value: { prompt } };
  }

  if (typeof base !== 'object' || Array.isArray(base)) {
    return fail(400, '"base" must be a project snapshot.');
  }
  const snapshot = base as { revision?: unknown; files?: unknown };
  if (typeof snapshot.revision !== 'string' || !Array.isArray(snapshot.files)) {
    return fail(400, '"base" must be a project snapshot.');
  }
  const files = parseProjectFiles(snapshot.files, limits);
  if (!files.ok) return files;

  return {
    ok: true,
    value: {
      prompt,
      base: { revision: snapshot.revision, files: files.value },
    },
  };
}

/**
 * A relative, canonical path with no way out of the project root -- the same
 * rule `src/generation/validator.ts`'s `pathProblem` already applies
 * client-side before a file is even staged. That check alone is not enough
 * here: `/api/preview` is the first place a `path` is used to write an
 * actual file on an actual filesystem (inside the sandbox container), and a
 * client-side rule is not a boundary check (ADR-0006) -- a caller that skips
 * the browser entirely could otherwise ask a sandbox to write outside
 * `/workspace`.
 */
function pathProblem(path: string): string | undefined {
  if (path.length === 0) return 'A file has an empty path.';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return `"${path}" must be a relative path.`;
  }
  if (path.includes('\\')) return `"${path}" must use forward slashes.`;
  if (path.includes('\0')) return `"${path}" contains an invalid character.`;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..')) {
    return `"${path}" escapes the project root.`;
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return `"${path}" is not a canonical path.`;
  }
  return undefined;
}

/**
 * The file-list rules `parseGenerationRequest`'s `base` and `/api/preview`
 * both need: how many files, how long a path, how much content in total.
 * Shared so the two endpoints cannot quietly drift onto different limits for
 * what is, in both cases, "how big a project can this deployment afford to
 * hand to a model or a sandbox".
 */
function parseProjectFiles(
  entries: unknown[],
  limits: GuardLimits,
): GuardResult<{ path: string; content: string }[]> {
  if (entries.length > limits.maxFiles) {
    return fail(413, `A project may contain at most ${limits.maxFiles} files.`);
  }

  const files: { path: string; content: string }[] = [];
  let totalPathChars = 0;
  let totalContentChars = 0;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      return fail(400, 'Every staged file must be an object.');
    }
    const { path, content } = entry as { path?: unknown; content?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') {
      return fail(400, 'Every staged file needs a string path and content.');
    }
    const problem = pathProblem(path);
    if (problem) return fail(400, problem);
    if (path.length > limits.maxPathChars) {
      return fail(
        413,
        `File paths must be ${limits.maxPathChars} characters or fewer.`,
      );
    }
    totalPathChars += path.length;
    if (totalPathChars > limits.maxTotalPathChars) {
      return fail(
        413,
        'The project has too many path characters to summarise.',
      );
    }
    totalContentChars += path.length + content.length;
    if (totalContentChars > limits.maxTotalContentChars) {
      return fail(
        413,
        `A project sent with a follow-up request must be ${limits.maxTotalContentChars} characters or fewer.`,
      );
    }
    files.push({ path, content });
  }
  return { ok: true, value: files };
}

/**
 * Validate `/api/preview`'s body: just the files a sandbox should run: no
 * prompt, no revision -- a preview is not a generation, only what already
 * got generated.
 */
export function parsePreviewRequest(
  body: unknown,
  limits: GuardLimits = DEFAULT_LIMITS,
): GuardResult<{ path: string; content: string }[]> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const { files } = body as { files?: unknown };
  if (!Array.isArray(files) || files.length === 0) {
    return fail(400, '"files" must be a non-empty list.');
  }
  return parseProjectFiles(files, limits);
}

/**
 * Validate an optional style preset.
 *
 * Kept as its own rule rather than folded into the request, because the
 * property that matters is not the shape but the closure of the set: the id
 * arrives from the browser and selects text that is appended to the model
 * prompt. Accepting an arbitrary string here would be a way to write
 * instructions for the model that the prompt itself does not contain, and
 * would survive every other check in this file.
 *
 * An unrecognised id is rejected rather than ignored. Ignoring it would give
 * someone who picked "Brutalism" an ordinary page and no reason why.
 */
export function parseStylePreset(
  body: unknown,
): GuardResult<StylePresetId | null> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const { style } = body as { style?: unknown };
  if (style === undefined || style === null) {
    return { ok: true, value: null };
  }
  if (!isStylePresetId(style)) {
    return fail(400, 'Unknown "style" preset.');
  }
  return { ok: true, value: style };
}

/**
 * Validate the project's standing instructions.
 *
 * Unlike a style preset this is the caller's own prose, and that is fine: it
 * is their instruction about their own generation, and the prompt beside it
 * already carries their arbitrary text. There is nothing to close off here,
 * only a size to bound -- these are sent on every turn, so unbounded they
 * would be a cost that grows quietly and never gets re-read.
 */
export function parseKnowledge(
  body: unknown,
  limits: GuardLimits = DEFAULT_LIMITS,
): GuardResult<string | null> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const { knowledge } = body as { knowledge?: unknown };
  if (knowledge === undefined || knowledge === null) {
    return { ok: true, value: null };
  }
  if (typeof knowledge !== 'string') {
    return fail(400, '"knowledge" must be a string.');
  }
  if (knowledge.length > limits.maxKnowledgeChars) {
    return fail(
      413,
      `Standing instructions must be ${limits.maxKnowledgeChars} characters or fewer.`,
    );
  }
  // Empty or whitespace-only is the same as none: it should not become an
  // empty section in the prompt that says nothing.
  return { ok: true, value: knowledge.trim().length > 0 ? knowledge : null };
}

/**
 * Validate a chosen model.
 *
 * A closed set, like the style preset, and for a sharper reason: the id
 * decides which service the account is billed by and at what rate. An open
 * field would let anyone with a session point a run at the most expensive
 * model a provider sells.
 *
 * A model whose provider has no key configured is refused here rather than
 * failing mid-run, after the user has already waited.
 */
export function parseModel(
  body: unknown,
  configured: { anthropic: boolean; deepseek: boolean },
): GuardResult<string | null> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'Body must be a JSON object.');
  }
  const { model } = body as { model?: unknown };
  if (model === undefined || model === null || model === '') {
    return { ok: true, value: null };
  }
  if (!isKnownModel(model)) {
    return fail(400, 'Unknown "model".');
  }
  const choice = findModel(model);
  if (!choice || !configured[choice.provider]) {
    return fail(
      400,
      `This deployment has no ${choice?.provider ?? 'matching'} credential, so it cannot use that model.`,
    );
  }
  return { ok: true, value: model };
}
