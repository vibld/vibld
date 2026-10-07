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
  build: 14_000_000,
  ship: 40_000_000,
};

/** L36: Free is $1/mo. The one tier an operator may still override -- see index.ts's `VIBLD_FREE_MONTHLY_MICRO_USD`. */
export const DEFAULT_FREE_INCLUDED_MICRO_USD = 1_000_000;

/**
 * D159: a Free account with no card on file has a trial instead of the
 * monthly dollar, $0.20 once, about two builds on Luna. The one an operator
 * may override is `VIBLD_FREE_TRIAL_MICRO_USD` (spendable.ts).
 */
export const DEFAULT_FREE_TRIAL_MICRO_USD = 200_000;

/**
 * The ledger period a trial is spent against: one for the life of the
 * account, so it never resets. Opaque to `UserBudget`, as a month key is.
 * Saving a card moves the account to the month's period, and what the
 * trial spent stays where it was.
 */
export const TRIAL_PERIOD_KEY = 'trial';

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

/**
 * How the tiers order, for "the higher of the two" (D73). Free is the
 * floor every account has without paying.
 */
export const TIER_RANK: Record<Tier, number> = { free: 0, build: 1, ship: 2 };

/** A paid tier an admin gave with no Stripe charge (`plan_gifts`). */
export interface PlanGift {
  tier: Exclude<Tier, 'free'>;
  /** Exclusive end, ISO 8601, or null for no end date. */
  endsAt: string | null;
  revokedAt: string | null;
}

/**
 * Whether a gift is giving its tier at this instant: not revoked, and not
 * past its end date. An end date that cannot be read is treated as passed,
 * so a malformed row withholds a plan rather than handing one out for ever.
 */
export function giftInForce(gift: PlanGift, now: number): boolean {
  if (gift.revokedAt !== null) return false;
  if (gift.endsAt === null) return true;
  const end = Date.parse(gift.endsAt);
  return Number.isFinite(end) && now < end;
}

export interface EffectiveTier {
  tier: Tier;
  /**
   * True when the gift is what gives this tier: it is in force and ranks
   * above the subscription's. A gift equal to what somebody already pays
   * for changes nothing, so it is not what their plan is.
   */
  gifted: boolean;
  /** The gift in force, whether or not it is the one that decides. */
  gift: PlanGift | null;
}

/**
 * The tier an account has, from its subscription and any gift (D73): the
 * higher of the two while the gift is in force, and the subscription's
 * alone otherwise.
 *
 * Pure and beside `tierFor` because it is the same question. Every place
 * that read `tierFor(subscription)` for a limit, an allowance or a model
 * now reads this, so a gift counts wherever a paid plan does.
 */
export function effectiveTier(
  subscription: Pick<SubscriptionRecord, 'tier' | 'status'> | undefined,
  gift: PlanGift | null,
  now: number,
): EffectiveTier {
  const paid = tierFor(subscription);
  const active = gift && giftInForce(gift, now) ? gift : null;
  if (active && TIER_RANK[active.tier] > TIER_RANK[paid]) {
    return { tier: active.tier, gifted: true, gift: active };
  }
  return { tier: paid, gifted: false, gift: active };
}

/**
 * What an admin set for one account in place of its plan's defaults
 * (`user_overrides`, D73). Null in either field is "the plan decides".
 */
export interface UserOverrides {
  activeProjectLimit: number | null;
  monthlySpendCapMicroUsd: number | null;
}

/**
 * A plan's limits as an admin set them in the panel (D134,
 * `plan-limits.ts`), in place of the ones above. Absent where the plan
 * keeps the code's.
 */
export interface PlanLimitsInForce {
  activeProjectLimit: number | null;
  monthlyAllowanceMicroUsd: number;
}

/**
 * The active-project limit: an account's override first, then the plan's
 * as an admin set it, then the code's.
 */
export function activeProjectLimitFor(
  tier: Tier,
  overrides: UserOverrides | null,
  plan?: PlanLimitsInForce,
): number | null {
  const override = overrides?.activeProjectLimit;
  if (override !== null && override !== undefined) return override;
  return plan ? plan.activeProjectLimit : ACTIVE_PROJECT_LIMIT[tier];
}

/**
 * The monthly allowance: an account's override first, then the plan's as
 * an admin set it, then the code's.
 */
export function monthlyAllowanceFor(
  tier: Tier,
  freeIncludedMicroUsd: number,
  overrides: UserOverrides | null,
  plan?: PlanLimitsInForce,
): number {
  return (
    overrides?.monthlySpendCapMicroUsd ??
    plan?.monthlyAllowanceMicroUsd ??
    monthlyAllowanceMicroUsd(tier, freeIncludedMicroUsd)
  );
}
