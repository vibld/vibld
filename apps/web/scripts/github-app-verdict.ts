/**
 * What GitHub's answer about the App means, decided apart from fetching it.
 *
 * Here rather than inside the script for the reason the panel's decisions
 * moved out of JSX: a script cannot be imported by a test, so every rule
 * written inside one is asserted by reading it. These three rules each came
 * from a review finding, so they are worth running.
 */

/** What this feature actually uses. */
export const NEEDED = { contents: 'write', pull_requests: 'write' };

/**
 * Everything the App may hold, and nothing else.
 *
 * `metadata` is not optional: GitHub grants it to every App and there is no
 * declining it. Anything beyond these widens what a leaked App key can do
 * across every installation at once, which is the blast radius that matters
 * for a key rather than for a token, so an extra scope is a failure rather
 * than a note.
 */
export const ALLOWED = new Set(['metadata', ...Object.keys(NEEDED)]);

/** One installation, as `GET /app/installations` describes it. */
export interface Installation {
  id: number;
  account?: { login?: string };
  permissions?: Record<string, string>;
}

export interface Verdict {
  missing: { name: string; level: string; has: string }[];
  extra: string[];
  lagging: { account: string; short: string[] }[];
  /** How many installations exist, or null when they could not be read. */
  installed: number | null;
}

/**
 * @param granted the App's own `permissions`, from `GET /app`
 * @param installed each installation's accepted `permissions`, or null when
 *   they could not be read
 */
export function appVerdict(
  granted: Record<string, string> | undefined,
  installed: Installation[] | null,
): Verdict {
  const held = granted ?? {};
  const missing = Object.entries(NEEDED)
    .filter(([name, level]) => held[name] !== level)
    .map(([name, level]) => ({ name, level, has: held[name] ?? 'absent' }));
  const extra = Object.keys(held).filter((name) => !ALLOWED.has(name));

  // What the App is configured to want is not what any installation has
  // agreed to give. Raising a permission takes effect only when each owner
  // accepts it, and until then that installation refuses the scopes the push
  // asks for and answers 422. Checking the App alone therefore passes in
  // exactly the state this exists to catch.
  const lagging = (installed ?? [])
    .map((one) => ({
      account: one.account?.login ?? `installation ${one.id}`,
      short: Object.entries(NEEDED)
        .filter(([name, level]) => (one.permissions ?? {})[name] !== level)
        .map(([name]) => name),
    }))
    .filter((one) => one.short.length > 0);

  return {
    missing,
    extra,
    lagging,
    installed: installed === null ? null : installed.length,
  };
}

/**
 * Whether the App is perfectly configured and has never been installed.
 *
 * This is the state a fully configured deployment sits in until somebody
 * installs the App on a repository, and it is indistinguishable from working
 * everywhere else: every secret is set, the permissions are exactly right,
 * the deploy is green, and the status route reports the feature as
 * configured. Nobody can push anything, because there is no installation for
 * a token to be minted against.
 *
 * It is the same shape as the signup-credit cutoff and the read-only App
 * this file already guards: green, and silently unable to do the thing.
 * Reading "Installations: 0" and drawing the conclusion is exactly what
 * nobody does, so it gets said.
 *
 * Null is not zero. An installation list that could not be read is unknown,
 * and claiming nobody has installed it would be inventing a fact from a
 * failed request.
 */
export function neverInstalled({ installed }: Pick<Verdict, 'installed'>) {
  return installed === 0;
}

/**
 * Whether the deploy should stop.
 *
 * Only for what this deployment controls. An installation that has not
 * accepted is somebody else's click, and refusing to ship anything until
 * another account acts would be worse than the thing it guards against, so
 * that is reported loudly and does not block.
 */
export function blocking({
  missing,
  extra,
}: Pick<Verdict, 'missing' | 'extra'>): boolean {
  return missing.length > 0 || extra.length > 0;
}
