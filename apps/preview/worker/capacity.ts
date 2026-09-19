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
 * named for building, and takes no fleet ticket (#196 review). The fleet
 * cannot see those, so a cap equal to the platform limit lets it admit a
 * preview the platform has no room for, and a deployment at its preview cap
 * has no room left to verify or publish anything. Both halves of that are
 * bad in the same way: a number that means something it does not.
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
 * several callers can be finishing runs at once. Its cost is five previews
 * this deployment will not run concurrently, which is the cheaper side of
 * the trade: a refused preview says so and can be retried, while a build
 * that cannot start makes the verification silently do nothing, which is
 * the failure this whole pull request exists to remove.
 */
export const BUILD_CONTAINER_HEADROOM = 5;

/** L9's account-wide preview concurrency cap. */
export const ACCOUNT_MAX_IN_FLIGHT =
  CONTAINER_MAX_INSTANCES - BUILD_CONTAINER_HEADROOM;
