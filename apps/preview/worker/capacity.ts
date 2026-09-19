/**
 * How many containers this deployment may have at once, and who gets them.
 *
 * `wrangler.jsonc` sets `max_instances` on the `PreviewSandbox` class, and
 * Cloudflare enforces it as a hard platform limit underneath
 * `PreviewFleet`'s own queue. The fleet's cap used to be that same number,
 * and its comment said the two could never disagree -- which was true while
 * every container was a preview.
 *
 * Since #196 it is not: a build runs in an instance of the same class,
 * named for building, and holds one of the platform's containers while it
 * does. The preview queue cannot see those, so a preview cap equal to the
 * platform limit lets it admit a preview the platform has no room for, and
 * a deployment at its preview cap has no room left to verify or publish
 * anything. Both halves of that are bad in the same way: a number that
 * means something it does not.
 *
 * So the platform limit is split rather than shared, and both sides are
 * counted. Previews fill the fleet's cap; builds fill the remainder,
 * against a `PreviewFleet` instance of their own. Subtracting the headroom
 * without counting builds only made the partition true on one side (#196
 * review): six builds could overlap nineteen previews and take every
 * platform slot while the fleet still believed it had room.
 *
 * Builds are short-lived, hold no exposed port, and destroy their container
 * as they finish rather than idling out the class's `sleepAfter`, so the
 * headroom is about how many can run at once rather than how many ran
 * recently.
 */

/**
 * The `PreviewFleet` instance that counts builds.
 *
 * Its own instance, not the preview queue: that queue's count is what
 * enforces L9, and mixing builds into it would make the preview cap mean
 * something else again. The class is a general reserve-now/release-later
 * counter; the name is what scopes it.
 */
export const BUILD_FLEET_NAME = 'builds';

/** What `wrangler.jsonc` gives the class. `capacity.test.ts` checks it. */
export const CONTAINER_MAX_INSTANCES = 25;

/**
 * Container slots kept back for builds.
 *
 * Five rather than one because a build is not the only thing in flight at
 * its own moment: a repair builds twice, auto-publish builds again, and
 * several callers can be finishing runs at once.
 */
export const BUILD_CONTAINER_HEADROOM = 5;

/**
 * How many previews may run at once, which is **not** L9's number, and that
 * is a question for the maintainer rather than a trade taken here
 * (#196 review).
 *
 * L9 reads "25 concurrent previews across all users. The 26th request is
 * queued with a visible position, not rejected." This is twenty, so the
 * twenty-first queues, and it is twenty whether or not anything is
 * building. The register's own rule is that an accepted decision changes
 * through a new ADR and an explicit register update, so nothing here
 * amends it: the number is written down as what it is, and the gap is
 * stated rather than reasoned away.
 *
 * Three ways out, and choosing between them is a product and spend call:
 *
 *  - **Raise `max_instances` to thirty.** L9 holds exactly and so does this
 *    partition. It buys five more concurrent `lite` containers, which is
 *    the part that is not mine to decide (L27 sizes the per-session cost
 *    estimate against this instance type).
 *  - **Count both workloads against one budget of twenty-five**, with
 *    builds bounded at five of it. Previews then get all twenty-five
 *    whenever nothing is building, which satisfies L9 whenever it can be
 *    satisfied, and a preview queues behind a build when the platform
 *    really is full. It costs nothing and it is not free either: it
 *    reopens the accounting that three review rounds went into, and it
 *    changes what a queued preview means.
 *  - **Amend L9 to twenty**, which is an ADR and a register update.
 *
 * What is not on offer is leaving the code and the register disagreeing
 * quietly, which is what this constant did until the nineteenth review
 * round noticed.
 */
export const ACCOUNT_MAX_IN_FLIGHT =
  CONTAINER_MAX_INSTANCES - BUILD_CONTAINER_HEADROOM;
