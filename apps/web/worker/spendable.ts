import { BillingStore } from './billing-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  monthlyAllowanceMicroUsd,
  tierFor,
} from './entitlement.ts';
import type { Tier } from './entitlement.ts';
import { billingConfigured } from './billing-handlers.ts';
import type { Principal } from './principal.ts';

/** Only what deciding an allowance needs, so a test need not build a router. */
export interface SpendableEnv {
  DB?: D1Database;
  VIBLD_FREE_MONTHLY_MICRO_USD?: string;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface Spendable {
  monthlyAllowance: number;
  topupCeiling: number;
  /**
   * A lost dispute has this account suspended (docs/decisions.md, resolved
   * 2026-09-28). Both ceilings are then zero as well, so a caller that
   * forgot to check this still cannot spend; checking it is what lets the
   * refusal say why, as `account-suspended` rather than `account-ceiling`.
   */
  suspended?: true;
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
  const subscription = await billing.findActiveSubscription(principal.userId);
  const freeAllowance = positiveInt(
    env.VIBLD_FREE_MONTHLY_MICRO_USD,
    DEFAULT_FREE_INCLUDED_MICRO_USD,
  );
  return {
    monthlyAllowance: monthlyAllowanceMicroUsd(
      tierFor(subscription),
      freeAllowance,
    ),
    // Stripe top-ups and admin-granted credit (L4) combined -- see
    // `totalSpendableCreditMicroUsd`'s own comment.
    topupCeiling: await billing.totalSpendableCreditMicroUsd(principal.userId),
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
  return tierFor(
    await new BillingStore(env.DB).findActiveSubscription(principal.userId),
  );
}
