import type Stripe from 'stripe';
import type { BillingStore, SubscriptionRecord } from './billing-store.ts';
import { TOPUP_CREDIT_USD_CENTS, tierForLookupKey } from './stripe-client.ts';

/**
 * Turn a verified Stripe event into a `BillingStore` write (docs/decisions.md
 * L13). Pure and Stripe-SDK-network-free -- `Stripe` is imported only for its
 * types -- so it is testable against hand-built event fixtures and a fake
 * `BillingStore`, the same way `generation-workflow.ts`'s `runGeneration` is
 * tested against a fake `GenerationStore`.
 *
 * Dispatches on `event.type`. `invoice.payment_failed` is acknowledged and
 * not acted on: `customer.subscription.updated` already carries the status
 * change it implies (`past_due`, `unpaid`), so there is nothing further to
 * mirror. `invoice.paid` used to be treated the same way and is not any more,
 * because it is the only event that records that money actually moved, and a
 * subscription's current status cannot answer that afterwards.
 */

/**
 * Threaded through `subscription_data.metadata` and `session.metadata` at
 * Checkout Session creation (billing-checkout.ts), and read back here --
 * deliberately, so a webhook never needs a second Stripe call just to learn
 * which of our users a subscription or a top-up belongs to.
 */
const USER_ID_METADATA_KEY = 'vibld_user_id';
const CREDIT_USD_CENTS_METADATA_KEY = 'vibld_credit_usd_cents';

function customerId(
  customer: string | { id: string } | null,
): string | undefined {
  if (!customer) return undefined;
  return typeof customer === 'string' ? customer : customer.id;
}

