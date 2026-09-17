import type Stripe from 'stripe';
import { resolvePrincipal } from './principal.ts';
import { BillingStore } from './billing-store.ts';
import {
  applyStripeEvent,
  idsOf,
  ownerOfSubscription,
  stripeCollectedUsdCents,
  subscriptionRecordFrom,
} from './billing-events.ts';
import { clawBackReferral, payReferralIfEarned } from './referral-payout.ts';
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
    const deps = { referrals, billing: store };
    const outcome = await applyStripeEvent(
      store,
      event,
      (userId, fundedBy) =>
        payReferralIfEarned(deps, userId, fundedBy).then(() => undefined),
      // A reversal rides its own delivery on the same terms, and fails it
      // the same way. The reward was funded by a payment that has gone
      // back out, so a clawback that is swallowed here leaves credit this
      // deployment is paying for with an event marked done and nothing to
      // come back to it. `clawBackReferral` is idempotent, so the retry
      // Stripe makes writes the same rows once.
      (userId, reason, refundedIds) =>
        clawBackReferral(deps, userId, reason, refundedIds).then(
          () => undefined,
        ),
      // A dispute names its charge by id, and the customer is only on the
      // charge. One request, on the rarest event type this deployment
      // handles.
      (chargeId) => stripe.charges.retrieve(chargeId),
    );

    // `unresolved` means the handler wrote nothing, so the event is not
    // done. Marking it processed on a normal return is how it is lost for
    // good: the replay skips a processed event, so nothing ever revisits it.
    //
    // A 5xx is what makes Stripe try again, which is the only retry a
    // webhook has. Thrown rather than returned so the one handler below
    // covers both this and an unexpected D1 failure, and so
    // `markEventProcessed` stays unreachable for anything that did not
    // finish.
    if (outcome === 'unresolved') {
      throw new Error(`stripe event ${event.id} could not be applied yet`);
    }
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
 * The one reconcile walk this deployment runs, named so a second one is a
 * new row rather than a schema change (0017_reconcile_cursor.sql).
 */
const RECONCILE_WALK = 'subscriptions';

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
  /**
   * How many subscriptions this run may check (#47).
   *
   * It used to check all of them, every night, with nothing bounding it.
   * The three phases before this one in the same invocation share one D1
   * allowance and this one took whatever was left; past about a hundred
   * subscriptions D1 throws, `scheduled` catches the throw and logs it, and
   * the reconcile quietly stops happening.
   *
   * The bound is only safe because of the cursor below. A bound on its own
   * is the failure `0009_event_replay.sql` was written from: it turns "never
   * finishes" into "stops early and reports success", and everything past it
   * is never reached on any night.
   */
  limit = Number.POSITIVE_INFINITY,
): Promise<{
  checked: number;
  corrected: number;
  failed: number;
  discovered: number;
  /** Subscriptions this run did not reach. The next one starts there. */
  remaining: number;
}> {
  const found = await discoverSubscriptionIds(stripe, store);
  let corrected = 0;
  let failed = 0;

  // A discovery that stopped early is a reconcile that cannot have covered
  // everything, so it is counted as a failure rather than reported as a
  // clean run over a short list. The subscriptions it did find are still
  // worth checking, which is why this does not throw.
  if (found.truncated) {
    console.error('reconcile: subscription discovery stopped early');
    failed += 1;
  }

  /*
   * One stable order, so "after this id" means the same thing on every run.
   * `discoverSubscriptionIds` merges the mirror with Stripe's own list, and
   * neither order is stable across nights: the mirror's is whatever D1
   * returns and Stripe's is newest-first, which shifts every time somebody
   * subscribes. Sorting makes the walk a walk rather than a re-shuffle.
   */
  const all = [...found.ids].sort();
  const { afterId: after, retryOf } =
    await store.reconcileCursor(RECONCILE_WALK);
  // The first id past where the last run stopped. An id that has since
  // disappeared costs nothing: the search is for the next one above it.
  const start = after === undefined ? 0 : all.findIndex((id) => id > after);
  const from = start === -1 ? all.length : start;
  const ids = Number.isFinite(limit)
    ? all.slice(from, from + limit)
    : all.slice(from);
  const reachedEnd = from + ids.length >= all.length;

  /**
   * Where the earliest subscription that threw sits in this slice, if any.
   *
   * A failure used to be walked straight past: the cursor advanced over the
   * whole slice whatever happened inside it, so the subscription was not
   * looked at again until the walk lapped (0019_reconcile_retry.sql).
   */
  let firstFailed = -1;
  /**
   * The earliest failure that is not the one this run was already retrying.
   *
   * The distinction a boolean could not make. During a retry run, a
   * different subscription failing for the first time would find the flag
   * already set and be walked past with no retry of its own, which is the
   * delay the retry exists to remove, moved one subscription along.
   */
  let firstNewFailure = -1;
  for (const [index, id] of ids.entries()) {
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
      // from is a subscriber who paid and then cancelled: their status
      // reads `canceled` for ever, and reading status was exactly how the
      // sweep came to skip them. What they have is a recorded payment.
      //
      // The local answer first, and one Stripe question when it is no.
      //
      // Before this change the payout fired on `record.status === 'active'`,
      // which needed no webhook at all. Requiring a recorded payment is
      // right (an active subscription can be a trial or a full coupon and
      // have taken nothing) but on its own it would lose the case that
      // reading status got correct: a subscriber who really is paying and
      // whose `invoice.paid` was never delivered. That is a payout silently
      // never made, so it is not something to fix later.
      //
      // Walking their invoice history is what could not be made to work
      // inside a scheduled run, so this does not walk it. One request, the
      // most recent paid invoice, no pagination and no cursor, which is why
      // it has none of the stop-early-and-report-success behaviour that
      // shape kept producing. Its limit is honest: a subscriber whose
      // latest paid invoice is zero but who paid earlier is not recovered
      // here, and recovering them needs the history read this deliberately
      // does not do.
      const cleared =
        (await store.hasClearedPayment(record.userId)) ||
        (await recordLatestPaidInvoice(stripe, store, id, record.userId));
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
      if (firstFailed === -1) firstFailed = index;
      if (firstNewFailure === -1 && id !== retryOf) firstNewFailure = index;
    }
  }

  /*
   * The cursor moves after the walk, not during it. A run that dies partway
   * re-reads the same slice tomorrow, which costs a repeat of idempotent
   * work; advancing per subscription would instead skip whatever was in
   * flight when it died, and a skipped subscription is one nothing revisits
   * until the next lap.
   *
   * Cleared at the end of the list rather than left pointing at the last id,
   * so the next run starts from the top. That is what makes this a lap: the
   * walk comes round to the beginning instead of stopping at the end.
   */
  /*
   * One retry, then past it (0019_reconcile_retry.sql).
   *
   * A run that saw a subscription throw parks the cursor before it, so the
   * next run starts there rather than leaving a transient failure until the
   * walk laps. Holding indefinitely would be worse and the codebase has
   * already been bitten by it: a row that fails every night would hold the
   * front of the queue and starve every one behind it, which is what
   * `resumeStrandedPayouts` stamps each attempt to avoid. So the hold lasts
   * one night. A run that was already retrying advances past the slice
   * whatever happened, reports the failure in `failed`, and picks it up
   * again on the next lap.
   */
  const holding = firstNewFailure !== -1;
  const resumeAt = holding
    ? // The id before the earliest new failure, so the next run re-reads it.
      // Falling back to the incoming cursor when it was first in the slice,
      // which leaves the walk exactly where it started.
      (ids[firstNewFailure - 1] ?? after)
    : reachedEnd
      ? undefined
      : ids.at(-1);
  await store.saveReconcileCursor(
    RECONCILE_WALK,
    resumeAt,
    // The id whose second chance is outstanding, so the next run can tell
    // "this one has had it" from "this one has not had a first".
    holding ? ids[firstNewFailure] : undefined,
  );

  return {
    checked: ids.length,
    corrected,
    failed,
    discovered: found.discovered,
    // What this run did not reach. A held cursor puts the failure and
    // everything after it back on the list rather than reporting it covered.
    remaining: holding
      ? all.length - (from + firstNewFailure)
      : all.length - (from + ids.length),
  };
}

