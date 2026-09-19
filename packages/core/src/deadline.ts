/**
 * What a deadline throws, so a caller can tell being stopped from a real
 * failure and report it as the stop it is.
 */
export const OUT_OF_TIME = 'vibld:out-of-time';

/**
 * One awaited thing, bounded by a deadline.
 *
 * In `@vibld/core` because both deployments need it and a second copy is
 * the defect rather than the convenience (#196 review): `retrying` already
 * moved here for the same reason, after a duplicate of it shipped.
 *
 * Checking a deadline between operations bounds a build made of many quick
 * calls and does nothing about a build stuck inside one slow call. A single
 * `writeFile` hanging past the deadline left everything the bound was for:
 * the lock expired, a second build took the workspace, the fleet reclaimed
 * a ticket whose container was still up, and the stalled call eventually
 * landed in somebody else's tree.
 *
 * The losing operation is not cancelled, because none of these can be. What
 * this buys is that the build itself ends on time, so its teardown starts
 * on time and destroys the container, and destroying the container is what
 * actually stops an orphaned RPC.
 *
 * The timer is cleared on either outcome. A pending timer per file would
 * otherwise outlive the work it was watching, which in a Durable Object
 * means holding it awake for the rest of the build's budget, and in a test
 * run means the process never exits.
 */
export function withinDeadline<T>(
  work: Promise<T>,
  msLeft: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(OUT_OF_TIME)),
      Math.max(0, msLeft),
    );
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
