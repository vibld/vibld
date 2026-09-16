/**
 * Stop charging somebody whose invite has just been withdrawn.
 *
 * Revoking an invite closes the door and, until this existed, did nothing
 * else. A subscriber who was revoked kept a live Stripe subscription: charged
 * on schedule, every month, for a product they could no longer sign in to.
 * Nothing in either system noticed, because the invite list is keyed by
 * address and Stripe is keyed by account, and no code joined them.
 *
 * **At period end, not immediately** (docs/decisions.md, resolved
 * 2026-09-16). They keep what they already paid for until that period runs
 * out, nothing is charged for time they cannot use, and there is no refund to
 * process. Reinstating before the period ends puts it back, because
 * `cancel_at_period_end` is a flag Stripe lets you clear, not a deletion.
 *
 * **Best-effort from the caller's point of view.** Withdrawing access must
 * not depend on Stripe answering. A deployment with no `STRIPE_SECRET_KEY` is
 * a supported shape, Stripe can be slow or down, and in every one of those
 * cases the revoke itself has to land and say what it could not do. The same
 * rule `clerk-waitlist.ts` follows for the same reason.
 */
import type Stripe from 'stripe';

import type { AccessStore } from './access-store.ts';
import type { BillingStore } from './billing-store.ts';
import { createStripeClient, stripeConfigured } from './stripe-client.ts';
import type { StripeEnv } from './stripe-client.ts';

/**
 * What happened to their billing, in terms of what was established.
 *
 * `scheduled` rather than `cancelled`, because nothing is cancelled yet: the
 * subscription runs to `endsAt` and stops there. Reporting it as cancelled
 * would tell an operator the charging has stopped when the next invoice may
 * still be weeks away, and that is the sentence they would act on.
 */
export type SubscriptionWindDown =
  | { scheduled: true; endsAt: string | null }
  | { scheduled: false; reason: 'unconfigured' }
  | { scheduled: false; reason: 'no-invite' }
  | { scheduled: false; reason: 'never-signed-in' }
  | { scheduled: false; reason: 'nothing-to-stop' }
  | { scheduled: false; reason: 'already-ending'; endsAt: string | null }
  | { scheduled: false; reason: 'error'; error: string };

export interface AccessBillingEnv extends StripeEnv {
  STRIPE_SECRET_KEY?: string;
}

/**
 * Set this person's live subscription to end when the period they paid for
 * does, and report what Stripe said.
 *
 * Called after the revoke has already landed, so the address is known to be
 * withdrawn by the time this runs. The four "did nothing" outcomes are kept
 * apart rather than collapsed into one falsy answer: an operator needs to
 * know the difference between "they never had a subscription" and "Stripe
 * could not be reached", because only one of them is worth going to look at.
 */
export async function windDownSubscription(
  env: AccessBillingEnv,
  access: AccessStore,
  billing: BillingStore,
  email: string,
  makeStripe: (env: StripeEnv) => Stripe = createStripeClient,
): Promise<SubscriptionWindDown> {
  if (!stripeConfigured(env)) {
    return { scheduled: false, reason: 'unconfigured' };
  }

  let subscription;
  try {
    const invite = await access.redeemedUserId(email);
    // No row at all, which is what a mistyped address in the free-form
    // control looks like. Saying "nobody ever signed in with that invite"
    // here would be a fact about a person who does not exist.
    if (!invite.exists) return { scheduled: false, reason: 'no-invite' };
    if (invite.userId === null) {
      // An invite nobody ever took. There is no account, so there is nothing
      // that could be subscribed, and this is the ordinary case rather than
      // a problem.
      return { scheduled: false, reason: 'never-signed-in' };
    }
    subscription = await billing.findActiveSubscription(invite.userId);
  } catch (error) {
    console.error('wind-down: could not read the local records', error);
    return {
      scheduled: false,
      reason: 'error',
      error: 'Could not read this deployment’s own billing records.',
    };
  }

  if (!subscription) return { scheduled: false, reason: 'nothing-to-stop' };

  // Already winding down. Saying so is not the same as saying nothing
  // happened: an operator revoking somebody who had already cancelled needs
  // to see that the end date is real and when it is, not a blank.
  if (subscription.cancelAtPeriodEnd) {
    return {
      scheduled: false,
      reason: 'already-ending',
      endsAt: subscription.currentPeriodEnd,
    };
  }

  try {
    const updated = await makeStripe(env).subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    // Mirrored straight away rather than waiting for the webhook Stripe will
    // also send. The operator is looking at the panel now, and a list that
    // still says this subscription renews is the same false claim the
    // revoke was meant to end, just moved.
    //
    // A failure here is not reported as a failed wind-down: Stripe has
    // already accepted the change, which is the part that stops the money,
    // and the webhook or the nightly reconcile will correct this row.
    const endsAt = periodEndOf(updated) ?? subscription.currentPeriodEnd;
    try {
      // Provenance, written alongside the mirror. Without it, restoring
      // access cannot tell this cancellation from one the subscriber made
      // for themselves, and clears theirs.
      await billing.recordScheduledCancellation(
        subscription.stripeSubscriptionId,
        subscription.userId,
      );
      await billing.upsertSubscription({
        ...subscription,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: endsAt,
      });
    } catch (error) {
      console.error(
        'wind-down: Stripe accepted it, local mirror did not',
        error,
      );
    }

    return { scheduled: true, endsAt };
  } catch (error) {
    console.error('wind-down: Stripe refused the cancellation', error);
    return {
      scheduled: false,
      reason: 'error',
      error: 'Stripe would not schedule the cancellation.',
    };
  }
}