function metadataUserId(metadata: Stripe.Metadata | null): string | undefined {
  const value = metadata?.[USER_ID_METADATA_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * What to do when an account's money has actually arrived.
 *
 * A callback rather than a store, so this module keeps knowing only about
 * Stripe and billing. The referral payout is the only caller today, and it is
 * the kind of thing that must never be able to fail a webhook delivery: see
 * where it is invoked below.
 */
export type OnPurchaseCleared = (userId: string) => Promise<void>;

/**
 * Called when money that had already arrived goes back out: a refund, or a
 * dispute this deployment lost.
 *
 * A separate callback rather than a branch inside this module, for the same
 * reason `OnPurchaseCleared` is one. What a reversal means for a referral is
 * the referral module's rule, and importing it here would put a payout
 * decision inside the file that reads Stripe's envelopes.
 *
 * `reason` is carried through to the ledger note, so a negative row in
 * somebody's credit history says which of the two happened rather than
 * appearing as an unexplained deduction.
 */
export type OnPurchaseReversed = (
  userId: string,
  reason: string,
) => Promise<void>;

/**
 * Fetch a charge Stripe referred to by id alone.
 *
 * `charge.dispute.closed` carries `charge` as a bare id in the ordinary
 * case, and a dispute is the one reversal whose customer cannot be read off
 * the event. Without this the whole dispute path was dead: the handler
 * answered `unresolved`, the webhook marked the event processed anyway, and
 * a replayed one parked for ever because nothing would ever expand it. Lost
 * disputes never clawed anything back.
 *
 * Injected rather than reached for, because this module reads Stripe's
 * envelopes and does not call Stripe. The caller has a client; this is the
 * one question it has to ask on this module's behalf.
 */
export type ResolveCharge = (chargeId: string) => Promise<Stripe.Charge>;

/**
 * Whether applying an event actually wrote what the event was about.
 *
 * `unresolved` means the handler could not work out whose money this is, so
 * it wrote nothing. Reported rather than logged and dropped, because the
 * answer can change: a missed `invoice.paid` read before the older
 * `checkout.session.completed` that creates the customer mapping has nobody
 * to attribute to yet, and does once that older event has been applied. A
 * caller that records the event as handled on the strength of a normal
 * return loses the payment permanently. `billing-replay.ts` is the caller
 * that has to care.
 *
 * The webhook path ignores this and still marks the delivery processed, as
 * it did before. Failing a delivery Stripe will retry for days over an event
 * that may never resolve is a different trade, and not one this change is
 * making.
 */
export type EventOutcome = 'applied' | 'unresolved';

/**
 * Whether Stripe has actually taken the money for this session.
 *
 * `no_payment_required` is a real settled state, not an edge case to ignore:
 * a Checkout fully covered by a coupon or a credit balance completes that way
 * and owes nothing further.
 */
function isSettled(session: Stripe.Checkout.Session): boolean {
  return (
    session.payment_status === 'paid' ||
    session.payment_status === 'no_payment_required'
  );
}

async function applyCheckoutSessionCompleted(
  store: BillingStore,
  session: Stripe.Checkout.Session,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<EventOutcome> {
  const userId =
    metadataUserId(session.metadata) ??
    session.client_reference_id ??
    undefined;
  const stripeCustomerId = customerId(session.customer);
  if (!userId || !stripeCustomerId) {
    console.error(
      'stripe checkout.session.completed with no resolvable user id',
      session.id,
    );
    return 'unresolved';
  }

  // Redundant with billing-checkout.ts's own write at Checkout creation, on
  // purpose: this event is the durable record that the checkout genuinely
  // happened, so re-asserting the link here means a failed write at
  // creation time still gets corrected once the webhook lands.
  await store.linkCustomer(userId, stripeCustomerId);

  // A subscription checkout is mirrored by the subscription events below.
  if (session.mode !== 'payment') return 'applied';

  // A completed Checkout is not a paid one. With a delayed payment method
  // (bank debits and the like) the session completes `unpaid` and settles
  // later, through `checkout.session.async_payment_succeeded`, or fails and
  // never settles at all. Recording the top-up on completion alone therefore
  // grants credit for money that may never arrive, and pays a referral on it.
  //
  // The settled events route back into this same function, so the top-up and
  // the payout both happen exactly once, when the money is actually there.
  if (!isSettled(session)) {
    console.log(
      JSON.stringify({
        event: 'billing.checkout.unsettled',
        session: session.id,
        paymentStatus: session.payment_status,
      }),
    );
    return 'applied';
  }

  const raw = session.metadata?.[CREDIT_USD_CENTS_METADATA_KEY];
  const creditUsdCents = raw ? Number(raw) : TOPUP_CREDIT_USD_CENTS;
  await store.recordTopup(
    session.id,
    userId,
    stripeCustomerId,
    Number.isFinite(creditUsdCents) ? creditUsdCents : TOPUP_CREDIT_USD_CENTS,
  );

  // The credit granted above and the money taken here are different numbers
  // and must not be conflated. `no_payment_required` is a settled state that
  // took nothing (a Checkout fully covered by a coupon or a credit balance),
  // and it still grants the credit the customer was promised. What it must
  // not do is earn a referral, which is why the amount is recorded and
  // `announceIfPaid` reads it rather than the fact that a top-up row exists.
  const amountUsdCents = session.amount_total ?? 0;
  await store.recordPayment(
    session.id,
    userId,
    amountUsdCents,
    new Date().toISOString(),
  );

  await announceIfPaid(onPurchaseCleared, userId, amountUsdCents);
  return 'applied';
}

/**
 * Run the purchase hook, and let a failure fail the delivery.
 *
 * This used to swallow the error, on the reasoning that a reward bug should
 * not look like a billing outage and that a later delivery would recover it.
 * The second half was false. `handleStripeWebhook` records the event as
 * processed once this returns, and Stripe's redelivery then exits at that
 * check, so a swallowed failure meant a payout that was owed and would never
 * be attempted again. Half a payout, too: the referrer's credit could land
 * and the referred account's not.
 *
 * Failing is the cheaper half of the trade. The top-up above is already
 * written and is keyed on the checkout session, so the redelivery Stripe
 * makes re-runs it as a no-op and the customer's own credit is never at
 * stake; what is red is a webhook delivery, which is a thing somebody should
 * be told about. A reward silently not paid is not.
 */
async function announceIfPaid(
  hook: OnPurchaseCleared | undefined,
  userId: string,
  amountUsdCents: number,
): Promise<void> {
  // The gate, in the one place every announce goes through. A settlement
  // that took nothing is not a purchase, however settled Stripe considers
  // it, and this is the same question `CLEARED_PAYMENT_SQL` asks of the
  // recorded row: the immediate path and the recovery sweep must not be able
  // to disagree about who has paid.
  if (amountUsdCents <= 0) return;
  if (!hook) return;
  await hook(userId);
}

/**
 * The mirror row a Stripe subscription maps to, given who it belongs to.
 * Pure and reused by `reconcileSubscriptions` (billing-handlers.ts) as well
 * as the webhook path below, so the two can never disagree about what a
 * subscription object means.
 *
 * `undefined` for a subscription this deployment cannot make sense of (no
 * customer, no recognised price) -- the caller decides what that means for
 * it (skip a webhook event, or leave a reconciled row alone).
 */
export function subscriptionRecordFrom(
  subscription: Stripe.Subscription,
  userId: string | undefined,
): SubscriptionRecord | undefined {
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId || !userId) return undefined;

  const item = subscription.items.data[0];
  const price = item?.price;
  const tier = tierForLookupKey(price?.lookup_key ?? null);
  if (!item || !price || !tier) return undefined;

  return {
    stripeSubscriptionId: subscription.id,
    userId,
    stripeCustomerId,
    tier,
    status: subscription.status,
    priceId: price.id,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

/**
 * Who a subscription belongs to, from the subscription alone.
 *
 * Its own metadata first, then the customer mapping this deployment owns.
 * Exported because the nightly reconcile needs exactly this: a subscription
 * Stripe reports that was never mirrored has no local row to read a user id
 * from, which is the whole reason it was missed.
 */
export async function ownerOfSubscription(
  store: BillingStore,
  subscription: Stripe.Subscription,
): Promise<string | undefined> {
  const stripeCustomerId = customerId(subscription.customer);
  return (
    metadataUserId(subscription.metadata) ??
    (stripeCustomerId
      ? await store.findUserIdForCustomer(stripeCustomerId)
      : undefined)
  );
}

/**
 * Mirror a subscription's state. It does not announce a purchase.
 *
 * It used to, on `status === 'active'`, and that was the wrong question. A
 * status is not a charge: a subscription covered in full by a coupon, or one
 * whose first invoice is zero, reads `active` having taken nothing, and the
 * announce paid a referral for it. `invoice.paid` is the event that says
 * money moved and it carries the amount, so the announce belongs there and
 * nowhere else.
 *
 * If that delivery never arrives, the nightly reconcile reads the paid
 * invoices back from Stripe itself and records them, so the payout is late
 * rather than lost. That is the trade, taken deliberately: a referral credit
 * a day late costs nothing, and one paid on a charge that never happened is
 * a way to farm the offer for free.
 */
async function applySubscriptionEvent(
  store: BillingStore,
  subscription: Stripe.Subscription,
): Promise<EventOutcome> {
  const userId = await ownerOfSubscription(store, subscription);

  const record = subscriptionRecordFrom(subscription, userId);
  if (!record) {
    console.error(
      'stripe subscription event this deployment cannot resolve',
      subscription.id,
      subscription.items.data[0]?.price?.id,
    );
    return 'unresolved';
  }

  await store.upsertSubscription(record);
  return 'applied';
}

/**
 * What this invoice charged through Stripe, in USD cents.
 *
 * Deliberately not "what Stripe collected", which is a larger claim than
 * this makes. A refund or a lost dispute returns money afterwards without
 * moving `amount_paid`, and nothing here reads either, so this is what was
 * charged at the time and not a current balance. Netting reversals is
 * tracked separately; treating this number as one would be wrong.
 *
 * Not `amount_paid` either, which is the wrong number twice over. It counts money
 * that never moved through Stripe: an invoice marked paid out of band (a
 * bank transfer, a cheque, a cash payment recorded by hand) reports the full
 * `amount_paid` with `amount_paid_off_stripe` carrying the part Stripe never
 * saw. And a zero-amount invoice is `paid` in Stripe's sense having taken
 * nothing at all, which a trial and a full coupon both produce.
 *
 * Subtracting leaves only what Stripe itself put through a card, which is
 * the conservative direction on a rule that hands out credit and the same
 * one the purchase barrier takes.
 *
 * **This is a product decision, not just a safety one, and it is reversible
 * in one line.** Vibld has no out-of-band invoicing today, so today this
 * changes nothing. If it ever bills an enterprise customer by bank transfer,
 * that customer really has bought something, and whether their referrer gets
 * paid is a question about the offer rather than about Stripe. Drop the
 * subtraction to say yes.
 */
export function stripeCollectedUsdCents(invoice: Stripe.Invoice): number {
  return invoice.amount_paid - (invoice.amount_paid_off_stripe ?? 0);
}

/**
 * An invoice that was actually paid.
 *
 * This event was acknowledged and discarded, on the reasoning that
 * `customer.subscription.updated` already carries whatever status change an
 * invoice implies. That is true about the status and false about the history,
 * and the difference cost a payout: a subscriber whose first subscription
 * event was missed and who then cancelled reads as `canceled` for ever, so
 * nothing downstream could tell they had ever paid.
 *
 * It is the only event that says money moved, so it is now the durable record
 * that it did, and it announces the purchase itself. Announcing on every
 * paid invoice rather than only the first is safe and deliberate: the payout
 * is idempotent per referred account, so the second invoice is a no-op and
 * the first one nobody delivered is recovered by the next.
 */
async function applyInvoicePaid(
  store: BillingStore,
  invoice: Stripe.Invoice,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<EventOutcome> {
  const stripeCustomerId = customerId(invoice.customer);
  const userId =
    metadataUserId(invoice.metadata ?? null) ??
    (stripeCustomerId
      ? await store.findUserIdForCustomer(stripeCustomerId)
      : undefined);

  // No resolvable owner means there is nobody to record the payment against.
  // Logged rather than swallowed: an invoice this deployment cannot
  // attribute is a mirror that has drifted from Stripe, not a normal event.
  if (!userId) {
    console.error('stripe invoice.paid with no resolvable user id', invoice.id);
    return 'unresolved';
  }

  // Recorded against the user and keyed on the invoice, not hung off the
  // subscription row. `invoice.paid` can arrive before
  // `customer.subscription.created`, and an UPDATE against a row that does
  // not exist yet changes nothing and reports nothing, which is how a real
  // payment could go unrecorded for ever.
  //
  const amountUsdCents = stripeCollectedUsdCents(invoice);
  await store.recordPayment(
    invoice.id ?? `invoice-unknown-${userId}`,
    userId,
    amountUsdCents,
    new Date().toISOString(),
  );

  await announceIfPaid(onPurchaseCleared, userId, amountUsdCents);
  return 'applied';
}

export async function applyStripeEvent(
  store: BillingStore,
  event: Stripe.Event,
  onPurchaseCleared?: OnPurchaseCleared,
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
): Promise<EventOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
    // The delayed-payment settlement of a session that completed unpaid. Same
    // handler, because it checks `payment_status` itself: the delivery that
    // arrived unpaid did nothing, and this one does the work.
    case 'checkout.session.async_payment_succeeded':
      return await applyCheckoutSessionCompleted(
        store,
        event.data.object,
        onPurchaseCleared,
      );
    case 'checkout.session.async_payment_failed':
      // Nothing to undo, which is the whole reason the grant is gated on
      // `payment_status` rather than on the session having completed.
      return 'applied';
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return await applySubscriptionEvent(store, event.data.object);
    case 'invoice.paid':
      return await applyInvoicePaid(
        store,
        event.data.object,
        onPurchaseCleared,
      );
    case 'invoice.payment_failed':
      // See the module comment: no separate mirror yet, only acknowledged.
      return 'applied';
    case 'charge.refunded':
      return await applyChargeReversed(
        store,
        event.data.object,
        'Referral reversed: the payment was refunded.',
        onPurchaseReversed,
        resolveCharge,
      );
    case 'charge.dispute.closed':
      // Only a dispute that was lost took the money back. A won dispute
      // means it stayed, and clawing back on `dispute.created` instead would
      // mean re-crediting everybody whose dispute this deployment wins.
      if (event.data.object.status !== 'lost') return 'applied';
      return await applyChargeReversed(
        store,
        event.data.object.charge,
        'Referral reversed: the dispute was lost.',
        onPurchaseReversed,
        resolveCharge,
      );
    default:
      // Every type here is one this deployment asked Stripe for
      // (billing-handlers.ts registers the webhook's `enabled_events`), so
      // reaching this branch means the endpoint's own subscription list
      // drifted from this switch -- worth knowing about, not worth failing
      // the delivery over.
      console.error('unhandled stripe webhook event type', event.type);
      // Applied in the sense that matters to a caller deciding whether to
      // come back: nothing here can write it, and reading it again would
      // reach this same branch.
      return 'applied';
  }
}

/**
 * Money that had arrived has gone back out, so tell the caller whose it was.
 *
 * Nothing about the payment row is rewritten here. `recordPayment`'s own
 * comment already says what it records is what was charged at the time and
 * not a current balance, and changing that now would move a number three
 * other places read as "they have paid at some point", which is still true
 * of somebody who was refunded.
 *
 * The one thing that must not survive a reversal is credit handed out
 * because the money arrived, and that is the callback's business.
 *
 * `unresolved` rather than `applied` when the customer cannot be mapped to
 * an account: a refund read before the `checkout.session.completed` that
 * creates the mapping has nobody to attribute to yet, and will have once
 * that older event lands. Reporting it applied loses the reversal for good.
 */
async function applyChargeReversed(
  store: BillingStore,
  charge: Stripe.Charge | string,
  reason: string,
  onPurchaseReversed?: OnPurchaseReversed,
  resolveCharge?: ResolveCharge,
): Promise<EventOutcome> {
  // A dispute carries its charge as a bare id in the ordinary case, and the
  // customer is only on the charge. This module does not call Stripe, so the
  // caller supplies the one lookup; without it the dispute path answered
  // `unresolved` for every real delivery and nothing ever clawed back.
  let resolved: Stripe.Charge;
  if (typeof charge === 'string') {
    if (!resolveCharge) {
      console.error('stripe reversal with no way to read the charge', charge);
      return 'unresolved';
    }
    try {
      resolved = await resolveCharge(charge);
    } catch (error) {
      // Not `applied`: Stripe was asked and could not answer, so this is
      // still owed. Marking it done here is how a lost dispute keeps its
      // reward for ever.
      console.error('stripe reversal could not read the charge', charge, error);
      return 'unresolved';
    }
  } else {
    resolved = charge;
  }

  const stripeCustomerId = customerId(resolved.customer);
  if (!stripeCustomerId) {
    console.error('stripe reversal with no customer', resolved.id);
    return 'unresolved';
  }

  const userId = await store.findUserIdForCustomer(stripeCustomerId);
  if (!userId) {
    console.error('stripe reversal for an unmapped customer', resolved.id);
    return 'unresolved';
  }

  if (onPurchaseReversed) {
    try {
      await onPurchaseReversed(userId, reason);
    } catch (error) {
      // Not `applied`. The clawback is the entire work of this event, so an
      // event marked done on a failed one is credit this deployment paid for
      // with nothing left to come back to it. `unresolved` is what the
      // callers already have machinery for: the replay parks it and retries,
      // and the webhook answers retryably rather than 200.
      console.error('stripe reversal could not be applied', userId, error);
      return 'unresolved';
    }
  }
  return 'applied';
}
