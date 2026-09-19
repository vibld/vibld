/**
 * Telling a failure of the project from a failure of the things around it.
 *
 * Its own module so it can be called rather than read: `preview-sandbox.ts`
 * imports `@cloudflare/sandbox` and cannot be loaded under `node --test`,
 * and every assertion about it so far has been a regex over source. That is
 * a poor instrument for a decision this consequential -- the answer decides
 * whether a caller is charged for a second model call (#196 review).
 */

/**
 * npm's own codes for "I could not reach the registry".
 *
 * A list of codes rather than a search for the word "network": these are
 * what npm prints, they are stable, and each names a failure of the
 * connection rather than of the manifest.
 *
 * `E404` is deliberately absent, and is the reason this is a list rather
 * than a pattern over `E4xx`/`E5xx`: a package that does not exist is the
 * project's own mistake and is exactly what a repair turn can fix, which is
 * the one case this must not swallow. `E403` and `E401` are absent for the
 * same reason -- a private package the project has no right to is a fact
 * about the project.
 */
export const NETWORK_FAILURE_CODES = [
  // Could not reach the registry at all.
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ERR_SOCKET_TIMEOUT',
  'EPROTO',
  'ENETUNREACH',
  // Reached it and it was not well (#196 review). The first list covered
  // only the case where the connection fails, which is the smaller half of
  // "npm is having a bad day": a registry that answers 503 is squarely an
  // outage, and npm reports it as `E503`. Leaving these out meant the
  // classifier missed the outage it was written for whenever the registry
  // was up enough to say no.
  'E500',
  'E502',
  'E503',
  'E504',
  // Not an outage, and not the project either: npm is refusing to serve
  // this caller for now, and the same request later succeeds.
  'E429',
] as const;

/**
 * Whether a failed `npm install` was the registry rather than the project.
 *
 * Matching on wording, which #194 deliberately moved away from for the
 * *caller's* decision. The difference is which layer: the caller decides
 * from a typed reason, and this is where that reason is worked out, from
 * the only signal there is. Erring toward "not the project" is the cheap
 * direction, because at worst a genuine dependency error goes unrepaired,
 * which spends nothing and claims nothing.
 */
export function networkFailure(said: string): boolean {
  return NETWORK_FAILURE_CODES.some((code) => said.includes(code));
}
