/**
 * The referral tables, behind the same kind of narrow surface `BillingStore`
 * and `GitHubStore` present: SQL lives here, decisions live in
 * `referral.ts`, and nothing outside this file writes these rows.
 */
import { PURCHASE_BARRIER_SQL } from './purchase-barrier.ts';
import { makeCode, normaliseCode } from './referral.ts';

export interface AttributionRecord {
  referredUserId: string;
  referrerUserId: string;
  code: string;
  createdAt: string;
  /** When this attribution took one of its referrer's capped slots. */
  claimedAt: string | null;
  /** When the nightly sweep last tried to finish this payout. */
  lastAttemptAt: string | null;
  paidAt: string | null;
}

/** The randomness a new code is drawn from. Injected so tests are not random. */
export type RandomBytes = (bytes: number) => Uint8Array;

const CRYPTO_RANDOM: RandomBytes = (bytes) =>
  crypto.getRandomValues(new Uint8Array(bytes));

export class ReferralStore {
  readonly #db: D1Database;
  readonly #random: RandomBytes;

  constructor(db: D1Database, random: RandomBytes = CRYPTO_RANDOM) {
    this.#db = db;
    this.#random = random;
  }

  /**
   * This account's code, issuing one if it has none.
   *
   * The retry is not defensive padding: `code` is UNIQUE, so two accounts
   * asking at the same moment can collide, and the loser of that race has to
   * try again rather than fail. It re-reads its own row first, because the
   * other possibility is that this account got a code between the read and
   * the write, and then the right answer is that code, not a second one.
   */
  async codeFor(userId: string): Promise<string> {
    const existing = await this.#db
      .prepare(`SELECT code FROM referral_codes WHERE user_id = ?1`)
      .bind(userId)
      .first<{ code: string }>();
    if (existing?.code) return existing.code;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = makeCode(this.#random);
      const result = await this.#db
        .prepare(
          `INSERT INTO referral_codes (user_id, code, created_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT DO NOTHING`,
        )
        .bind(userId, code, new Date().toISOString())
        .run();
      if (result.meta.changes > 0) return code;

      const mine = await this.#db
        .prepare(`SELECT code FROM referral_codes WHERE user_id = ?1`)
        .bind(userId)
        .first<{ code: string }>();
      if (mine?.code) return mine.code;
    }
    throw new Error('could not issue a referral code');
  }

  /** Whose code this is, or undefined. Normalised first, so a pasted code resolves. */
  async ownerOf(
    rawCode: string | null | undefined,
  ): Promise<string | undefined> {
    const code = normaliseCode(rawCode);
    if (code === null) return undefined;
    const row = await this.#db
      .prepare(`SELECT user_id FROM referral_codes WHERE code = ?1`)
      .bind(code)
      .first<{ user_id: string }>();
    return row?.user_id;
  }

