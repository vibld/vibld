import { HARD_LIFETIME_MS } from './fleet.ts';

/**
 * How long a Free account's previews may hold a container each UTC day
 * (D158, Chris, 2026-10-05), with no storage and no runtime behind it.
 * `PreviewFleet` keeps the sessions, one per admitted Free ticket, keyed
 * by the account whose preview it is, so the builder and every share link
 * of that account's projects draw on one day (internal PR 376 review).
 *
 * What is counted is the time a preview held a fleet slot, from admission
 * to release, because that is what a preview costs: a container is billed
 * while it is held, whether anybody is looking at it or not. A session
 * nobody ended counts until its hard lifetime, the most it could hold. A
 * session that crosses midnight counts its part after midnight against
 * the new day (internal PR 376 review), so no part of one is ever free.
 *
 * Checked when a preview is asked for, and again when a queued one is
 * about to be admitted, and never during one. Each check counts every
 * session still open at its whole lifetime, as if it will run to the end,
 * so starts made in parallel (the builder and several share links) cannot
 * each be let past on time not yet counted (internal PR 376 review). A day can
 * therefore run past the limit by at most one preview.
 */

/** Two hours a day unless the deployment says otherwise. */
export const DEFAULT_FREE_PREVIEW_DAILY_MINUTES = 120;

/** The sentence a Free start is refused with once the day is spent. */
export const FREE_PREVIEW_LIMIT_ERROR =
  "Today's preview time for this Free account is used up. It resets at midnight UTC, and a paid plan has no daily preview limit.";

/** One admission to the fleet: when it began and, once known, when it ended. */
export interface PreviewSession {
  began: number;
  ended?: number | null;
}

const DAY_MS = 24 * 60 * 60_000;

/** Midnight UTC at the start of the day `now` falls on. */
export function dayStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The earliest a session can begin and still have held a container today:
 * one hard lifetime before midnight. What the fleet reads from.
 */
export function countedSince(now: number): number {
  return dayStart(now) - HARD_LIFETIME_MS;
}

/**
 * The daily limit in milliseconds: the deployment's figure in minutes when
 * it is a whole number of zero or more, else the default. Zero turns Free
 * previews off.
 */
export function dailyLimitMs(configured: string | undefined): number {
  const minutes =
    configured !== undefined && /^\d+$/.test(configured.trim())
      ? Number(configured.trim())
      : DEFAULT_FREE_PREVIEW_DAILY_MINUTES;
  return minutes * 60_000;
}

/** What these sessions held today, counted as the module comment says. */
export function usedMs(sessions: PreviewSession[], now: number): number {
  const since = dayStart(now);
  let total = 0;
  for (const { began, ended } of sessions) {
    const end = Math.min(
      ended ?? began + HARD_LIFETIME_MS,
      began + HARD_LIFETIME_MS,
      now,
    );
    total += Math.max(0, end - Math.max(began, since));
  }
  return total;
}

/**
 * What these sessions may hold today at most: those that ended as they
 * held, and those still open to the end of their lifetime or of the day,
 * whichever comes first.
 */
export function heldAtMostMs(sessions: PreviewSession[], now: number): number {
  // The day `now` falls on: today for a check, or tomorrow's midnight to
  // ask what open sessions would already hold of it.
  const since = dayStart(now);
  // What runs past midnight is the next day's to count (internal PR 376 review).
  const until = since + DAY_MS;
  let total = 0;
  for (const { began, ended } of sessions) {
    const end = Math.min(
      ended ?? began + HARD_LIFETIME_MS,
      began + HARD_LIFETIME_MS,
      until,
    );
    total += Math.max(0, end - Math.max(began, since));
  }
  return total;
}

/**
 * Whether a Free preview may be asked for, or admitted, now.
 *
 * Tomorrow is checked as well as today (internal PR 376 review). What an open session
 * would hold after midnight is the next day's, and without this, starts
 * made just before midnight would each reserve a few seconds of today
 * while their lifetimes together spent tomorrow in advance. So the next
 * day too may start overrun by at most one preview.
 */
export function mayStart(
  sessions: PreviewSession[],
  now: number,
  limitMs: number,
): boolean {
  return (
    heldAtMostMs(sessions, now) < limitMs &&
    heldAtMostMs(sessions, dayStart(now) + DAY_MS) < limitMs
  );
}
