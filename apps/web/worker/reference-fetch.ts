import { MAX_REFERENCE_CHARS } from '@vibld/ai/limits';

/**
 * Fetches a caller-supplied "copy from or emulate" URL and reduces it to the
 * plain text `plan-provider.ts`'s `buildUserPrompt` puts in front of the
 * model.
 *
 * Lives in the Worker, not `@vibld/ai`, for the same reason `publish-client.ts`
 * does: this is IO (`fetch`, a byte-capped read, HTML parsing), and the
 * package that adapter lives in also ships in the browser bundle. It runs
 * inside `handlePlan`, before a Workflow is created, for the same reason
 * `parseKnowledge`/`parseStylePreset` run there: a bad reference URL should
 * fail the request before anything is reserved against the caller's budget,
 * not surface as a mid-run error after they have already waited.
 */

export type ReferenceFetchResult =
  { ok: true; text: string } | { ok: false; error: string };

/** How long a fetch may take before this gives up and reports it. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * How much of the response body is read, in bytes, before extraction stops.
 *
 * Bounds the cost of a caller pointing this at an enormous page: reading (and
 * then regex-scanning) an unbounded body would make the size of someone
 * else's page part of this deployment's own request cost. Comfortably larger
 * than MAX_REFERENCE_CHARS -- most of a typical page's bytes are markup,
 * scripts and styles that extraction below throws away before the character
 * cap ever applies.
 */
const MAX_FETCH_BYTES = 512 * 1024;

/**
 * Hostnames Cloudflare's own platform already refuses to route `fetch()` to
 * (private/reserved/loopback ranges) get checked again here anyway --
 * defense in depth costs one string comparison, and this code should not be
 * the one place that quietly starts trusting platform behaviour it did not
 * itself verify.
 */
const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1']);

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.internal')) return true;
  // 127.0.0.0/8 and 169.254.0.0/16 (link-local, including the cloud metadata
  // address every provider parks there) -- checked as plain octets rather
  // than parsed as an IP, which is enough for the literal-IP case a URL bar
  // actually allows and does not need this module to carry an IP library.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  return false;
}

/** Parse and validate the URL shape. Split from the fetch so both are testable alone. */
export function parseReferenceTarget(
  url: string,
): { ok: true; value: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'The reference URL is not a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: 'The reference URL must start with http:// or https://.',
    };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, error: 'That reference URL is not reachable.' };
  }
  return { ok: true, value: parsed };
}

/**
 * Strip a capped HTML byte string down to visible text.
 *
 * Deliberately simple (no DOM, no HTML parser library -- Workers have
 * neither): drop whole `<script>`/`<style>` elements first so their contents
 * never become "text", strip every remaining tag, unescape the handful of
 * entities plain prose actually uses, then collapse whitespace. Good enough
 * for "give the model a sense of this page's content and structure"; it is
 * not trying to be a readability extractor.
 */
export function extractReadableText(html: string): string {
  const withoutScripts = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  const unescaped = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
  return unescaped
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Read at most `maxBytes` from a response body, decoding what was read as UTF-8. */
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      chunks.push(
        remaining < value.length ? value.subarray(0, remaining) : value,
      );
      total += value.length;
      if (total >= maxBytes) break;
    }
  } finally {
    // The body is being abandoned early on the cap-hit path; releasing the
    // lock rather than awaiting cancel() keeps this from blocking on a slow
    // server that never stops sending.
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

export interface ReferenceFetchOptions {
  fetchImpl?: typeof fetch;
  maxChars?: number;
}

export async function fetchReferenceContext(
  url: string,
  options: ReferenceFetchOptions = {},
): Promise<ReferenceFetchResult> {
  const target = parseReferenceTarget(url);
  if (!target.ok) return target;

  const doFetch = options.fetchImpl ?? fetch;
  const maxChars = options.maxChars ?? MAX_REFERENCE_CHARS;

  let response: Response;
  try {
    response = await doFetch(target.value.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      error: timedOut
        ? 'The reference URL took too long to respond.'
        : 'The reference URL could not be reached.',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `The reference URL returned an error (${response.status}).`,
    };
  }
  if (!response.body) {
    return {
      ok: false,
      error: 'The reference URL returned an empty response.',
    };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (
    contentType &&
    !contentType.includes('html') &&
    !contentType.includes('text/plain')
  ) {
    return {
      ok: false,
      error: 'The reference URL must point at an HTML or text page.',
    };
  }

  const raw = await readCapped(response.body, MAX_FETCH_BYTES);
  const text = extractReadableText(raw);
  if (text.length === 0) {
    return {
      ok: false,
      error: 'No readable text could be extracted from the reference URL.',
    };
  }

  return {
    ok: true,
    text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
  };
}
