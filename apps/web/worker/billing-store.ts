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

/**
 * The Stripe subscription statuses that can still take money.
 *
 * Expressed as what is billable rather than as what is terminal, because the
 * question being asked is "can this still charge them", and `canceled` and
 * `incomplete_expired` are the only two where the answer is no for good.
 * `trialing` is the one that made this matter: a trial charges when it ends.
 *
 * One list, used by the mirror lookup (`findCancellableSubscription`) and by
 * the Stripe fallback in `access-billing.ts`. Two lists would drift, and the
 * drift would be a subscription the revoke finds and the reinstatement
 * cannot.
 */
export const BILLABLE_STATUSES: readonly string[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
];

/** The same list as a SQL literal, for embedding in an `IN (...)`. */
const BILLABLE_STATUS_SQL = BILLABLE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * What saving a card for the welcome credit came to. See
 * 0029_card_first_signup_credit.sql for what each one means.
 */
export type SignupCardOutcome =
  'granted' | 'card-used' | 'account-granted' | 'no-offer';

/** What went back out: a refund, or a dispute this deployment lost. */
export type ClawbackCause = 'refund' | 'dispute';

/** What the reversed payment had bought. */
export type ClawbackKind = 'topup' | 'subscription';

/** A recorded payment, found from a charge that was refunded or disputed. */
export interface ReversedPayment {
  /** The `billing_payments` key: a Checkout Session or an Invoice id. */
  stripeObjectId: string;
  amountUsdCents: number;
  /** The subscription an invoice paid for, when `invoice.paid` recorded it. */
  stripeSubscriptionId: string | null;
  /** Present when the payment was a top-up: what it granted, and when. */
  topup: { creditUsdCents: number; createdAt: string } | null;
}

/** One reversal, as `recordClawback` is asked to write it. */
export interface ClawbackInput {
  /** Deterministic; see 0032_payment_clawbacks.sql. */
  id: string;
  userId: string;
  cause: ClawbackCause;
  stripeEventId: string | null;
  stripeChargeId: string;
  stripeObjectId: string;
  kind: ClawbackKind;
  chargeUsdCents: number;
  /** Cumulative `amount_refunded` for a refund, the dispute's amount for a dispute. */
  reversedUsdCents: number;
  /** The top-up's credit. Ignored for a subscription payment. */
  creditUsdCents: number;
  creditGrantedAt: string | null;
  stripeSubscriptionId: string | null;
  suspends: boolean;
  /** Top-up credit already spent, in cents, from the spend ledger. */
  spentCents: number;
  at?: string;
}

/** What one newly recorded reversal took, and what it could not. */
export interface ClawbackRecorded {
  creditRemovedUsdCents: number;
  creditShortfallUsdCents: number;
}

/** One reversal, as the admin panel reads it back. */
export interface ClawbackRecord {
  id: string;
  cause: ClawbackCause;
  stripeChargeId: string;
  stripeObjectId: string;
  kind: ClawbackKind;
  chargeUsdCents: number;
  reversedUsdCents: number;
  creditRemovedUsdCents: number;
  creditShortfallUsdCents: number;
  stripeSubscriptionId: string | null;
  suspends: boolean;
  liftedAt: string | null;
  liftedByEmail: string | null;
  createdAt: string;
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

/**
 * The ids a parked reconcile run attempted (0019_reconcile_attempted.sql).
 *
 * Anything unreadable comes back empty rather than throwing. A cursor is a
 * hint about where to resume, and a hint that cannot be read should cost a
 * repeat of idempotent work, not a nightly pass that dies before it starts.
 * Empty is also the safe direction for what reads this: every failure then
 * counts as a first one and gets its retry.
 */
function parseAttempted(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    console.error('reconcile: could not read the attempted list');
    return [];
  }
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

