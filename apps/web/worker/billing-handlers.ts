import type Stripe from 'stripe';
import { resolvePrincipal } from './principal.ts';
import { BillingStore } from './billing-store.ts';
import {
  applyStripeEvent,
  ownerOfSubscription,
  subscriptionRecordFrom,
} from './billing-events.ts';
import { payReferralIfEarned } from './referral-payout.ts';
import { ReferralStore } from './referral-store.ts';
import {
  createCheckoutSession,
  createPortalSession,
} from './billing-checkout.ts';
import { createStripeClient, stripeConfigured } from './stripe-client.ts';
import type { PurchaseOption } from './stripe-client.ts';

/**
 * The Worker-facing half of Stripe billing (docs/decisions.md L12-L15):
 * three HTTP handlers wired into `index.ts`'s router, plus the nightly
 * reconcile the scheduled export calls. Every real decision -- which price a
 * purchase maps to, how a webhook becomes a mirror row -- lives in
 * `stripe-client.ts`/`billing-checkout.ts`/`billing-events.ts`; this file
 * only authenticates, validates a request body, and shapes the response.
 */

export interface BillingEnv {
  CLERK_FRONTEND_API_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DB?: D1Database;
}

export function billingConfigured(env: BillingEnv): boolean {
  return Boolean(stripeConfigured(env) && env.STRIPE_WEBHOOK_SECRET && env.DB);
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function parsePurchaseOption(
  body: unknown,
): PurchaseOption | { error: string } {
  if (typeof body !== 'object' || body === null)
    return { error: 'Body must be a JSON object.' };
  const { tier, interval, topup } = body as {
    tier?: unknown;
    interval?: unknown;
    topup?: unknown;
  };

  if (topup === true) return { kind: 'topup' };

  if (tier !== 'build' && tier !== 'ship') {
    return {
      error: '"tier" must be "build" or "ship" (or set "topup": true).',
    };
  }
  if (interval !== 'monthly' && interval !== 'annual') {
    return { error: '"interval" must be "monthly" or "annual".' };
  }
  return { kind: 'subscription', tier, interval };
}

/**
 * POST { tier, interval } or { topup: true } -> { url } to redirect the
 * browser to. Authenticated the same way `/api/plan` is (ADR-0006): this
 * Worker verifies the caller's own Clerk session, never trusts a userId the
 * browser could supply itself.
 */
export async function handleBillingCheckout(
  request: Request,
  env: BillingEnv,
  selfOrigin: string,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!billingConfigured(env)) {
    return json(
      { error: 'Billing is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const option = parsePurchaseOption(body);
  if ('error' in option) return json({ error: option.error }, 400);

  try {
    const stripe = createStripeClient(env);
    const store = new BillingStore(env.DB!);
    const url = await createCheckoutSession(
      stripe,
      store,
      principal.userId,
      option,
      {
        successUrl: `${selfOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${selfOrigin}/billing/cancelled`,
      },
    );
    return json({ url });
  } catch (error) {
    console.error('failed to create checkout session', error);
    return json({ error: 'Could not start checkout. Try again shortly.' }, 502);
  }
}

/** POST -> { url } for the Stripe-hosted Billing Portal (L12). */
export async function handleBillingPortal(
  request: Request,
  env: BillingEnv,
  selfOrigin: string,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!billingConfigured(env)) {
    return json(
      { error: 'Billing is not configured for this deployment.' },
      503,
    );
  }

  const resolved = await resolvePrincipal(request, env);
  if (resolved.denied) return resolved.denied;
  const { principal } = resolved;

  try {
    const stripe = createStripeClient(env);
    const store = new BillingStore(env.DB!);
    const url = await createPortalSession(
      stripe,
      store,
      principal.userId,
      `${selfOrigin}/`,
    );
    return json({ url });
  } catch (error) {
    console.error('failed to create billing portal session', error);
    return json(
      { error: 'Could not open the billing portal. Try again shortly.' },
      502,
    );
  }
}

/**
 * Stripe's own POST, not a browser's: no Clerk session exists to check, so
 * the `Stripe-Signature` header is the entire authentication (L30) -- the
 * raw body is read and verified before anything about it is parsed or
 * trusted, exactly the order L30 requires.
 */
export async function handleStripeWebhook(
  request: Request,
  env: BillingEnv,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!billingConfigured(env)) {
    return json(
      { error: 'Billing is not configured for this deployment.' },
      503,
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature)
    return json({ error: 'Missing Stripe-Signature header.' }, 400);

  const rawBody = await request.text();
  const stripe = createStripeClient(env);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (error) {
    // Never echo the failure detail: it would tell a forger which part of
    // their forged signature was wrong.
    console.error('stripe webhook signature verification failed', error);
    return json({ error: 'Invalid signature.' }, 400);
  }

  const store = new BillingStore(env.DB!);
  // Checked before applying, not after: Stripe redelivers, and the same
  // event applied twice must be a no-op, not a second write.
  if (await store.wasEventProcessed(event.id)) {
    return json({ received: true });
  }

  try {
    // The referral payout rides the same delivery that records the money,
    // because "their first purchase cleared" is exactly what this event
    // means and there is no second moment that knows it. A payout failure
    // therefore fails the delivery, on purpose: `markEventProcessed` below
    // runs only when the whole of this succeeded, so swallowing the failure
    // here would mark the event done and lose a payout that was owed. The
    // retry Stripe then makes re-runs an idempotent path.
    const referrals = new ReferralStore(env.DB!);
    await applyStripeEvent(store, event, (userId) =>
      payReferralIfEarned({ referrals, billing: store }, userId).then(
        () => undefined,
      ),
    );
  } catch (error) {
    // A 5xx here makes Stripe retry, which is what an unexpected D1/R2
    // failure should do -- succeeding despite a write that never happened
    // would let this event age out of Stripe's own retry window unmirrored.
    console.error('failed to apply stripe webhook event', event.type, error);
    return json({ error: 'Could not process this event.' }, 500);
  }

  await store.markEventProcessed(event.id, event.type);
  return json({ received: true });
}

/**
 * Re-read every mirrored subscription from Stripe and correct drift (L13).
 * Called from `index.ts`'s `scheduled` export, on a nightly Cron Trigger.
 * Stripe, not this deployment's own copy, is authoritative -- a subscription
 * Stripe no longer recognises is left alone rather than deleted, matching
 * L32's general preference for keeping a record over erasing one silently.
 */
export async function reconcileSubscriptions(
  stripe: Stripe,
  store: BillingStore,
  /**
   * Called for every subscription Stripe reports as active, so a payout whose
   * webhook never arrived at all is still made. The webhook is the fast path;
   * this is the one that does not depend on a delivery having happened. It is
   * idempotent, so calling it nightly for every active subscriber costs one
   * read each and changes nothing for the ones already paid.
   */
  onActiveSubscription?: (userId: string) => Promise<void>,
): Promise<{
  checked: number;
  corrected: number;
  failed: number;
  discovered: number;
}> {
  const ids = await discoverSubscriptionIds(stripe, store);
  let corrected = 0;
  let failed = 0;

  for (const id of ids.ids) {
    try {
      const subscription = await stripe.subscriptions.retrieve(id);
      const current = await store.getSubscription(id);
      // The local row first, since it is the cheapest answer, then the
      // subscription's own metadata and the customer mapping. A subscription
      // discovered above has no local row by definition, so without the
      // fallback every discovered one would count as unresolvable.
      const record = subscriptionRecordFrom(
        subscription,
        current?.userId ?? (await ownerOfSubscription(store, subscription)),
      );
      if (!record) {
        console.error('reconcile: subscription no longer resolvable', id);
        failed += 1;
        continue;
      }
      if (
        !current ||
        current.status !== record.status ||
        current.priceId !== record.priceId ||
        current.tier !== record.tier ||
        current.currentPeriodEnd !== record.currentPeriodEnd ||
        current.cancelAtPeriodEnd !== record.cancelAtPeriodEnd
      ) {
        await store.upsertSubscription(record);
        corrected += 1;
      }
      if (record.status === 'active') {
        // Stripe reporting a subscription active is evidence money cleared,
        // and this is the path that runs when no delivery ever arrived to say
        // so. Without it, a subscriber discovered here has no durable payment
        // record and the recovery sweep cannot see them.
        await store.markSubscriptionPaid(id, new Date().toISOString());
      }
      if (record.status === 'active' && onActiveSubscription) {
        // Counted as a failure of this subscription's reconcile, not thrown:
        // a reward that cannot be paid tonight must not stop the remaining
        // subscriptions being corrected.
        try {
          await onActiveSubscription(record.userId);
        } catch (error) {
          console.error('reconcile: referral payout failed', id, error);
          failed += 1;
        }
      }
    } catch (error) {
      console.error('reconcile: failed to check subscription', id, error);
      failed += 1;
    }
  }

  return {
    checked: ids.ids.length,
    corrected,
    failed,
    discovered: ids.discovered,
  };
}

/**
 * Every subscription this reconcile should look at.
 *
 * The local mirror is not enough, and assuming it was is what this fixes. A
 * subscriber whose very first `customer.subscription.created` delivery was
 * missed has no row here at all, and a subscription-mode
 * `checkout.session.completed` only links the customer, so nothing else
 * writes one either. Iterating the mirror alone means that account is never
 * reconciled and its referral is never paid, which is the opposite of what a
 * missed-webhook recovery is for.
 *
 * Stripe is authoritative (L13), so this asks Stripe. Pagination is explicit
 * rather than using the SDK's auto-paging helper, because a reconcile that
 * silently stops after one page is a reconcile that covers the first hundred
 * subscribers.
 */
async function discoverSubscriptionIds(
  stripe: Stripe,
  store: BillingStore,
): Promise<{ ids: string[]; discovered: number }> {
  const mirrored = await store.listSubscriptionIds();
  const ids = new Set(mirrored);
  let discovered = 0;
  let startingAfter: string | undefined;

  for (;;) {
    const page = await stripe.subscriptions.list({
      limit: 100,
      status: 'all',
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const subscription of page.data) {
      if (!ids.has(subscription.id)) {
        ids.add(subscription.id);
        discovered += 1;
      }
    }
    const last = page.data[page.data.length - 1];
    if (!page.has_more || !last) break;
    startingAfter = last.id;
  }

  return { ids: [...ids], discovered };
}
