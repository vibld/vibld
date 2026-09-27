/**
 * The arithmetic behind the account-wide container budget
 * (docs/decisions.md L9, and #197 for how builds share it), with no storage
 * and no runtime behind it.
 *
 * Lives apart from `preview-fleet.ts`'s Durable Object for the same reason
 * `spend.ts` lives apart from `budget.ts`: the part that decides is testable
 * without a Workers runtime; the object owns durability and atomicity.
 *
 * Per-user concurrency (L9: "1 concurrent preview per user") needs none of
 * this -- it falls out of `getSandbox(env.Sandbox, userId)` for free, since
 * starting a second preview for the same user reuses the same Durable
 * Object rather than creating a competing one. This file is only the
 * account-wide layer: 25 concurrent containers across every user, previews
 * and builds together, with builds bounded at 5 of them and the 26th
 * preview queued rather than refused. `capacity.ts` says why the two share
 * one budget.
 */

/**
 * A sandbox's hard lifetime (L9): 30 minutes, regardless of activity. A
 * queue slot activated longer ago than this without being released is
 * reclaimed -- a crashed Worker or a client that never called stop must not
 * hold a slot forever.
 */
export const HARD_LIFETIME_MS = 30 * 60_000;

/** True once an activated slot has outlived the hard lifetime unreleased. */
export function isStale(activatedAt: number, now: number): boolean {
  return activatedAt < now - HARD_LIFETIME_MS;
}

/**
 * How long a row may wait with nobody asking after it before it is treated
 * as abandoned (#199).
 *
 * The reclaim above only ever looked at rows it had activated, so a row
 * that was still waiting had no expiry at all. That is the one kind of
 * ticket nothing in this system can clean up on its own, and it is not
 * harmless while it waits: it is promoted later, for a caller that gave up
 * long ago, and only then starts its thirty-minute lifetime holding a slot
 * somebody else wanted. Three separate findings on #196 were that leak
 * arriving from three directions, each fixed by making one more release
 * path infallible, which is an argument that stops working the moment
 * somebody adds a fourth.
 *
 * Measured from the last time anybody asked about the row rather than from
 * when it was requested, because those differ for the two callers and only
 * one of them is a leak. A preview's client polls `status` for as long as
 * its reader is watching, which refreshes this and means a queue deeper
 * than this figure still never drops a waiting user. A build never asks
 * again: it awaits `enqueue` once, gives up on its own wall clock, and
 * relies on a late release. So this figure has to outlast everything a
 * build could still be doing with the answer, and `fleet-abandoned.test.ts`
 * adds that up.
 *
 * The same thirty minutes as the hard lifetime, deliberately: a row nobody
 * has mentioned for as long as a sandbox is allowed to exist is not one
 * anybody is waiting on.
 */
export const ABANDONED_AFTER_MS = HARD_LIFETIME_MS;

/** True once nobody has asked about a still-waiting row for that long. */
export function isAbandoned(lastSeenAt: number, now: number): boolean {
  return lastSeenAt < now - ABANDONED_AFTER_MS;
}

/** What a row is holding, or waiting to hold, a container for. */
export type FleetKind = 'preview' | 'build';

export interface QueueRow {
  id: number;
  requested: number;
  /**
   * Absent means a preview, because that is what every row was before
   * builds shared the counter, and it is the default the table's column
   * gives those rows too. `PreviewFleet` writes the kind on every row it
   * inserts, so a build is never read as a preview this way.
   */
  kind?: FleetKind;
}

/** How many builds hold a container now, and how many may. */
export interface BuildRoom {
  active: number;
  max: number;
}

/**
 * What `toActivate` assumes when it is not told about builds: none may
 * start. A caller that forgot the bound refuses builds rather than letting
 * them take the previews' containers without one.
 */
const NO_BUILD_ROOM: BuildRoom = { active: 0, max: 0 };

/**
 * How many rows are strictly ahead of `row` in FIFO order among `waiting`
 * (rows not yet activated) -- the "visible position" L9 requires for a
 * queued request. Ties on `requested` (same millisecond) break on `id`,
 * which is assigned in insertion order, so the ordering is total and stable.
 *
 * Still a count of the previews ahead since builds share the budget
 * (#197): a build is refused rather than left waiting, so every waiting row
 * is a preview, and a container freed by either kind goes to the head of
 * the queue. A position of N therefore means N containers have to free up
 * first, whichever kind of work is holding them.
 */
export function queuePosition(row: QueueRow, waiting: QueueRow[]): number {
  return waiting.filter(
    (other) =>
      other.requested < row.requested ||
      (other.requested === row.requested && other.id < row.id),
  ).length;
}

/**
 * Which of the oldest waiting rows can be activated right now.
 *
 * Two constraints inside one counter (#197). Every row, of either kind,
 * needs room in the whole budget: `activeCount` counts previews and builds
 * together against `maxInFlight`. A build also needs room under the build
 * bound, and a build that bound is holding back is passed over rather than
 * waited for: it is not holding a container, so a preview behind it is not
 * waiting for the platform, and stopping there would queue that preview
 * while containers sit free.
 *
 * FIFO otherwise, so a preview is never passed by a later one, and a build
 * by a later build.
 */
export function toActivate(
  waiting: QueueRow[],
  activeCount: number,
  maxInFlight: number,
  builds: BuildRoom = NO_BUILD_ROOM,
): QueueRow[] {
  let room = Math.max(0, maxInFlight - activeCount);
  let buildRoom = Math.max(0, builds.max - builds.active);
  const admitted: QueueRow[] = [];
  const ordered = [...waiting].sort(
    (a, b) => a.requested - b.requested || a.id - b.id,
  );
  for (const row of ordered) {
    if (room === 0) break;
    if (row.kind === 'build') {
      if (buildRoom === 0) continue;
      buildRoom--;
    }
    room--;
    admitted.push(row);
  }
  return admitted;
}
