/**
 * How many containers this deployment may have at once, and who gets them.
 *
 * `wrangler.jsonc` sets `max_instances` on the `PreviewSandbox` class, and
 * Cloudflare enforces it as a hard platform limit underneath
 * `PreviewFleet`'s own queue. Until internal PR 196 every container of that class was
 * a preview, so the platform limit and L9's preview cap were the same
 * number.
 *
 * Since internal PR 196 a build runs in an instance of the same class, named for
 * building, and holds one of the platform's containers while it does. Internal PR 196
 * split the budget statically to keep the fleet from admitting a preview
 * the platform had no room for: twenty for previews, five kept back for
 * builds, counted by two separate fleet instances. That was safe and it
 * broke L9, which reads "25 concurrent previews across all users. The 26th
 * request is queued with a visible position, not rejected." The
 * twenty-first preview queued whether or not anything was building.
 *
 * Chris chose the shared budget on 2026-09-27 (internal issue 197), and this is it:
 * previews and builds are counted against one budget of twenty-five, in one
 * `PreviewFleet` instance, with builds bounded at five of it. Previews get
 * all twenty-five whenever nothing is building, which meets L9 whenever a
 * twenty-five container budget can meet it, and a preview queues behind a
 * build only when every container is genuinely taken. A queued preview may
 * therefore be waiting for a build to finish rather than for another
 * preview, and its position still counts truthfully: builds never wait in
 * the queue (see `BUILD_MAX_IN_FLIGHT`), so everybody ahead of it is a
 * preview, and whichever kind of work frees a container, it goes to the
 * head of the queue.
 *
 * One counter rather than two is also what keeps the total honest. The
 * static split was counted on both sides only after a review round found
 * six builds overlapping nineteen previews with the fleet still believing
 * it had room; a single table that counts every container it has
 * authorised cannot be out of step with itself that way.
 *
 * The limits live here and the fleet reads them itself. Callers used to
 * pass their cap on every call, which was harmless while each instance
 * served one kind of caller. With both kinds sharing one instance, a
 * release that passed the wrong cap would promote the queue under it, so
 * no caller passes a cap any more.
 */

/** The one `PreviewFleet` instance, which counts previews and builds alike. */
export const FLEET_NAME = 'fleet';

/** What `wrangler.jsonc` gives the class. `capacity.test.ts` checks it. */
export const CONTAINER_MAX_INSTANCES = 25;

/**
 * How many containers the fleet authorises at once, previews and builds
 * together: the whole platform limit, and L9's twenty-five when nothing is
 * building.
 */
export const ACCOUNT_MAX_IN_FLIGHT = CONTAINER_MAX_INSTANCES;

/**
 * How many of those may be builds at once.
 *
 * Five rather than one because a build is not the only thing in flight at
 * its own moment: a repair builds twice, auto-publish builds again, and
 * several callers can be finishing runs at once. A bound inside the budget
 * rather than slots kept back beside it, so previews lose nothing to it
 * while nothing is building, and can never be left with fewer than twenty.
 *
 * A build over the bound, or one that finds every container taken, is
 * refused on the spot rather than queued. It has a paid Workflow waiting on
 * its answer, so waiting would spend that Workflow's timeout, and a build
 * row left waiting would sit in front of previews and could be promoted
 * later for a caller that was already told `busy`.
 *
 * Builds are short-lived, hold no exposed port, and destroy their container
 * as they finish rather than idling out the class's `sleepAfter`, so the
 * bound is about how many can run at once rather than how many ran
 * recently.
 */
export const BUILD_MAX_IN_FLIGHT = 5;

/**
 * How many containers a Free preview may never take (D158, Chris,
 * 2026-10-05), so Free use filling the fleet cannot queue paying accounts.
 * A Free preview starts only while this many would still be free after it;
 * paid previews and builds may use every one. Five of the twenty-five, the
 * figure Chris agreed to.
 */
export const PAID_PREVIEW_RESERVED = 5;
