import type Stripe from 'stripe';
import { BILLABLE_STATUSES } from './billing-store.ts';
import type { BillingStore } from './billing-store.ts';
import type { PurchaseOption } from './stripe-client.ts';
import {
  PURPOSE_METADATA_KEY,
  RETENTION_COUPON_ID,
  SIGNUP_CARD_PURPOSE,
  TOPUP_CREDIT_USD_CENTS,
  isMonthlyPlanPrice,
  lookupKeyFor,
} from './stripe-client.ts';

/**
 * Stripe-hosted Checkout and Billing Portal (docs/decisions.md L12): card
 * data never reaches this Worker, only a redirect URL does.
 */

const USER_ID_METADATA_KEY = 'vibld_user_id';
const CREDIT_USD_CENTS_METADATA_KEY = 'vibld_credit_usd_cents';

/**
 * The customer for `userId`, creating one in Stripe on first purchase.
 *
 * Checked against `store` first (L14: Vibld owns this mapping) rather than
 * searching Stripe by metadata, so a returning customer's second Checkout
 * reuses their existing Stripe customer -- creating a second one would split
 * their payment methods and invoice history across two records.
 */
async function findOrCreateCustomer(
  stripe: Stripe,
  store: BillingStore,
  userId: string,
): Promise<string> {
  const existing = await store.findCustomerId(userId);
  if (existing) return existing;

  const customer = await stripe.customers.create({
    metadata: { [USER_ID_METADATA_KEY]: userId },
  });
  await store.linkCustomer(userId, customer.id);
  return customer.id;
}

async function priceIdFor(stripe: Stripe, lookupKey: string): Promise<string> {
  const prices = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `No active Stripe price is configured with lookup_key "${lookupKey}".`,
    );
  }
  return price.id;
}

export interface CheckoutUrls {
  successUrl: string;
  cancelUrl: string;
}

/**
 * Start a Checkout Session for a subscription or a top-up.
 *
 * `client_reference_id` and `subscription_data.metadata` both carry the
 * Clerk user id (L14): the first is Checkout's own recommended field for
 * "who is buying", read back by `billing-events.ts` if the second is ever
 * missing; the second is what a live subscription object itself carries for
 * the rest of its life, so `customer.subscription.updated` never needs a
 * second lookup either.
 *
 * No Stripe Tax (L15, confirmed by Chris 2026-09-27): no `automatic_tax`, and
 * so no tax id or billing address collection either, since both exist here
 * only to feed it. Turning tax on later is a change to this call and to L15
 * together, not a Dashboard toggle.
 *
 * The purchase is recorded as started (`recordPurchaseStarted`) after Stripe
 * has created the session and before its URL is handed back. That order is
 * what makes it a barrier: nobody can pay on a page whose URL they have not
 * been given, so no charge can precede the row, and a failed write returns
 * no URL at all rather than a checkout the referral rule cannot see.
 */
export async function createCheckoutSession(
  stripe: Stripe,
  store: BillingStore,
  userId: string,
  option: PurchaseOption,
  urls: CheckoutUrls,
): Promise<string> {
  // A top-up as much as a plan: the plan auto-subscribe starts is bought in
  // place of a top-up, so neither is sold beside it.
  const before = await store.autoSubscribeState(userId);
  if (before.inFlight) throw new AutoSubscribeInFlightError();
  const customer = await findOrCreateCustomer(stripe, store, userId);
  const price = await priceIdFor(stripe, lookupKeyFor(option));

  const session = await stripe.checkout.sessions.create({
    customer,
    client_reference_id: userId,
    line_items: [{ price, quantity: 1 }],
    mode: option.kind === 'topup' ? 'payment' : 'subscription',
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    ...(option.kind === 'topup'
      ? {
          metadata: {
            [CREDIT_USD_CENTS_METADATA_KEY]: String(TOPUP_CREDIT_USD_CENTS),
          },
        }
      : {
          subscription_data: { metadata: { [USER_ID_METADATA_KEY]: userId } },
        }),
  });

  // Asked again once the session exists. Auto-subscribe expires the open
  // Checkouts it can see before it starts a plan, and one created too late
  // for it to see is expired here instead, so the two are never both
  // bought: an attempt in flight now, or a plan it started since the first
  // read (its attempt already settled), both mean it acted between.
  const after = await store.autoSubscribeState(userId);
  if (after.inFlight || after.subscriptionId !== before.subscriptionId) {
    await stripe.checkout.sessions.expire(session.id).catch((error) => {
      console.error(
        'could not expire a Checkout raced by auto-subscribe',
        error,
      );
    });
    throw new AutoSubscribeInFlightError();
  }
  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL.');
  }
  await store.recordPurchaseStarted(userId);
  return session.url;
}

/** A Checkout refused while auto-subscribe is starting a plan (D167). */
export class AutoSubscribeInFlightError extends Error {
  constructor() {
    super('Auto-subscribe is starting a plan for this account.');
    this.name = 'AutoSubscribeInFlightError';
  }
}

