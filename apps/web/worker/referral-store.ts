/**
 * The referral tables, behind the same kind of narrow surface `BillingStore`
 * and `GitHubStore` present: SQL lives here, decisions live in
 * `referral.ts`, and nothing outside this file writes these rows.
 */
import { makeCode, normaliseCode } from './referral.ts';

export interface AttributionRecord {
  referredUserId: string;
  referrerUserId: string;
  code: string;
  createdAt: string;
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
        `SELECT referred_user_id, referrer_user_id, code, created_at, paid_at
         FROM referral_attributions WHERE referred_user_id = ?1`,
      )
      .bind(referredUserId)
      .first<{
        referred_user_id: string;
        referrer_user_id: string;
        code: string;
        created_at: string;
        paid_at: string | null;
      }>();
    if (!row) return undefined;
    return {
      referredUserId: row.referred_user_id,
      referrerUserId: row.referrer_user_id,
      code: row.code,
      createdAt: row.created_at,
      paidAt: row.paid_at,
    };
  }

  /**
   * Record who referred this account, if nothing has been recorded before.
   *
   * `ON CONFLICT DO NOTHING` rather than a read followed by a write: the
   * "first one wins" rule has to hold under two simultaneous signups with two
   * different codes, and check-then-act does not survive that. Returns whether
   * this call is the one that wrote.
   */
  async attribute(
    referredUserId: string,
    referrerUserId: string,
    code: string,
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO referral_attributions
           (referred_user_id, referrer_user_id, code, created_at, paid_at)
         VALUES (?1, ?2, ?3, ?4, NULL)
         ON CONFLICT(referred_user_id) DO NOTHING`,
      )
      .bind(referredUserId, referrerUserId, code, new Date().toISOString())
      .run();
    return result.meta.changes > 0;
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

  /** How many referrals this account has already been paid for, for the cap. */
  async paidCountFor(referrerUserId: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS total FROM referral_attributions
         WHERE referrer_user_id = ?1 AND paid_at IS NOT NULL`,
      )
      .bind(referrerUserId)
      .first<{ total: number }>();
    return row?.total ?? 0;
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
