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

  /**
   * The next accounts the top-up recovery should look at, least recently
   * checked first, at most `limit` of them.
   *
   * A top-up leaves no row anywhere but `billing_topups`, which records the
   * credit granted rather than the money taken, so the only way to learn
   * what Stripe actually collected is to ask Stripe per customer.
   *
   * A rotation rather than a queue that empties. There is no finished
   * state, on purpose: a customer is mapped when Checkout *begins*, so a
   * pass can see a session that has not settled yet, and a "done" mark
   * would stop anyone looking again when it does. Rotating also keeps a
   * top-up taken tomorrow recoverable, which a one-time backfill does not.
   *
   * Already-paid accounts are excluded here rather than skipped later, so
   * the rotation covers only accounts a Stripe call could still tell us
   * something about, and the set shrinks as customers pay.
   *
   * Ordered by when each account was last attended to, counting the day it
   * joined as its last attention if nobody has looked yet. Putting all the
   * never-checked accounts first instead looks like the same thing and is
   * not: a steady stream of signups keeps arriving at the front, and an
   * account checked once is never revisited, so a missed webhook for an
   * existing customer is never recovered. Coalescing makes a new arrival
   * queue behind somebody who has been waiting longer.
   *
   * `user_id` breaks the remaining tie, so the order is total. Without it
   * two accounts sharing a timestamp are returned in whatever order the
   * query plan happens to produce, which makes "who is next" unanswerable
   * and made a test of this queue fail about one run in three.
   *
   * The caller stamps before it reads: an account whose read throws must go
   * to the back, or enough of them hold every slot under the limit and
   * later accounts are never reached.
   */
  async customersToCheckForTopups(
    limit: number,
  ): Promise<Array<{ userId: string; stripeCustomerId: string }>> {
    const result = await this.#db
      .prepare(
        `SELECT user_id, stripe_customer_id FROM billing_customers AS c
          WHERE NOT ${CLEARED_PAYMENT_SQL.replace(/\?1/g, 'c.user_id')}
          ORDER BY COALESCE(topups_checked_at, created_at), user_id
          LIMIT ?1`,
      )
      .bind(limit)
      .all<CustomerRow>();
    return (result.results ?? []).map((row) => ({
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
    }));
  }

  /**
   * Record that the top-up recovery is about to look at this customer.
   *
   * Before the read, not after. The read that throws is exactly the one
   * that must move to the back of the queue; stamping afterwards leaves it
   * at the front for ever, holding a slot under the limit so later
   * customers are never reached. The same reason `ReferralStore` stamps
   * `last_attempt_at` before the attempt rather than after it.
   */
  async markTopupsChecked(userId: string, at: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE billing_customers SET topups_checked_at = ?2
          WHERE user_id = ?1`,
      )
      .bind(userId, at)
      .run();
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
  async grantAdminCredit(
    id: string,
    userId: string,
    creditUsdCents: number,
    grantedByEmail: string,
    note: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO billing_admin_credits
           (id, user_id, credit_usd_cents, granted_by_email, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(id, userId, creditUsdCents, grantedByEmail, note, now)
      .run();
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
   * Has money actually cleared for this account?
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
