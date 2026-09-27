import type Stripe from 'stripe';
import type { BillingStore } from './billing-store.ts';
import type { PurchaseOption } from './stripe-client.ts';
import { TOPUP_CREDIT_USD_CENTS, lookupKeyFor } from './stripe-client.ts';

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
 * second lookup either. Stripe Tax is on unconditionally (L15).
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
    automatic_tax: { enabled: true },
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
