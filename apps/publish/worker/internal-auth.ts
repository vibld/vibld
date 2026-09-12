/**
 * Gate for this Worker's internal API (publish a project's built output).
 *
 * Same shape as apps/preview/worker/internal-auth.ts, and for the same
 * reason: this Worker answers two entirely different kinds of request on
 * the same origin -- public, unauthenticated traffic for
 * `*.published.vibld-preview.dev` (served straight out of R2 by the public
 * fetch handler) and the internal control-plane call apps/web makes over a
 * service binding to actually publish a project. The internal path must
 * refuse anyone who isn't apps/web -- a public caller could otherwise send
 * a request that merely *looks* like the internal one.
 *
 * A shared secret, not the caller's identity, because apps/web has already
 * done that check (Clerk, via `resolvePrincipal`) before it ever calls
 * here -- this is one trusted service confirming the request came from
 * another trusted service, the same shape ADR-0006 asks for at every
 * boundary. Deliberately a separate secret from PREVIEW_INTERNAL_SECRET:
 * this is a different Worker, and a leak of one must not compromise the
 * other.
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
