import { BillingStore } from './billing-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  monthlyAllowanceMicroUsd,
  tierFor,
} from './entitlement.ts';
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
): Promise<{ monthlyAllowance: number; topupCeiling: number }> {
  const billing = new BillingStore(env.DB!);
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
