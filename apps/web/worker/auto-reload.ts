import type Stripe from 'stripe';
import type { AutoReloadAccess, BillingStore } from './billing-store.ts';
import type { OnPurchaseCleared } from './billing-events.ts';
import {
  applyAutoReloadSucceeded,
  autoReloadFailureReason,
} from './billing-events.ts';
import {
  AUTO_RELOAD_ATTEMPT_METADATA_KEY,
  AUTO_RELOAD_PURPOSE,
  PRICE_LOOKUP_KEYS,
  PURPOSE_METADATA_KEY,
  TOPUP_CREDIT_USD_CENTS,
} from './stripe-client.ts';
import { monthKey } from './spend.ts';

/**
 * Opt-in auto-reload (docs/decisions.md, D166).
 *
 * With it on, the card the account chose is charged for the $10 top-up, off
 * session, when what the account can still spend drops below $1. Never more
 * often than the monthly cap the account set buys, never twice at once, and
 * never again after a decline: a failed charge turns it off, and the builder
 * offers the one-click top-up instead (L37's path, which stays).
 *
 * Asked after a run settles, never before one: a reload is for the next run,
 * and a run that waited on a card would be a run that waited on a bank.
 */

/** Below this much left to spend, a reload is due. */
export const AUTO_RELOAD_THRESHOLD_MICRO_USD = 1_000_000;

/** The cap an account gets until it picks one, and the bounds it may pick. */
export const AUTO_RELOAD_DEFAULT_CAP_USD_CENTS = 3000;
export const AUTO_RELOAD_MIN_CAP_USD_CENTS = 1000;
export const AUTO_RELOAD_MAX_CAP_USD_CENTS = 10000;

/** A cap auto-reload accepts: whole top-ups, from one to ten. */
export function validAutoReloadCap(cents: unknown): cents is number {
  return (
    typeof cents === 'number' &&
    Number.isInteger(cents) &&
    cents >= AUTO_RELOAD_MIN_CAP_USD_CENTS &&
    cents <= AUTO_RELOAD_MAX_CAP_USD_CENTS &&
    cents % 1000 === 0
  );
}

/**
 * How long a claimed charge may stay unanswered before the next check asks
 * Stripe again, and how long Stripe keeps the idempotency key that makes
 * asking again safe (24 hours, less an hour's margin).
 */
const STALE_PENDING_MS = 10 * 60_000;
/**
 * How long after a check last sent an attempt's request it may still be in
 * flight. Far past what one request can take: a Worker's own wall time and
 * the Stripe client's timeout and retry are each well under it.
 */
const DISPATCH_LEASE_MS = STALE_PENDING_MS;
const IDEMPOTENCY_WINDOW_MS = 23 * 3_600_000;
/**
 * How old an attempt with no charge to show must be before it is given up
 * and another claimed. An hour past the last moment anything asks Stripe
 * again with its key: a check that started asking just before then has long
 * finished, and its charge, if it made one, is on the customer's list.
 * Between the two, nothing is asked and nothing is given up.
 */
const ABANDON_AFTER_MS = IDEMPOTENCY_WINDOW_MS + 3_600_000;

/** Only the parts of Stripe a reload uses, so a test can stand in for them. */
export type AutoReloadStripe = {
  paymentIntents: Pick<Stripe['paymentIntents'], 'create' | 'list'>;
  prices: Pick<Stripe['prices'], 'list'>;
};

export interface AutoReloadDeps {
  store: BillingStore;
  stripe: AutoReloadStripe;
  /**
   * What the account can still spend, allowance and credit together, or
   * null while a run of its own is in flight.
   */
  spendableLeftMicroUsd: () => Promise<number | null>;
  onPurchaseCleared?: OnPurchaseCleared;
  /**
   * How this deployment admits accounts, so a withdrawn invite bars only an
   * account nothing else lets in. Defaults to invite-only with no admins.
   */
  access?: AutoReloadAccess;
  now?: number;
}

export type AutoReloadOutcome =
  /** A top-up was charged and credited. */
  | 'credited'
  /** Off, never set, or the account is suspended. */
  | 'off'
  /** Enough left, or a charge is already in flight. */
  | 'skipped'
  /** The month already holds as many top-ups as the cap buys. */
  | 'capped'
  /** The card was refused; auto-reload is now off. */
  | 'failed'
  /** Stripe has not answered yet; the next check or the webhook settles it. */
  | 'pending';

