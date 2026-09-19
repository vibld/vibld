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
 * `E404` is deliberately absent. A package that does not exist is the
 * project's own mistake and is exactly what a repair turn can fix, which
 * is the one case this must not swallow.
 */
export const NETWORK_FAILURE_CODES = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ERR_SOCKET_TIMEOUT',
  'EPROTO',
  'ENETUNREACH',
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
