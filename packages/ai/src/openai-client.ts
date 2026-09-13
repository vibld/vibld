import { z } from 'zod';
import { GenerationPlanSchema } from './plan-schema.ts';
import { findModel } from './model-catalogue.ts';
import type { PlanClient, PlanCompletion, PlanRequest } from './client.ts';

/**
 * A third real model provider, behind the same `PlanClient` seam.
 *
 * Written against the REST API with plain `fetch` rather than a vendor SDK,
 * for the reason `deepseek-client.ts` already gives: a second SDK in a Worker
 * bundle buys nothing that a typed request body does not, and ADR-0003 only
 * asks that vendor specifics stay inside a file like this one.
 *
 * This is the Responses API (`/v1/responses`), not chat completions, because
 * that is where structured outputs live. The shape differs from both existing
 * clients in three ways worth naming up front:
 *
 *  - The schema goes in `text.format` as a raw JSON Schema with
 *    `strict: true`, not as a Zod helper and not as a prompt instruction. So
 *    this provider sits with Anthropic on the schema-enforced side of the
 *    line rather than with DeepSeek's JSON mode, and `ModelChoice.note` says
 *    so where a person chooses.
 *  - A refusal arrives as a *content block* of type `refusal` rather than as
 *    a stop reason, so it has to be found in the output rather than read off
 *    the top of the response.
 *  - Truncation is `status: "incomplete"` with
 *    `incomplete_details.reason: "max_output_tokens"`, which is mapped back
 *    to the `max_tokens` stop reason the rest of Vibld reasons about. Without
 *    that mapping `ProviderTruncationError` could never fire and a cut-off
 *    project would surface as an unreadable JSON parse failure.
 */

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * `GenerationPlanSchema` as a JSON Schema OpenAI's strict mode will accept.
 *
 * Zod already emits `additionalProperties: false` and a complete `required`
 * array, which are strict mode's two hard requirements. What is stripped is
 * the validation vocabulary around them: `$schema`, and the `minLength` /
 * `minItems` bounds that strict mode does not accept.
 *
 * Dropping those loses nothing real. They are re-checked a layer up, where
 * `PlanProvider` runs the actual Zod schema over whatever came back and
 * raises `ProviderShapeError` on a miss. Sending a keyword the API rejects
 * would fail every request; sending a slightly looser schema fails none, and
 * the tighter check still happens.
 */
export function planJsonSchema(): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$schema' || key === 'minLength' || key === 'minItems') {
        continue;
      }
      out[key] = strip(value);
    }
    return out;
  };
  return strip(z.toJSONSchema(GenerationPlanSchema)) as Record<string, unknown>;
}

interface OpenaiContentBlock {
  type?: string;
  text?: string;
  refusal?: string;
}

interface OpenaiOutputItem {
  type?: string;
  content?: OpenaiContentBlock[];
}

interface OpenaiResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: OpenaiOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: { message?: string } | null;
}

/** The assistant text, or null when the response carried none. */
export function readOutputText(response: OpenaiResponse): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const block of item.content ?? []) {
      if (block.type === 'output_text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }
  return null;
}

/** The refusal message, or null when the model did not refuse. */
export function readRefusal(response: OpenaiResponse): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const block of item.content ?? []) {
      if (block.type === 'refusal' && typeof block.refusal === 'string') {
        return block.refusal;
      }
    }
  }
  return null;
}

/**
 * The response's own status, in the vocabulary the rest of Vibld uses.
 *
 * A refusal is checked before anything else: it arrives on an otherwise
 * `completed` response, so reading status alone would report a refusal as a
 * clean finish with an unparseable plan.
 */
export function mapResponseStatus(response: OpenaiResponse): string | null {
  if (readRefusal(response) !== null) return 'refusal';
  if (response.status === 'incomplete') {
    return response.incomplete_details?.reason === 'max_output_tokens'
      ? 'max_tokens'
      : 'incomplete';
  }
  if (response.status === 'completed') return 'end_turn';
  return response.status ?? null;
}

/**
 * Accumulate a Responses API SSE stream.
 *
 * Two things it deliberately does not assume. Text is taken from
 * `response.output_text.delta` events, which is what feeds the progress
 * meter; but the final response object is taken from *any* event carrying a
 * `response` with a terminal `status`, rather than from one named event.
 * The terminal event's exact name was not verifiable when this was written,
 * and a parser keyed to a guess would fail only against a real server, which
 * is precisely the failure this file cannot afford.
 *
 * Exported so the framing is testable without a network: chunk boundaries do
 * not respect frame boundaries.
 */
