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

/** What one sweep of the stranded payouts did. */
export interface ResumeResult {
  found: number;
  paid: number;
  failed: number;
}

/**
 * Finish the payouts that claimed a slot and never got paid.
 *
 * Stripe's redelivery is the first line and it recovers most of them, but it
 * gives up after a few days, and a delivery that was never made at all is
 * retried by nobody. Without this, "a failure anywhere in claim, grant, mark
 * leaves a state that resumes" is a claim about the shape of the data rather
 * than something that actually happens: the slot stays taken and the referral
 * stays owed, permanently and quietly.
 *
 * One failure does not stop the sweep. This is a nightly pass over rows, not
 * a webhook delivery: abandoning the rest because the first one threw would
 * strand exactly the ones this exists to recover.
 */
export async function resumeStrandedPayouts(
  deps: PayoutDeps,
  limit = 100,
): Promise<ResumeResult> {
  const stranded = await deps.referrals.strandedPayouts(limit);
  let paid = 0;
  let failed = 0;

  for (const referredUserId of stranded) {
    try {
      // Stamped before the attempt, so a row that throws moves to the back of
      // the queue instead of holding the front of it for ever.
      await deps.referrals.markAttempted(
        referredUserId,
        (deps.now ?? new Date()).toISOString(),
      );
      const outcome = await payReferralIfEarned(deps, referredUserId);
      if (outcome.paid) paid += 1;
    } catch (error) {
      failed += 1;
      console.error('referral payout resume failed', referredUserId, error);
    }
  }

  return { found: stranded.length, paid, failed };
}
