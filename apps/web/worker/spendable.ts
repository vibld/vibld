import { AdminStore } from './admin-store.ts';
import { BillingStore } from './billing-store.ts';
import type { SubscriptionRecord } from './billing-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  DEFAULT_FREE_TRIAL_MICRO_USD,
  TRIAL_PERIOD_KEY,
  activeProjectLimitFor,
  effectiveTier,
  monthlyAllowanceFor,
} from './entitlement.ts';
import type {
  EffectiveTier,
  PlanLimitsInForce,
  Tier,
  UserOverrides,
} from './entitlement.ts';
import { billingConfigured } from './billing-handlers.ts';
import { planLimitsFor, savedPlanLimits } from './plan-limits.ts';
import type { Principal } from './principal.ts';

/** Only what deciding an allowance needs, so a test need not build a router. */
export interface SpendableEnv {
  DB?: D1Database;
  VIBLD_FREE_MONTHLY_MICRO_USD?: string;
  /** The trial a Free account without a card has (D159), else $0.20. */
  VIBLD_FREE_TRIAL_MICRO_USD?: string;
  /** Read only to know whether this deployment sells plans (`tierOf`). */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Free's monthly allowance in code: `VIBLD_FREE_MONTHLY_MICRO_USD`, else $1. */
export function freeAllowanceOf(env: SpendableEnv): number {
  return positiveInt(
    env.VIBLD_FREE_MONTHLY_MICRO_USD,
    DEFAULT_FREE_INCLUDED_MICRO_USD,
  );
}

/**
 * Free's trial in code: `VIBLD_FREE_TRIAL_MICRO_USD`, else $0.20. Zero is
 * allowed, and means a Free account builds nothing until it saves a card.
 */
export function freeTrialOf(env: SpendableEnv): number {
  const value = Number(env.VIBLD_FREE_TRIAL_MICRO_USD);
  return env.VIBLD_FREE_TRIAL_MICRO_USD !== undefined &&
    env.VIBLD_FREE_TRIAL_MICRO_USD.trim() !== '' &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : DEFAULT_FREE_TRIAL_MICRO_USD;
}

/**
 * The allowance an account's runs are held to, and the ledger period it is
 * spent against.
 *
 * D159 (Chris, 2026-10-05: "Trial, then $1/mo"): on a deployment that sells
 * plans, a Free account with no card on file has a trial, $0.20 for the life
 * of the account, in `TRIAL_PERIOD_KEY`; one with a card has the monthly
 * allowance, as every Free account had before. An admin's cap for the
 * account (D73) is a monthly figure and replaces either, as it replaces any
 * plan's. A paid or gifted plan, or a deployment with no billing, is the
 * monthly allowance as before.
 */
export interface Allowance {
  monthlyAllowance: number;
  /** Absent for the month's period, the default. */
  allowancePeriod?: typeof TRIAL_PERIOD_KEY;
  /**
   * Only for a Free account on the trial: whether the cards it saved were
   * all first saved by another account, so it is asked for a different one.
   */
  trial?: { cardAlreadyUsed: boolean };
}

export async function allowanceOf(
  env: SpendableEnv,
  billing: Pick<BillingStore, 'freeCardOf'>,
  userId: string,
  tier: Tier,
  overrides: UserOverrides | null,
  plan: PlanLimitsInForce | undefined,
): Promise<Allowance> {
  const freeAllowance = freeAllowanceOf(env);
  const monthly = {
    monthlyAllowance: monthlyAllowanceFor(tier, freeAllowance, overrides, plan),
  };
  if (
    tier !== 'free' ||
    !billingConfigured(env) ||
    overrides?.monthlySpendCapMicroUsd != null
  ) {
    return monthly;
  }
  const card = await billing.freeCardOf(userId);
  if (card.onFile) return monthly;
  return {
    monthlyAllowance: freeTrialOf(env),
    allowancePeriod: TRIAL_PERIOD_KEY,
    trial: { cardAlreadyUsed: card.cardAlreadyUsed },
  };
}

export interface Spendable {
  monthlyAllowance: number;
  /**
   * The ledger period `monthlyAllowance` is spent against: the trial's, for
   * a Free account with no card (D159). Absent for the month's.
   */
  allowancePeriod?: typeof TRIAL_PERIOD_KEY;
  topupCeiling: number;
  /**
   * A lost dispute has this account suspended (docs/decisions.md, resolved
   * 2026-09-28). Both ceilings are then zero as well, so a caller that
   * forgot to check this still cannot spend; checking it is what lets the
   * refusal say why, as `account-suspended` rather than `account-ceiling`.
   */
  suspended?: true;
  /**
   * The account is on the Free plan of a deployment that sells plans, so
   * its runs also count against the Free plan's share of the day (D158,
   * `reserve.ts`). Absent on a paid plan, a gifted one, and a deployment
   * with no billing, where everybody is Free and there is nobody to keep
   * room for.
   */
  freePool?: true;
}

/**
 * The sentence a suspended account is refused with. One copy, because three
 * routes say it and the builder shows whichever one answered.
 */
export const SUSPENDED_MESSAGE =
  'This account is suspended because a payment on it was disputed and the dispute was lost. Email billing@vibld.com to resolve it.';

/**
 * What this caller is allowed to spend: their tier's monthly allowance, and
 * whatever credit they hold on top of it.
 *
 * Its own function because a second route is about to need the same answer
 * (internal issue 185), and this is the part where two copies would actually hurt. The
 * reservation arithmetic is already shared -- `runCeilingFor`,
 * `worstCaseMicroUsd`, `reserveBudget` are each one function with one
 * caller-independent answer. This is not arithmetic; it is policy, and a
 * tier change that landed in one route and not the other would quietly let
 * somebody spend what their plan does not buy, or refuse them what it does.
 *
 * The signup credit used to be granted here as well as in
 * `handleBillingStatus`, so that a client that never called the status
 * endpoint was not refused its first run for want of a credit it was
 * promised. It is not granted on a request at all any more: it waits for a
 * card on file and arrives on the Stripe webhook (`signup-credit.ts`), so
 * by the time a run asks, it is either in the balance below or not owed.
 */
export async function spendableFor(
  env: SpendableEnv,
  principal: Principal,
): Promise<Spendable> {
  const billing = new BillingStore(env.DB!);
  // Here, beside the allowance, because this is the one function every paid
  // request asks and a suspension is an answer to the same question: what
  // may this account spend. A check in each route is one a new route
  // forgets.
  if (await billing.isSuspended(principal.userId)) {
    return { monthlyAllowance: 0, topupCeiling: 0, suspended: true };
  }
  const [plan, overrides, saved] = await Promise.all([
    planOf(env.DB!, principal.userId),
    new AdminStore(env.DB!).overrides(principal.userId),
    savedPlanLimits(env.DB!),
  ]);
  const freeAllowance = freeAllowanceOf(env);
  // An admin's cap for this account, where one is set, in place of the
  // tier's included amount (D73). Read here, beside the tier, for the
  // reason this function exists: one answer to "what may this account
  // spend" for every route that reserves. Then the plan's, as an admin set
  // it in the panel (D134), else the code's; or the trial, for a Free
  // account with no card (D159).
  const allowance = await allowanceOf(
    env,
    billing,
    principal.userId,
    plan.tier,
    overrides,
    planLimitsFor(plan.tier, saved, freeAllowance),
  );
  return {
    monthlyAllowance: allowance.monthlyAllowance,
    ...(allowance.allowancePeriod
      ? { allowancePeriod: allowance.allowancePeriod }
      : {}),
    // Stripe top-ups and admin-granted credit (L4) combined -- see
    // `totalSpendableCreditMicroUsd`'s own comment.
    topupCeiling: await billing.totalSpendableCreditMicroUsd(principal.userId),
    ...(plan.tier === 'free' && billingConfigured(env)
      ? { freePool: true as const }
      : {}),
  };
}

/**
 * This caller's tier, which decides the models they may use (D66,
 * `TIER_MODELS` in `model-access.ts`), or null on a deployment that sells
 * no plans, where there is no tier to hold anybody to.
 *
 * Its own read rather than a field of `spendableFor`'s answer, because the
 * model is decided before anything is reserved, and `spendableFor` is asked
 * only once a run has passed the rate limiter. A D1 that fails throws, and
 * the caller decides what that means.
 */
export interface TierEnv extends SpendableEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export async function tierOf(
  env: TierEnv,
  principal: Principal,
): Promise<Tier | null> {
  if (!billingConfigured(env) || !env.DB) return null;
  return (await planOf(env.DB, principal.userId)).tier;
}

/**
 * Whether a preview for this account is a Free one (D158): held to the
 * preview service's daily limit, and kept out of the containers reserved
 * for paid plans. Only on a deployment that sells plans, as with
 * `freePool`. `userId` rather than a principal, because a shared project's
 * preview is its owner's, whoever is viewing it.
 *
 * A plan that cannot be read is treated as Free: that only applies the
 * limits, and paying accounts are the ones the limits protect.
 */
export async function freePreviewFor(
  env: TierEnv,
  userId: string,
): Promise<boolean> {
  if (!billingConfigured(env) || !env.DB) return false;
  try {
    return (await planOf(env.DB, userId)).tier === 'free';
  } catch (error) {
    console.error('preview plan read failed', error);
    return true;
  }
}

/** What `planOf` answers: the tier, and the two things it was read from. */
export interface Plan extends EffectiveTier {
  subscription: SubscriptionRecord | undefined;
}

/**
 * The tier this account has now: its subscription's, or a gifted plan's
 * where that is higher and still in force (D73, `effectiveTier`).
 *
 * The one reading of the tier every caller makes, so a gift counts
 * wherever a paid subscription does: the models a plan unlocks
 * (`tierOf`), the monthly allowance (`spendableFor`), the active-project
 * limit (`project-handlers.ts`, `share-handlers.ts`) and the billing
 * panel. Two reads, the subscription mirror and the gift, made together.
 */
export async function planOf(
  db: D1Database,
  userId: string,
  now: number = Date.now(),
): Promise<Plan> {
  const [subscription, gift] = await Promise.all([
    new BillingStore(db).findActiveSubscription(userId),
    new AdminStore(db).currentGift(userId),
  ]);
  return { ...effectiveTier(subscription, gift, now), subscription };
}

/**
 * How many active projects this account may have: an admin's override
 * where one is set (D73), then the plan's limit as an admin set it in the
 * panel (D134), then the code's.
 */
export async function projectLimitOf(
  db: D1Database,
  userId: string,
  tier: Tier,
): Promise<number | null> {
  const [overrides, saved] = await Promise.all([
    new AdminStore(db).overrides(userId),
    savedPlanLimits(db),
  ]);
  // The allowance is not read here, so Free's is immaterial.
  return activeProjectLimitFor(
    tier,
    overrides,
    planLimitsFor(tier, saved, DEFAULT_FREE_INCLUDED_MICRO_USD),
  );
}
