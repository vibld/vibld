/**
 * The invite list, behind the same narrow surface the other stores present:
 * SQL lives here, decisions live in `access.ts`, nothing else writes these
 * rows.
 */
import { normaliseEmail } from './access.ts';

export interface InviteRecord {
  email: string;
  invitedByEmail: string;
  invitedAt: string;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export class AccessStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Whether this identity may in. Revoked invites do not count.
   *
   * The normalisation is not a convenience: an invite issued to
   * `Chris@Example.com` and a sign-in as `chris@example.com` are the same
   * person, and a lookup that misses turns a granted invite into a locked
   * door with no error anybody can act on.
   */
  async isInvited(identity: string): Promise<boolean> {
    const email = normaliseEmail(identity);
    if (email === null) return false;
    const row = await this.#db
      .prepare(
        `SELECT 1 FROM access_invites
          WHERE email = ?1 AND revoked_at IS NULL`,
      )
      .bind(email)
      .first();
    return row !== null;
  }

  /**
   * Add an invite, or return the one that already exists.
   *
   * `ON CONFLICT DO NOTHING` rather than an upsert: re-inviting somebody must
   * not reset who invited them or when, and must not un-revoke a withdrawn
   * invite silently. Reinstating one is `reinstate` below, which says so.
   */
  async invite(rawEmail: string, byEmail: string): Promise<boolean> {
    const email = normaliseEmail(rawEmail);
    if (email === null) return false;
    const result = await this.#db
      .prepare(
        `INSERT INTO access_invites
           (email, invited_by_email, invited_at, redeemed_by_user_id,
            redeemed_at, revoked_at)
         VALUES (?1, ?2, ?3, NULL, NULL, NULL)
         ON CONFLICT(email) DO NOTHING`,
      )
      .bind(email, byEmail.trim().toLowerCase(), new Date().toISOString())
      .run();
    return result.meta.changes > 0;
  }

  /** Withdraw an invite, keeping the row so the record stays readable. */
  async revoke(rawEmail: string, at: string): Promise<boolean> {
    const email = normaliseEmail(rawEmail);
    if (email === null) return false;
    const result = await this.#db
      .prepare(
        `UPDATE access_invites SET revoked_at = ?2
          WHERE email = ?1 AND revoked_at IS NULL`,
      )
      .bind(email, at)
      .run();
    return result.meta.changes > 0;
  }

  /** Put a withdrawn invite back, which is a separate act from issuing one. */
  async reinstate(rawEmail: string): Promise<boolean> {
    const email = normaliseEmail(rawEmail);
    if (email === null) return false;
    const result = await this.#db
      .prepare(
        `UPDATE access_invites SET revoked_at = NULL
          WHERE email = ?1 AND revoked_at IS NOT NULL`,
      )
      .bind(email)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Record that this invite has been used, the first time it is used.
   *
   * `WHERE redeemed_at IS NULL` keeps the first sign-in rather than the
   * latest, which is the fact worth having: when somebody actually took the
   * invite up. It is written on a normal request path, so it must never fail
   * one; the caller treats it as bookkeeping.
   */
  async redeem(identity: string, userId: string): Promise<void> {
    const email = normaliseEmail(identity);
    if (email === null) return;
    await this.#db
      .prepare(
        `UPDATE access_invites
            SET redeemed_by_user_id = ?2, redeemed_at = ?3
          WHERE email = ?1 AND redeemed_at IS NULL`,
      )
      .bind(email, userId, new Date().toISOString())
      .run();
  }

  /** The list an operator reads: never-used invites first, oldest first. */
  async list(limit = 200): Promise<InviteRecord[]> {
    const result = await this.#db
      .prepare(
        `SELECT email, invited_by_email, invited_at, redeemed_by_user_id,
                redeemed_at, revoked_at
           FROM access_invites
          ORDER BY redeemed_at IS NOT NULL, invited_at
          LIMIT ?1`,
      )
      .bind(limit)
      .all<{
        email: string;
        invited_by_email: string;
        invited_at: string;
        redeemed_by_user_id: string | null;
        redeemed_at: string | null;
        revoked_at: string | null;
      }>();
    return (result.results ?? []).map((row) => ({
      email: row.email,
      invitedByEmail: row.invited_by_email,
      invitedAt: row.invited_at,
      redeemedByUserId: row.redeemed_by_user_id,
      redeemedAt: row.redeemed_at,
      revokedAt: row.revoked_at,
    }));
  }
}