  /**
   * Record that this account has started a plan or top-up purchase.
   *
   * The referral barrier's earliest term (purchase-barrier.ts), written by
   * `createCheckoutSession` and deliberately not by the card-setup session:
   * saving a card for the welcome credit buys nothing. `DO NOTHING` keeps the
   * first start, since only whether one ever happened is asked.
   */
  async recordPurchaseStarted(userId: string): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_purchase_starts (user_id, started_at)
         VALUES (?1, ?2)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, new Date().toISOString())
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
  /**
   * The subscription that could still be cancelled or un-cancelled, which is
   * a wider question than the entitlement lookup below.
   *
   * A `past_due` or `paused` subscriber is not entitled to anything right
   * now and is very much still billable, so the wind-down has to find them.
   * Reinstating has to find the same ones, or a revoke that scheduled a
   * cancellation on a `past_due` subscription cannot be undone: the restore
   * reported nothing to restore, and the subscription ended at period close
   * after the payment recovered.
   */
  async findCancellableSubscription(
    userId: string,
  ): Promise<SubscriptionRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT stripe_subscription_id, user_id, stripe_customer_id, tier, status,
                price_id, current_period_end, cancel_at_period_end
         FROM billing_subscriptions
         WHERE user_id = ?1 AND status IN (${BILLABLE_STATUS_SQL})
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId)
      .first<SubscriptionRow>();
    return row ? toSubscriptionRecord(row) : undefined;
  }

  /**
   * A subscription a refund or a lost dispute ended is never one, whatever
   * its mirrored status says (0032_payment_clawbacks.sql).
   *
   * Asked of the clawback record rather than written into `status`, because
   * the mirror is overwritten by every subscription event and the replay
   * applies them out of order: an older `customer.subscription.updated`
   * reading `active` would otherwise hand back an allowance whose payment
   * has already gone back out. Stripe's own cancellation arrives later and
   * agrees; this is what makes the allowance stop before it does, and stay
   * stopped if cancelling in Stripe has to be retried.
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
           AND NOT EXISTS (
             SELECT 1 FROM billing_clawbacks
              WHERE billing_clawbacks.stripe_subscription_id =
                    billing_subscriptions.stripe_subscription_id)
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
   *
   * Net of what a refund or a lost dispute removed from it
   * (0032_payment_clawbacks.sql), windowed on when the removed credit was
   * bought rather than when it was removed, so a removal expires with the
   * top-up it came out of and never reaches credit bought afterwards.
   */
  async totalTopupCreditMicroUsd(userId: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COALESCE((SELECT SUM(credit_usd_cents)
                  FROM billing_topups
                 WHERE user_id = ?1
                   AND created_at > datetime('now', '-12 months')), 0)
              - COALESCE((SELECT SUM(credit_removed_usd_cents)
                  FROM billing_clawbacks
                 WHERE user_id = ?1
                   AND credit_granted_at > datetime('now', '-12 months')), 0)
                AS total`,
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
    /**
     * Stripe's own `canceled_at` for the cancellation being recorded, as it
     * came back from the update. This is what makes the row a claim about
     * one specific cancellation rather than a standing permission to clear
     * whatever this subscription happens to be carrying later.
     *
     * `ON CONFLICT DO UPDATE` rather than `DO NOTHING`: a subscription can
     * be cancelled, restored and cancelled again, and keeping the first
     * row would leave the record pointing at a cancellation that no longer
     * exists, which is the stale marker this column is here to stop.
     */
    canceledAt: string | null,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_scheduled_cancellations
           (stripe_subscription_id, user_id, scheduled_at, canceled_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(stripe_subscription_id) DO UPDATE
           SET user_id = ?2, scheduled_at = ?3, canceled_at = ?4`,
      )
      .bind(stripeSubscriptionId, userId, new Date().toISOString(), canceledAt)
      .run();
  }

  /**
   * The cancellation this deployment recorded for this subscription, if any.
   *
   * `null` means no record, so nothing here scheduled it. A record answers
   * with the `canceled_at` it was scheduled under, and the caller compares
   * that against the cancellation Stripe is holding now. A bare "yes we
   * scheduled something once" is not enough: a row left behind by a failed
   * clean-up would otherwise authorise clearing a cancellation the
   * subscriber made afterwards, which is the harm this table exists to
   * prevent, one step removed.
   */
  async scheduledCancellation(
    stripeSubscriptionId: string,
  ): Promise<{ canceledAt: string | null } | null> {
    const row = await this.#db
      .prepare(
        `SELECT canceled_at FROM billing_scheduled_cancellations
          WHERE stripe_subscription_id = ?1`,
      )
      .bind(stripeSubscriptionId)
      .first<{ canceled_at: string | null }>();
    if (!row) return null;
    return { canceledAt: row.canceled_at };
  }

  /**
   * Forget a scheduled cancellation, because it has been undone.
   *
   * Tidiness rather than safety. The `canceled_at` on the row is what stops
   * a leftover authorising anything, so a delete that fails costs a stale
   * row and no harm; without that column this delete would be the only
   * thing standing between a failed clean-up and clearing somebody's own
   * cancellation later.
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

  /**
   * Open the welcome-credit offer to an account (0029_card_first_signup_credit.sql).
   *
   * `ON CONFLICT DO NOTHING`, so the amount an account was first offered is
   * the amount it keeps: a later change to the configured figure does not
   * move an offer somebody has already been shown.
   */
  async openSignupOffer(userId: string, creditUsdCents: number): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_signup_offers (user_id, credit_usd_cents, opened_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, creditUsdCents, new Date().toISOString())
      .run();
  }

  /** The cents this account was offered, or undefined if it never was. */
  async findSignupOffer(userId: string): Promise<number | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT credit_usd_cents FROM billing_signup_offers WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<{ credit_usd_cents: number }>();
    return row?.credit_usd_cents;
  }

  /**
   * Whether this account has a card on file for the Free plan's monthly
   * allowance (D159), and, when it has not, whether that is because every
   * card it saved was first saved by another account.
   *
   * A card counts for the account that saved it first (the SetupIntent id
   * breaks a tie in the same millisecond), so one card buys one
   * account its dollar a month, as it buys one account the welcome credit.
   * Every card saved through the builder is a row in `billing_signup_cards`,
   * whatever the welcome credit made of it. An account that has paid, for a
   * plan or a top-up, has had a card charged, so it counts too.
   */
  async freeCardOf(
    userId: string,
  ): Promise<{ onFile: boolean; cardAlreadyUsed: boolean }> {
    const row = await this.#db
      .prepare(
        `SELECT
           EXISTS (
             SELECT 1 FROM billing_signup_cards c
              WHERE c.user_id = ?1
                AND NOT EXISTS (
                  SELECT 1 FROM billing_signup_cards o
                   WHERE o.card_fingerprint = c.card_fingerprint
                     AND o.user_id <> ?1
                     AND (o.created_at < c.created_at
                          OR (o.created_at = c.created_at
                              AND o.stripe_setup_intent_id
                                  < c.stripe_setup_intent_id)))
           )
           OR EXISTS (
             SELECT 1 FROM billing_subscriptions
              WHERE user_id = ?1
                AND status NOT IN ('incomplete', 'incomplete_expired'))
           OR EXISTS (SELECT 1 FROM billing_topups WHERE user_id = ?1)
             AS on_file,
           EXISTS (SELECT 1 FROM billing_signup_cards WHERE user_id = ?1)
             AS any_card`,
      )
      .bind(userId)
      .first<{ on_file: number; any_card: number }>();
    const onFile = row?.on_file === 1;
    return { onFile, cardAlreadyUsed: !onFile && row?.any_card === 1 };
  }

  /**
   * What became of the most recent card this account saved for the offer,
   * or undefined if it has saved none. Read by the status route, so the
   * builder can say why a card that was added did not pay anything.
   */
  async latestSignupCardOutcome(
    userId: string,
  ): Promise<SignupCardOutcome | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT outcome FROM billing_signup_cards
          WHERE user_id = ?1
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .bind(userId)
      .first<{ outcome: SignupCardOutcome }>();
    return row?.outcome;
  }

  /**
   * Grant the welcome credit for a saved card, at most once per card and
   * once per account.
   *
   * Three statements, deliberately ordered so that none of them needs the
   * others to have run in the same transaction (D1 offers `batch`, and the
   * test double this store is exercised against does not, so correctness is
   * not allowed to rest on it):
   *
   * 1. Claim. A `granted` row is inserted only if the account was offered
   *    the credit and has no `signup:` grant already. The two partial unique
   *    indexes refuse a second `granted` row for the same card or the same
   *    account, and `ON CONFLICT DO NOTHING` turns that refusal into a
   *    no-op rather than an error.
   * 2. Record a refusal, if the claim did not land, with the reason. The
   *    primary key makes this a no-op when the claim did land, or when an
   *    earlier delivery of the same SetupIntent already recorded either.
   * 3. Pay, if this SetupIntent's row says `granted`. Keyed on the
   *    `signup:` id, so it is a no-op when already paid.
   *
   * A delivery that dies between 1 and 3 leaves a `granted` claim and no
   * credit. Stripe retries it (the webhook is not marked processed), 1 and 2
   * are no-ops on the primary key, and 3 pays. That is the whole reason 3
   * reads the claim rather than trusting what 1 reported.
   */
  async claimSignupCardCredit(claim: {
    setupIntentId: string;
    userId: string;
    cardFingerprint: string;
    grantId: string;
    grantedByEmail: string;
    note: string;
  }): Promise<{ outcome: SignupCardOutcome; paid: boolean }> {
    const now = new Date().toISOString();
    const { setupIntentId, userId, cardFingerprint, grantId } = claim;

    await this.#db
      .prepare(
        `INSERT INTO billing_signup_cards
           (stripe_setup_intent_id, user_id, card_fingerprint, outcome, created_at)
         SELECT ?1, ?2, ?3, 'granted', ?4
          WHERE EXISTS (SELECT 1 FROM billing_signup_offers
                         WHERE user_id = ?2 AND credit_usd_cents > 0)
            AND NOT EXISTS (SELECT 1 FROM billing_admin_credits WHERE id = ?5)
         ON CONFLICT DO NOTHING`,
      )
      .bind(setupIntentId, userId, cardFingerprint, now, grantId)
      .run();

    // The order of the CASE is the order the reasons are worth telling
    // somebody in. An account that already has its credit needs no second
    // card, whichever route it came by (an account that got its dollar on
    // creation, before this table, has no offer row and is still told the
    // true thing). One never offered anything has nothing to try again
    // with. "That card was used elsewhere" is said only when it is the
    // whole answer, since it is the one that asks for a different card.
    await this.#db
      .prepare(
        `INSERT INTO billing_signup_cards
           (stripe_setup_intent_id, user_id, card_fingerprint, outcome, created_at)
         SELECT ?1, ?2, ?3,
                CASE
                  WHEN EXISTS (SELECT 1 FROM billing_admin_credits WHERE id = ?5)
                    OR EXISTS (SELECT 1 FROM billing_signup_cards
                                WHERE user_id = ?2 AND outcome = 'granted')
                    THEN 'account-granted'
                  WHEN NOT EXISTS (SELECT 1 FROM billing_signup_offers
                                    WHERE user_id = ?2 AND credit_usd_cents > 0)
                    THEN 'no-offer'
                  ELSE 'card-used'
                END,
                ?4
          WHERE 1
         ON CONFLICT DO NOTHING`,
      )
      .bind(setupIntentId, userId, cardFingerprint, now, grantId)
      .run();

    const row = await this.#db
      .prepare(
        `SELECT user_id, outcome FROM billing_signup_cards
          WHERE stripe_setup_intent_id = ?1`,
      )
      .bind(setupIntentId)
      .first<{ user_id: string; outcome: SignupCardOutcome }>();
    if (!row) {
      // Both inserts are unconditional between them, so this means the
      // database dropped a write it reported as done. Thrown so the webhook
      // answers 5xx and Stripe tries again.
      throw new Error(`no signup card claim recorded for ${setupIntentId}`);
    }
    if (row.outcome !== 'granted' || row.user_id !== userId) {
      return { outcome: row.outcome, paid: false };
    }

    // The amount is the one the offer was opened at, read here rather than
    // passed in, so nothing on the webhook path can decide it.
    const paid = await this.#db
      .prepare(
        `INSERT INTO billing_admin_credits
           (id, user_id, credit_usd_cents, granted_by_email, note, created_at)
         SELECT ?1, ?2, credit_usd_cents, ?3, ?4, ?5
           FROM billing_signup_offers
          WHERE user_id = ?2
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(grantId, userId, claim.grantedByEmail, claim.note, now)
      .run();
    return { outcome: 'granted', paid: paid.meta.changes > 0 };
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
    /**
     * Every other id this payment can be recognised by, from the event that
     * settled it. The key above is the ledger key and is not what a refund
     * names: a refund carries the charge, its payment intent and, for a
     * subscription, its invoice, and never the Checkout Session a top-up was
     * recorded under. Stored so a reward recovered from this table rather
     * than from an event can still be tied to the payment that funded it.
     */
    aliases: string[] = [],
    /**
     * The subscription an invoice paid for, so a refund of that invoice ends
     * that subscription (0032_payment_clawbacks.sql). Absent for a top-up.
     *
     * The one column a repeat may fill in, and only while it is empty: the
     * nightly reconcile re-records invoices this deployment already holds,
     * which is how a row written before the column existed learns its
     * subscription without anything else about the first settlement moving.
     */
    stripeSubscriptionId: string | null = null,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_payments
           (stripe_object_id, user_id, amount_usd_cents, cleared_at, aliases,
            stripe_subscription_id)
         VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6)
         ON CONFLICT(stripe_object_id) DO UPDATE SET
           stripe_subscription_id = excluded.stripe_subscription_id
         WHERE billing_payments.stripe_subscription_id IS NULL
           AND excluded.stripe_subscription_id IS NOT NULL`,
      )
      .bind(
        stripeObjectId,
        userId,
        amountUsdCents,
        at,
        aliases.join(' '),
        stripeSubscriptionId,
      )
      .run();
  }

  /**
   * The recorded payment a refunded or disputed charge paid for, if any.
   *
   * Matched on the ledger key and on every alias recorded with it, the same
   * ids `firstClearedPaymentIds` reads, and only among this account's own
   * payments: the charge's customer already said whose money it was, and a
   * match outside that account would take somebody else's credit.
   *
   * The top-up is joined in, because a Checkout Session's payment and its
   * credit are two rows keyed the same way, and which one this is decides
   * whether credit or a plan is what gets removed.
   */
  async findReversedPayment(
    userId: string,
    ids: readonly string[],
  ): Promise<ReversedPayment | undefined> {
    const wanted = [...new Set(ids.filter((id) => id !== ''))];
    if (wanted.length === 0) return undefined;
    const holes = wanted.map((_, n) => n + 2);
    const row = await this.#db
      .prepare(
        `SELECT p.stripe_object_id, p.amount_usd_cents, p.stripe_subscription_id,
                t.credit_usd_cents AS topup_credit_usd_cents,
                t.created_at AS topup_created_at
           FROM billing_payments p
           LEFT JOIN billing_topups t
             ON t.stripe_checkout_session_id = p.stripe_object_id
          WHERE p.user_id = ?1
            AND (p.stripe_object_id IN (${holes.map((n) => `?${n}`).join(', ')})
                 OR ${holes
                   .map(
                     (n) =>
                       `instr(' ' || COALESCE(p.aliases, '') || ' ', ' ' || ?${n} || ' ') > 0`,
                   )
                   .join(' OR ')})
          ORDER BY p.cleared_at, p.stripe_object_id
          LIMIT 1`,
      )
      .bind(userId, ...wanted)
      .first<{
        stripe_object_id: string;
        amount_usd_cents: number;
        stripe_subscription_id: string | null;
        topup_credit_usd_cents: number | null;
        topup_created_at: string | null;
      }>();
    if (!row) return undefined;
    return {
      stripeObjectId: row.stripe_object_id,
      amountUsdCents: row.amount_usd_cents,
      stripeSubscriptionId: row.stripe_subscription_id,
      topup:
        row.topup_credit_usd_cents === null || row.topup_created_at === null
          ? null
          : {
              creditUsdCents: row.topup_credit_usd_cents,
              createdAt: row.topup_created_at,
            },
    };
  }

  /**
   * Record one reversal and remove what it owes, in one statement.
   *
   * One statement for the reason `deductAdminCredit` is one: the amount owed
   * and the balance it is floored against are both read inside the INSERT,
   * and D1 admits one writer at a time. Two partial refunds of the same
   * charge delivered together therefore cannot both read "nothing removed
   * yet" and both take their share of the whole; the second sees the
   * first's row.
   *
   * What is owed is cumulative, not per event. Stripe's `amount_refunded` is
   * the charge's running total, so the refunded share is the larger of this
   * event's total and any earlier one, plus whatever lost disputes took,
   * capped at the charge. The credit owed is that share of the top-up's
   * credit, less everything earlier rows for the charge already owed. An
   * older refund event replayed after a newer one therefore owes nothing,
   * and two refunds add up to exactly the share they refunded between them.
   *
   * What is removed is floored at the balance still unspent: the account's
   * granted credit (top-ups and grants, the same 12-month window as
   * everywhere else), less earlier removals, less `spentCents`. The rest is
   * recorded as a shortfall and never collected, so nobody is left owing.
   * `spentCents` comes from the spend ledger, which is not in D1, and is the
   * one number here read outside the statement.
   *
   * Credit that has already expired (a top-up older than the 12-month
   * window) owes nothing: it is no longer in the balance to take from, and
   * taking the same amount out of newer credit would charge a later
   * purchase for an older one.
   *
   * `null` means the id was already recorded, which is what a redelivery,
   * a replay and a parked retry all look like. Nothing is removed twice.
   */
  async recordClawback(input: ClawbackInput): Promise<ClawbackRecorded | null> {
    const now = input.at ?? new Date().toISOString();
    const row = await this.#db
      .prepare(
        `WITH prior AS (
           SELECT COALESCE(MAX(CASE WHEN cause = 'refund'
                                    THEN reversed_usd_cents END), 0) AS refunded,
                  COALESCE(SUM(CASE WHEN cause = 'dispute'
                                    THEN reversed_usd_cents END), 0) AS disputed,
                  COALESCE(SUM(credit_removed_usd_cents
                               + credit_shortfall_usd_cents), 0) AS owed
             FROM billing_clawbacks
            WHERE stripe_charge_id = ?5
         ),
         due AS (
           SELECT CASE WHEN ?8 > 0 AND ?10 > 0
                        AND ?11 > datetime('now', '-12 months') THEN MAX(0,
                    CAST(?10 * MIN(?8,
                           MAX(CASE WHEN ?3 = 'refund' THEN ?9 ELSE 0 END,
                               prior.refunded)
                           + CASE WHEN ?3 = 'dispute' THEN ?9 ELSE 0 END
                           + prior.disputed) / ?8 AS INTEGER)
                    - prior.owed)
                  ELSE 0 END AS cents
             FROM prior
         ),
         balance AS (
           SELECT MAX(0,
                    COALESCE((SELECT SUM(credit_usd_cents) FROM billing_topups
                               WHERE user_id = ?2
                                 AND created_at > datetime('now', '-12 months')), 0)
                  + COALESCE((SELECT SUM(credit_usd_cents) FROM billing_admin_credits
                               WHERE user_id = ?2
                                 AND created_at > datetime('now', '-12 months')), 0)
                  - COALESCE((SELECT SUM(credit_removed_usd_cents) FROM billing_clawbacks
                               WHERE user_id = ?2
                                 AND credit_granted_at > datetime('now', '-12 months')), 0)
                  - ?15) AS cents
         )
         INSERT INTO billing_clawbacks
           (id, user_id, cause, stripe_event_id, stripe_charge_id,
            stripe_object_id, kind, charge_usd_cents, reversed_usd_cents,
            credit_removed_usd_cents, credit_shortfall_usd_cents,
            credit_granted_at, stripe_subscription_id, suspends, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                MIN(due.cents, balance.cents),
                due.cents - MIN(due.cents, balance.cents),
                ?11, ?12, ?13, ?14
           FROM due, balance
          WHERE 1
         ON CONFLICT(id) DO NOTHING
         RETURNING credit_removed_usd_cents, credit_shortfall_usd_cents`,
      )
      .bind(
        input.id,
        input.userId,
        input.cause,
        input.stripeEventId,
        input.stripeChargeId,
        input.stripeObjectId,
        input.kind,
        Math.max(0, Math.round(input.chargeUsdCents)),
        Math.max(0, Math.round(input.reversedUsdCents)),
        input.kind === 'topup' ? Math.max(0, input.creditUsdCents) : 0,
        input.creditGrantedAt,
        input.stripeSubscriptionId,
        input.suspends ? 1 : 0,
        now,
        Math.max(0, Math.ceil(input.spentCents)),
      )
      .first<{
        credit_removed_usd_cents: number;
        credit_shortfall_usd_cents: number;
      }>();
    if (!row) return null;
    return {
      creditRemovedUsdCents: row.credit_removed_usd_cents,
      creditShortfallUsdCents: row.credit_shortfall_usd_cents,
    };
  }

  /**
   * Whether a lost dispute has this account suspended and no operator has
   * lifted it yet. Read by `spendableFor`, which every paid request asks.
   */
  async isSuspended(userId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT 1 AS found FROM billing_clawbacks
          WHERE user_id = ?1 AND suspends = 1 AND lifted_at IS NULL
          LIMIT 1`,
      )
      .bind(userId)
      .first();
    return row !== null;
  }

  /**
   * An operator lifting a suspension, and saying so.
   *
   * Every open suspension on the account at once: it is the account that is
   * suspended, not the dispute, and an operator who has resolved it with the
   * customer should not have to lift it twice for two charges. A dispute
   * lost afterwards is a new row and suspends again; a replay of one already
   * lifted is the same row and does not.
   *
   * Returns how many were lifted, so a lift of nothing can say so.
   */
  async liftSuspension(
    userId: string,
    liftedByEmail: string,
    at: string = new Date().toISOString(),
  ): Promise<number> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_clawbacks
            SET lifted_at = ?3, lifted_by_email = ?2
          WHERE user_id = ?1 AND suspends = 1 AND lifted_at IS NULL`,
      )
      .bind(userId, liftedByEmail, at)
      .run();
    return result.meta.changes;
  }

  /** The account's reversals, newest first: the admin panel's history. */
  async listClawbacks(userId: string, limit = 20): Promise<ClawbackRecord[]> {
    const result = await this.#db
      .prepare(
        `SELECT id, cause, stripe_charge_id, stripe_object_id, kind,
                charge_usd_cents, reversed_usd_cents, credit_removed_usd_cents,
                credit_shortfall_usd_cents, stripe_subscription_id, suspends,
                lifted_at, lifted_by_email, created_at
           FROM billing_clawbacks
          WHERE user_id = ?1
          ORDER BY created_at DESC, id
          LIMIT ?2`,
      )
      .bind(userId, limit)
      .all<{
        id: string;
        cause: string;
        stripe_charge_id: string;
        stripe_object_id: string;
        kind: string;
        charge_usd_cents: number;
        reversed_usd_cents: number;
        credit_removed_usd_cents: number;
        credit_shortfall_usd_cents: number;
        stripe_subscription_id: string | null;
        suspends: number;
        lifted_at: string | null;
        lifted_by_email: string | null;
        created_at: string;
      }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      // Closed sets this table only holds because `recordClawback` is its
      // one writer, the same trust `toSubscriptionRecord` places in `tier`.
      cause: row.cause as ClawbackCause,
      stripeChargeId: row.stripe_charge_id,
      stripeObjectId: row.stripe_object_id,
      kind: row.kind as ClawbackKind,
      chargeUsdCents: row.charge_usd_cents,
      reversedUsdCents: row.reversed_usd_cents,
      creditRemovedUsdCents: row.credit_removed_usd_cents,
      creditShortfallUsdCents: row.credit_shortfall_usd_cents,
      stripeSubscriptionId: row.stripe_subscription_id,
      suspends: row.suspends !== 0,
      liftedAt: row.lifted_at,
      liftedByEmail: row.lifted_by_email,
      createdAt: row.created_at,
    }));
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
  /**
   * Every id the earliest payment that took money from this account can be
   * recognised by.
   *
   * Used to tie a referral reward to the purchase that funded it, so a later
   * refund of something unrelated does not take the reward back. The paths
   * that pay on a recorded payment have no event in hand, so they read the
   * id from here instead.
   *
   * **The earliest, and only the earliest.** A referral pays on a first
   * purchase, and an attribution cannot be claimed once a purchase has begun
   * (`PURCHASE_BARRIER_SQL`), so the account's first settled payment is the
   * one that earned the reward. Returning every cleared payment would record
   * a renewal or a later top-up as though it were an alias of that purchase,
   * and then refunding the renewal would claw back a reward the original
   * purchase still funds, which is the bug this whole linkage exists to fix.
   */
  async firstClearedPaymentIds(userId: string): Promise<string[]> {
    const row = await this.#db
      .prepare(
        `SELECT stripe_object_id, aliases FROM billing_payments
          WHERE user_id = ?1 AND amount_usd_cents > 0
          ORDER BY cleared_at, stripe_object_id LIMIT 1`,
      )
      .bind(userId)
      .first<{ stripe_object_id: string; aliases: string | null }>();
    if (!row) return [];
    // The ledger key and every alias recorded with it. All of them name the
    // same payment, which is what separates this from the earlier version
    // that returned several different payments.
    //
    // Deduplicated because the callers compute the aliases from the event
    // and the ledger key is one of them, so the key arrives twice by
    // construction rather than by mistake.
    return [
      ...new Set(
        [row.stripe_object_id, ...(row.aliases?.split(' ') ?? [])].filter(
          (id) => id !== '',
        ),
      ),
    ];
  }

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
   * Where the subscription reconcile's walk has got to (internal PR 47,
   * 0017_reconcile_cursor.sql).
   *
   * `undefined` means start from the top: a fresh deployment, and every run
   * after a lap completes.
   */
  async reconcileCursor(id: string): Promise<{
    afterId: string | undefined;
    /**
     * The subscriptions the run that parked here attempted, so each of them
     * has already had its second chance (0019_reconcile_attempted.sql).
     *
     * Empty when nothing is outstanding, and empty too if the stored list
     * cannot be read. That is the safe direction: every failure then counts
     * as a first one and parks, which costs a night and cannot lose a
     * retry, and the next park writes a list that reads back.
     */
    attempted: Set<string>;
  }> {
    const row = await this.#db
      .prepare(
        `SELECT after_id, attempted FROM billing_reconcile_cursor WHERE id = ?1`,
      )
      .bind(id)
      .first<{ after_id: string | null; attempted: string | null }>();
    return {
      afterId: row?.after_id ?? undefined,
      attempted: new Set(parseAttempted(row?.attempted ?? null)),
    };
  }

  /**
   * Record the last subscription a reconcile run reached.
   *
   * `undefined` clears it, which is what a run that reached the end of the
   * list writes: the next run starts from the top and the walk laps.
   */
  async saveReconcileCursor(
    id: string,
    afterId: string | undefined,
    attempted: readonly string[] | undefined = undefined,
    at: string = new Date().toISOString(),
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_reconcile_cursor
           (id, after_id, attempted, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           after_id = excluded.after_id,
           attempted = excluded.attempted,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        afterId ?? null,
        attempted === undefined ? null : JSON.stringify(attempted),
        at,
      )
      .run();
  }

  /**
   * Advance a nightly rotation by one run and say which run this is
   * (internal issue 176, 0028_nightly_rotation.sql).
   *
   * Zero on the first run, then one more on each after it. One query, the
   * upsert and the read together, because the allowance this is taken out
   * of is small enough that a second query is a noticeable share of it, and
   * because a read followed by a write is two runs able to read the same
   * turn.
   */
  async takeNightlyTurn(id: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `INSERT INTO billing_nightly_rotation (id, nights, updated_at)
         VALUES (?1, 0, ?2)
         ON CONFLICT(id) DO UPDATE SET
           nights = nights + 1,
           updated_at = excluded.updated_at
         RETURNING nights`,
      )
      .bind(id, new Date().toISOString())
      .first<{ nights: number }>();
    return row?.nights ?? 0;
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

  /**
   * How much is parked, and how long the oldest has been waiting.
   *
   * Counted in the database rather than by measuring a list, because
   * `listUnattributedEvents` takes a limit and a length that has hit its
   * limit is not a count: a queue of a thousand would report two hundred
   * and look survivable. What this is for is telling somebody how bad it
   * is, so it has to be able to say a number that alarms them.
   *
   * `first_seen_at` is when this deployment took custody, which is the age
   * that matters for "how long has this been ignored". Stripe's own
   * `created` is kept alongside it because a payment that moved long before
   * we ever saw the event is a different kind of old.
   */
  async unattributedSummary(): Promise<{
    parked: number;
    oldestFirstSeenAt: string | null;
    oldestCreated: number | null;
  }> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS parked,
                MIN(first_seen_at) AS oldest_first_seen_at,
                MIN(created) AS oldest_created
           FROM billing_unattributed_events`,
      )
      .first<{
        parked: number;
        oldest_first_seen_at: string | null;
        oldest_created: number | null;
      }>();
    return {
      parked: row?.parked ?? 0,
      oldestFirstSeenAt: row?.oldest_first_seen_at ?? null,
      oldestCreated: row?.oldest_created ?? null,
    };
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
