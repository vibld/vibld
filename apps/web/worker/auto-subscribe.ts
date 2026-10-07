import type Stripe from 'stripe';
import { BILLABLE_STATUSES } from './billing-store.ts';
import type { AutoReloadAccess, BillingStore } from './billing-store.ts';
import { subscriptionRecordFrom } from './billing-events.ts';
import {
  AUTO_SUBSCRIBE_ATTEMPT_METADATA_KEY,
  AUTO_SUBSCRIBE_PURPOSE,
  PRICE_LOOKUP_KEYS,
  PURPOSE_METADATA_KEY,
} from './stripe-client.ts';
import { AUTO_RELOAD_THRESHOLD_MICRO_USD } from './auto-reload.ts';

/**
 * Opt-in auto-subscribe (docs/decisions.md, D167).
 *
 * With it on, a Free account that runs out of what it can spend is moved to
 * the Build plan, monthly, on the card it chose: the same moment auto-reload
 * (D166) would charge a top-up, and in its place. Once: having started the
 * plan, the setting turns itself off, and a plan cancelled later is not
 * started again. A decline turns it off too, and the builder says why.
 *
 * The plan starts with Stripe's `error_if_incomplete`, so a card that is
 * refused, or a bank that wants the person there to confirm, leaves no
 * subscription behind: the request fails, and nothing is billed.
 */

/** How long an attempt may stay unanswered before the next check asks again. */
const STALE_PENDING_MS = 10 * 60_000;
/** How long after a check sent an attempt's request it may still be in flight. */
const DISPATCH_LEASE_MS = STALE_PENDING_MS;
/**
 * How long after its dispatch an attempt's request may still be in flight,
 * for account deletion to wait out (account-deletion.ts).
 */
export const AUTO_SUBSCRIBE_DISPATCH_LEASE_MS = DISPATCH_LEASE_MS;
/** How long Stripe keeps the idempotency key, less an hour's margin. */
const IDEMPOTENCY_WINDOW_MS = 23 * 3_600_000;
/** An hour past the last time anything asks again with the key. */
const ABANDON_AFTER_MS = IDEMPOTENCY_WINDOW_MS + 3_600_000;
/** At most this many pages of the customer's subscriptions are read. */
const MAX_LIST_PAGES = 5;

/** Only the parts of Stripe auto-subscribe uses, so a test can stand in. */
export type AutoSubscribeStripe = {
  subscriptions: Pick<Stripe['subscriptions'], 'create' | 'list'>;
  prices: Pick<Stripe['prices'], 'list'>;
  paymentIntents: Pick<Stripe['paymentIntents'], 'retrieve'>;
  checkout: {
    sessions: Pick<Stripe['checkout']['sessions'], 'list' | 'expire'>;
  };
};

export interface AutoSubscribeDeps {
  store: BillingStore;
  stripe: AutoSubscribeStripe;
  /**
   * What the account can still spend, allowance and credit together, or
   * null while a run of its own is in flight.
   */
  spendableLeftMicroUsd: () => Promise<number | null>;
  /** Whether the account is on Free now, gifted plans counted. */
  onFree: () => Promise<boolean>;
  access?: AutoReloadAccess;
  now?: number;
  /**
   * The time when the dispatch is recorded, read then rather than at the
   * claim, since the Stripe reads between them can take a while. Defaults
   * to `now` when that is given, else the real time.
   */
  clock?: () => number;
}

export type AutoSubscribeOutcome =
  /** The Build plan was started. */
  | 'subscribed'
  /** Off, never set, already on a plan, or barred. */
  | 'off'
  /** Enough left, or an attempt is already in flight. */
  | 'skipped'
  /** The card was refused; auto-subscribe is now off. */
  | 'failed'
  /** Stripe has not answered yet; the next check or the webhook settles it. */
  | 'pending';

/** The idempotency key that makes asking Stripe again one plan, not two. */
export function autoSubscribeIdempotencyKey(attemptId: string): string {
  return `auto-subscribe:${attemptId}`;
}

/**
 * Start the Build plan if it is due. Safe to call after every settlement,
 * from as many places at once as there are: the claim decides who asks.
 */
