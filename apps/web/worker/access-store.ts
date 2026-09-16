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
   * Take the invite for this account, and say whether it is now theirs.
   *
   * One statement, because two cannot settle this. Reading the row and then
   * writing the binding is a check followed by an act: two Clerk accounts
   * verified for the same address, arriving together, both read an
   * unclaimed row and both were admitted, after which one binding landed
   * and the other update changed nothing and was ignored. A single
   * conditional UPDATE is what SQLite's one writer serialises, so exactly
   * one of them comes back true.
   *
   * The condition is the rule: not revoked, and either unclaimed or already
   * this account's. An unclaimed invite goes to whoever arrives first, which
   * is what makes an invite usable; once taken it admits only that account,
   * because an address can be reassigned (a company mailbox handed on, a
   * domain that changes hands) and the invite was for the person.
   *
   * `COALESCE` keeps the first redemption time rather than overwriting it on
   * every later sign-in: the question it answers is when they first came in.
   *
   * The normalisation is not a convenience: an invite issued to
   * `Chris@Example.com` and a sign-in as `chris@example.com` are the same
   * person, and a lookup that misses turns a granted invite into a locked
   * door with no error anybody can act on.
   */
  async claimInvite(identity: string, userId: string): Promise<boolean> {
    const email = normaliseEmail(identity);
    if (email === null) return false;
    const result = await this.#db
      .prepare(
        `UPDATE access_invites
            SET redeemed_by_user_id = ?2,
                redeemed_at = COALESCE(redeemed_at, ?3)
          WHERE email = ?1
            AND revoked_at IS NULL
            AND (redeemed_by_user_id IS NULL OR redeemed_by_user_id = ?2)`,
      )
      .bind(email, userId, new Date().toISOString())
      .run();
    return result.meta.changes > 0;
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
