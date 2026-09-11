import type Stripe from 'stripe';
import { resolvePrincipal } from './principal.ts';
import { BillingStore } from './billing-store.ts';
import { applyStripeEvent, subscriptionRecordFrom } from './billing-events.ts';
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
    await applyStripeEvent(store, event);
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
): Promise<{ checked: number; corrected: number; failed: number }> {
  const ids = await store.listSubscriptionIds();
  let corrected = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      const subscription = await stripe.subscriptions.retrieve(id);
      const current = await store.getSubscription(id);
      const record = subscriptionRecordFrom(subscription, current?.userId);
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
    } catch (error) {
      console.error('reconcile: failed to check subscription', id, error);
      failed += 1;
    }
  }

  return { checked: ids.length, corrected, failed };
}
