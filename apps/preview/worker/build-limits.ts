/**
 * What a build is given, and how long its lock outlives that.
 *
 * Their own module so the relationship between them can be asserted on the
 * real values rather than parsed back out of source: `preview-sandbox.ts`
 * imports `@cloudflare/sandbox` and cannot be loaded under `node --test`,
 * and this is arithmetic worth checking rather than describing. Same
 * reasoning as `build-sandbox.ts` beside it.
 */

/**
 * What each half of a build is given before it is abandoned.
 *
 * Bounded at all because the command is the generated project's to declare
 * (#196 review). `npm run build` is whatever its package.json says, and a
 * manifest naming a watch-mode script never returns: the build held its
 * lock forever, the lock aged out under a second build that then emptied
 * the workspace beneath the first, and the paid Workflow waiting on the
 * answer sat there until its own step timed out. None of that needs a bad
 * actor; one plausible wrong script does it.
 *
 * Generous against what they measure: an install and a production build of
 * a generated Vite project are a minute or two, and every build here starts
 * from an empty workspace, so the install is always a cold one.
 */
export const BUILD_INSTALL_TIMEOUT_MS = 5 * 60_000;
export const BUILD_COMPILE_TIMEOUT_MS = 5 * 60_000;

/**
 * How long a build lock is believed before the build holding it is treated
 * as gone.
 *
 * Strictly greater than the two bounds above, and that ordering is the
 * point rather than the number: a lock that expired while its own build was
 * still legitimately running is what let two builds share one workspace.
 * The slack covers everything between the timed commands -- writing the
 * project out, reading the output back -- and `build-limits.test.ts`
 * asserts the ordering, so neither half can be raised without the lock
 * being raised with it.
 */
export const BUILD_LOCK_TTL_MS = 15 * 60_000;

/**
 * How long a whole build may take before it gives up.
 *
 * The thing that was missing, and the reason three rounds of review each
 * found another place a heartbeat did not reach (#196 review). Install and
 * compile were bounded; writing the project in, reading the output back and
 * tearing the container down were not, so a build had no maximum duration
 * at all. Every protection around it was a heartbeat, and a heartbeat has
 * to cover every `await` or it proves nothing: the twenty-second round
 * found the write loop unprotected, and the twenty-third found that the
 * fleet ticket, which has a hard lifetime rather than a heartbeat, could be
 * reclaimed underneath a build that was still running.
 *
 * A bound is what makes the other numbers provable instead of hopeful:
 *
 *  - It is under `BUILD_LOCK_TTL_MS`, so a build that is still running
 *    cannot have its lock expire. The TTL then means what it was always
 *    supposed to mean, which is "the build holding this is gone", rather
 *    than "the build holding this is slow".
 *  - Added to `MAX_DESTROY_WAIT_MS` it stays under the fleet's
 *    `HARD_LIFETIME_MS`, so `reclaimStale` cannot release the ticket of a
 *    build whose container is still up. That was the over-admission the
 *    fleet counter exists to prevent, arriving through the one door nobody
 *    had a heartbeat on.
 *  - It leaves room above the two command bounds for the per-file loops.
 *
 * `build-limits.test.ts` asserts all three, on the real values.
 *
 * Reaching it is reported as `sandbox`, never as a verdict on the project:
 * a build that was stopped measured nothing.
 */
export const BUILD_WALL_CLOCK_MS = 12 * 60_000;

/**
 * How often the lock is pushed forward while a teardown is in flight, and
 * how long that may go on.
 *
 * `destroy()` has no deadline of its own, and the renewals around the build
 * stopped at the edge of teardown, so a destroy that blocked past the TTL
 * let another build take the lock and start in the same sandbox -- which
 * the first destroy then killed (#196 review). The lock is held for the
 * whole teardown now, which needs these two.
 *
 * Both sit inside `BUILD_LOCK_TTL_MS`: the interval so a renewal always
 * lands before the lock could expire, and the cap so a destroy that never
 * settles stops renewing rather than blocking this user's builds for good.
 * `build-limits.test.ts` asserts both, because a comment saying "inside" is
 * how the other three numbers here came to disagree.
 */
export const LOCK_RENEWAL_INTERVAL_MS = 60_000;
export const MAX_DESTROY_WAIT_MS = 10 * 60_000;

/**
 * How long one call to the fleet Durable Object may stay pending, and how
 * long the whole teardown may take (#196 review).
 *
 * The same hazard as everything else on this pull request, on the last two
 * places in this file's code that did not have it. `releaseTicket` retries,
 * and `retrying` never reaches its second attempt if the first never
 * settles: a ticket for a build refused before anything ran is the one kind
 * `PreviewFleet.reclaimStale` never reclaims, so that release is the only
 * cleanup there is and an unbounded one is no cleanup at all. And
 * `releaseBuild`'s own storage reads had no clock, so a stalled one left the
 * teardown pending with a ticket still held.
 *
 * Seconds for the call, because these are same-colocation object calls and
 * `retrying` waits a second between attempts, a pace that assumes sub-second
 * answers. Minutes for the teardown, because it contains
 * `MAX_DESTROY_WAIT_MS` and has to be able to finish what it starts.
 *
 * The relationship that matters is with `HARD_LIFETIME_MS`: a teardown that
 * gives up holds an active ticket, which is safe only because the fleet
 * reclaims activated rows. The whole teardown plus its last release has to
 * fit inside that lifetime, or the cleanup is racing the thing it exists to
 * make unnecessary. `build-limits.test.ts` adds it up.
 */
export const FLEET_CALL_TIMEOUT_MS = 15_000;
export const TEARDOWN_WALL_CLOCK_MS = 12 * 60_000;