export async function readResponseStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (characters: number) => void,
): Promise<{ text: string; response: OpenaiResponse | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let response: OpenaiResponse | null = null;

  const TERMINAL = new Set(['completed', 'incomplete', 'failed', 'cancelled']);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n');
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');

        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0 || payload === '[DONE]') continue;

        let event: { type?: string; delta?: string; response?: OpenaiResponse };
        try {
          event = JSON.parse(payload);
        } catch {
          // A frame that is not JSON is not worth ending a run over. The
          // terminal response is what decides the outcome, and a dropped
          // delta costs a few characters of progress meter.
          continue;
        }

        if (event.type === 'response.output_text.delta' && event.delta) {
          text += event.delta;
          onProgress?.(text.length);
        }
        if (event.response && TERMINAL.has(event.response.status ?? '')) {
          response = event.response;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { text, response };
}

/** Rough, deliberately generous. Only used when the stream omits usage. */
function estimateTokens(characters: number): number {
  return Math.max(1, Math.ceil(characters / 4));
}

export interface OpenaiPlanClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Injected in tests; production callers leave it unset. */
  fetchImpl?: typeof fetch;
}

export function createOpenaiPlanClient(
  options: OpenaiPlanClientOptions = {},
): PlanClient {
  const apiKey = options.apiKey ?? globalThis.process?.env?.OPENAI_API_KEY;
  const baseUrl = options.baseUrl ?? OPENAI_BASE_URL;
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    id: 'openai',
    async createPlan(request: PlanRequest): Promise<PlanCompletion> {
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is not set, so no OpenAI request can be made.',
        );
      }

      // Same clamp the Anthropic client applies, for the same reason: asking
      // past a model's own ceiling is rejected outright rather than truncated.
      const known = findModel(request.model);
      const maxOutputTokens = known
        ? Math.min(request.maxTokens, known.maxOutputTokens)
        : request.maxTokens;

      const response = await doFetch(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          max_output_tokens: maxOutputTokens,
          // The Responses API stores responses by default, and what this
          // request carries is the user's prompt, their standing instructions,
          // any reference text, and every existing file in their project --
          // `buildUserPrompt` sends the whole project back on each follow-up
          // turn, so a multi-turn session would leave a copy of it server-side
          // on every turn. The other two clients are stateless, and choosing a
          // model from the picker must not quietly change the retention of
          // someone's code. Nothing here ever retrieves a stored response.
          store: false,
          // Streamed for the reason both other clients are: a whole project
          // takes minutes, and a request that long risks an HTTP timeout with
          // nothing to show for it.
          stream: true,
          reasoning: { effort: request.effort },
          text: {
            format: {
              type: 'json_schema',
              name: 'generation_plan',
              schema: planJsonSchema(),
              strict: true,
            },
          },
          input: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // The key must never reach an error message or a log.
        throw new Error(
          `OpenAI rejected the request (${response.status}).${detail ? ` ${detail.slice(0, 200)}` : ''}`,
        );
      }
      if (!response.body) {
        throw new Error('OpenAI returned an empty response.');
      }

      const { text, response: final } = await readResponseStream(
        response.body,
        request.onProgress
          ? (characters) => request.onProgress?.({ characters })
          : undefined,
      );

      // Prefer the terminal object's own text; fall back to what the deltas
      // accumulated. A stream that ended without a terminal event still has
      // the plan, and losing a finished generation to a missing frame would
      // charge someone for work that was actually done.
      const body = final ? (readOutputText(final) ?? text) : text;
      const stopReason = final ? mapResponseStatus(final) : null;

      let plan: unknown = null;
      if (stopReason !== 'refusal' && body.length > 0) {
        try {
          plan = JSON.parse(body);
        } catch {
          // Truncation and shape failures are both named a layer up, from a
          // null plan plus the stop reason. Nothing to add here.
          plan = null;
        }
      }

      const refusal = final ? readRefusal(final) : null;
      const promptCharacters = request.system.length + request.prompt.length;

      return {
        plan,
        stopReason,
        ...(refusal !== null
          ? { refusal: { category: 'refusal', explanation: refusal } }
          : {}),
        usage: {
          // Estimated only when the stream omitted usage. Over-reporting is
          // the safe direction for a budget; under-reporting is not.
          inputTokens:
            final?.usage?.input_tokens ?? estimateTokens(promptCharacters),
          outputTokens:
            final?.usage?.output_tokens ?? estimateTokens(body.length),
          cacheReadInputTokens:
            final?.usage?.input_tokens_details?.cached_tokens ?? 0,
        },
      };
    },
  };
}
