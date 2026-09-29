/**
 * Retry an API read that a rate limit refused (D68, Chris, 2026-09-29).
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
 * Only reads are retried: a GET or HEAD to this origin's `/api/`. A write
 * that was refused may still be retried by the person, who can see what
 * happened; one retried here could land twice.
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

/** Whether a request is an API read on this origin. */
export function isRetryableRead(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
): boolean {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
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
    return false;
  }
  return url.origin === origin && url.pathname.startsWith('/api/');
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  origin: string;
}

/** `fetchImpl`, with API reads retried on 429. */
export function withRateLimitRetry(
  fetchImpl: typeof fetch,
  deps: RetryDeps,
): typeof fetch {
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (input, init) => {
    if (!isRetryableRead(input, init, deps.origin)) {
      return fetchImpl(input, init);
    }
    for (let attempt = 0; ; attempt += 1) {
      // A Request's body is read once; a GET has none, so it can be sent
      // again as it is.
      const response = await fetchImpl(input, init);
      if (response.status !== 429 || attempt >= MAX_RETRIES) return response;
      if (init?.signal?.aborted) return response;
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
