/**
 * Asking a Durable Object again, a bounded number of times, without letting
 * the asking become the failure.
 *
 * Three places need exactly this and reached for it separately (#196
 * review): closing the repair's own reservation, releasing an account hold
 * when a later ceiling could not be asked, and giving a build's fleet
 * ticket back. All three are cleanup on an error path, all three are
 * idempotent, and in each the thing being retried is a Durable Object that
 * is restarting -- which is over in seconds, so one immediate retry would
 * land inside the same restart it was retrying.
 *
 * Here rather than in either Worker because the third caller is in the
 * other deployment (`apps/preview`). Both depend on this package already,
 * and a second copy of a retry is how two cleanups come to disagree about
 * how hard they try.
 *
 * Neither one may throw. A hold that cannot be closed is money the reclaim
 * will charge in full; letting that failure escape loses the caller's work
 * on top and closes nothing, so the answer is a value the caller has to
 * read rather than an exception it can forget to catch.
 */

/** How many times, and how long between: shared so the two agree. */
export const RETRY_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1_000;

export type Attempted<T> =
  { ok: true; value: T } | { ok: false; error: unknown };

/** The real delay, replaced in tests so they do not spend it. */
export const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retrying<T>(
  step: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
  attempts: number = RETRY_ATTEMPTS,
): Promise<Attempted<T>> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ok: true, value: await step() };
    } catch (error) {
      last = error;
      // Backing off a little further each time, and not at all after the
      // last attempt: a delay nothing follows is only latency.
      if (attempt < attempts) await wait(RETRY_DELAY_MS * attempt);
    }
  }
  return { ok: false, error: last };
}