export async function maybeAutoSubscribe(
  deps: AutoSubscribeDeps,
  userId: string,
): Promise<AutoSubscribeOutcome> {
  const { store } = deps;
  const now = deps.now ?? Date.now();
  const access = deps.access ?? { inviteGated: true };

  const settings = await store.autoSubscribeSettings(userId);
  if (!settings) return 'off';
  const customer = await store.findCustomerId(userId);
  if (!customer) return 'off';

  if (settings.attempt) {
    const age = now - Date.parse(settings.attempt.claimedAt);
    if (age < STALE_PENDING_MS) return 'skipped';
    const resumed = await resume(deps, userId, customer, {
      ...settings.attempt,
      age,
      now,
    });
    if (resumed !== 'abandoned') return resumed;
  }
  if (!settings.enabled) return 'off';
  if (!(await deps.onFree())) return 'off';

  const left = await deps.spendableLeftMicroUsd();
  if (left === null || left >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
    return 'skipped';
  }
  const iso = new Date(now).toISOString();
  const claim = await store.claimAutoSubscribe(userId, iso, access);
  if (!claim) return 'off';
  // Asked again now the claim is held: a top-up bought or a plan started
  // meanwhile has already done what this was for.
  const still = await deps.spendableLeftMicroUsd();
  if (still === null || still >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
    await store.giveUpAutoSubscribe(userId, claim.attemptId, iso);
    return 'skipped';
  }
  const outcome = await dispatch(
    deps,
    userId,
    customer,
    claim.attemptId,
    iso,
    access,
  );
  return outcome === 'abandoned' ? 'off' : outcome;
}

/**
 * The last checks and the request. Whether the attempt may still be sent at
 * all is asked last, atomically with writing the referral barrier's
 * earliest term (purchase-barrier.ts), so an attempt that is not sent
 * leaves no barrier behind. A check that
 * says no gives the attempt up once no other check can be sending it
 * (`abandoned`, which frees the caller to claim afresh).
 */
async function dispatch(
  deps: AutoSubscribeDeps,
  userId: string,
  customer: string,
  attemptId: string,
  nowIso: string,
  access: AutoReloadAccess,
): Promise<AutoSubscribeOutcome | 'abandoned'> {
  const { store } = deps;
  // Read first, so the final check below stays the last thing awaited
  // before the request: a slow read cannot outlast an opt-out.
  const price = await buildMonthlyPriceId(deps.stripe);
  // A Checkout the person opened and has not finished would, finished
  // after this, buy a second plan or a top-up beside this one, so it is
  // expired first, before the subscriptions and the balance are read
  // below: a plan that completes before it can be expired is then found
  // there. One opened after the claim expires itself (createCheckoutSession).
  if (!(await expireOpenCheckouts(deps.stripe, customer))) {
    return 'pending';
  }
  // A top-up paid just before that list, whose credit the webhook has not
  // written yet, is in neither the balance nor the subscriptions: it is
  // waited for, so the read below sees its credit.
  if (
    !(await topupsCredited(
      deps.stripe,
      store,
      userId,
      customer,
      Date.parse(nowIso),
    ))
  ) {
    return 'pending';
  }
  // Stripe itself, not D1, is asked whether the customer already has a plan
  // it may bill: one bought through Checkout whose webhook has not landed
  // yet is on Free in D1 still. Asked after the open Checkouts are expired,
  // so none can complete after it, and before the final check, so an
  // attempt given up here was never sent.
  const existing = await billableSubscriptionOf(deps.stripe, customer);
  if (existing === 'unknown') return 'pending';
  if (existing) {
    const record = subscriptionRecordFrom(existing, userId);
    if (record) await store.upsertSubscription(record);
    const leaseStart = new Date(
      Date.parse(nowIso) - DISPATCH_LEASE_MS,
    ).toISOString();
    return (await store.giveUpAutoSubscribe(userId, attemptId, leaseStart))
      ? 'abandoned'
      : 'pending';
  }
  // Asked again after those Stripe reads: a top-up credited while they
  // were awaited has already done what this was for.
  const left = await deps.spendableLeftMicroUsd();
  if (left === null || left >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
    const leaseStart = new Date(
      Date.parse(nowIso) - DISPATCH_LEASE_MS,
    ).toISOString();
    return (await store.giveUpAutoSubscribe(userId, attemptId, leaseStart))
      ? 'skipped'
      : 'pending';
  }
  // Stamped with the time it is sent, not the claim's: the lease that
  // keeps another check from giving the attempt up runs from here.
  const sentAt = deps.clock?.() ?? deps.now ?? Date.now();
  // Records the referral barrier too, only when it says yes.
  const current = await store.autoSubscribeAttemptCurrent(
    userId,
    attemptId,
    new Date(sentAt).toISOString(),
    access,
  );
  if (!current) {
    const leaseStart = new Date(sentAt - DISPATCH_LEASE_MS).toISOString();
    return (await store.giveUpAutoSubscribe(userId, attemptId, leaseStart))
      ? 'abandoned'
      : 'pending';
  }
  let subscription: Stripe.Subscription;
  try {
    subscription = await deps.stripe.subscriptions.create(
      {
        customer,
        items: [{ price }],
        default_payment_method: current.paymentMethodId,
        off_session: true,
        payment_behavior: 'error_if_incomplete',
        metadata: {
          vibld_user_id: userId,
          [PURPOSE_METADATA_KEY]: AUTO_SUBSCRIBE_PURPOSE,
          [AUTO_SUBSCRIBE_ATTEMPT_METADATA_KEY]: attemptId,
        },
      },
      { idempotencyKey: autoSubscribeIdempotencyKey(attemptId) },
    );
  } catch (error) {
    return await refused(store, userId, attemptId, error);
  }
  return await started(store, userId, subscription);
}

