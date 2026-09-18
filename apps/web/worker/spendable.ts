import { BillingStore } from './billing-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  monthlyAllowanceMicroUsd,
  tierFor,
} from './entitlement.ts';
import { grantSignupCreditOnce } from './signup-credit.ts';
import type { SignupCreditEnv } from './signup-credit.ts';
import type { Principal } from './principal.ts';

/** Only what deciding an allowance needs, so a test need not build a router. */
export interface SpendableEnv extends SignupCreditEnv {
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
 * (#185), and this is the part where two copies would actually hurt. The
 * reservation arithmetic is already shared -- `runCeilingFor`,
 * `worstCaseMicroUsd`, `reserveBudget` are each one function with one
 * caller-independent answer. This is not arithmetic; it is policy, and a
 * tier change that landed in one route and not the other would quietly let
 * somebody spend what their plan does not buy, or refuse them what it does.
 *
 * The signup credit is granted here, and not only in `handleBillingStatus`:
 * a client that never calls the status endpoint must not be refused its
 * first run for want of a credit it was promised. The deterministic id
 * means whichever path arrives first wins and the other is a no-op.
 */
export async function spendableFor(
  env: SpendableEnv,
  principal: Principal,
): Promise<{ monthlyAllowance: number; topupCeiling: number }> {
  const billing = new BillingStore(env.DB!);
  await grantSignupCreditOnce(billing, principal, env);
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
