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
import { BILLABLE_STATUSES } from './billing-store.ts';
import type { BillingStore, SubscriptionRecord } from './billing-store.ts';
import { subscriptionRecordFrom } from './billing-events.ts';
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
  | {
      scheduled: true;
      endsAt: string | null;
      /**
       * Whether the panel can undo this later.
       *
       * False when Stripe accepted the cancellation and the record of
       * having scheduled it could not be written. The money stops either
       * way, which is why this is still `scheduled: true`, but restoring
       * reads that record to establish the cancellation is this
       * deployment's to clear, so without it a later reinstatement will
       * refuse. Said out loud rather than discovered weeks later by an
       * operator whose Reinstate button does nothing.
       */
      restorable: boolean;
    }
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
 * What winding a subscription down needs to know about it.
 *
 * Deliberately less than a `SubscriptionRecord`. The wind-down needs an id
 * to cancel, a period end to report and whether it is already ending; a
 * mirror row is a separate thing that may or may not exist, which is why it
 * sits in `record` and may be absent. Conflating the two is how a
 * subscription read from Stripe ended up being written to the mirror as a
 * placeholder.
 */
interface Winding {
  stripeSubscriptionId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** The mirror row this maps to, when this deployment recognises the price. */
  record: SubscriptionRecord | undefined;
}

/**
 * Stripe's `canceled_at` for a subscription, as an ISO string.
 *
 * Seconds since the epoch on the wire, absent when nothing is cancelled.
 * Read defensively for the same reason `periodEndOf` is: a field that is
 * sometimes absent becomes a throw the moment it is passed to `Date`.
 */
