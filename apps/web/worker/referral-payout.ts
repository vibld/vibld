/**
 * Paying a referral when a purchase clears.
 *
 * The orchestration only: every rule it applies lives in `referral.ts`, and
 * every row it touches goes through `ReferralStore` or `BillingStore`.
 */
import type { BillingStore } from './billing-store.ts';
import type { ReferralStore } from './referral-store.ts';
import { decidePayout, payoutGrantId } from './referral.ts';
import type { PayoutRefusal, RewardCents } from './referral.ts';

/** The actor recorded against a referral grant, so the ledger says where it came from. */
export const REFERRAL_GRANT_ACTOR = 'system@vibld.com';

export type PayoutOutcome =
  | { paid: true; referrerUserId: string; reward: RewardCents }
  | { paid: false; reason: PayoutRefusal };

export interface PayoutDeps {
  referrals: ReferralStore;
  billing: BillingStore;
  reward?: RewardCents;
  now?: Date;
}

/**
 * Pay both sides, once, for an account whose first purchase has cleared.
 *
 * Called from the Stripe webhook path, which has already established that
 * money arrived; nothing here re-checks that.
 *
 * **The credit is written before the attribution is marked paid**, which is
 * the opposite of the obvious order and is deliberate. Marking first would
 * mean a failure between the two steps leaves an attribution that says it was
 * paid and a ledger that never received anything, and nothing would ever
 * revisit it. Granting first cannot double-pay, because `grantAdminCredit`
 * inserts on a deterministic id and does nothing on conflict, so a
 * redelivered webhook rewrites the same two rows and changes neither. The
 * worst case in this order is a grant that is made and not marked, which the
 * next delivery corrects.
 */
export async function payReferralIfEarned(
  deps: PayoutDeps,
  referredUserId: string,
): Promise<PayoutOutcome> {
  const attribution = await deps.referrals.attributionFor(referredUserId);
  const referrerUserId = attribution?.referrerUserId;

  const decision = decidePayout({
    referrerUserId,
    paidAlready: attribution?.paidAt != null,
    referrerPaidCount: referrerUserId
      ? await deps.referrals.paidCountFor(referrerUserId)
      : 0,
    ...(deps.reward ? { reward: deps.reward } : {}),
  });
  if (!decision.pay) return { paid: false, reason: decision.reason };

  const note = `Referral: ${attribution?.code ?? 'unknown code'}`;
  await deps.billing.grantAdminCredit(
    payoutGrantId('referrer', referredUserId),
    decision.referrerUserId,
    decision.reward.referrer,
    REFERRAL_GRANT_ACTOR,
    note,
  );
  await deps.billing.grantAdminCredit(
    payoutGrantId('referred', referredUserId),
    referredUserId,
    decision.reward.referred,
    REFERRAL_GRANT_ACTOR,
    note,
  );

  await deps.referrals.markPaid(
    referredUserId,
    (deps.now ?? new Date()).toISOString(),
  );

  return {
    paid: true,
    referrerUserId: decision.referrerUserId,
    reward: decision.reward,
  };
}
