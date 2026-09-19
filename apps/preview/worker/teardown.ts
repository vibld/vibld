import { budgeted, withinDeadline } from '@vibld/core';

/**
 * Waiting for a container to die while keeping the lock alive, bounded
 * (#196 review).
 *
 * A destroy is the only thing that actually stops an orphaned RPC, so the
 * teardown waits for one; and a container that will not die must not hold
 * the wait open forever, because the caller is holding both the workspace
 * lock and a fleet ticket while it waits. The cap is what turns "will not
 * die" into a refusal.
 *
 * Every wait inside it is bounded by what is left of that cap, which is
 * the finding this loop had twice over. Awaited directly, a storage call
 * that stalled inside the renewal never came back to the loop's own clock
 * check, so the cap bounded everything except the one call that could
 * stall: `releaseBuild` sat there holding the lock and the ticket, and a
 * destroy that settled in the meantime went unnoticed until storage
 * resumed. Its sibling was quieter: the interval was a bare `setTimeout`
 * inside a race, so every iteration left a timer running for the rest of
 * its minute. In a Durable Object that is the object held awake after the
 * work it was watching finished, which is what `withinDeadline` clears its
 * timer for.
 *
 * Here rather than in `preview-sandbox.ts` because that module imports
 * `@cloudflare/sandbox` and cannot be loaded under `node --test`. A loop
 * whose arithmetic no test can call is the shape that produced every
 * finding on this pull request.
 *
 * `false` is the safe answer and the only one it invents: a container in
 * an unknown state keeps its lock and its ticket, so nobody is sent into
 * it and the fleet does not authorise a replacement the platform has no
 * room for.
 */
export async function destroyWithin(
  destroyed: Promise<boolean>,
  renew: () => Promise<unknown>,
  every: number,
  until: number,
  now: () => number = Date.now,
): Promise<boolean> {
  while (now() < until) {
    // `destroyed` answers rather than rejects, so the only rejection here
    // is the deadline, and the deadline is "not yet" rather than a
    // failure: the wait is the pacing between renewals.
    const settled = await withinDeadline(
      destroyed,
      budgeted(every, until - now()),
    ).catch(() => undefined);
    if (settled !== undefined) return settled;
    // Giving up on a renewal is giving up on the teardown. The lock is
    // what makes destroying this container safe, and a renewal that will
    // not answer is a lock nobody can vouch for.
    try {
      await withinDeadline(renew(), until - now());
    } catch {
      return false;
    }
  }
  return false;
}
