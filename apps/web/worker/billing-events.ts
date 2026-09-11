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

async function applyCheckoutSessionCompleted(
  store: BillingStore,
  session: Stripe.Checkout.Session,
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

  const raw = session.metadata?.[CREDIT_USD_CENTS_METADATA_KEY];
  const creditUsdCents = raw ? Number(raw) : TOPUP_CREDIT_USD_CENTS;
  await store.recordTopup(
    session.id,
    userId,
    stripeCustomerId,
    Number.isFinite(creditUsdCents) ? creditUsdCents : TOPUP_CREDIT_USD_CENTS,
  );
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

async function applySubscriptionEvent(
  store: BillingStore,
  subscription: Stripe.Subscription,
): Promise<void> {
  const stripeCustomerId = customerId(subscription.customer);
  const userId =
    metadataUserId(subscription.metadata) ??
    (stripeCustomerId
      ? await store.findUserIdForCustomer(stripeCustomerId)
      : undefined);

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
}

export async function applyStripeEvent(
  store: BillingStore,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await applyCheckoutSessionCompleted(store, event.data.object);
      return;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await applySubscriptionEvent(store, event.data.object);
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
