/**
 * Retry an API call that a rate limit refused (D68, Chris, 2026-09-29).
 *
 * app.vibld.com sits behind a Cloudflare rate-limiting rule with a ten
 * second window. One builder load from one address asks for access, the
 * deployment's config, billing and the project list at once, and the
 * production end-to-end run (36591020730) showed that burst tripping the
 * rule: Cloudflare answered 429 with its own HTML page and `Retry-After`,
 * and the builder showed "Could not reach your projects", the banner Chris
 * saw on the North Star project. The rule is being loosened; this is the
 * other half, so a burst that still trips it costs a short wait rather
 * than an error.
 *
 * A read (GET or HEAD to this origin's `/api/`) is retried on any 429. A
 * write is retried only on the edge's 429, which is Cloudflare's own page
 * and not JSON: it is sent before the request reaches the Worker, so the
 * write never happened. The run after the read retry shipped (36593518869)
 * showed the project list loading and the project's creation then refused
 * that way. The Worker's own 429s are JSON with a `reason` (its per-user
 * build limits), and a write they refuse is never sent again, and nor is
 * a write whose body cannot be sent twice.
 */

/** Retries after the first answer, so at most four requests in all. */
export const MAX_RETRIES = 3;

/** The longest single wait, whatever `Retry-After` asks. */
export const MAX_WAIT_MS = 10_000;

/** How long to wait before the retry numbered `attempt` (0 for the first). */
export function rateLimitDelayMs(
  retryAfter: string | null,
  attempt: number,
): number {
  const seconds = Number(retryAfter);
  const asked =
    retryAfter !== null && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : 1000 * 2 ** attempt;
  return Math.min(asked, MAX_WAIT_MS);
}

/** A request's method and URL, and whether it is to this origin's `/api/`. */
function describe(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
): { method: string; api: boolean } {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  let url: URL;
  try {
    const href =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    url = new URL(href, origin);
  } catch {
    return { method, api: false };
  }
  return {
    method,
    api: url.origin === origin && url.pathname.startsWith('/api/'),
  };
}

/** Whether a request is an API read on this origin. */
export function isRetryableRead(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
): boolean {
  const { method, api } = describe(input, init, origin);
  return api && (method === 'GET' || method === 'HEAD');
}

/**
 * Whether a write can be sent again as it was: not a `Request` (its body
 * is read once), and a body that is nothing, text, or form data rather
 * than a stream.
 */
export function canResendWrite(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): boolean {
  if (input instanceof Request) return false;
  const body = init?.body;
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof URLSearchParams ||
    (typeof FormData !== 'undefined' && body instanceof FormData)
  );
}

/**
 * Whether a 429 came from the edge rather than the Worker. The Worker
 * answers every refusal in JSON; Cloudflare's rate-limiting rule answers
 * with its own HTML page.
 */
export function isEdgeRefusal(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return response.status === 429 && !type.includes('application/json');
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  origin: string;
}

/** `fetchImpl`, with API calls a rate limit refused sent again. */
export function withRateLimitRetry(
  fetchImpl: typeof fetch,
  deps: RetryDeps,
): typeof fetch {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (input, init) => {
    const { method, api } = describe(input, init, deps.origin);
    if (!api) return fetchImpl(input, init);
    const read = method === 'GET' || method === 'HEAD';
    if (!read && !canResendWrite(input, init)) return fetchImpl(input, init);
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(input, init);
      if (response.status !== 429 || attempt >= MAX_RETRIES) return response;
      if (!read && !isEdgeRefusal(response)) return response;
      if (init?.signal?.aborted) return response;
      await response.body?.cancel().catch(() => undefined);
      await sleep(
        rateLimitDelayMs(response.headers.get('retry-after'), attempt),
      );
    }
  };
}

/**
 * Wrap the page's own `fetch`, once, before anything renders, so every
 * client (each picks up `globalThis.fetch` when it calls) gets the retry
 * without being changed one by one.
 */
export function installRateLimitRetry(target: typeof globalThis): void {
  const marked = target as typeof globalThis & { __vibldRetry?: true };
  if (marked.__vibldRetry) return;
  marked.__vibldRetry = true;
  target.fetch = withRateLimitRetry(target.fetch.bind(target), {
    origin: target.location.origin,
  });
}
