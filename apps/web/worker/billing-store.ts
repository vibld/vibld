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

/**
 * How this deployment admits accounts, as far as auto-reload's barrier
 * needs to know: whether by invite, and which addresses are platform admins
 * (let in without one, `decideAccessFor`).
 */
export interface AutoReloadAccess {
  inviteGated: boolean;
  /** Lowercased, as `platformAdminsFor` gives them. */
  admins?: Iterable<string>;
}

const INVITE_GATED: AutoReloadAccess = { inviteGated: true };

/** The two values `autoReloadBarredSql` binds, in its placeholders' order. */
function accessParams(access: AutoReloadAccess): [number, string] {
  return [
    access.inviteGated ? 1 : 0,
    JSON.stringify([...(access.admins ?? [])]),
  ];
}

/**
 * True for an account auto-reload must not charge, with the account's id as
 * ?1, `gated` whether this deployment admits by invite and `admins` a JSON
 * array of its admins' addresses: deletion requested and not canceled, a
 * suspension or a ban not yet lifted, or, where invites decide who gets in,
 * an account the gate would not admit now. Admission is read as the gate
 * reads it (`decideAccessFor`), by the address the account last signed in
 * with (`accounts`): an admin's, or one with an invite it redeemed and that
 * still stands. An open deployment bars nothing here.
 * A durable check rather than only the revoke turning the setting off, so a
 * revoke whose update failed still charges nothing, and one that holds for
 * a run settling in the background, which has no request to ask the gate.
 */
function autoReloadBarredSql(gated: string, admins: string): string {
  return `EXISTS (SELECT 1 FROM account_deletions
                WHERE user_id = ?1 AND cancelled_at IS NULL)
             OR EXISTS (SELECT 1 FROM billing_clawbacks
                WHERE user_id = ?1 AND suspends = 1 AND lifted_at IS NULL)
             OR EXISTS (SELECT 1 FROM user_bans
                WHERE user_id = ?1 AND lifted_at IS NULL)
             OR (${gated} = 1
                 AND NOT EXISTS (SELECT 1 FROM accounts a
                    WHERE a.user_id = ?1
                      AND (lower(a.email) IN (SELECT value FROM json_each(${admins}))
                           OR EXISTS (SELECT 1 FROM access_invites i
                              WHERE i.redeemed_by_user_id = ?1
                                AND i.revoked_at IS NULL
                                AND i.email = lower(a.email)))))`;
}

/** Why auto-reload turned itself off (D166). */
export type AutoReloadDisabledReason =
  'declined' | 'authentication_required' | 'no_card';

export interface AutoReloadSettings {
  enabled: boolean;
  monthlyCapUsdCents: number;
  paymentMethodId: string | null;
  card: { brand: string; last4: string } | null;
  disabledReason: AutoReloadDisabledReason | null;
}

interface AutoReloadRow {
  enabled: number;
  monthly_cap_usd_cents: number;
  payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  disabled_reason: string | null;
}

/** Why auto-subscribe turned itself off (D167). */
export type AutoSubscribeDisabledReason =
  'subscribed' | 'declined' | 'authentication_required' | 'no_card';

export interface AutoSubscribeSettings {
  enabled: boolean;
  paymentMethodId: string | null;
  card: { brand: string; last4: string } | null;
  disabledReason: AutoSubscribeDisabledReason | null;
  /** The attempt in flight, if any, and when it was claimed. */
  attempt: { id: string; claimedAt: string } | null;
  /** It has started a plan: it does that once, and is not turned on again. */
  used: boolean;
}

interface AutoSubscribeRow {
  enabled: number;
  payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  disabled_reason: string | null;
  attempt_id: string | null;
  attempt_claimed_at: string | null;
  stripe_subscription_id: string | null;
}

/**
 * Still on Free, in SQL, for the statements that start a plan: no
 * subscription Stripe may bill (`BILLABLE_STATUSES`), and no gifted plan in
 * force at `now`. `?1` is the user id.
 */