/**
 * Charge a top-up if one is due. Safe to call after every settlement, from
 * as many places at once as there are: the claim decides who charges.
 */
export async function maybeAutoReload(
  deps: AutoReloadDeps,
  userId: string,
): Promise<AutoReloadOutcome> {
  const { store } = deps;
  const now = deps.now ?? Date.now();
  const access = deps.access ?? { inviteGated: true };
  const settings = await store.autoReloadSettings(userId);
  if (!settings?.enabled || !settings.paymentMethodId) return 'off';
  if (await store.isSuspended(userId)) return 'off';
  // Asked to be deleted, or its invite withdrawn: nothing more is charged,
  // however the run that got here started (docs/decisions.md L32).
  if (await store.autoReloadBarred(userId, access)) return 'off';
  const customer = await store.findCustomerId(userId);
  if (!customer) return 'off';

  const pending = await store.pendingAutoReload(userId);
  if (pending) {
    const age = now - Date.parse(pending.createdAt);
    if (age < STALE_PENDING_MS) return 'skipped';
    const resumed = await resume(deps, userId, customer, {
      id: pending.id,
      age,
      paymentMethodId: pending.paymentMethodId,
      amount: pending.amountUsdCents,
      createdAt: pending.createdAt,
      period: monthKey(now),
      now,
    });
    // A charge known never to have been made frees the claim, and this
    // check goes on to the next one: nothing else may come along to.
    if (resumed !== 'abandoned') return resumed;
  }

  // Unknown while a run is in flight: its reservation counts at its worst
  // case until it settles, and when it settles, it asks this again.
  const left = await deps.spendableLeftMicroUsd();
  if (left === null || left >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
    return 'skipped';
  }
  const amount = await topupPriceUsdCents(deps.stripe);
  const attempt = await store.claimAutoReload(
    userId,
    monthKey(now),
    amount,
    new Date(now).toISOString(),
    access,
  );
  if (!attempt) return 'capped';
  // Asked again now the claim is held: a top-up bought or a plan started
  // while the price was read has already done what this charge was for.
  const still = await deps.spendableLeftMicroUsd();
  if (still === null || still >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
    await store.settleAutoReloadAttempt(attempt, 'failed', null, 'not_due');
    return 'skipped';
  }
  // The card the claim itself read, not the one read above: a setting saved
  // again in between is the setting this charge answers to.
  const claimed = await store.pendingAutoReload(userId);
  if (claimed?.id !== attempt) return 'skipped';
  // The referral barrier's earliest term, before the charge, as a Checkout
  // writes it before the page opens (purchase-barrier.ts).
  await store.recordPurchaseStarted(userId);
  // Still the setting the claim read, under its cap, the account not barred,
  // asked in one statement as the last thing before Stripe.
  if (
    !(await store.autoReloadAttemptCurrent(
      userId,
      attempt,
      monthKey(now),
      access,
      new Date(now).toISOString(),
    ))
  ) {
    await store.settleAutoReloadAttempt(attempt, 'failed', null, 'superseded');
    return 'skipped';
  }
  return await charge(deps, userId, customer, claimed.paymentMethodId, {
    id: attempt,
    amount: claimed.amountUsdCents,
  });
}

/**
 * What the top-up costs, from the Stripe price itself: nothing in this
 * Worker charges from `PRICE_USD_CENTS` (stripe-client.ts).
 */
async function topupPriceUsdCents(stripe: AutoReloadStripe): Promise<number> {
  const prices = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEYS.topup],
    active: true,
    limit: 1,
  });
  const amount = prices.data[0]?.unit_amount;
  if (!amount || amount <= 0) {
    throw new Error(
      `No active Stripe price is configured with lookup_key "${PRICE_LOOKUP_KEYS.topup}".`,
    );
  }
  return amount;
}

/** The idempotency key that makes asking Stripe again one charge, not two. */
export function autoReloadIdempotencyKey(attemptId: string): string {
  return `auto-reload:${attemptId}`;
}

async function charge(
  deps: AutoReloadDeps,
  userId: string,
  customer: string,
  paymentMethod: string,
  attempt: { id: string; amount: number },
): Promise<AutoReloadOutcome> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await deps.stripe.paymentIntents.create(
      {
        amount: attempt.amount,
        currency: 'usd',
        customer,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: 'Vibld top-up (auto-reload)',
        metadata: {
          vibld_user_id: userId,
          [PURPOSE_METADATA_KEY]: AUTO_RELOAD_PURPOSE,
          [AUTO_RELOAD_ATTEMPT_METADATA_KEY]: attempt.id,
          vibld_credit_usd_cents: String(TOPUP_CREDIT_USD_CENTS),
        },
      },
      { idempotencyKey: autoReloadIdempotencyKey(attempt.id) },
    );
  } catch (error) {
    return await refused(deps.store, userId, attempt.id, error);
  }
  return await settled(deps, userId, attempt.id, intent);
}

