/**
 * The Stripe entitlement mirror (docs/decisions.md L12-L14), backed by D1.
 *
 * A thin wrapper over the three tables `migrations/0002_billing.sql`
 * declares -- billing-events.ts and billing-handlers.ts are the only
 * callers, and neither one writes SQL of its own. Kept free of anything
 * Stripe-shaped (no `Stripe.Subscription`, no webhook parsing) so it is
 * testable the same way `generation-store.ts` is: a real D1-backed schema
 * (`SqliteD1Database`), no network, no Stripe SDK.
 */
import {
  CLEARED_PAYMENT_SQL,
  PURCHASE_BARRIER_SQL,
} from './purchase-barrier.ts';

export interface SubscriptionRecord {
  stripeSubscriptionId: string;
  userId: string;
  stripeCustomerId: string;
  tier: 'build' | 'ship';
  status: string;
  priceId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface CustomerRow {
  user_id: string;
  stripe_customer_id: string;
}

/**
 * How far the replay of Stripe's event log has got.
 *
 * `doneBelow` is the floor: every event Stripe created before that second
 * has been replayed. `sweepTop` and `sweepAfterId` describe a descent in
 * progress, and are both null when none is. See
 * `migrations/0009_event_replay.sql` for why the floor and the top of the
 * descent are separate numbers.
 */
/** One Stripe event whose owner this deployment could not work out yet. */
export interface UnattributedEvent {
  stripeEventId: string;
  type: string;
  created: number;
  /** The event as Stripe sent it, so the retry does not depend on Stripe still having it. */
  payload: string;
  firstSeenAt: string;
  attempts: number;
}

export interface EventReplayCursor {
  doneBelow: number;
  sweepTop: number | null;
  sweepAfterId: string | null;
}

interface EventReplayRow {
  done_below: number;
  sweep_top: number | null;
  sweep_after_id: string | null;
}

export interface AdminCreditRecord {
  id: string;
  userId: string;
  creditUsdCents: number;
  grantedByEmail: string;
  note: string | null;
  createdAt: string;
}

interface AdminCreditRow {
  id: string;
  user_id: string;
  credit_usd_cents: number;
  granted_by_email: string;
  note: string | null;
  created_at: string;
}

function toAdminCreditRecord(row: AdminCreditRow): AdminCreditRecord {
  return {
    id: row.id,
    userId: row.user_id,
    creditUsdCents: row.credit_usd_cents,
    grantedByEmail: row.granted_by_email,
    note: row.note,
    createdAt: row.created_at,
  };
}

interface SubscriptionRow {
  stripe_subscription_id: string;
  user_id: string;
  stripe_customer_id: string;
  tier: string;
  status: string;
  price_id: string;
  current_period_end: string | null;
  cancel_at_period_end: number;
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    stripeSubscriptionId: row.stripe_subscription_id,
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    // 'build' | 'ship' is a closed set this table only ever holds because
    // upsertSubscription is the only writer and it only ever writes one of
    // the two -- the same trust `generation-store.ts` places in its own
    // `state` column.
    tier: row.tier as SubscriptionRecord['tier'],
    status: row.status,
    priceId: row.price_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end !== 0,
  };
}

export class BillingStore {
  #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Record which Stripe customer belongs to which Clerk user.
   *
   * `ON CONFLICT DO NOTHING`: once a user has a customer, that mapping is
   * permanent -- a webhook redelivered out of order, or a second Checkout
   * Session for someone who already has one, must never reassign it.
   */
  async linkCustomer(userId: string, stripeCustomerId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO billing_customers (user_id, stripe_customer_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, stripeCustomerId, now)
      .run();
  }

