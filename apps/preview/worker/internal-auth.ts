/**
 * Gate for this Worker's internal API (start/status/stop a preview).
 *
 * This Worker answers two entirely different kinds of request on the same
 * origin: public, unauthenticated traffic for `*.vibld-preview.dev` (proxied
 * straight into a sandbox by `proxyToSandbox`, per L8's isolated-origin
 * requirement) and the internal control-plane calls apps/web makes over a
 * service binding to actually start/stop a preview. A service binding call
 * never crosses the public internet, but the same Worker script still
 * answers both kinds of request, so the internal path must refuse anyone who
 * isn't apps/web -- a public caller could otherwise send a request that
 * merely *looks* like the internal one.
 *
 * A shared secret, not the caller's identity, because apps/web has already
 * done that check (Clerk, via `resolvePrincipal`) before it ever calls
 * here -- this is one trusted service confirming the request came from
 * another trusted service, the same shape ADR-0006 asks for at every
 * boundary.
 */

const SCHEME = 'Bearer ';

export function isAuthorizedInternalCaller(
  headers: Headers,
  secret: string | undefined,
): boolean {
  // Fail closed: an unconfigured secret must refuse every caller, never
  // admit one because there was nothing to check against.
  if (!secret) return false;
  const header = headers.get('Authorization');
  if (!header || !header.startsWith(SCHEME)) return false;
  return header.slice(SCHEME.length) === secret;
}
