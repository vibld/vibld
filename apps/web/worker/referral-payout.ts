/**
 * Paying a referral when a purchase clears.
 *
 * The orchestration only: every rule it applies lives in `referral.ts`, and
 * every row it touches goes through `ReferralStore` or `BillingStore`.
 */
import type { BillingStore } from './billing-store.ts';
import type { ReferralStore } from './referral-store.ts';
import {
  MAX_PAID_REFERRALS,
  decidePayout,
  payoutGrantId,
  reservationOutcome,
} from './referral.ts';
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
 * Three steps, in an order chosen for what survives a failure between any two
 * of them.
 *
 * **The slot is claimed first.** The cap has to be a race the database
 * settles, not a count read here and compared here, so `reserveSlot` takes it
 * in one statement or reports that there was none left. A claim is a
 * reservation and not a receipt: nothing has been paid at this point.
 *
 * **The credit is written before the attribution is marked paid**, which is
 * the opposite of the obvious order and is deliberate. Marking first would
 * mean a failure between the two steps leaves an attribution that says it was
 * paid and a ledger that never received anything. Granting first cannot
 * double-pay, because `grantAdminCredit` inserts on a deterministic id and
 * does nothing on conflict, so a redelivered webhook rewrites the same two
 * rows and changes neither.
 *
 * So the worst case is a slot claimed and a payout unfinished, which is a
 * state that resumes: the claim is held, `reservationOutcome` reads it as
 * this attribution's own and lets the retry through, and the grants are
 * idempotent. That retry is real rather than hoped for, because a throw from
 * here now fails the webhook delivery and Stripe redelivers it
 * (`billing-events.ts`). It used to be swallowed, which left the event marked
 * processed and the payout gone for good.
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
    ...(deps.reward ? { reward: deps.reward } : {}),
  });
  if (!decision.pay) return { paid: false, reason: decision.reason };

  const now = (deps.now ?? new Date()).toISOString();
  const slot = reservationOutcome({
    heldAlready: attribution?.claimedAt != null,
    won: await deps.referrals.reserveSlot(
      referredUserId,
      now,
      MAX_PAID_REFERRALS,
    ),
  });
  if (!slot.proceed) return { paid: false, reason: slot.reason };

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

  await deps.referrals.markPaid(referredUserId, now);

  return {
    paid: true,
    referrerUserId: decision.referrerUserId,
    reward: decision.reward,
  };
}
