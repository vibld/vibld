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
