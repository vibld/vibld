import type Stripe from 'stripe';
import type { BillingStore } from './billing-store.ts';
import type { PurchaseOption } from './stripe-client.ts';
import {
  PURPOSE_METADATA_KEY,
  SIGNUP_CARD_PURPOSE,
  TOPUP_CREDIT_USD_CENTS,
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

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL.');
  }
  await store.recordPurchaseStarted(userId);
  return session.url;
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
