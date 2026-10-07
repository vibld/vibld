import { BillingStore } from './billing-store.ts';
import { billingConfigured } from './billing-handlers.ts';
import type { BillingEnv } from './billing-handlers.ts';
import type { UserBudget } from './budget.ts';
import { parseAccessMode } from './access.ts';
import { platformAdminsFor } from './platform-admins.ts';
import type { PrincipalEnv } from './principal.ts';
import { maybeAutoReload } from './auto-reload.ts';
import type { AutoReloadOutcome } from './auto-reload.ts';
import { payReferralIfEarned } from './referral-payout.ts';
import { ReferralStore } from './referral-store.ts';
import { largestSpendableMicroUsd } from './spendable.ts';
import type { SpendableEnv } from './spendable.ts';
import { createStripeClient } from './stripe-client.ts';

/** What a reload check needs of the Worker's env. */
export type AutoReloadEnv = BillingEnv &
  SpendableEnv & {
    USER_BUDGET?: DurableObjectNamespace<Pick<UserBudget, 'usageFor'>>;
    VIBLD_ACCESS_MODE?: string;
    VIBLD_PLATFORM_ADMINS?: string;
  } & PrincipalEnv;

/**
 * Charge an auto-reload top-up for this account if one is due (D166). Asked
 * after every settlement; a deployment with no billing, or an account that
 * never turned it on, costs one D1 read.
 *
 * Never throws: a reload is the next run's business, and must not fail the
 * one that just settled.
 */
export async function autoReloadFor(
  env: AutoReloadEnv,
  userId: string,
): Promise<AutoReloadOutcome | undefined> {
  if (!billingConfigured(env) || !env.DB || !env.USER_BUDGET) return undefined;
  const budget = env.USER_BUDGET;
  try {
    const billing = new BillingStore(env.DB);
    const referrals = new ReferralStore(env.DB);
    const outcome = await maybeAutoReload(
      {
        store: billing,
        stripe: createStripeClient(env),
        access: {
          inviteGated: parseAccessMode(env.VIBLD_ACCESS_MODE) === 'invite',
          admins: platformAdminsFor(env),
        },
        spendableLeftMicroUsd: () =>
          largestSpendableMicroUsd({ ...env, USER_BUDGET: budget }, userId),
        // The referral payout rides the charge as it rides a Checkout. If it
        // fails here, the credit is already written, and the webhook for the
        // same charge pays it.
        onPurchaseCleared: (paidBy, fundedBy) =>
          payReferralIfEarned({ referrals, billing }, paidBy, fundedBy).then(
            () => undefined,
          ),
      },
      userId,
    );
    if (outcome !== 'off' && outcome !== 'skipped') {
      console.log(JSON.stringify({ event: 'billing.auto_reload', outcome }));
    }
    return outcome;
  } catch (error) {
    console.error('auto-reload check failed', error);
    return undefined;
  }
}