  /** This account's attribution, or undefined if it was never referred. */
  async attributionFor(
    referredUserId: string,
  ): Promise<AttributionRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT referred_user_id, referrer_user_id, code, created_at,
                claimed_at, paid_at, last_attempt_at
         FROM referral_attributions WHERE referred_user_id = ?1`,
      )
      .bind(referredUserId)
      .first<{
        referred_user_id: string;
        referrer_user_id: string;
        code: string;
        created_at: string;
        claimed_at: string | null;
        paid_at: string | null;
        last_attempt_at: string | null;
      }>();
    if (!row) return undefined;
    return {
      referredUserId: row.referred_user_id,
      referrerUserId: row.referrer_user_id,
      code: row.code,
      createdAt: row.created_at,
      claimedAt: row.claimed_at,
      paidAt: row.paid_at,
      lastAttemptAt: row.last_attempt_at,
    };
  }

  /**
   * Record who referred this account, if nothing has been recorded before and
   * this account is not already a customer.
   *
   * Two rules, both in the statement rather than in a read before it, because
   * both have to hold against a second request arriving at the same instant.
   *
   * `ON CONFLICT DO NOTHING` is "first one wins": two simultaneous claims with
   * two different codes must not both write, and check-then-act does not
   * survive that.
   *
   * The `WHERE NOT ...` is the purchase barrier (purchase-barrier.ts). The
   * caller has already asked the readable version of the same question and
   * refused on it, which is what produces a reason worth logging; this is the
   * half that closes the window between that read and this write. A claim
   * submitted while a Checkout is in flight loses that race here instead of
   * recording an attribution behind a purchase.
   *
   * It reads billing's tables, which nothing else in this file does. That is
   * the point: the only way the two facts can be checked together is in one
   * statement, and they are in the same database.
   */
  async attribute(
    referredUserId: string,
    referrerUserId: string,
    code: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO referral_attributions
           (referred_user_id, referrer_user_id, code, created_at,
            claimed_at, paid_at, last_attempt_at)
         SELECT ?1, ?2, ?3, ?4, NULL, NULL, NULL
          WHERE NOT ${PURCHASE_BARRIER_SQL}
         ON CONFLICT(referred_user_id) DO NOTHING`,
      )
      .bind(referredUserId, referrerUserId, code, new Date().toISOString())
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Attributions that claimed a slot and were never paid, oldest first.
   *
   * The state a payout that died between claiming and granting leaves behind.
   * Stripe's own redelivery recovers most of them, but its retries run out
   * after a few days, and a delivery that was never made at all is not
   * retried by anybody. Without a sweep over these, the slot stays taken and
   * the referral stays owed, permanently and silently.
   */
  async strandedPayouts(limit: number): Promise<string[]> {
    const result = await this.#db
      .prepare(
        `SELECT referred_user_id FROM referral_attributions
          WHERE claimed_at IS NOT NULL AND paid_at IS NULL
          ORDER BY last_attempt_at IS NOT NULL, last_attempt_at, claimed_at
          LIMIT ?1`,
      )
      .bind(limit)
      .all<{ referred_user_id: string }>();
    return (result.results ?? []).map((row) => row.referred_user_id);
  }

  /**
   * Record that the sweep has just tried this one.
   *
   * Stamped before the attempt rather than after it, and deliberately: a
   * payout that throws is exactly the one that must move to the back of the
   * queue, and stamping afterwards would skip precisely those. A row that
   * fails for ever then costs one attempt a night rather than blocking every
   * newer stranded payout behind it.
   */
  async markAttempted(referredUserId: string, at: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE referral_attributions SET last_attempt_at = ?2
          WHERE referred_user_id = ?1`,
      )
      .bind(referredUserId, at)
      .run();
  }

  /**
   * Mark an attribution paid, and say whether this call is the one that did.
   *
   * `WHERE paid_at IS NULL` is the guard, in the same statement as the write.
   * The caller uses the answer to decide whether to grant credit, so a
   * redelivered webhook that loses this race is told it lost and grants
   * nothing, rather than reading a stale NULL and paying a second time.
   */
  async markPaid(referredUserId: string, at: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE referral_attributions SET paid_at = ?2
         WHERE referred_user_id = ?1 AND paid_at IS NULL`,
      )
      .bind(referredUserId, at)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Take one of this attribution's referrer's capped slots, if any is left.
   *
   * The cap lives in this statement rather than in a count the caller
   * compares, and that is the whole point. Counting first and paying second
   * is a check-then-act: two purchases clearing at the same instant both read
   * the same total, both find it under the ceiling, and both pay. A burst
   * passes the cap by however many arrive together, which on a program that
   * writes credit is the difference between a ceiling and a suggestion.
   *
   * Here the count is a correlated subquery inside the UPDATE's own WHERE
   * clause. SQLite (and therefore D1) admits one writer at a time, so the
   * second statement runs against the first one's committed row and sees the
   * slot gone. `changes` then says which of the two took it.
   *
   * `claimed_at IS NULL` makes it a no-op for a row that already holds a
   * slot, so a redelivery does not consume a second one.
   */
  async reserveSlot(
    referredUserId: string,
    at: string,
    maxClaimed: number,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE referral_attributions
            SET claimed_at = ?2
          WHERE referred_user_id = ?1
            AND claimed_at IS NULL
            AND (SELECT COUNT(*) FROM referral_attributions AS held
                  WHERE held.referrer_user_id
                        = referral_attributions.referrer_user_id
                    AND held.claimed_at IS NOT NULL) < ?3`,
      )
      .bind(referredUserId, at, maxClaimed)
      .run();
    return result.meta.changes > 0;
  }

  /** Everyone this account has referred, for their own readout. */
  async summaryFor(
    referrerUserId: string,
  ): Promise<{ referred: number; paid: number }> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS referred,
                COUNT(paid_at) AS paid
         FROM referral_attributions WHERE referrer_user_id = ?1`,
      )
      .bind(referrerUserId)
      .first<{ referred: number; paid: number }>();
    return { referred: row?.referred ?? 0, paid: row?.paid ?? 0 };
  }
}
