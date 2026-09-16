import type Stripe from 'stripe';
import { resolvePrincipal } from './principal.ts';
import { BillingStore } from './billing-store.ts';
import {
  applyStripeEvent,
  ownerOfSubscription,
  stripeCollectedUsdCents,
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
   * Called for every subscription Stripe has actually taken money for, so a
   * payout whose webhook never arrived at all is still made. The webhook is
   * the fast path; this is the one that does not depend on a delivery having
   * happened, which is why it reads the invoices back from Stripe rather
   * than trusting anything mirrored locally. It is idempotent, so calling it
   * nightly costs one read each and changes nothing for the ones already
   * paid.
   */
  onClearedPayment?: (userId: string) => Promise<void>,
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
      // Deliberately not gated on `record.status`. The bug this recovers
      // from is a subscriber who paid and then cancelled: their status reads
      // `canceled` for ever, and reading status was exactly how the sweep
      // came to skip them. Their paid invoices are still there in Stripe.
      //
      // Gated on the local answer first, though, and that is what keeps
      // this from growing without bound. Reading a subscriber's whole
      // invoice history every night costs more every year, and once the
      // run exceeds its budget the subscriptions after it are never
      // reached -- the same non-converging failure the top-up rotation was
      // shaped to avoid. Once a payment is recorded, re-reading the
      // invoices cannot change any decision here, so a paid subscriber
      // costs one D1 query instead. The Stripe scan is only for accounts
      // where nothing local says they paid, which is the set it exists for
      // and which empties as they are found.
      const cleared =
        (await store.hasClearedPayment(record.userId)) ||
        (await recordPaidInvoices(stripe, store, id, record.userId)) > 0;
      if (cleared && onClearedPayment) {
        // Counted as a failure of this subscription's reconcile, not thrown:
        // a reward that cannot be paid tonight must not stop the remaining
        // subscriptions being corrected.
        try {
          await onClearedPayment(record.userId);
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
 * Mirror every account's settled top-up Checkouts, and pay what they earned.
 *
 * The other half of the delivery-independent payment record, and the half a
 * migration cannot supply. `recordPaidInvoices` repairs subscribers by
 * reading Stripe; a top-up leaves no equivalent trail locally. Its only row
 * is in `billing_topups`, which records the credit granted rather than the
 * money taken -- a coupon-covered Checkout writes one having been charged
 * nothing -- so the old rows cannot say which of them were real purchases.
 *
 * Without this, an account that topped up before `billing_payments` existed
 * reads as never having paid, and an unpaid attribution behind it is
 * stranded for ever: the webhook that would have recorded it is long gone.
 *
 * Only `mode: 'payment'` sessions. A subscription Checkout's money arrives
 * as an invoice and is recorded there, and counting the session too would
 * record the same charge twice.
 *
 * A bounded rotation, not a queue that empties. This was a one-time
 * backfill with a "done" stamp, and that shape was wrong twice over. A
 * customer is mapped when Checkout *begins*, so a pass can see a session
 * that has not settled yet and mark the account permanently finished;
 * nothing looks again when it settles. And a top-up taken after the stamp
 * had no recovery at all, which is the gap this exists to close, reopened
 * one night later.
 *
 * So there is no finished state. Least recently checked first, at most
 * `limit` a night, for ever. Accounts with a recorded payment are excluded
 * by the query rather than skipped here, so the rotation only covers
 * accounts a Stripe call could still say something about, and it shrinks as
 * customers pay.
 *
 * Returns what it looked at and how many accounts it found cleared money
 * for. Idempotent: the session id keys the write.
 */
export async function backfillTopupPayments(
  stripe: Stripe,
  store: BillingStore,
  onClearedPayment?: (userId: string) => Promise<void>,
  limit = 50,
): Promise<{ checked: number; cleared: number; failed: number }> {
  const customers = await store.customersToCheckForTopups(limit);
  let cleared = 0;
  let failed = 0;

  for (const { userId, stripeCustomerId } of customers) {
    try {
      // Before the read, not after. A customer whose read throws is exactly
      // the one that must move to the back of the queue; stamping
      // afterwards leaves it at the front for ever, holding a slot under
      // the limit so later customers are never reached.
      await store.markTopupsChecked(userId, new Date().toISOString());
      let collected = 0;
      let startingAfter: string | undefined;

      for (;;) {
        const page = await stripe.checkout.sessions.list({
          customer: stripeCustomerId,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        for (const session of page.data) {
          if (session.mode !== 'payment') continue;
          if (
            session.payment_status !== 'paid' &&
            session.payment_status !== 'no_payment_required'
          ) {
            continue;
          }
          const amount = session.amount_total ?? 0;
          collected += amount;
          await store.recordPayment(
            session.id,
            userId,
            amount,
            new Date((session.created ?? 0) * 1000).toISOString(),
          );
        }

        const last = page.data.at(-1);
        if (!page.has_more || !last?.id) break;
        // A cursor that does not move means the next request returns this
        // same page for ever. Stripe should never do it, and the cost of
        // trusting that it will not is a scheduled run that spins inside
        // one customer until the Worker is killed, every night, never
        // reaching anybody else. Cheaper to stop.
        if (last.id === startingAfter) break;
        startingAfter = last.id;
      }

      if (collected > 0) {
        cleared += 1;
        // Same shape as the subscription path: a reward that cannot be paid
        // tonight must not stop the remaining accounts being backfilled.
        if (onClearedPayment) {
          try {
            await onClearedPayment(userId);
          } catch (error) {
            console.error('backfill: referral payout failed', userId, error);
            failed += 1;
          }
        }
      }
    } catch (error) {
      console.error('backfill: failed to read checkouts', userId, error);
      failed += 1;
    }
  }

  return { checked: customers.length, cleared, failed };
}

/**
 * Mirror this subscription's paid invoices, and report what they took.
 *
 * The delivery-independent half of the payment record. `invoice.paid` is the
 * fast path; if that delivery never arrived, or the endpoint was not
 * subscribed to it, nothing local says the money cleared. Stripe still
 * knows, so this asks Stripe.
 *
 * Returns the total actually taken, in USD cents, across every paid invoice
 * on the subscription. Zero is a real answer and not an error: a trial
 * invoice and a fully coupon-covered one are both `paid` and both took
 * nothing, and the caller must not pay a referral on either.
 *
 * Writes are keyed on the invoice id, so re-running this every night
 * re-records the same invoices as no-ops.
 */
async function recordPaidInvoices(
  stripe: Stripe,
  store: BillingStore,
  subscriptionId: string,
  userId: string,
): Promise<number> {
  let total = 0;
  let startingAfter: string | undefined;

  // Paginated explicitly, for the same reason discoverSubscriptionIds is: a
  // long-lived subscriber has more than one page of invoices, and the first
  // one is not the interesting one.
  for (;;) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      status: 'paid',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const invoice of page.data) {
      // The same rule the webhook path uses, from the same function: an
      // invoice settled outside Stripe must not read as a charge here and
      // not there.
      const collected = stripeCollectedUsdCents(invoice);
      total += collected;
      if (!invoice.id) continue;
      await store.recordPayment(
        invoice.id,
        userId,
        collected,
        invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : new Date().toISOString(),
      );
    }

    const last = page.data.at(-1);
    if (!page.has_more || !last?.id) break;
    // See the note in backfillTopupPayments: a cursor that does not
    // advance turns this into an endless loop rather than a long one.
    if (last.id === startingAfter) break;
    startingAfter = last.id;
  }

  return total;
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
    // Same guard as the two loops above. This one predates them and had
    // the same hole: discovery is what feeds the whole reconcile, so a
    // cursor stuck here stalls every subscription behind it.
    if (last.id === startingAfter) break;
    startingAfter = last.id;
  }

  return { ids: [...ids], discovered };
}