  async findCustomerId(userId: string): Promise<string | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT stripe_customer_id FROM billing_customers WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<CustomerRow>();
    return row?.stripe_customer_id;
  }

  async findUserIdForCustomer(
    stripeCustomerId: string,
  ): Promise<string | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT user_id FROM billing_customers WHERE stripe_customer_id = ?1`,
      )
      .bind(stripeCustomerId)
      .first<CustomerRow>();
    return row?.user_id;
  }

  async upsertSubscription(record: SubscriptionRecord): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO billing_subscriptions
           (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
            price_id, current_period_end, cancel_at_period_end, created_at,
            updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(stripe_subscription_id) DO UPDATE SET
           user_id = excluded.user_id,
           stripe_customer_id = excluded.stripe_customer_id,
           tier = excluded.tier,
           status = excluded.status,
           price_id = excluded.price_id,
           current_period_end = excluded.current_period_end,
           cancel_at_period_end = excluded.cancel_at_period_end,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.stripeSubscriptionId,
        record.userId,
        record.stripeCustomerId,
        record.tier,
        record.status,
        record.priceId,
        record.currentPeriodEnd,
        record.cancelAtPeriodEnd ? 1 : 0,
        now,
      )
      .run();
  }

  async getSubscription(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT stripe_subscription_id, user_id, stripe_customer_id, tier, status,
                price_id, current_period_end, cancel_at_period_end
         FROM billing_subscriptions WHERE stripe_subscription_id = ?1`,
      )
      .bind(stripeSubscriptionId)
      .first<SubscriptionRow>();
    return row ? toSubscriptionRecord(row) : undefined;
  }

  /** Every mirrored subscription id -- what the nightly reconcile re-checks against Stripe. */
  async listSubscriptionIds(): Promise<string[]> {
    const result = await this.#db
      .prepare(`SELECT stripe_subscription_id FROM billing_subscriptions`)
      .all<{ stripe_subscription_id: string }>();
    return result.results.map((row) => row.stripe_subscription_id);
  }

  /**
   * The subscription `/api/plan`'s budget gate (docs/decisions.md L35-L39)
   * should honour for this user, if any. A user has at most one in practice
   * -- Checkout always reuses their existing Stripe customer -- but this
   * still orders by `updated_at` and takes the most recent, defensively,
   * rather than assume the invariant holds.
   */
  async findActiveSubscription(
    userId: string,
  ): Promise<SubscriptionRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT stripe_subscription_id, user_id, stripe_customer_id, tier, status,
                price_id, current_period_end, cancel_at_period_end
         FROM billing_subscriptions
         WHERE user_id = ?1 AND status IN ('active', 'trialing')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId)
      .first<SubscriptionRow>();
    return row ? toSubscriptionRecord(row) : undefined;
  }

  /**
   * This user's spendable top-up credit (L37), summed rather than tracked as
   * a running balance -- decrementing one durably as it is drawn down would
   * need its own write path with its own race to get right, and the ledger
   * that actually spends it (`entitlement.ts`'s `"<userId>:topup"` bucket in
   * `budget.ts`) already *is* a correct running balance: its own period-keyed
   * spend total, subtracted from whatever this returns, is what "remaining"
   * means. Restricted to the last 12 months, matching L36's top-up expiry --
   * an approximation of it, not an exact one: this excludes an old top-up
   * from the total outright rather than tracking each purchase's own expiry
   * against what was actually drawn from it first.
   */
  async totalTopupCreditMicroUsd(userId: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COALESCE(SUM(credit_usd_cents), 0) AS total
         FROM billing_topups
         WHERE user_id = ?1 AND created_at > datetime('now', '-12 months')`,
      )
      .bind(userId)
      .first<{ total: number }>();
    // 1 cent = 10,000 micro-USD ($1 = 1,000,000 micro-USD).
    return (row?.total ?? 0) * 10_000;
  }

  /**
   * A platform admin's manual grant (docs/decisions.md L4) -- support,
   * goodwill, or testing credit with no Stripe Checkout Session behind it.
   * `id` is the caller's to choose (a fresh UUID in practice) rather than
   * autoincrement, so a retried request can be made idempotent by the
   * caller if that ever matters -- the same reasoning `recordTopup`'s own
   * `ON CONFLICT ... DO NOTHING` serves for a real Stripe session id.
   */
  /**
   * Returns whether this call is the one that wrote the row.
   *
   * The insert has always been a no-op on a repeated id, which is what makes
   * every caller safe to retry. What it did not do was say so, and a caller
   * that assumed it had written reported money moving on a delivery that
   * moved none: a redelivered refund logged the same five dollars recovered
   * twice while the balance changed once. `meta.changes` already knows, and
   * costs nothing to return.
   */
  async grantAdminCredit(
    id: string,
    userId: string,
    creditUsdCents: number,
    grantedByEmail: string,
    note: string | null,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const result = await this.#db
      .prepare(
        `INSERT INTO billing_admin_credits
           (id, user_id, credit_usd_cents, granted_by_email, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, userId, creditUsdCents, grantedByEmail, note, now)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Record that this deployment scheduled a subscription to end.
   *
   * Provenance, and it cannot be inferred. `cancel_at_period_end` is the same
   * boolean whether a revoke here set it or the subscriber set it in the
   * Billing Portal, so reading the mirror could not establish who did it, and
   * restoring access therefore cleared a paying customer's own cancellation
   * and let Stripe charge them again.
   *
   * A row means this deployment scheduled it and may undo it. No row means
   * hands off, whatever the mirror says.
   */
  async recordScheduledCancellation(
    stripeSubscriptionId: string,
    userId: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_scheduled_cancellations
           (stripe_subscription_id, user_id, scheduled_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(stripe_subscription_id) DO NOTHING`,
      )
      .bind(stripeSubscriptionId, userId, new Date().toISOString())
      .run();
  }

  /** Whether this deployment is the one that scheduled this cancellation. */
  async scheduledCancellation(stripeSubscriptionId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT 1 AS present FROM billing_scheduled_cancellations
          WHERE stripe_subscription_id = ?1`,
      )
      .bind(stripeSubscriptionId)
      .first<{ present: number }>();
    return row !== null && row !== undefined;
  }

  /**
   * Forget a scheduled cancellation, because it has been undone.
   *
   * Cleared on restore rather than left behind: a stale row would let a
   * later restore undo a cancellation the subscriber made afterwards, which
   * is the same harm one step removed.
   */
  async clearScheduledCancellation(
    stripeSubscriptionId: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM billing_scheduled_cancellations
          WHERE stripe_subscription_id = ?1`,
      )
      .bind(stripeSubscriptionId)
      .run();
  }

  /**
   * Deduct up to `maxCents` of granted credit, and say how much was taken.
   *
   * One statement, because two cannot settle this. Reading the balance here
   * and inserting the bounded deduction there is a check followed by an act:
   * two refunds of two different referrals sharing one referrer, arriving
   * together, both read the same remaining five dollars, both pass the
   * floor, and both write, leaving the granted total at minus five. The
   * no-debt rule this exists to keep is exactly what that breaks, and it
   * takes the difference out of credit somebody paid for.
   *
   * So the floor is computed inside the INSERT's own SELECT. D1 admits one
   * writer at a time, so the second statement runs against the first one's
   * committed row and sees the smaller balance.
   *
   * The `WHERE` keeps a zero-value row out of the ledger: there is no such
   * thing as deducting nothing, and a row saying so would have to be
   * explained to anybody reading a credit history.
   *
   * The amount is read back rather than computed here for the same reason it
   * is written there: what was taken is whatever the database decided, and
   * this must not be a second opinion about it.
   */
  async deductAdminCredit(
    id: string,
    userId: string,
    maxCents: number,
    grantedByEmail: string,
    note: string | null,
  ): Promise<number> {
    if (maxCents <= 0) return 0;
    const now = new Date().toISOString();
    const available = `MAX(0, COALESCE((SELECT SUM(credit_usd_cents)
        FROM billing_admin_credits
       WHERE user_id = ?2 AND created_at > datetime('now', '-12 months')), 0))`;
    const result = await this.#db
      .prepare(
        `INSERT INTO billing_admin_credits
           (id, user_id, credit_usd_cents, granted_by_email, note, created_at)
         SELECT ?1, ?2, -MIN(?3, ${available}), ?4, ?5, ?6
          WHERE MIN(?3, ${available}) > 0
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, userId, maxCents, grantedByEmail, note, now)
      .run();
    if (result.meta.changes === 0) return 0;

    const row = await this.#db
      .prepare(
        `SELECT credit_usd_cents FROM billing_admin_credits WHERE id = ?1`,
      )
      .bind(id)
      .first<{ credit_usd_cents: number }>();
    return row ? Math.abs(row.credit_usd_cents) : 0;
  }

  /**
   * This user's admin-granted credit (L4), summed the same way
   * `totalTopupCreditMicroUsd` sums Stripe top-ups -- including the same
   * 12-month window, since both feed the same spendable-credit bucket
   * (`totalSpendableCreditMicroUsd` below; `budget.ts`'s
   * `"<userId>:topup"` ledger draws down against the combined total, not
   * against either source individually).
   */
  async totalAdminCreditMicroUsd(userId: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COALESCE(SUM(credit_usd_cents), 0) AS total
         FROM billing_admin_credits
         WHERE user_id = ?1 AND created_at > datetime('now', '-12 months')`,
      )
      .bind(userId)
      .first<{ total: number }>();
    return (row?.total ?? 0) * 10_000;
  }

  /**
   * What "credit remaining" actually means everywhere it is spent or shown:
   * Stripe top-ups plus admin grants, combined. `handlePlan`'s Layer three
   * and `handleBillingStatus`'s readout both call this rather than either
   * total alone, so a user's spendable balance is never missing half its
   * sources in one of the two places that reads it.
   */
  async totalSpendableCreditMicroUsd(userId: string): Promise<number> {
    const [topup, admin] = await Promise.all([
      this.totalTopupCreditMicroUsd(userId),
      this.totalAdminCreditMicroUsd(userId),
    ]);
    return topup + admin;
  }

  /**
   * One grant by id, or undefined.
   *
   * Exists so a caller can tell whether a known grant has already been made
   * without summing anything. `signup-credit.ts` uses it to skip an external
   * lookup it would otherwise repeat on every request forever; correctness
   * there still rests on the insert's own ON CONFLICT, not on this read.
   */
  async findAdminCredit(id: string): Promise<AdminCreditRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT id, user_id, credit_usd_cents, granted_by_email, note, created_at
         FROM billing_admin_credits WHERE id = ?1`,
      )
      .bind(id)
      .first<AdminCreditRow>();
    return row ? toAdminCreditRecord(row) : undefined;
  }

  /** Recent admin grants for a user, newest first -- an admin tool's own audit view. */
  async listAdminCredits(userId: string): Promise<AdminCreditRecord[]> {
    const result = await this.#db
      .prepare(
        `SELECT id, user_id, credit_usd_cents, granted_by_email, note, created_at
         FROM billing_admin_credits
         WHERE user_id = ?1
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .bind(userId)
      .all<AdminCreditRow>();
    return result.results.map(toAdminCreditRecord);
  }

  async recordTopup(
    stripeCheckoutSessionId: string,
    userId: string,
    stripeCustomerId: string,
    creditUsdCents: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO billing_topups
           (stripe_checkout_session_id, user_id, stripe_customer_id, credit_usd_cents, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(stripe_checkout_session_id) DO NOTHING`,
      )
      .bind(
        stripeCheckoutSessionId,
        userId,
        stripeCustomerId,
        creditUsdCents,
        now,
      )
      .run();
  }

  /**
   * Record a Stripe object that settled, and what it took.
   *
   * `stripeObjectId` is the Checkout Session id for a top-up or the Invoice
   * id for a subscription charge. It is the primary key, so this is a no-op
   * on Stripe's at-least-once redelivery and on the nightly reconcile
   * re-reading the same invoices.
   *
   * `amountUsdCents` is what Stripe actually took, which is not the credit
   * granted and is legitimately zero: a coupon-covered Checkout settles as
   * `no_payment_required` and a trial invoice is paid for nothing. Zero is
   * recorded rather than dropped, because it happened; whether it counts as
   * payment is `CLEARED_PAYMENT_SQL`'s decision, in one place.
   *
   * `ON CONFLICT DO NOTHING` keeps the first settlement rather than the
   * latest, which is the answer the question wants.
   */
  async recordPayment(
    stripeObjectId: string,
    userId: string,
    amountUsdCents: number,
    at: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_payments
           (stripe_object_id, user_id, amount_usd_cents, cleared_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(stripe_object_id) DO NOTHING`,
      )
      .bind(stripeObjectId, userId, amountUsdCents, at)
      .run();
  }

  /**
   * Has this account begun paying for anything?
   *
   * Asked by the referral claim path, which has to refuse an account that is
   * already a customer: the offer is for somebody who arrived through a link
   * and then purchased, so if a code could be attached afterwards, every
   * established account would be a voucher waiting to be spent.
   *
   * "Begun" rather than "completed", and the predicate lives in
   * purchase-barrier.ts, which explains both why and what it costs. A
   * subscription row counts unless Stripe never took the first payment for
   * it. A trial counts, because the payout fires the moment that subscription
   * turns active. Neither the 12-month credit window nor the current tier
   * comes into it: the question is whether this account is a customer, not
   * what it has left.
   *
   * This is the readable half of the rule and it produces the refusal reason.
   * The half that survives two requests arriving at once is the same
   * predicate inside `ReferralStore.attribute`'s own INSERT.
   */
  async hasBegunAPurchase(userId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(`SELECT 1 AS found WHERE ${PURCHASE_BARRIER_SQL}`)
      .bind(userId)
      .first();
    return row !== null;
  }

  /**
   * Has a positive charge been recorded for this account?
   *
   * Recorded, not still held: a refund or a lost dispute returns the money
   * and nothing here reads either, so this stays true for a purchase that
   * was later reversed. See `CLEARED_PAYMENT_SQL`.
   *
   * The late signal, and a different question from `hasBegunAPurchase`: that
   * one refuses a claim from somebody whose purchase is under way, this one
   * decides whether a payout is owed. purchase-barrier.ts holds both
   * predicates side by side and says which is which, because using the wrong
   * one either pays out on an abandoned checkout or refuses a real customer.
   */
  async hasClearedPayment(userId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(`SELECT 1 AS found WHERE ${CLEARED_PAYMENT_SQL}`)
      .bind(userId)
      .first();
    return row !== null;
  }

  /**
   * Which of these events have already been applied.
   *
   * One query for a whole page rather than one per event, because D1 counts
   * queries per Worker invocation (1000 on Workers Paid, 50 on Free) and the
   * replay's per-event cost is what decides how much of a backlog a nightly
   * run can clear.
   *
   * The caller keeps the list at or under D1's hundred bound parameters per
   * query, which is what bounds the page.
   */
  async processedEventIds(stripeEventIds: string[]): Promise<Set<string>> {
    if (stripeEventIds.length === 0) return new Set();
    const holes = stripeEventIds.map((_, n) => `?${n + 1}`).join(', ');
    const result = await this.#db
      .prepare(
        `SELECT stripe_event_id FROM billing_webhook_events
          WHERE stripe_event_id IN (${holes})`,
      )
      .bind(...stripeEventIds)
      .all<{ stripe_event_id: string }>();
    return new Set((result.results ?? []).map((row) => row.stripe_event_id));
  }

  /** Has this Stripe event already been applied? Checked before, not after. */
  async wasEventProcessed(stripeEventId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT 1 FROM billing_webhook_events WHERE stripe_event_id = ?1`,
      )
      .bind(stripeEventId)
      .first();
    return row !== null;
  }

  /**
   * Where the replay of Stripe's event log has got to.
   *
   * Null means this deployment has never run one, which asks for everything
   * Stripe still holds (about 30 days).
   */
  async getEventReplayCursor(id: string): Promise<EventReplayCursor | null> {
    const row = await this.#db
      .prepare(
        `SELECT done_below, sweep_top, sweep_after_id
           FROM billing_event_replay WHERE id = ?1`,
      )
      .bind(id)
      .first<EventReplayRow>();
    if (row === null) return null;
    return {
      doneBelow: row.done_below,
      sweepTop: row.sweep_top,
      sweepAfterId: row.sweep_after_id,
    };
  }

  /**
   * Record where a replay run stopped, so the next one carries on from
   * there.
   *
   * Written after every page rather than once at the end of a run. A run that
   * dies halfway (the scheduled invocation is cut off, Stripe rejects the
   * next request) then loses one page of progress instead of all of it, and
   * the alternative is the failure this whole cursor exists to prevent: a
   * descent that restarts at the top every night never reaches the bottom.
   */
  async saveEventReplayCursor(
    id: string,
    cursor: EventReplayCursor,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_event_replay
           (id, done_below, sweep_top, sweep_after_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           done_below = excluded.done_below,
           sweep_top = excluded.sweep_top,
           sweep_after_id = excluded.sweep_after_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        cursor.doneBelow,
        cursor.sweepTop,
        cursor.sweepAfterId,
        new Date().toISOString(),
      )
      .run();
  }

  /**
   * Keep an event nobody could be attributed to, so the sweep can move on
   * without it being lost.
   *
   * The first sighting wins for `first_seen_at`, which is what makes "this
   * has been waiting nine days" a thing the row can say.
   */
  async parkUnattributedEvent(
    stripeEventId: string,
    type: string,
    created: number,
    payload: string,
    at: string = new Date().toISOString(),
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_unattributed_events
           (stripe_event_id, type, created, payload, first_seen_at,
            last_attempt_at, attempts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0)
         ON CONFLICT(stripe_event_id) DO UPDATE SET
           last_attempt_at = excluded.last_attempt_at,
           attempts = billing_unattributed_events.attempts + 1`,
      )
      .bind(stripeEventId, type, created, payload, at)
      .run();
  }

  /**
   * Record that the retry is about to try this one.
   *
   * Stamped before the attempt rather than after it, and the ordering above
   * reads the same column, so a row that cannot be attributed moves to the
   * back of the queue instead of holding the front of it. Exactly what
   * `ReferralStore.markAttempted` does and for the same reason: without it a
   * fixed batch of the oldest rows is the whole queue for ever, and a
   * payment parked later is never looked at again.
   */
  async markUnattributedAttempted(
    stripeEventId: string,
    at: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE billing_unattributed_events
            SET last_attempt_at = ?2, attempts = attempts + 1
          WHERE stripe_event_id = ?1`,
      )
      .bind(stripeEventId, at)
      .run();
  }

  /**
   * A batch of parked events, least recently tried first.
   *
   * By attempt and not by age, which is the difference between a queue and a
   * dead end. Ordering by `created` meant a fixed batch always returned the
   * same oldest rows, so once the batch filled with events that can never be
   * attributed, every payment parked after them was starved: an invoice that
   * became attributable the moment its customer mapping arrived would never
   * be tried again.
   *
   * The caller applies the batch oldest-first regardless. Fairness decides
   * which rows are in it; `created` decides the order they go in, because a
   * Checkout that maps a customer has to be applied before the invoice that
   * needs the mapping.
   */
  async listUnattributedEvents(limit = 200): Promise<UnattributedEvent[]> {
    const result = await this.#db
      .prepare(
        `SELECT stripe_event_id, type, created, payload, first_seen_at, attempts
           FROM billing_unattributed_events
          ORDER BY last_attempt_at, created, stripe_event_id
          LIMIT ?1`,
      )
      .bind(limit)
      .all<{
        stripe_event_id: string;
        type: string;
        created: number;
        payload: string;
        first_seen_at: string;
        attempts: number;
      }>();
    return (result.results ?? []).map((row) => ({
      stripeEventId: row.stripe_event_id,
      type: row.type,
      created: row.created,
      payload: row.payload,
      firstSeenAt: row.first_seen_at,
      attempts: row.attempts,
    }));
  }

  /** Drop a parked event, once it has actually been applied. */
  async dropUnattributedEvent(stripeEventId: string): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM billing_unattributed_events WHERE stripe_event_id = ?1`,
      )
      .bind(stripeEventId)
      .run();
  }

  async markEventProcessed(stripeEventId: string, type: string): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_webhook_events (stripe_event_id, type, received_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(stripe_event_id) DO NOTHING`,
      )
      .bind(stripeEventId, type, new Date().toISOString())
      .run();
  }
}