/**
 * When the period Stripe just confirmed ends, as an ISO string.
 *
 * Read defensively rather than trusted. Stripe has moved
 * `current_period_end` between the subscription and its items across API
 * versions, and a missing one here would become `new Date(undefined)`, which
 * is an Invalid Date that stringifies by throwing. The caller falls back to
 * the date already mirrored locally when this answers null.
 */
function periodEndOf(subscription: Stripe.Subscription): string | null {
  const seconds =
    (subscription as unknown as { current_period_end?: unknown })
      .current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null;
}

/**
 * What happened when access was restored.
 *
 * `restored` means a cancellation that was scheduled is no longer scheduled.
 * Everything else is a reason nothing needed doing, or could not be done.
 */
export type SubscriptionRestore =
  | { restored: true; renewsOn: string | null }
  | { restored: false; reason: 'unconfigured' }
  | { restored: false; reason: 'no-invite' }
  | { restored: false; reason: 'never-signed-in' }
  | { restored: false; reason: 'nothing-to-restore' }
  /** Somebody else scheduled this cancellation, so it is not ours to undo. */
  | { restored: false; reason: 'not-ours' }
  | { restored: false; reason: 'error'; error: string };

/**
 * Put back a subscription this deployment scheduled to end.
 *
 * This exists because its absence made a claim false. `windDownSubscription`
 * cancels at period end rather than immediately, and the reason given for
 * that, here and in docs/decisions.md, is that reinstating before the period
 * ends puts it back. Nothing did. Re-inviting a revoked subscriber cleared
 * `revoked_at` and asked Clerk, and left the cancellation standing, so Stripe
 * ended a subscription belonging to somebody whose access had been restored
 * and every sentence written about it said otherwise.
 *
 * Only ever clears a cancellation this deployment recorded scheduling. A
 * subscriber who cancelled in the Billing Portal and is then re-invited
 * keeps their cancellation: it was their decision, and silently reversing it
 * would be charging somebody who asked not to be charged.
 *
 * That is established from `billing_scheduled_cancellations`, not from the
 * mirror. An earlier version read `cancelAtPeriodEnd` and claimed in this
 * comment that doing so identified its own work. It does not:
 * `cancel_at_period_end` is the same boolean whoever set it, so that version
 * cleared subscribers' own cancellations and Stripe charged them again.
 *
 * Best-effort on the same terms as the wind-down: the invite has already been
 * written, so a throw here would answer 500 for a request that half happened.
 */
export async function restoreSubscription(
  env: AccessBillingEnv,
  access: AccessStore,
  billing: BillingStore,
  email: string,
  makeStripe: (env: StripeEnv) => Stripe = createStripeClient,
): Promise<SubscriptionRestore> {
  if (!stripeConfigured(env)) {
    return { restored: false, reason: 'unconfigured' };
  }

  let subscription;
  try {
    const invite = await access.redeemedUserId(email);
    if (!invite.exists) return { restored: false, reason: 'no-invite' };
    if (invite.userId === null) {
      return { restored: false, reason: 'never-signed-in' };
    }
    subscription = await billing.findActiveSubscription(invite.userId);
  } catch (error) {
    console.error('restore: could not read the local records', error);
    return {
      restored: false,
      reason: 'error',
      error: 'Could not read this deployment\u2019s own billing records.',
    };
  }

  // Nothing live, or nothing scheduled to end.
  if (!subscription || !subscription.cancelAtPeriodEnd) {
    return { restored: false, reason: 'nothing-to-restore' };
  }

  // Whether this deployment is the one that scheduled it. The mirror cannot
  // answer that: `cancel_at_period_end` is the same boolean whoever set it,
  // so an earlier version of this read the flag, believed its own comment
  // about only undoing its own work, and cleared cancellations subscribers
  // had made in the Billing Portal. Stripe then charged them again.
  //
  // No row means somebody else scheduled it, and it is left alone.
  let ours: boolean;
  try {
    ours = await billing.scheduledCancellation(
      subscription.stripeSubscriptionId,
    );
  } catch (error) {
    console.error('restore: could not read the cancellation record', error);
    return {
      restored: false,
      reason: 'error',
      error: 'Could not establish who scheduled the cancellation.',
    };
  }
  if (!ours) return { restored: false, reason: 'not-ours' };

  try {
    const updated = await makeStripe(env).subscriptions.update(
      subscription.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );
    const renewsOn = periodEndOf(updated) ?? subscription.currentPeriodEnd;
    try {
      await billing.upsertSubscription({
        ...subscription,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: renewsOn,
      });
      // Cleared, not left behind. A stale row would let a later restore undo
      // a cancellation the subscriber makes after this one, which is the
      // same harm one step removed.
      await billing.clearScheduledCancellation(
        subscription.stripeSubscriptionId,
      );
    } catch (error) {
      console.error('restore: Stripe accepted it, local mirror did not', error);
    }
    return { restored: true, renewsOn };
  } catch (error) {
    console.error('restore: Stripe refused to clear the cancellation', error);
    return {
      restored: false,
      reason: 'error',
      error: 'Stripe would not clear the scheduled cancellation.',
    };
  }
}
