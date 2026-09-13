import { MAX_REFERENCE_CHARS } from '@vibld/ai/limits';
import { paletteFromPage, sameOriginStylesheets } from '@vibld/ai';
import type { ExtractedPalette } from '@vibld/ai';

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
  | { ok: true; text: string; palette: ExtractedPalette | null }
  | { ok: false; error: string };

/** How long a fetch may take before this gives up and reports it. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * A Worker's `fetch()` sends no User-Agent unless one is set, which reads as
 * a script rather than a browser to a fair number of ordinary sites' WAFs --
 * the observed failure mode was a real marketing site 403ing every request.
 * This is a normal browser UA string, not a spoofed bypass of anything
 * targeted: the same header every browser already sends on the request a
 * site's own owner would make of it.
 */
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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
 * How much of a linked stylesheet is read, and how long it may take.
 *
 * Smaller and shorter than the page's own budget on purpose. The stylesheet
 * is a bonus: the request already has its text and can complete without it,
 * so it gets a slice of the latency someone is waiting inside of rather than
 * a second full allowance. A sheet that is slow or enormous is dropped and
 * the run carries on.
 */
const MAX_STYLESHEET_BYTES = 256 * 1024;

/**
 * One deadline for the whole stylesheet phase, not one per sheet.
 *
 * Per-sheet timeouts stack: two sheets that both stall spend eight seconds
 * between them, on top of the page fetch, which is the opposite of the
 * "slice of the latency" this budget is supposed to be. The sheets are
 * fetched together under a single clock, so the phase costs what it says it
 * costs however many sheets there are.
 */
const STYLESHEET_PHASE_MS = 4_000;

/**
 * How many redirects are followed, each of them checked.
 *
 * More than a handful is a loop or a tracker, and neither is a reference
 * page worth waiting for.
 */
const MAX_REDIRECTS = 5;

/**
 * A fetch that validates every hop rather than only the first.
 *
 * `fetch` follows redirects itself by default, which quietly undoes the
 * guard on the URL: `/theme.css` answering 302 to `http://169.254.169.254/`
 * is a request this Worker makes to the metadata address having checked
 * nothing, because the only URL `parseReferenceTarget` ever saw was the one
 * before the redirect. Checking the URL a caller typed and then letting the
 * network choose the next one is not a boundary.
 *
 * So redirects are manual and each destination goes through the same guard
 * as the first. The landing URL is returned alongside the response, because
 * `response.url` is empty under manual redirects and the caller needs to
 * know where it ended up to resolve relative links against it.
 */
async function fetchValidated(
  start: URL,
  doFetch: typeof fetch,
  init: RequestInit,
): Promise<{ response: Response; url: URL } | null> {
  let target = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await doFetch(target.toString(), {
      ...init,
      redirect: 'manual',
    });
    const location =
      response.status >= 300 && response.status <= 399
        ? response.headers.get('location')
        : null;
    if (!location) return { response, url: target };

    let next: string;
    try {
      next = new URL(location, target).toString();
    } catch {
      return null;
    }
    const checked = parseReferenceTarget(next);
    if (!checked.ok) return null;
    target = checked.value;
  }
  // Out of hops. A chain this long is not answering.
  return null;
}

/**
 * The page's own stylesheets, as text, skipping any that misbehaves.
 *
 * Every failure here is swallowed deliberately. This exists to improve a
 * palette guess; nothing about it is worth failing a generation over, and a
 * reference site whose CSS 404s is not a reason to refuse the request.
 */
async function readStylesheets(
  html: string,
  pageUrl: string,
  doFetch: typeof fetch,
): Promise<string[]> {
  const urls = sameOriginStylesheets(html, pageUrl);
  if (urls.length === 0) return [];

  const deadline = AbortSignal.timeout(STYLESHEET_PHASE_MS);
  const fetched = await Promise.all(
    urls.map(async (url) => {
      // Re-validated even though same-origin already implies the page's own
      // host passed: this module does not get to be the one place that
      // starts trusting a URL because of where it came from.
      const target = parseReferenceTarget(url);
      if (!target.ok) return null;
      try {
        const landed = await fetchValidated(target.value, doFetch, {
          signal: deadline,
          headers: {
            accept: 'text/css,*/*;q=0.1',
            'user-agent': FETCH_USER_AGENT,
          },
        });
        if (!landed) return null;
        const { response } = landed;
        if (!response.ok || !response.body) return null;
        return await readCapped(response.body, MAX_STYLESHEET_BYTES);
      } catch {
        // Timed out, refused, or the body died partway. Not this feature's
        // problem to report.
        return null;
      }
    }),
  );
  return fetched.filter((sheet): sheet is string => sheet !== null);
}

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
  // `[^>]*` before the closing `>`, matching how a real HTML tokenizer
  // treats a closing tag: anything up to the next `>` ends it, attributes
  // and all -- `</script foo="bar">` really does close the element. CodeQL
  // flagged two narrower attempts here in turn (a bare `<\/script>` missed
  // `</script >`; requiring only whitespace via `\s*` still missed
  // `</script\t\n bar>`), so this matches the opening-tag pattern's own
  // shape instead of trying to enumerate what a closing tag may contain.
  const withoutScripts = html
    .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  // `&amp;` decoded LAST, not first: decoding it first turns a page's own
  // literal, doubly-encoded `&amp;lt;` into `&lt;` in time for the `&lt;`
  // rule below to decode it again into a real `<` -- reconstituting markup
  // the source page had safely escaped (CodeQL's "double escaping or
  // unescaping" finding). None of `&lt;`/`&gt;`/`&quot;`/`&#39;`/`&nbsp;`
  // can themselves produce a new `&amp;` match, so running them before
  // `&amp;` is the one order that decodes each entity exactly once.
  const unescaped = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&amp;/gi, '&');
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
  /** Set false to skip the stylesheet fetches. Tests that count requests use it. */
  readStylesheets?: boolean;
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
  let landedAt: URL;
  try {
    // The page's own redirects are checked too, and for the same reason the
    // stylesheets' are: the guard has to apply to the URL actually fetched,
    // not only to the one the user typed. One deadline covers the whole
    // chain rather than resetting at every hop.
    const landed = await fetchValidated(target.value, doFetch, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': FETCH_USER_AGENT,
      },
    });
    if (!landed) {
      return {
        ok: false,
        error: 'The reference URL redirected somewhere it cannot be followed.',
      };
    }
    response = landed.response;
    landedAt = landed.url;
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

  // Read from the markup before it is thrown away, and from the page's own
  // stylesheets, which is where most sites actually keep their colours.
  // Resolved against where the response actually came from, not where it was
  // asked for. A reference URL that redirects from `/old` to `/products/x/`
  // turns `href="theme.css"` into the wrong absolute URL if the original is
  // used as the base, and the sheet 404s. Every hop that got here has
  // already been through `parseReferenceTarget`, so the landing URL is one
  // this module decided to reach rather than one the network chose for it.
  const stylesheets =
    options.readStylesheets === false
      ? []
      : await readStylesheets(raw, landedAt.toString(), doFetch);

  return {
    ok: true,
    text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
    palette: paletteFromPage(raw, stylesheets),
  };
}