function canceledAtOf(subscription: Stripe.Subscription): string | null {
  const at = (subscription as unknown as { canceled_at?: unknown }).canceled_at;
  return typeof at === 'number' ? new Date(at * 1000).toISOString() : null;
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
  let userId: string;
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
    userId = invite.userId;
    subscription = await billing.findCancellableSubscription(userId);
  } catch (error) {
    console.error('wind-down: could not read the local records', error);
    return {
      scheduled: false,
      reason: 'error',
      error: 'Could not read this deployment’s own billing records.',
    };
  }

  // What the wind-down actually needs, which is less than a mirror row: an
  // id to cancel, a period end to report, and whether it is already ending.
  let winding: Winding | undefined = subscription
    ? {
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        record: subscription,
      }
    : undefined;

  // The mirror being empty is not the same as Stripe having nothing. A
  // `customer.subscription.created` that was missed, delayed, or is racing
  // this revoke leaves no local row while Stripe bills on schedule, and
  // nothing revisits a revoked invite afterwards: the nightly reconcile
  // creates the mirror row and never asks whether that person's access was
  // withdrawn. So the customer mapping is used to ask Stripe directly.
  if (!winding) {
    const fromStripe = await liveSubscription(env, billing, userId, makeStripe);
    if (!fromStripe.ok) {
      return { scheduled: false, reason: 'error', error: fromStripe.error };
    }
    if (!fromStripe.winding) {
      return { scheduled: false, reason: 'nothing-to-stop' };
    }
    winding = fromStripe.winding;
  }

  // Already winding down. Saying so is not the same as saying nothing
  // happened: an operator revoking somebody who had already cancelled needs
  // to see that the end date is real and when it is, not a blank.
  if (winding.cancelAtPeriodEnd) {
    return {
      scheduled: false,
      reason: 'already-ending',
      endsAt: winding.currentPeriodEnd,
    };
  }

  try {
    const updated = await makeStripe(env).subscriptions.update(
      winding.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    const endsAt = periodEndOf(updated) ?? winding.currentPeriodEnd;

    // Provenance first, and its failure is reported. Without this row a
    // later reinstatement cannot establish that the cancellation is this
    // deployment's to clear, and refuses; nothing reconstructs it, because
    // the webhooks and the nightly reconcile own `billing_subscriptions`
    // and have never heard of this table. An earlier version swallowed the
    // failure under a comment claiming the reconcile would fix it, which
    // was true of the mirror row beneath it and false of this one.
    //
    // Recorded against Stripe's own `canceled_at` for this cancellation, so
    // the row identifies one cancellation rather than standing as open
    // permission to clear whatever the subscription carries later.
    let restorable = true;
    try {
      await billing.recordScheduledCancellation(
        winding.stripeSubscriptionId,
        userId,
        canceledAtOf(updated),
      );
    } catch (error) {
      console.error('wind-down: could not record the provenance', error);
      restorable = false;
    }

    // Mirrored straight away rather than waiting for the webhook Stripe will
    // also send. The operator is looking at the panel now, and a list that
    // still says this subscription renews is the same false claim the
    // revoke was meant to end, just moved.
    //
    // A failure here really is not a failed wind-down: Stripe has accepted
    // the change, which is the part that stops the money, and the webhook
    // or the nightly reconcile will correct this row.
    //
    // Only written when there is a real row to write. A subscription read
    // from Stripe whose price this deployment does not recognise has no
    // mirror row to derive, and inventing one would put a wrong tier where
    // the reconcile is about to put a right one: the previous cut of this
    // hard-coded `build` with an empty price id, so a revoked Ship
    // subscriber came back on Build entitlement until the nightly sweep.
    if (winding.record) {
      try {
        await billing.upsertSubscription({
          ...winding.record,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: endsAt,
        });
      } catch (error) {
        console.error('wind-down: Stripe accepted it, mirror did not', error);
      }
    }

    return { scheduled: true, endsAt, restorable };
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
    subscription = await billing.findCancellableSubscription(invite.userId);
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
  let recorded: { canceledAt: string | null } | null;
  try {
    recorded = await billing.scheduledCancellation(
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
  if (!recorded) return { restored: false, reason: 'not-ours' };

  try {
    // Which cancellation, not merely whether there was one. The record could
    // have been left behind by a clean-up that failed after a previous
    // restore, and a subscriber who then cancels for themselves would be
    // holding a different cancellation that a bare record would authorise
    // clearing. Stripe's own `canceled_at` is what tells them apart, so it
    // is read back from Stripe rather than from the mirror, which does not
    // carry it.
    const stripe = makeStripe(env);
    const live = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );
    const now = canceledAtOf(live);
    // A null on either side is not a match. The record predates this column,
    // or Stripe reports no cancellation at all; neither is proof that what
    // is scheduled now is what this deployment scheduled then.
    if (
      now === null ||
      recorded.canceledAt === null ||
      now !== recorded.canceledAt
    ) {
      return { restored: false, reason: 'not-ours' };
    }

    const updated = await stripe.subscriptions.update(
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
      // Cleared rather than left behind, though a failure here is no longer
      // dangerous: the `canceled_at` on the row means a leftover can only
      // ever match the cancellation it was written for, which this restore
      // has just undone.
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

/**
 * This account's live subscription according to Stripe, when the mirror has
 * none.
 *
 * Asked only in that case, so the ordinary revoke costs no Stripe request.
 * Returns the subscription in the shape the mirror would have held, so the
 * caller's one path handles both.
 *
 * A customer with no mapping is not an error: they never reached Checkout,
 * so there is nothing to look up.
 */
async function liveSubscription(
  env: AccessBillingEnv,
  billing: BillingStore,
  userId: string,
  makeStripe: (env: StripeEnv) => Stripe,
): Promise<
  { ok: true; winding: Winding | undefined } | { ok: false; error: string }
> {
  let customerId: string | undefined;
  try {
    customerId = await billing.findCustomerId(userId);
  } catch (error) {
    console.error('wind-down: could not read the customer mapping', error);
    return { ok: false, error: 'Could not read the customer mapping.' };
  }
  if (!customerId) return { ok: true, winding: undefined };

  try {
    // Every status, filtered here rather than by Stripe. Asking for `active`
    // alone missed a `trialing` subscription whose creation webhook never
    // arrived: the revoke reported nothing to stop, the trial ended, and
    // Stripe charged somebody whose access had been withdrawn. Anything that
    // can still take money has to be found, and only Stripe's two terminal
    // statuses cannot.
    const page = await makeStripe(env).subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });
    const live = page.data.find((s) => BILLABLE_STATUSES.includes(s.status));
    if (!live) return { ok: true, winding: undefined };
    return {
      ok: true,
      winding: {
        stripeSubscriptionId: live.id,
        currentPeriodEnd: periodEndOf(live),
        cancelAtPeriodEnd: live.cancel_at_period_end === true,
        // The real row when the price is one this deployment sells, and
        // nothing when it is not. `subscriptionRecordFrom` is the same
        // function the reconcile and the webhook path use, so a tier read
        // here can never disagree with the tier read there.
        record: subscriptionRecordFrom(live, userId),
      },
    };
  } catch (error) {
    console.error('wind-down: could not ask Stripe for a subscription', error);
    return {
      ok: false,
      error: 'Could not ask Stripe about their subscription.',
    };
  }
}
