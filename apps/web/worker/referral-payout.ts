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
  clawbackGrantId,
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
  /** Stripe ids the funding payment can be recognised by; see `markPaid`. */
  fundedBy: string[] = [],
): Promise<PayoutOutcome> {
  const attribution = await deps.referrals.attributionFor(referredUserId);
  const referrerUserId = attribution?.referrerUserId;

  const decision = decidePayout({
    referrerUserId,
    paidAlready: attribution?.paidAt != null,
    reversed: attribution?.reversedAt != null,
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

  // The paths that pay without an event in hand still have to record what
  // funded the reward, or the reversal path can never prove a match for
  // them and the reward becomes permanently unreversible. The nightly
  // reconcile and the stranded-payout sweep are both such paths: they know
  // an account has a cleared payment, not which webhook said so. Reading it
  // back costs one query, and only on a payout that is about to settle.
  //
  // One payment, the earliest, rather than every payment on the account,
  // and every id that one payment can be recognised by. Several ids because
  // they are aliases of a single settlement; a list of several different
  // payments would make refunding any later renewal take the reward back,
  // which is the bug being fixed reintroduced through the recovery path.
  const funding =
    fundedBy.length > 0
      ? fundedBy
      : await deps.billing.firstClearedPaymentIds(referredUserId);

  // The write that settles it, and the only place that can. `decidePayout`
  // read `reversed_at` several statements ago, so a refund arriving in
  // between passes that check: the reversal saw a null `paid_at`, took
  // nothing back, and this would otherwise mark the row paid with both
  // grants standing. `markPaid` now carries `AND reversed_at IS NULL`, so
  // D1's single writer decides which of the two happened second.
  const marked = await deps.referrals.markPaid(referredUserId, now, funding);
  if (!marked) {
    // Either a redelivery of a payout that already landed, which is a no-op
    // and fine, or the reversal won. Only the second has grants to undo, and
    // they are undone here rather than through `clawBackReferral`, which
    // reads `paid_at` and would find nothing to take.
    const settled = await deps.referrals.attributionFor(referredUserId);
    if (settled?.reversedAt != null) {
      await reverseGrants(
        deps,
        referredUserId,
        'Referral reversed: the payment was returned while the reward was being paid.',
      );
      return { paid: false, reason: 'reversed' };
    }
  }

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
 * Finish the payouts that are owed and have not happened.
 *
 * Stripe's redelivery is the first line and it recovers most of them, but it
 * gives up after a few days, and a delivery that was never made at all is
 * retried by nobody. Without this, "a failure anywhere in claim, grant, mark
 * leaves a state that resumes" is a claim about the shape of the data rather
 * than something that actually happens: the referral stays owed, permanently
 * and quietly.
 *
 * What counts as owed is `ReferralStore.payoutsToRetry`, and the definition
 * matters more than this loop does. An earlier cut asked for rows holding a
 * cap reservation, which excluded every payout that failed before taking
 * one.
 *
 * One failure does not stop the sweep. This is a nightly pass over rows, not
 * a webhook delivery: abandoning the rest because the first one threw would
 * strand exactly the ones this exists to recover.
 */
export async function resumeStrandedPayouts(
  deps: PayoutDeps,
  limit = 100,
): Promise<ResumeResult> {
  const owed = await deps.referrals.payoutsToRetry(limit, MAX_PAID_REFERRALS);
  let paid = 0;
  let failed = 0;

  for (const referredUserId of owed) {
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

  return { found: owed.length, paid, failed };
}

/** What one clawback attempt did, per side. */
export interface ClawbackResult {
  /** True when this account had a paid referral to reverse at all. */
  found: boolean;
  referrerCents: number;
  referredCents: number;
}

/**
 * Take back a referral reward whose funding payment went away.
 *
 * A referred account pays, both sides are credited, and then the payment is
 * refunded or the dispute is lost. Without this the credit stays, which is
 * the self-refer-pay-collect-refund loop with nothing between it and the
 * model spend it turns into.
 *
 * Two rules from the decision on 2026-09-16, and the second is the one that
 * is easy to get wrong. Floored at zero, so nobody is shown a debt. Against
 * granted credit only, so a person holding purchased top-up is never charged
 * for another account's refund. `clawbackCents` carries both and is where
 * the reasoning lives.
 *
 * Idempotent through `clawbackGrantId`: `grantAdminCredit` does nothing on
 * conflict, so a redelivered webhook, a replayed event and a second dispute
 * on the same charge all write the same two rows once. That is also why
 * nothing is marked "clawed back" anywhere: these rows are the record.
 *
 * The attribution is deliberately left marked paid. It records that a reward
 * was earned and paid, which is true and stays true; that it was later taken
 * back is what the negative rows say. Clearing `paidAt` would re-arm the
 * payout path, and the next cleared payment would credit them again.
 */
export async function clawBackReferral(
  deps: PayoutDeps,
  referredUserId: string,
  note: string,
  /**
   * Stripe ids the refunded charge can be recognised by.
   *
   * The reward is taken back only when one of these is an id the funding
   * payment was recorded under. Without that check every refund on the
   * account reversed its one referral, so refunding an unrelated later
   * top-up took back a reward the original purchase still funds.
   *
   * Empty means the caller could not name the charge, which is treated the
   * same way an unmatched one is: nothing is reversed.
   */
  refundedIds: string[] = [],
): Promise<ClawbackResult> {
  const attribution = await deps.referrals.attributionFor(referredUserId);
  // No referral at all. Most refunds are of a purchase nothing was attached
  // to, and there is nothing here to record.
  if (!attribution?.referrerUserId) {
    return { found: false, referrerCents: 0, referredCents: 0 };
  }

  // Nothing paid yet, and the mark is written anyway. An unpaid attribution
  // is not proof that no payout can still happen: the replay descends newest
  // pages first, so a refund can be applied before the older purchase that
  // earns the reward is recovered, and a payout can fail between its first
  // grant and its `markPaid`. In both cases the reward was still coming, and
  // returning early without the mark is what let it arrive after its funding
  // payment had gone back out.
  //
  // This branch cannot ask the question the paid branch below asks, because
  // nothing has recorded what funds this reward yet. So it is deliberately
  // the conservative half of the same decision: unproven here withholds a
  // reward, unproven there leaves one standing. Both err away from moving
  // credit on a guess, and the cost of this one is a $5 reward not paid
  // where the cost of the other is credit taken from somebody who kept
  // their purchase.
  if (attribution.paidAt == null) {
    await deps.referrals.markReversed(
      referredUserId,
      (deps.now ?? new Date()).toISOString(),
    );
    // Unpaid does not mean nothing was granted. A payout that failed between
    // its first grant and its second, or before `markPaid`, left credit
    // standing under a row that still reads unpaid, and the mark above is
    // what stops any retry ever finishing it. Returning here without this
    // left that half-reward spendable for good.
    //
    // Safe to run unconditionally because it reverses the payout grants
    // themselves: no grant, no deduction.
    const taken = await reverseGrants(deps, referredUserId, note);
    return { found: false, ...taken };
  }

  // Only the payment that earned the reward can take it back.
  //
  // Decided 2026-09-16: when the match cannot be proven, the reward stays.
  // That errs toward never taking credit from somebody wrongly, and it costs
  // the abuse case whenever the funding payment is unknown, which is every
  // reward paid before this was recorded.
  //
  // Nothing is written on this path, the mark included. A row marked
  // reversed with both grants still standing would assert something untrue
  // about this reward: the payment that went back out was not the one that
  // earned it. The log line is the record, because a reward that arguably
  // should have been reversed and was not is worth somebody seeing.
  const funded = attribution.fundedBy ?? [];
  const matched = refundedIds.some((id) => funded.includes(id));
  if (!matched) {
    console.log(
      JSON.stringify({
        event: 'referral.reversal_unmatched',
        referredUserId,
        refundedIds,
        knownFunding: funded,
      }),
    );
    return { found: false, referrerCents: 0, referredCents: 0 };
  }

  await deps.referrals.markReversed(
    referredUserId,
    (deps.now ?? new Date()).toISOString(),
  );

  const taken = await reverseGrants(
    deps,
    referredUserId,
    note,
    attribution.referrerUserId,
  );
  return { found: true, ...taken };
}

/**
 * Take both sides' rewards back.
 *
 * Shared by the ordinary reversal and by the payout that loses the race to
 * one, because those two have the same work to do and only differ in how
 * they found out. The race path cannot go through `clawBackReferral`: that
 * reads `paid_at`, which the lost race left null, so it would find nothing
 * to take and leave the grants it just wrote standing.
 */
async function reverseGrants(
  deps: PayoutDeps,
  referredUserId: string,
  note: string,
  referrerUserId?: string,
): Promise<{ referrerCents: number; referredCents: number }> {
  const referrer =
    referrerUserId ??
    (await deps.referrals.attributionFor(referredUserId))?.referrerUserId;
  const referrerCents = referrer
    ? await takeBack(deps, 'referrer', referredUserId, referrer, note)
    : 0;
  const referredCents = await takeBack(
    deps,
    'referred',
    referredUserId,
    referredUserId,
    note,
  );
  return { referrerCents, referredCents };
}

/**
 * Deduct one side's reward, and say how much was actually taken.
 *
 * **What that payout granted, read from the grant it wrote**, rather than
 * what the reward is worth today. Two reasons, and the second is a bug this
 * had:
 *
 * The reward amount is a constant that can be changed between a payout and
 * its reversal, and taking back today's figure for yesterday's grant is
 * either a gift or a theft depending on which way it moved.
 *
 * And a payout that failed partway through wrote one grant and not the
 * other. Reading the row is what lets the reversal take back exactly what
 * exists: the side that was written is reversed, the side that was not is a
 * no-op rather than a deduction against whatever other granted credit the
 * account happens to hold. Without that, reversing an interrupted payout
 * would take the missing half out of somebody's signup credit.
 */
async function takeBack(
  deps: PayoutDeps,
  side: 'referrer' | 'referred',
  referredUserId: string,
  userId: string,
  note: string,
): Promise<number> {
  const granted = await deps.billing.findAdminCredit(
    payoutGrantId(side, referredUserId),
  );
  const rewardCents = granted?.creditUsdCents ?? 0;
  // Nothing was granted on this side, so there is nothing to take back. A
  // deduction here would come out of credit this referral never paid.
  if (rewardCents <= 0) return 0;
  const id = clawbackGrantId(side, referredUserId);
  // The floor lives in the statement, not here. Reading the balance and then
  // writing a deduction bounded by it is a check followed by an act, and two
  // refunds of two different referrals sharing one referrer can both pass it
  // and leave the granted total negative, which takes the difference out of
  // credit somebody paid for.
  //
  // What comes back is what this call took, which is zero for a redelivered
  // refund: the row is written once for a given id, and reporting the reward
  // regardless would log the same money recovered every time one arrived
  // while the balance moved once.
  return await deps.billing.deductAdminCredit(
    id,
    userId,
    rewardCents,
    REFERRAL_GRANT_ACTOR,
    note,
  );
}