/**
 * A subscription Stripe started for the attempt: the one thing auto-subscribe
 * does is done, whatever the subscription's status is now. One found on a
 * resume may be canceled already, and still counts.
 */
async function started(
  store: BillingStore,
  userId: string,
  subscription: Stripe.Subscription,
): Promise<AutoSubscribeOutcome> {
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    // Expected only on a resume, for a plan ended since: a create with
    // `error_if_incomplete` answers a refusal with an error instead.
    console.warn(
      'auto-subscribe found its subscription not active',
      subscription.id,
      subscription.status,
    );
  }
  // Mirrored now rather than on the webhook, so the next run is held to
  // the plan's allowance at once. The webhook writes the same row again.
  const record = subscriptionRecordFrom(subscription, userId);
  if (record) await store.upsertSubscription(record);
  await store.settleAutoSubscribed(userId, subscription.id);
  return 'subscribed';
}

/**
 * Stripe refused the request. A card error is an answer: the attempt ends
 * and auto-subscribe turns off. A card that is no longer there is the same,
 * said differently. Anything else (a network failure, Stripe being down) is
 * not an answer, so the attempt stays to be asked about again.
 */
async function refused(
  store: BillingStore,
  userId: string,
  attemptId: string,
  error: unknown,
): Promise<AutoSubscribeOutcome> {
  const e = error as { type?: string; code?: string };
  if (e?.type === 'StripeCardError') {
    await store.failAutoSubscribe(
      userId,
      attemptId,
      e.code === 'authentication_required'
        ? 'authentication_required'
        : 'declined',
    );
    return 'failed';
  }
  if (
    e?.type === 'StripeInvalidRequestError' &&
    e.code === 'resource_missing'
  ) {
    await store.failAutoSubscribe(userId, attemptId, 'no_card');
    return 'failed';
  }
  console.error('auto-subscribe request unanswered', attemptId, error);
  return 'pending';
}

/**
 * An attempt nobody heard back about. The subscription is looked for first,
 * by the attempt it carries: one Stripe started settles it. None found,
 * inside Stripe's idempotency window, the same request is sent again, but
 * only if the plan is still due and the attempt still current. Past the
 * window, an attempt that never started a plan is given up, leaving the
 * setting on, so the caller may claim the next.
 */
async function resume(
  deps: AutoSubscribeDeps,
  userId: string,
  customer: string,
  attempt: { id: string; claimedAt: string; age: number; now: number },
): Promise<AutoSubscribeOutcome | 'abandoned'> {
  const { store } = deps;
  const made = await subscriptionStartedFor(
    deps.stripe,
    customer,
    attempt.id,
    attempt.claimedAt,
  );
  if (made === 'unknown') return 'pending';
  if (made) return await started(store, userId, made);
  const nowIso = new Date(attempt.now).toISOString();
  const leaseStart = new Date(attempt.now - DISPATCH_LEASE_MS).toISOString();
  if (attempt.age < IDEMPOTENCY_WINDOW_MS) {
    const left = await deps.spendableLeftMicroUsd();
    if (left === null) return 'skipped';
    if (left >= AUTO_RELOAD_THRESHOLD_MICRO_USD || !(await deps.onFree())) {
      await store.giveUpAutoSubscribe(userId, attempt.id, leaseStart);
      return 'skipped';
    }
    return await dispatch(
      deps,
      userId,
      customer,
      attempt.id,
      nowIso,
      deps.access ?? { inviteGated: true },
    );
  }
  if (attempt.age < ABANDON_AFTER_MS) return 'pending';
  await store.giveUpAutoSubscribe(userId, attempt.id, leaseStart);
  return 'abandoned';
}

/**
 * The subscription Stripe started for this attempt, null when it started
 * none, or 'unknown' when that cannot be said. Read from the customer's
 * list, every status included, since a plan cancelled since was still
 * started.
 */
