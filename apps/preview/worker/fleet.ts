/**
 * The arithmetic behind the account-wide preview concurrency cap
 * (docs/decisions.md L9), with no storage and no runtime behind it.
 *
 * Lives apart from `preview-fleet.ts`'s Durable Object for the same reason
 * `spend.ts` lives apart from `budget.ts`: the part that decides is testable
 * without a Workers runtime; the object owns durability and atomicity.
 *
 * Per-user concurrency (L9: "1 concurrent preview per user") needs none of
 * this -- it falls out of `getSandbox(env.Sandbox, userId)` for free, since
 * starting a second preview for the same user reuses the same Durable
 * Object rather than creating a competing one. This file is only the
 * account-wide layer: 25 concurrent across every user, with the 26th
 * queued rather than refused.
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

export interface QueueRow {
  id: number;
  requested: number;
}

/**
 * How many rows are strictly ahead of `row` in FIFO order among `waiting`
 * (rows not yet activated) -- the "visible position" L9 requires for a
 * queued request. Ties on `requested` (same millisecond) break on `id`,
 * which is assigned in insertion order, so the ordering is total and stable.
 */
export function queuePosition(row: QueueRow, waiting: QueueRow[]): number {
  return waiting.filter(
    (other) =>
      other.requested < row.requested ||
      (other.requested === row.requested && other.id < row.id),
  ).length;
}

/** How many of the oldest waiting rows can be activated right now. */
export function toActivate(
  waiting: QueueRow[],
  activeCount: number,
  maxInFlight: number,
): QueueRow[] {
  const room = Math.max(0, maxInFlight - activeCount);
  if (room === 0) return [];
  return [...waiting]
    .sort((a, b) => a.requested - b.requested || a.id - b.id)
    .slice(0, room);
}