/**
 * Record this subscription's most recent paid invoice, and say whether it
 * was a real charge.
 *
 * One Stripe request, `limit: 1`. No loop, no cursor, no page budget and
 * nothing persisted between runs, because every previous attempt to make
 * this delivery-independent walked history and every bound placed on that
 * walk turned "never finishes" into "stops early while reporting success".
 * A single request cannot do either.
 *
 * What it buys is the case that reading subscription status used to get
 * right: a subscriber who is genuinely paying and whose `invoice.paid`
 * never arrived. What it does not buy is a full audit. A subscriber whose
 * most recent paid invoice took nothing, a coupon month say, but who paid
 * before it, is not recovered here. That needs the history walk, and the
 * history walk needs a design rather than a few lines.
 */
async function recordLatestPaidInvoice(
  stripe: Stripe,
  store: BillingStore,
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  const page = await stripe.invoices.list({
    subscription: subscriptionId,
    status: 'paid',
    limit: 1,
  });

  const invoice = page.data[0];
  if (!invoice?.id) return false;

  const collected = stripeCollectedUsdCents(invoice);
  await store.recordPayment(
    invoice.id,
    userId,
    collected,
    invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
      : new Date().toISOString(),
    // The same aliases the webhook path records, so a payment recovered by
    // the reconcile is as reversible as one that arrived by delivery.
    idsOf(
      invoice.id,
      (invoice as unknown as { payment_intent?: unknown }).payment_intent,
      (invoice as unknown as { charge?: unknown }).charge,
    ),
  );

  return collected > 0;
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
): Promise<{ ids: string[]; discovered: number; truncated: boolean }> {
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
    // Stripe saying there is no more is the only clean end.
    if (!page.has_more) break;

    // Everything else is "there is more and I cannot reach it", which is
    // one condition with two shapes: a page with nothing to take a cursor
    // from, and a cursor identical to the one just used, which would
    // return this same page for ever.
    //
    // Both have to report it. Breaking out stops the spin; `truncated` is
    // what stops the stall being invisible. Returning a short list as
    // though it were the whole one means every night reads the same first
    // pages, stops at the same place, logs success, and every subscription
    // behind that page goes unreconciled with nothing anywhere saying so.
    const last = page.data[page.data.length - 1];
    if (!last || last.id === startingAfter) {
      return { ids: [...ids], discovered, truncated: true };
    }
    startingAfter = last.id;
  }

  return { ids: [...ids], discovered, truncated: false };
}