async function subscriptionStartedFor(
  stripe: AutoSubscribeStripe,
  customer: string,
  attemptId: string,
  claimedAt: string,
): Promise<Stripe.Subscription | null | 'unknown'> {
  const since = Math.floor(Date.parse(claimedAt) / 1000) - 3600;
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const found = await stripe.subscriptions.list({
      customer,
      status: 'all',
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const made = found.data.find(
      (subscription) =>
        subscription.metadata?.[AUTO_SUBSCRIBE_ATTEMPT_METADATA_KEY] ===
        attemptId,
    );
    if (made) return made;
    if (!found.has_more || found.data.length === 0) return null;
    startingAfter = found.data[found.data.length - 1]!.id;
  }
  return 'unknown';
}

/**
 * A subscription of the customer's that Stripe may still bill
 * (`BILLABLE_STATUSES`), null when there is none, or 'unknown' when the list
 * is longer than one page reads.
 */
async function billableSubscriptionOf(
  stripe: AutoSubscribeStripe,
  customer: string,
): Promise<Stripe.Subscription | null | 'unknown'> {
  const found = await stripe.subscriptions.list({
    customer,
    status: 'all',
    limit: 100,
  });
  const live = found.data.find((subscription) =>
    BILLABLE_STATUSES.includes(subscription.status),
  );
  if (live) return live;
  return found.has_more ? 'unknown' : null;
}

/**
 * Expire the customer's open plan and top-up Checkout sessions (a card
 * setup buys nothing and is left). False when one
 * could not be expired (it may have just been paid) or there are more than
 * one page reads.
 */
async function expireOpenCheckouts(
  stripe: AutoSubscribeStripe,
  customer: string,
): Promise<boolean> {
  const open = await stripe.checkout.sessions.list({
    customer,
    status: 'open',
    limit: 100,
  });
  if (open.has_more) return false;
  for (const session of open.data) {
    if (session.mode === 'setup') continue;
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch (error) {
      console.error('auto-subscribe could not expire a Checkout', error);
      return false;
    }
  }
  return true;
}

/**
 * Whether every top-up Checkout the customer has paid lately is credited
 * in D1, and none is still settling. Lately is `TOPUP_LOOKBACK_MS`. False
 * too when that cannot be said (more than one page).
 */
async function topupsCredited(
  stripe: AutoSubscribeStripe,
  store: BillingStore,
  userId: string,
  customer: string,
  now: number,
): Promise<boolean> {
  const done = await stripe.checkout.sessions.list({
    customer,
    status: 'complete',
    created: { gte: Math.floor((now - TOPUP_LOOKBACK_MS) / 1000) },
    limit: 100,
    expand: ['data.payment_intent'],
  });
  // One the webhook has marked unsettled is waited for however old it is,
  // a bank debit can outlast that lookback, until it is credited or its
  // payment has failed.
  for (const intent of await store.uncreditedUnsettledTopups(userId)) {
    if (!intent) return false;
    const payment = await stripe.paymentIntents.retrieve(intent);
    if (
      payment.status !== 'requires_payment_method' &&
      payment.status !== 'canceled'
    ) {
      return false;
    }
  }
  if (done.has_more) return false;
  const topups = done.data.filter((session) => session.mode === 'payment');
  // One paid by a delayed method (a bank debit) completes unpaid and is
  // credited only when it settles: while its payment is still processing,
  // it is waited for too. One whose payment failed is not.
  if (
    topups.some(
      (session) =>
        session.payment_status === 'unpaid' && stillSettling(session),
    )
  ) {
    return false;
  }
  const paid = topups
    .filter(
      (session) =>
        session.payment_status === 'paid' ||
        session.payment_status === 'no_payment_required',
    )
    .map((session) => session.id);
  return await store.topupsRecorded(paid);
}

/** An unpaid session whose payment may yet arrive; unknown counts as so. */
function stillSettling(session: Stripe.Checkout.Session): boolean {
  const intent = session.payment_intent;
  if (!intent || typeof intent === 'string') return true;
  return intent.status === 'processing' || intent.status === 'requires_action';
}

/**
 * How far back completed top-ups are read: a session lives up to a day, a
 * bank debit can take most of a week to settle after it completes, and its
 * webhook can lag either.
 */
const TOPUP_LOOKBACK_MS = 8 * 24 * 3_600_000;

/** The monthly Build price, from Stripe itself, as Checkout reads it. */
async function buildMonthlyPriceId(
  stripe: AutoSubscribeStripe,
): Promise<string> {
  const prices = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEYS.buildMonthly],
    active: true,
    limit: 1,
  });
  const price = prices.data[0];
  if (!price) {
    throw new Error(
      `No active Stripe price is configured with lookup_key "${PRICE_LOOKUP_KEYS.buildMonthly}".`,
    );
  }
  return price.id;
}