/** What a charge Stripe answered for means for the attempt. */
async function settled(
  deps: AutoReloadDeps,
  userId: string,
  attemptId: string,
  intent: Stripe.PaymentIntent,
): Promise<AutoReloadOutcome> {
  const { store } = deps;
  switch (intent.status) {
    case 'succeeded': {
      const outcome = await applyAutoReloadSucceeded(
        store,
        intent,
        deps.onPurchaseCleared,
      );
      return outcome === 'applied' ? 'credited' : 'pending';
    }
    case 'processing':
      // The webhook settles it when the bank answers.
      return 'pending';
    case 'requires_action':
    case 'requires_confirmation':
      await store.failAutoReloadAttempt(
        userId,
        attemptId,
        intent.id,
        'authentication_required',
        'authentication_required',
      );
      return 'failed';
    default:
      await store.failAutoReloadAttempt(
        userId,
        attemptId,
        intent.id,
        intent.last_payment_error?.code ?? intent.status,
        autoReloadFailureReason(intent.last_payment_error?.code),
      );
      return 'failed';
  }
}

/**
 * Stripe refused the request. A card error is an answer: the attempt failed
 * and auto-reload turns off. A card that is no longer there (removed in the
 * Billing Portal) is the same, said differently. Anything else (a network
 * failure, Stripe being down) is not an answer, so the attempt stays pending
 * and is asked about again with the same key.
 */
async function refused(
  store: BillingStore,
  userId: string,
  attemptId: string,
  error: unknown,
): Promise<AutoReloadOutcome> {
  const e = error as {
    type?: string;
    code?: string;
    decline_code?: string;
    payment_intent?: { id?: string };
  };
  if (e?.type === 'StripeCardError') {
    await store.failAutoReloadAttempt(
      userId,
      attemptId,
      e.payment_intent?.id ?? null,
      e.decline_code ?? e.code ?? 'card_error',
      autoReloadFailureReason(e.code),
    );
    return 'failed';
  }
  if (
    e?.type === 'StripeInvalidRequestError' &&
    e.code === 'resource_missing'
  ) {
    await store.failAutoReloadAttempt(
      userId,
      attemptId,
      null,
      e.code,
      'no_card',
    );
    return 'failed';
  }
  console.error('auto-reload charge unanswered', attemptId, error);
  return 'pending';
}

/** Pages of the customer's charges read before giving up on knowing. */
const MAX_LIST_PAGES = 5;

/**
 * The PaymentIntent made for an attempt, null when Stripe holds none, or
 * 'unknown' when that cannot be said. Read from the customer's list, which
 * Stripe answers from what it has written, and not from Search, whose
 * index can lag a charge by up to an hour
 * (docs.stripe.com/api/payment_intents/search): a charge Search has not
 * caught up with would read as never made.
 */
