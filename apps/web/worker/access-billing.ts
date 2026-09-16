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

  let userId: string | null;
  let subscription;
  try {
    userId = await access.redeemedUserId(email);
    if (userId === null) {
      // An invite nobody ever took. There is no account, so there is nothing
      // that could be subscribed, and this is the ordinary case rather than
      // a problem.
      return { scheduled: false, reason: 'never-signed-in' };
    }
    subscription = await billing.findActiveSubscription(userId);
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
