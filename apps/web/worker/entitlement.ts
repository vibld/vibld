import { monthKey } from './spend.ts';
import type { SubscriptionRecord } from './billing-store.ts';

/**
 * What a subscribed tier actually buys (docs/decisions.md L35-L39), pure and
 * storage-free -- `handlePlan` (`index.ts`) is the only caller, and it owns
 * looking up a subscription and turning the result into a ledger call.
 */

export type Tier = 'free' | 'build' | 'ship';

/**
 * Included monthly model spend, in micro-USD, for Build and Ship -- fixed by
 * the accepted price table (L36) and not configurable: correcting either
 * means changing the Stripe price too, not just this number.
 */
export const TIER_INCLUDED_MICRO_USD: Record<Exclude<Tier, 'free'>, number> = {
  build: 10_000_000,
  ship: 40_000_000,
};

/** L36: Free is $1/mo. The one tier an operator may still override -- see index.ts's `VIBLD_FREE_MONTHLY_MICRO_USD`. */
export const DEFAULT_FREE_INCLUDED_MICRO_USD = 1_000_000;

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * Free unless the mirrored subscription is actually in force. A `canceled`,
 * `unpaid` or `past_due` row still exists in `billing_subscriptions` (it is
 * never deleted, only its status updated), so the status is what decides
 * this, not the row's mere presence.
 */
export function tierFor(
  subscription: Pick<SubscriptionRecord, 'tier' | 'status'> | undefined,
): Tier {
  if (subscription && ACTIVE_STATUSES.has(subscription.status)) {
    return subscription.tier;
  }
  return 'free';
}

/**
 * Active projects a tier may have at once (docs/decisions.md, "Resolved
 * 2026-09-28", projects), or `null` for no limit.
 *
 * Active means not archived. Archived projects are unlimited on every
 * tier, so the limit is on how many things somebody is working on, not on
 * how much they have ever made: archiving one is always a way to start
 * another, and nothing a free account made has to be deleted to stay free.
 *
 * Beside the allowances because it is the same kind of fact, what a plan
 * buys, and is decided by the same `tierFor` reading of the same
 * subscription. A suspension does not change it: a project costs nothing
 * to hold, and the suspension already refuses every run that would.
 */
export const ACTIVE_PROJECT_LIMIT: Record<Tier, number | null> = {
  free: 3,
  build: null,
  ship: null,
};

export function monthlyAllowanceMicroUsd(
  tier: Tier,
  freeIncludedMicroUsd: number,
): number {
  return tier === 'free' ? freeIncludedMicroUsd : TIER_INCLUDED_MICRO_USD[tier];
}

/**
 * The ledger period a monthly allowance resets against: the UTC calendar
 * month, for every user alike.
 *
 * A deliberate simplification of each subscription's own billing-cycle
 * anchor (Stripe's `current_period_end`, already mirrored in
 * `billing_subscriptions` but unused here) -- someone who subscribes on the
 * 28th gets a partial first month rather than a full one starting from their
 * own renewal date. Anchoring to each subscription's real cycle instead is a
 * real refinement, just not this one's: it would mean this function taking
 * the subscription (for its period start) rather than only the clock, and
 * every user's reset landing on a different day of the month rather than one
 * shared boundary everyone can reason about.
 */
export function allowancePeriodKey(at: number): string {
  return monthKey(at);
}