function onFreeSql(now: string): string {
  return `NOT EXISTS (SELECT 1 FROM billing_subscriptions
                       WHERE user_id = ?1
                         AND status IN (${BILLABLE_STATUS_SQL}))
          AND NOT EXISTS (SELECT 1 FROM plan_gifts
                       WHERE user_id = ?1 AND revoked_at IS NULL
                         AND (ends_at IS NULL OR ends_at > ${now}))`;
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

  /**
   * Withdraw an offer the account has not been paid for yet, so a card saved
   * after the credit was switched off pays nothing (D163). A paid offer is
   * left alone: the grant is the record, and the row is harmless. With no
   * offer row, `claimSignupCardCredit` records the card as `no-offer`, and
   * the card still counts for the monthly allowance. An offer with a
   * `granted` claim not yet paid is kept too: the claim's retry reads the
   * amount from it.
   */
  async closeSignupOffer(userId: string, grantId: string): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM billing_signup_offers
          WHERE user_id = ?1
            AND NOT EXISTS (SELECT 1 FROM billing_admin_credits WHERE id = ?2)
            AND NOT EXISTS (SELECT 1 FROM billing_signup_cards
                             WHERE user_id = ?1 AND outcome = 'granted')`,
      )
      .bind(userId, grantId)
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
    /**
     * Whether the deployment still offers the credit. False records the
     * card as `no-offer` whatever offer row is left (D163): the card still
     * counts for the monthly allowance, and nothing is paid.
     */
    offerOpen: boolean;
  }): Promise<{ outcome: SignupCardOutcome; paid: boolean }> {
    const now = new Date().toISOString();
    const { setupIntentId, userId, cardFingerprint, grantId } = claim;
    const open = claim.offerOpen ? 1 : 0;

    await this.#db
      .prepare(
        `INSERT INTO billing_signup_cards
           (stripe_setup_intent_id, user_id, card_fingerprint, outcome, created_at)
         SELECT ?1, ?2, ?3, 'granted', ?4
          WHERE ?6 = 1
            AND EXISTS (SELECT 1 FROM billing_signup_offers
                         WHERE user_id = ?2 AND credit_usd_cents > 0)
            AND NOT EXISTS (SELECT 1 FROM billing_admin_credits WHERE id = ?5)
         ON CONFLICT DO NOTHING`,
      )
      .bind(setupIntentId, userId, cardFingerprint, now, grantId, open)
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
                  WHEN ?6 = 0
                    OR NOT EXISTS (SELECT 1 FROM billing_signup_offers
                                    WHERE user_id = ?2 AND credit_usd_cents > 0)
                    THEN 'no-offer'
                  ELSE 'card-used'
                END,
                ?4
          WHERE 1
         ON CONFLICT DO NOTHING`,
      )
      .bind(setupIntentId, userId, cardFingerprint, now, grantId, open)
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

  /**
   * A top-up whose Checkout completed unpaid, its payment still on the way
   * (a bank debit). Auto-subscribe waits on it (D167) until it is credited
   * or its payment fails (`dropUnsettledTopup`).
   */
  async recordUnsettledTopup(
    stripeCheckoutSessionId: string,
    userId: string,
    stripePaymentIntentId: string | null,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_unsettled_topups
           (stripe_checkout_session_id, user_id, stripe_payment_intent_id,
            created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(stripe_checkout_session_id) DO NOTHING`,
      )
      .bind(
        stripeCheckoutSessionId,
        userId,
        stripePaymentIntentId,
        new Date().toISOString(),
      )
      .run();
  }

  async dropUnsettledTopup(stripeCheckoutSessionId: string): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM billing_unsettled_topups
          WHERE stripe_checkout_session_id = ?1`,
      )
      .bind(stripeCheckoutSessionId)
      .run();
  }

  /**
   * The payment intents of this account's unsettled top-ups not yet
   * credited: null in the list where the intent is not known.
   */
  async uncreditedUnsettledTopups(userId: string): Promise<(string | null)[]> {
    const rows = await this.#db
      .prepare(
        `SELECT u.stripe_payment_intent_id AS intent
           FROM billing_unsettled_topups u
          WHERE u.user_id = ?1
            AND NOT EXISTS (
                  SELECT 1 FROM billing_topups t
                   WHERE t.stripe_checkout_session_id =
                         u.stripe_checkout_session_id)`,
      )
      .bind(userId)
      .all<{ intent: string | null }>();
    return rows.results.map((row) => row.intent);
  }

  /** Whether each of these top-up Checkout sessions has been credited. */
  async topupsRecorded(stripeCheckoutSessionIds: string[]): Promise<boolean> {
    for (const id of stripeCheckoutSessionIds) {
      const row = await this.#db
        .prepare(
          `SELECT 1 AS found FROM billing_topups
            WHERE stripe_checkout_session_id = ?1`,
        )
        .bind(id)
        .first();
      if (!row) return false;
    }
    return true;
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
  /**
   * Whether nothing may be charged automatically for the account: it has
   * asked to be deleted and not taken it back, it is suspended or banned, or (where
   * invites decide) the invite that let it in was withdrawn, none other
   * stands and it is no admin. Either way it cannot spend what a charge would buy.
   * `claimAutoReload` asks the same inside its statement.
   */
  async autoReloadBarred(
    userId: string,
    access: AutoReloadAccess = INVITE_GATED,
  ): Promise<boolean> {
    const row = await this.#db
      .prepare(`SELECT 1 AS found WHERE ${autoReloadBarredSql('?2', '?3')}`)
      .bind(userId, ...accessParams(access))
      .first();
    return row !== null;
  }

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

  /** This account's auto-reload settings (D166), or undefined if never set. */
  async autoReloadSettings(
    userId: string,
  ): Promise<AutoReloadSettings | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT enabled, monthly_cap_usd_cents, payment_method_id, card_brand,
                card_last4, disabled_reason
           FROM billing_auto_reload WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<AutoReloadRow>();
    if (!row) return undefined;
    return {
      enabled: row.enabled === 1,
      monthlyCapUsdCents: row.monthly_cap_usd_cents,
      paymentMethodId: row.payment_method_id,
      card:
        row.card_brand && row.card_last4
          ? { brand: row.card_brand, last4: row.card_last4 }
          : null,
      disabledReason: row.disabled_reason as AutoReloadDisabledReason | null,
    };
  }

  /**
   * Turn auto-reload on, with the card it will charge, or off. Either clears
   * a reason it turned itself off for: the account has now decided.
   */
  async saveAutoReloadSettings(
    userId: string,
    settings: {
      enabled: boolean;
      monthlyCapUsdCents: number;
      card?: { paymentMethodId: string; brand: string; last4: string };
    },
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO billing_auto_reload
           (user_id, enabled, monthly_cap_usd_cents, payment_method_id,
            card_brand, card_last4, disabled_reason, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = excluded.enabled,
           monthly_cap_usd_cents = excluded.monthly_cap_usd_cents,
           payment_method_id = COALESCE(excluded.payment_method_id,
                                        billing_auto_reload.payment_method_id),
           card_brand = COALESCE(excluded.card_brand, billing_auto_reload.card_brand),
           card_last4 = COALESCE(excluded.card_last4, billing_auto_reload.card_last4),
           disabled_reason = NULL,
           version = billing_auto_reload.version + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(
        userId,
        settings.enabled ? 1 : 0,
        settings.monthlyCapUsdCents,
        settings.card?.paymentMethodId ?? null,
        settings.card?.brand ?? null,
        settings.card?.last4 ?? null,
        new Date().toISOString(),
      )
      .run();
  }

  /**
   * Auto-reload turned itself off, and why, for the builder to say.
   *
   * Given the attempt whose answer this is, only while the setting is still
   * the one that attempt's claim read its card from: an answer about a charge the
   * account made before turning auto-reload off and on again, perhaps with
   * another card, is not about the setting it has now.
   */
  async disableAutoReload(
    userId: string,
    reason: AutoReloadDisabledReason,
    attemptId?: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE billing_auto_reload
            SET enabled = 0, disabled_reason = ?2, updated_at = ?3
          WHERE user_id = ?1
            AND (?4 IS NULL OR version = (
                  SELECT settings_version FROM billing_auto_reload_attempts
                   WHERE id = ?4))`,
      )
      .bind(userId, reason, new Date().toISOString(), attemptId ?? null)
      .run();
  }

  /**
   * Off, as the account turning it off would leave it, for an account whose
   * access was withdrawn: it can no longer spend what a reload would buy.
   * Only while it is in fact barred (`autoReloadBarred`): an account another
   * invite still lets in, or an open deployment, keeps it. True when it was
   * turned off.
   */
  async turnOffAutoReloadIfBarred(
    userId: string,
    access: AutoReloadAccess = INVITE_GATED,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_reload
            SET enabled = 0, disabled_reason = NULL, updated_at = ?2
          WHERE user_id = ?1 AND enabled = 1
            AND (${autoReloadBarredSql('?3', '?4')})`,
      )
      .bind(userId, new Date().toISOString(), ...accessParams(access))
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Claim the right to start one automatic charge, or learn there is none
   * to start. The one statement every charge passes through, so two runs
   * settling at once cannot both charge: D1 runs it alone, and the pending
   * index and the (user, period, seq) key turn a lost race into nothing.
   *
   * Refused while auto-reload is off or has no card, while another charge
   * for the account is in flight, or an auto-subscribe attempt
   * (`claimAutoSubscribe`, which refuses in turn while this one is), once the month holds as many charges as
   * the cap buys (counted in the month each was made, `charged_period`),
   * and once the account has asked to be deleted (docs/decisions.md L32)
   * or lost its invite (`autoReloadBarred`): a run that settles after
   * either would otherwise charge a card nobody can use the credit from. A failed charge
   * does not count against the cap; it has turned auto-reload off.
   */
  async claimAutoReload(
    userId: string,
    period: string,
    priceUsdCents: number,
    now: string = new Date().toISOString(),
    access: AutoReloadAccess = INVITE_GATED,
  ): Promise<string | undefined> {
    const row = await this.#db
      .prepare(
        `INSERT INTO billing_auto_reload_attempts
           (id, user_id, period, seq, state, payment_method_id,
            amount_usd_cents, settings_version, created_at, updated_at)
         SELECT ?5, ?1, ?2, n.seq, 'pending', s.payment_method_id, ?4,
                s.version, ?3, ?3
           FROM billing_auto_reload s,
                (SELECT COALESCE(MAX(seq), 0) + 1 AS seq
                   FROM billing_auto_reload_attempts
                  WHERE user_id = ?1 AND period = ?2) n
          WHERE s.user_id = ?1
            AND s.enabled = 1
            AND s.payment_method_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM billing_auto_reload_attempts
                             WHERE user_id = ?1 AND state = 'pending')
            AND NOT EXISTS (SELECT 1 FROM billing_auto_subscribe
                             WHERE user_id = ?1 AND attempt_id IS NOT NULL)
            AND NOT (${autoReloadBarredSql('?6', '?7')})
            AND (SELECT COUNT(*) FROM billing_auto_reload_attempts
                  WHERE user_id = ?1 AND charged_period = ?2
                    AND state = 'succeeded')
                < s.monthly_cap_usd_cents / ?4
         ON CONFLICT DO NOTHING
         RETURNING id`,
      )
      .bind(
        userId,
        period,
        now,
        priceUsdCents,
        crypto.randomUUID(),
        ...accessParams(access),
      )
      .first<{ id: string }>();
    return row?.id;
  }

  /**
   * Whether a claimed attempt may still be charged, asked in one statement
   * just before its request goes to Stripe: still pending, auto-reload still
   * on with the very setting the claim read (`settings_version`: a cap
   * lowered or a card changed since is a save, and the save is what decides),
   * the month's charges still under that cap, and the account not barred.
   * True also records the dispatch (`dispatched_at`), which keeps the
   * attempt from being given up while its request may be in flight
   * (`giveUpAutoReloadAttempt`), and in the same batch writes the referral
   * barrier's earliest term (purchase-barrier.ts): written exactly when a
   * charge may follow, and never for an attempt that gives way here.
   */
  async autoReloadAttemptCurrent(
    userId: string,
    attemptId: string,
    period: string,
    access: AutoReloadAccess = INVITE_GATED,
    now: string = new Date().toISOString(),
  ): Promise<boolean> {
    const [dispatched] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE billing_auto_reload_attempts
            SET dispatched_at = ?6
          WHERE id = ?2 AND user_id = ?1 AND state = 'pending'
            AND EXISTS (
                  SELECT 1 FROM billing_auto_reload s
                   WHERE s.user_id = ?1
                     AND s.enabled = 1
                     AND s.version = billing_auto_reload_attempts.settings_version
                     AND (SELECT COUNT(*) FROM billing_auto_reload_attempts c
                           WHERE c.user_id = ?1 AND c.charged_period = ?3
                             AND c.state = 'succeeded')
                         < s.monthly_cap_usd_cents
                           / billing_auto_reload_attempts.amount_usd_cents)
            AND NOT (${autoReloadBarredSql('?4', '?5')})`,
        )
        .bind(userId, attemptId, period, ...accessParams(access), now),
      // Only when the statement above recorded this dispatch.
      this.#db
        .prepare(
          `INSERT INTO billing_purchase_starts (user_id, started_at)
           SELECT ?1, ?3
            WHERE EXISTS (
                    SELECT 1 FROM billing_auto_reload_attempts
                     WHERE id = ?2 AND user_id = ?1 AND state = 'pending'
                       AND dispatched_at = ?3)
           ON CONFLICT(user_id) DO NOTHING`,
        )
        .bind(userId, attemptId, now),
    ]);
    return (dispatched?.meta.changes ?? 0) > 0;
  }

  /**
   * Ends a pending attempt that never became a charge (`not_due`,
   * `superseded`), but only once no request under its key can still be in
   * flight: never dispatched, or last dispatched before `dispatchedBefore`.
   * False, and the attempt left pending, otherwise: a check sending the same
   * request may yet make the charge, and freeing the claim now would let
   * the next one charge again beside it.
   */
  async giveUpAutoReloadAttempt(
    attemptId: string,
    failureCode: string,
    dispatchedBefore: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_reload_attempts
            SET state = 'failed', failure_code = ?2, updated_at = ?3
          WHERE id = ?1 AND state = 'pending'
            AND (dispatched_at IS NULL OR dispatched_at < ?4)`,
      )
      .bind(attemptId, failureCode, new Date().toISOString(), dispatchedBefore)
      .run();
    return result.meta.changes > 0;
  }
  /**
   * The charge a claimed attempt became, and how it ended. False when the
   * attempt had already ended, so that a late answer about it changes
   * nothing the account has done since. The one exception is a success for
   * an attempt given up on without a charge to show for it (`not_due`,
   * `superseded`, `abandoned`): Stripe made the charge after all, and the
   * cap must count it.
   */
  async settleAutoReloadAttempt(
    attemptId: string,
    state: 'succeeded' | 'failed',
    paymentIntentId: string | null,
    failureCode: string | null = null,
    chargedPeriod: string | null = null,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_reload_attempts
            SET state = ?2,
                payment_intent_id = COALESCE(?3, payment_intent_id),
                failure_code = ?4,
                updated_at = ?5,
                charged_period = ?6
          WHERE id = ?1
            AND (state = 'pending'
                 OR (?2 = 'succeeded' AND state = 'failed'
                     AND payment_intent_id IS NULL))`,
      )
      .bind(
        attemptId,
        state,
        paymentIntentId,
        failureCode,
        new Date().toISOString(),
        chargedPeriod,
      )
      .run();
    return result.meta.changes > 0;
  }

  /**
   * A pending attempt's charge failed, and auto-reload turns itself off for
   * `reason`: both in one batch, so a failure between the two can never
   * leave the attempt ended with the setting still on, where a retry of the
   * same answer would find nothing pending and change nothing. The setting
   * turns off only while it is still the save the claim read its card from
   * (`disableAutoReload`). False, and nothing written, when the attempt had
   * already ended.
   */
  async failAutoReloadAttempt(
    userId: string,
    attemptId: string,
    paymentIntentId: string | null,
    failureCode: string | null,
    reason: AutoReloadDisabledReason,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const [, settled] = await this.#db.batch([
      // First, while the attempt still reads pending.
      this.#db
        .prepare(
          `UPDATE billing_auto_reload
              SET enabled = 0, disabled_reason = ?2, updated_at = ?3
            WHERE user_id = ?1
              AND version = (
                    SELECT settings_version FROM billing_auto_reload_attempts
                     WHERE id = ?4 AND user_id = ?1 AND state = 'pending')`,
        )
        .bind(userId, reason, now, attemptId),
      this.#db
        .prepare(
          `UPDATE billing_auto_reload_attempts
              SET state = 'failed',
                  payment_intent_id = COALESCE(?2, payment_intent_id),
                  failure_code = ?3,
                  updated_at = ?4
            WHERE id = ?1 AND state = 'pending'`,
        )
        .bind(attemptId, paymentIntentId, failureCode, now),
    ]);
    return (settled?.meta.changes ?? 0) > 0;
  }

  /** This account's charge still in flight, if any, and when it was claimed. */
  async pendingAutoReload(userId: string): Promise<
    | {
        id: string;
        createdAt: string;
        paymentMethodId: string;
        amountUsdCents: number;
      }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT id, created_at, payment_method_id, amount_usd_cents
           FROM billing_auto_reload_attempts
          WHERE user_id = ?1 AND state = 'pending'`,
      )
      .bind(userId)
      .first<{
        id: string;
        created_at: string;
        payment_method_id: string;
        amount_usd_cents: number;
      }>();
    return row
      ? {
          id: row.id,
          createdAt: row.created_at,
          paymentMethodId: row.payment_method_id,
          amountUsdCents: row.amount_usd_cents,
        }
      : undefined;
  }

  /** How many automatic top-ups the month holds, for the builder to say. */
  async autoReloadsIn(userId: string, period: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS n FROM billing_auto_reload_attempts
          WHERE user_id = ?1 AND charged_period = ?2
            AND state = 'succeeded'`,
      )
      .bind(userId, period)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /** This account's auto-subscribe settings (D167), or undefined if never set. */
  async autoSubscribeSettings(
    userId: string,
  ): Promise<AutoSubscribeSettings | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT enabled, payment_method_id, card_brand, card_last4,
                disabled_reason, attempt_id, attempt_claimed_at,
                stripe_subscription_id
           FROM billing_auto_subscribe WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<AutoSubscribeRow>();
    if (!row) return undefined;
    return {
      enabled: row.enabled === 1,
      paymentMethodId: row.payment_method_id,
      card:
        row.card_brand && row.card_last4
          ? { brand: row.card_brand, last4: row.card_last4 }
          : null,
      disabledReason: row.disabled_reason as AutoSubscribeDisabledReason | null,
      attempt:
        row.attempt_id && row.attempt_claimed_at
          ? { id: row.attempt_id, claimedAt: row.attempt_claimed_at }
          : null,
      used: row.stripe_subscription_id !== null,
    };
  }

  /**
   * Where auto-subscribe stands for a Checkout (D167): whether an
   * attempt is in flight, and the plan it started, if any. Read before and
   * after the session is created, a change in either means auto-subscribe
   * acted in between, so the session must not be handed out.
   */
  async autoSubscribeState(userId: string): Promise<{
    inFlight: boolean;
    subscriptionId: string | null;
    dispatchedAt: string | null;
  }> {
    const row = await this.#db
      .prepare(
        `SELECT attempt_id, stripe_subscription_id, attempt_dispatched_at
           FROM billing_auto_subscribe
          WHERE user_id = ?1`,
      )
      .bind(userId)
      .first<{
        attempt_id: string | null;
        stripe_subscription_id: string | null;
        attempt_dispatched_at: string | null;
      }>();
    return {
      inFlight: row?.attempt_id != null,
      subscriptionId: row?.stripe_subscription_id ?? null,
      dispatchedAt: row?.attempt_id != null ? row.attempt_dispatched_at : null,
    };
  }

  /**
   * Whether the account is on Free as the statements that start a plan see
   * it (`onFreeSql`): a subscription Stripe may still bill, `past_due` or
   * `paused` among them, counts as a plan, though it grants nothing.
   */
  async onFree(
    userId: string,
    now: string = new Date().toISOString(),
  ): Promise<boolean> {
    const row = await this.#db
      .prepare(`SELECT 1 AS free WHERE ${onFreeSql('?2')}`)
      .bind(userId, now)
      .first<{ free: number }>();
    return row !== null;
  }

  /**
   * Turn auto-subscribe on, with the card it will start the plan on, or off.
   * Either clears a reason it turned itself off for, and either is a new
   * save (`version`), so an attempt claimed from the one before gives way.
   * The attempt itself is left for the check that owns it to end. Turning
   * it on is refused (false) once it has started a plan, in the same
   * statement, so a plan started while the request was being made wins.
   */
  async saveAutoSubscribeSettings(
    userId: string,
    settings: {
      enabled: boolean;
      card?: { paymentMethodId: string; brand: string; last4: string };
    },
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO billing_auto_subscribe
           (user_id, enabled, payment_method_id, card_brand, card_last4,
            disabled_reason, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = excluded.enabled,
           payment_method_id = COALESCE(excluded.payment_method_id,
                                        billing_auto_subscribe.payment_method_id),
           card_brand = COALESCE(excluded.card_brand,
                                 billing_auto_subscribe.card_brand),
           card_last4 = COALESCE(excluded.card_last4,
                                 billing_auto_subscribe.card_last4),
           disabled_reason = NULL,
           version = billing_auto_subscribe.version + 1,
           updated_at = excluded.updated_at
         WHERE excluded.enabled = 0
            OR billing_auto_subscribe.stripe_subscription_id IS NULL`,
      )
      .bind(
        userId,
        settings.enabled ? 1 : 0,
        settings.card?.paymentMethodId ?? null,
        settings.card?.brand ?? null,
        settings.card?.last4 ?? null,
        new Date().toISOString(),
      )
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Claim the one attempt to start this account's plan (D167), or nothing.
   * One statement: on, with a card, no attempt already in flight (nor an
   * auto-reload charge: each claim refuses while the other's is held, so
   * the two can never both buy), still on
   * Free (`onFreeSql`), and not barred (`autoReloadBarredSql`, whose
   * terms are the same for any charge made without the person there). The
   * card is read in the same statement, so the attempt is about one save.
   */
  async claimAutoSubscribe(
    userId: string,
    now: string = new Date().toISOString(),
    access: AutoReloadAccess = INVITE_GATED,
  ): Promise<{ attemptId: string; paymentMethodId: string } | undefined> {
    const row = await this.#db
      .prepare(
        `UPDATE billing_auto_subscribe
            SET attempt_id = ?2, attempt_claimed_at = ?3,
                attempt_version = version, attempt_dispatched_at = NULL,
                updated_at = ?3
          WHERE user_id = ?1 AND enabled = 1 AND attempt_id IS NULL
            AND payment_method_id IS NOT NULL
            AND stripe_subscription_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM billing_auto_reload_attempts
                             WHERE user_id = ?1 AND state = 'pending')
            AND ${onFreeSql('?3')}
            AND NOT (${autoReloadBarredSql('?4', '?5')})
         RETURNING attempt_id, payment_method_id`,
      )
      .bind(userId, crypto.randomUUID(), now, ...accessParams(access))
      .first<{ attempt_id: string; payment_method_id: string }>();
    return row
      ? { attemptId: row.attempt_id, paymentMethodId: row.payment_method_id }
      : undefined;
  }

  /**
   * Whether the attempt may still be sent to Stripe, asked in one statement
   * as the last thing before it is: still this account's attempt, still on
   * with the save the claim read, still on Free, not barred. True also
   * records the dispatch, which keeps the attempt from being given up while
   * its request may be in flight (`giveUpAutoSubscribe`), and the referral
   * barrier's earliest term (`recordPurchaseStarted`), in the same batch:
   * an attempt this says no to never sent a purchase, so leaves no barrier.
   * The card is read here too: the one the claim's save named.
   */
  async autoSubscribeAttemptCurrent(
    userId: string,
    attemptId: string,
    now: string = new Date().toISOString(),
    access: AutoReloadAccess = INVITE_GATED,
  ): Promise<{ paymentMethodId: string } | undefined> {
    const [dispatched] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE billing_auto_subscribe
              SET attempt_dispatched_at = ?3
            WHERE user_id = ?1 AND attempt_id = ?2 AND enabled = 1
              AND version = attempt_version
              AND payment_method_id IS NOT NULL
              AND stripe_subscription_id IS NULL
              AND ${onFreeSql('?3')}
              AND NOT (${autoReloadBarredSql('?4', '?5')})
           RETURNING payment_method_id`,
        )
        .bind(userId, attemptId, now, ...accessParams(access)),
      // Only when the statement above recorded this dispatch.
      this.#db
        .prepare(
          `INSERT INTO billing_purchase_starts (user_id, started_at)
           SELECT ?1, ?3
            WHERE EXISTS (
                    SELECT 1 FROM billing_auto_subscribe
                     WHERE user_id = ?1 AND attempt_id = ?2
                       AND attempt_dispatched_at = ?3)
           ON CONFLICT(user_id) DO NOTHING`,
        )
        .bind(userId, attemptId, now),
    ]);
    const row = (
      dispatched?.results as { payment_method_id: string }[] | undefined
    )?.[0];
    return row ? { paymentMethodId: row.payment_method_id } : undefined;
  }

  /**
   * It started the plan: auto-subscribe has done the one thing it does, and
   * turns itself off saying so. From the charge's own reply or from the
   * webhook, whichever is first; the second changes nothing. A subscription
   * it started under an attempt since given up still counts.
   */
  async settleAutoSubscribed(
    userId: string,
    stripeSubscriptionId: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_subscribe
            SET enabled = 0, disabled_reason = 'subscribed',
                stripe_subscription_id = ?2,
                attempt_id = NULL, attempt_claimed_at = NULL,
                attempt_version = NULL, attempt_dispatched_at = NULL,
                updated_at = ?3
          WHERE user_id = ?1 AND stripe_subscription_id IS NULL`,
      )
      .bind(userId, stripeSubscriptionId, new Date().toISOString())
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Stripe refused the attempt: it ends, and auto-subscribe turns itself off
   * for `reason`, in the same single-row write, but only while the
   * setting is still the save the claim read its card from. False, and
   * nothing written, when the attempt had already ended.
   */
  async failAutoSubscribe(
    userId: string,
    attemptId: string,
    reason: Exclude<AutoSubscribeDisabledReason, 'subscribed'>,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_subscribe
            SET enabled = CASE WHEN version = attempt_version THEN 0
                               ELSE enabled END,
                disabled_reason = CASE WHEN version = attempt_version THEN ?3
                                       ELSE disabled_reason END,
                attempt_id = NULL, attempt_claimed_at = NULL,
                attempt_version = NULL, attempt_dispatched_at = NULL,
                updated_at = ?4
          WHERE user_id = ?1 AND attempt_id = ?2`,
      )
      .bind(userId, attemptId, reason, new Date().toISOString())
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Ends an attempt that never started a plan, leaving the setting as it
   * is, but only once no request under its key can still be in flight:
   * never dispatched, or last dispatched before `dispatchedBefore`.
   */
  async giveUpAutoSubscribe(
    userId: string,
    attemptId: string,
    dispatchedBefore: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE billing_auto_subscribe
            SET attempt_id = NULL, attempt_claimed_at = NULL,
                attempt_version = NULL, attempt_dispatched_at = NULL,
                updated_at = ?3
          WHERE user_id = ?1 AND attempt_id = ?2
            AND (attempt_dispatched_at IS NULL
                 OR attempt_dispatched_at < ?4)`,
      )
      .bind(userId, attemptId, new Date().toISOString(), dispatchedBefore)
      .run();
    return result.meta.changes > 0;
  }
}