async function chargeMadeFor(
  stripe: AutoReloadStripe,
  customer: string,
  attemptId: string,
  claimedAt: string,
): Promise<Stripe.PaymentIntent | null | 'unknown'> {
  // A margin before the claim for the two clocks, Stripe's and the Worker's.
  const since = Math.floor(Date.parse(claimedAt) / 1000) - 3600;
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const found = await stripe.paymentIntents.list({
      customer,
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const made = found.data.find(
      (intent) =>
        intent.metadata?.[AUTO_RELOAD_ATTEMPT_METADATA_KEY] === attemptId,
    );
    if (made) return made;
    if (!found.has_more || found.data.length === 0) return null;
    startingAfter = found.data[found.data.length - 1]!.id;
  }
  return 'unknown';
}

/**
 * A claimed charge nobody heard back about: the Worker stopped between the
 * claim and Stripe's answer, or Stripe did not answer.
 *
 * The charge is looked for first, by the attempt it carries: one Stripe
 * made is settled as it stands. None found, inside Stripe's idempotency
 * window, the same request with the same key is asked again, but only if a
 * top-up is still due and the attempt is still current: one bought while
 * this waited ends the attempt as `not_due`, a setting saved since (a cap
 * lowered, a card changed) as `superseded`, though neither while another
 * check may still be sending the same request (`DISPATCH_LEASE_MS`). Past
 * the window, the key no longer protects anything, so an attempt that
 * never became a charge is given up (once `ABANDON_AFTER_MS` has also
 * passed) without turning auto-reload off, which leaves the caller free to
 * claim the next.
 */
async function resume(
  deps: AutoReloadDeps,
  userId: string,
  customer: string,
  pending: {
    id: string;
    age: number;
    paymentMethodId: string;
    amount: number;
    createdAt: string;
    /** The month a charge made now would count in. */
    period: string;
    now: number;
  },
): Promise<AutoReloadOutcome | 'abandoned'> {
  // Whatever the age, a charge Stripe already made is the answer. Not known
  // whether there is one, the attempt stays as it is: nothing may be decided
  // about a charge that may exist.
  const intent = await chargeMadeFor(
    deps.stripe,
    customer,
    pending.id,
    pending.createdAt,
  );
  if (intent === 'unknown') return 'pending';
  if (intent) return await settled(deps, userId, pending.id, intent);
  if (pending.age < IDEMPOTENCY_WINDOW_MS) {
    // No charge yet, so asking again makes one: asked first whether it is
    // still due, since a top-up bought while this waited has already done
    // what it was for.
    const left = await deps.spendableLeftMicroUsd();
    if (left === null) return 'skipped';
    // Given up only once no other check can still be sending this request
    // (`DISPATCH_LEASE_MS`): until then, a charge under this key may yet be
    // made, and the attempt stays pending to be found next time.
    const leaseStart = new Date(pending.now - DISPATCH_LEASE_MS).toISOString();
    if (left >= AUTO_RELOAD_THRESHOLD_MICRO_USD) {
      await deps.store.giveUpAutoReloadAttempt(
        pending.id,
        'not_due',
        leaseStart,
      );
      return 'skipped';
    }
    // Written again first: a Worker that stopped right after the claim never
    // reached the first write (`recordPurchaseStarted` keeps the earliest).
    await deps.store.recordPurchaseStarted(userId);
    // And whether it may still be charged at all, asked in one statement as
    // the last thing before Stripe: a setting saved since the claim (a cap
    // lowered, a card changed, turned off and on) is what decides now, so
    // this attempt gives way and the check goes on to claim afresh.
    if (
      !(await deps.store.autoReloadAttemptCurrent(
        userId,
        pending.id,
        pending.period,
        deps.access,
        new Date(pending.now).toISOString(),
      ))
    ) {
      return (await deps.store.giveUpAutoReloadAttempt(
        pending.id,
        'superseded',
        leaseStart,
      ))
        ? 'abandoned'
        : 'pending';
    }
    // The same card and amount as the first request, which the same key
    // requires. A charge made after the list was read is answered by the
    // key with that charge, not made a second time.
    return await charge(deps, userId, customer, pending.paymentMethodId, {
      id: pending.id,
      amount: pending.amount,
    });
  }
  if (pending.age < ABANDON_AFTER_MS) return 'pending';
  await deps.store.settleAutoReloadAttempt(
    pending.id,
    'failed',
    null,
    'abandoned',
  );
  return 'abandoned';
}

/**
 * The card auto-reload will charge: the customer's default where that is a
 * card, else the newest card saved to the customer. Undefined when there is
 * none to charge without the person there, which is what a top-up bought
 * through Checkout leaves: it saves no card.
 */
export async function resolveReusableCard(
  stripe: {
    customers: Pick<Stripe['customers'], 'retrieve' | 'listPaymentMethods'>;
  },
  customer: string,
): Promise<
  { paymentMethodId: string; brand: string; last4: string } | undefined
> {
  const record = await stripe.customers.retrieve(customer, {
    expand: ['invoice_settings.default_payment_method'],
  });
  if (!('deleted' in record && record.deleted)) {
    const preferred = (record as Stripe.Customer).invoice_settings
      ?.default_payment_method;
    if (preferred && typeof preferred !== 'string' && preferred.card) {
      return {
        paymentMethodId: preferred.id,
        brand: preferred.card.brand,
        last4: preferred.card.last4,
      };
    }
  }
  const cards = await stripe.customers.listPaymentMethods(customer, {
    type: 'card',
    limit: 1,
  });
  const card = cards.data[0];
  if (!card?.card) return undefined;
  return {
    paymentMethodId: card.id,
    brand: card.card.brand,
    last4: card.card.last4,
  };
}