/**
 * Start a Checkout Session in `setup` mode: Stripe's hosted page saves a card
 * to the customer and charges nothing (Chris, 2026-09-27: the welcome credit
 * waits for a card on file).
 *
 * Hosted Checkout rather than a SetupIntent confirmed in the builder, for the
 * reason every other card flow here is hosted (L12): card data never reaches
 * this Worker, and the builder ships no Stripe.js.
 *
 * Card only, not whatever payment methods the account has enabled. The
 * once-per-card rule reads Stripe's card `fingerprint`, which a bank debit
 * or a wallet does not carry in the same form, so a method without one could
 * not be limited and is not offered.
 *
 * The purpose and the user id go on the SetupIntent as well as the session,
 * because `setup_intent.succeeded` carries only the SetupIntent.
 *
 * This creates a Stripe customer but does not record a purchase as started,
 * and that difference is the point. Saving a card sells nothing, so it must
 * not close the referral barrier (purchase-barrier.ts): an account that took
 * its welcome credit and was then sent a referral link is exactly who the
 * offer is for.
 */
export async function createCardSetupSession(
  stripe: Stripe,
  store: BillingStore,
  userId: string,
  urls: CheckoutUrls,
): Promise<string> {
  const customer = await findOrCreateCustomer(stripe, store, userId);
  const metadata = {
    [USER_ID_METADATA_KEY]: userId,
    [PURPOSE_METADATA_KEY]: SIGNUP_CARD_PURPOSE,
  };

  const session = await stripe.checkout.sessions.create({
    customer,
    client_reference_id: userId,
    mode: 'setup',
    payment_method_types: ['card'],
    metadata,
    setup_intent_data: { metadata },
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL.');
  }
  return session.url;
}

/** A Billing Portal session so the customer can update, cancel or see invoices themselves (L12). */
export async function createPortalSession(
  stripe: Stripe,
  store: BillingStore,
  userId: string,
  returnUrl: string,
): Promise<string> {
  const customer = await store.findCustomerId(userId);
  if (!customer) {
    throw new Error('No Stripe customer exists for this account yet.');
  }
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * A Billing Portal session that opens straight on cancelling this account's
 * subscription, with the retention offer for a monthly plan (Chris,
 * 2026-09-28: half off one month, once, and nothing for an annual plan).
 *
 * The offer is decided here rather than in the portal's own settings. The
 * portal can attach a retention coupon to its cancel page, but only one for
 * every subscription, and Stripe keeps a tier's monthly and annual prices on
 * the same product, so neither the portal nor the coupon can tell them
 * apart. This flow can, because it reads the subscription's price first.
 *
 * The subscription is looked for the way the revoke's wind-down looks for
 * one (`findCancellableSubscription`), not the way the allowance is: a
 * `past_due` subscriber is entitled to nothing and is still being charged,
 * and cancelling is how that stops. Stripe is then asked for the live
 * subscription, because the price and whether it is already ending are
 * Stripe's to say, and the mirror can be a delivery behind.
 *
 * A subscription already set to end is sent to the ordinary portal instead
 * of a cancel flow. There is nothing left to cancel, and the portal shows
 * when it ends and how to keep it. That is also what keeps the offer away
 * from an account whose access was revoked: the revoke schedules the end
 * itself (`access-billing.ts`), so such an account never reaches the flow.
 *
 * No subscription at all throws, the same answer `createPortalSession` gives
 * an account with no customer.
 */
export async function createCancelSession(
  stripe: Stripe,
  store: BillingStore,
  userId: string,
  returnUrl: string,
): Promise<string> {
  const record = await store.findCancellableSubscription(userId);
  if (!record) {
    throw new Error('No subscription exists for this account to cancel.');
  }
  const subscription = await stripe.subscriptions.retrieve(
    record.stripeSubscriptionId,
  );
  if (!BILLABLE_STATUSES.includes(subscription.status)) {
    throw new Error('No subscription exists for this account to cancel.');
  }

  const customer = record.stripeCustomerId;
  if (subscription.cancel_at_period_end || subscription.cancel_at !== null) {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: returnUrl,
    });
    return session.url;
  }

  const prices = subscription.items.data.map((item) => item.price);
  const offerRetention =
    prices.length > 0 && prices.every((price) => isMonthlyPlanPrice(price));

  const cancelFlow = async (withOffer: boolean) =>
    stripe.billingPortal.sessions.create({
      customer,
      return_url: returnUrl,
      flow_data: {
        type: 'subscription_cancel',
        subscription_cancel: {
          subscription: subscription.id,
          ...(withOffer
            ? {
                retention: {
                  type: 'coupon_offer',
                  coupon_offer: { coupon: RETENTION_COUPON_ID },
                },
              }
            : {}),
        },
        after_completion: {
          type: 'redirect',
          redirect: { return_url: returnUrl },
        },
      },
    });

  if (!offerRetention) return (await cancelFlow(false)).url;

  try {
    return (await cancelFlow(true)).url;
  } catch (error) {
    // The offer is something extra; the cancellation is what was asked for.
    // A coupon Stripe will not attach (not created yet in this account,
    // deleted, or refused for this subscription) must not leave somebody
    // unable to cancel, so the flow is asked for again without it.
    //
    // Only a refusal, though. A network failure or an outage says nothing
    // about the coupon, and quietly dropping the offer for it would take
    // away a discount this customer was entitled to be shown; that failure
    // goes back to the caller like any other.
    if (!isStripeRefusal(error)) throw error;
    console.error(
      'retention offer refused by Stripe; opening the cancel flow without it',
      { coupon: RETENTION_COUPON_ID, subscription: subscription.id, error },
    );
    return (await cancelFlow(false)).url;
  }
}

/** Stripe answered and said no, as opposed to not answering at all. */
function isStripeRefusal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'StripeInvalidRequestError'
  );
}
