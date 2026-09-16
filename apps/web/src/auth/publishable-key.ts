/**
 * What counts as a Clerk publishable key, in one place.
 *
 * Two callers need the same answer and used to disagree. The shell asked
 * `Boolean(key)`, so a key of one space was configured as far as it was
 * concerned and `ClerkProvider` received a space: not the unconfigured
 * fallback, which renders without Clerk on purpose, but a provider that
 * cannot mint a session. The deploy preflight asked `=== ''` and let the
 * same value through. Between them a deployment could go out where the
 * browser has no working identity and the Worker refuses every request for
 * want of a token.
 *
 * Dependency-free so both can import it: the preflight runs on a CI runner
 * before `pnpm install`, and this file is also in the browser bundle.
 *
 * Deliberately not a `pk_test_`/`pk_live_` prefix check. The failure this
 * guards against is a key that is not a key at all; refusing a deploy
 * because Clerk changed a prefix would be the same outage from the other
 * direction, and this codebase has now produced that mistake twice.
 */
export function usablePublishableKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // No internal whitespace either: a key with a space inside it is not one
  // that was typed correctly and cannot authenticate anybody.
  if (trimmed.length === 0 || /\s/.test(trimmed)) return null;
  return trimmed;
}
