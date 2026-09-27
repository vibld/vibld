/**
 * Platform admin grants (docs/decisions.md L4).
 *
 * Deliberately not derivable from anything inside the running application:
 * `VIBLD_PLATFORM_ADMINS` is a GitHub Actions secret, synced to a Worker
 * secret by the deploy workflow the same way `VIBLD_MODEL_POLICY` already
 * is. Admin status can only be granted by someone who can push to the
 * repository -- never by a request the Worker itself handles.
 */

/** Parses the comma-separated list into a normalised set for membership checks. */
export function parsePlatformAdmins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * True only when the caller's email is both present, Clerk-verified, and on
 * the list -- all three, not two out of three. An email claim with no
 * verification status attached (the customization described in the README
 * not yet configured on the Clerk instance) must not be treated as
 * verified by default: that would turn a missing dashboard setting into an
 * open admin grant for anyone who can put any string in an email field.
 */
export function isPlatformAdmin(
  claims: { email?: string; emailVerified?: boolean },
  admins: Set<string>,
): boolean {
  if (!claims.email || claims.emailVerified !== true) return false;
  return admins.has(claims.email.trim().toLowerCase());
}
