import { fetchGitHubStatus } from './github-client.ts';
import type { GitHubStatus } from './github-client.ts';

/**
 * One copy of "what is connected", shared by everything that shows it (#34).
 *
 * The panel in the header and the push button in the Code tab each kept their
 * own status and each probed for it separately, so the two could say
 * different things about the same connection. That is not hypothetical: the
 * panel's own disconnect path carries a comment about it, saying the button
 * "would otherwise go on offering a push to the repository this just found
 * out about, until somebody clicked it and was refused in turn". This is the
 * shared copy that comment was waiting for.
 *
 * Three behaviours, all of which already existed in one component or the
 * other and are kept because each has a reason:
 *
 *  - **A read only commits what it got.** A probe that fails leaves the last
 *    known connection alone rather than blanking it, so a dropped request
 *    does not tell somebody their repository is gone.
 *  - **A local write supersedes a read in flight.** Binding and disconnecting
 *    already know the answer, because the route just told them. A probe that
 *    started earlier must not land afterwards and put the old repository
 *    back.
 *  - **Forgetting is its own act.** When a route says the connection is
 *    somewhere else entirely, the honest state is "not known" rather than the
 *    name that has just been contradicted.
 *
 * JSX-free, and a plain object rather than a hook, for the reason the rest of
 * this directory is: the runner strips types and errors on JSX, so a rule
 * written inside a component is typechecked and never run.
 */
export interface GitHubStatusStore {
  /** The last known status, or null when there is not one. */
  read(): GitHubStatus | null;
  subscribe(listener: () => void): () => void;
  /**
   * Ask the route again. Concurrent callers join one request rather than
   * making two, which is the other half of the two components agreeing: two
   * probes racing can commit in either order.
   */
  refresh(): Promise<void>;
  /** Apply what a completed write already established, at once, everywhere. */
  amend(next: (previous: GitHubStatus | null) => GitHubStatus | null): void;
  /** Drop what is known, because something has contradicted it. */
  forget(): void;
}

export function createGitHubStatusStore(
  load: () => Promise<GitHubStatus | null> = fetchGitHubStatus,
): GitHubStatusStore {
  let value: GitHubStatus | null = null;
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const announce = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    read: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      if (inFlight) return inFlight;
      const mine = ++generation;
      inFlight = (async () => {
        const read = await load();
        // Two guards, not one. `mine === generation` is the supersede rule:
        // a local write since this started knows more than this does. `read`
        // being null is the commit-what-you-got rule: a failed probe is not
        // news that the connection is gone.
        if (mine === generation && read) {
          value = read;
          announce();
        }
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    amend(next) {
      generation += 1;
      value = next(value);
      announce();
    },
    forget() {
      generation += 1;
      value = null;
      announce();
    },
  };
}

/** The one every surface reads. */
export const githubStatus = createGitHubStatusStore();
