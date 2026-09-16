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
 * Dispatches on `event.type`; an event this deployment does not act on
 * (`invoice.paid`, `invoice.payment_failed`) is acknowledged, not ignored --
 * `customer.subscription.updated` already carries the status change either
 * one implies (`past_due`, `unpaid`), so there is nothing further to mirror
 * yet. Kept in the switch, rather than left unsubscribed at the Stripe
 * endpoint, so adding real handling later is a case, not a re-subscription.
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
): Promise<void> {
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
    return;
  }

  // Redundant with billing-checkout.ts's own write at Checkout creation, on
  // purpose: this event is the durable record that the checkout genuinely
  // happened, so re-asserting the link here means a failed write at
  // creation time still gets corrected once the webhook lands.
  await store.linkCustomer(userId, stripeCustomerId);

  if (session.mode !== 'payment') return; // A subscription checkout is mirrored by the subscription events below.

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
    return;
  }

  const raw = session.metadata?.[CREDIT_USD_CENTS_METADATA_KEY];
  const creditUsdCents = raw ? Number(raw) : TOPUP_CREDIT_USD_CENTS;
  await store.recordTopup(
    session.id,
    userId,
    stripeCustomerId,
    Number.isFinite(creditUsdCents) ? creditUsdCents : TOPUP_CREDIT_USD_CENTS,
  );

  await announcePurchase(onPurchaseCleared, userId);
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
async function announcePurchase(
  hook: OnPurchaseCleared | undefined,
  userId: string,
): Promise<void> {
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

async function applySubscriptionEvent(
  store: BillingStore,
  subscription: Stripe.Subscription,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<void> {
  const userId = await ownerOfSubscription(store, subscription);

  const record = subscriptionRecordFrom(subscription, userId);
  if (!record) {
    console.error(
      'stripe subscription event this deployment cannot resolve',
      subscription.id,
      subscription.items.data[0]?.price?.id,
    );
    return;
  }

  await store.upsertSubscription(record);

  // A subscription is the other way an account's first money arrives, and the
  // offer says "first purchase", not "first top-up". Only `active`: a trial
  // has not paid for anything, and paying a referral on one turns the trial
  // into the product being farmed.
  if (record.status === 'active') {
    await announcePurchase(onPurchaseCleared, record.userId);
  }
}

export async function applyStripeEvent(
  store: BillingStore,
  event: Stripe.Event,
  onPurchaseCleared?: OnPurchaseCleared,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    // The delayed-payment settlement of a session that completed unpaid. Same
    // handler, because it checks `payment_status` itself: the delivery that
    // arrived unpaid did nothing, and this one does the work.
    case 'checkout.session.async_payment_succeeded':
      await applyCheckoutSessionCompleted(
        store,
        event.data.object,
        onPurchaseCleared,
      );
      return;
    case 'checkout.session.async_payment_failed':
      // Nothing to undo, which is the whole reason the grant is gated on
      // `payment_status` rather than on the session having completed.
      return;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscriptionEvent(store, event.data.object, onPurchaseCleared);
      return;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      // See the module comment: no separate mirror yet, only acknowledged.
      return;
    default:
      // Every type here is one this deployment asked Stripe for
      // (billing-handlers.ts registers the webhook's `enabled_events`), so
      // reaching this branch means the endpoint's own subscription list
      // drifted from this switch -- worth knowing about, not worth failing
      // the delivery over.
      console.error('unhandled stripe webhook event type', event.type);
  }
}
