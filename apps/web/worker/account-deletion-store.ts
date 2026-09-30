/**
 * The D1 half of account deletion (docs/decisions.md L32,
 * `0031_account_deletions.sql`).
 *
 * Every statement the request, the refusal, the retries and the purge make
 * lives here, so what is deleted and what is kept is one list somebody can
 * read rather than a set of queries spread across the files that own each
 * table. `account-deletion.ts` decides when; this decides what.
 *
 * One list is borrowed rather than written here: the rows a single project
 * is made of (`PROJECT_ROW_DELETIONS`), which deleting a project from the
 * builder uses too. The purge deleting every project and the builder
 * deleting one are the same statements, and a table added to a project
 * later is added to both by being added once.
 */

import { PROJECT_ROW_DELETIONS } from './project-store.ts';

/** L32: project content is purged 30 days after the request. */
export const PURGE_AFTER_DAYS = 30;

/** L32: the audit record is kept 12 months, with the user id tombstoned. */
export const AUDIT_KEPT_MONTHS = 12;

/**
 * Failed attempts after which a request is tried once a week rather than
 * every night.
 *
 * A request that keeps failing is one a person has to look at (the operator
 * panel lists it with its last error), and trying it nightly for ever would
 * hold a share of the nightly allowance for nothing. A week still retries
 * it, so something that clears on its own is still finished.
 */
export const BACKOFF_AFTER_ATTEMPTS = 7;

/** How long a request past `BACKOFF_AFTER_ATTEMPTS` waits between tries. */
export const BACKOFF_DAYS = 7;

/**
 * What happens the moment somebody asks, each retried until it has.
 *
 * The order is the order they are attempted in. Money first, because a
 * subscription that goes on charging a deleted account is the harm a person
 * notices; then what is running and what is public; then the grants.
 */
export const IMMEDIATE_STEPS = [
  'subscription',
  'preview',
  'sites',
  'github',
  'referrals',
] as const;

export type ImmediateStep = (typeof IMMEDIATE_STEPS)[number];

export interface DeletionRecord {
  userId: string;
  tombstone: string;
  requestedAt: string;
  purgeAfter: string;
  cancelledAt: string | null;
  /** When each immediate step was established as done, or null. */
  done: Record<ImmediateStep, string | null>;
  lastError: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  purgeStep: number;
  purgedAt: string | null;
  forgetAfter: string | null;
}

interface DeletionRow {
  user_id: string;
  tombstone: string;
  requested_at: string;
  purge_after: string;
  cancelled_at: string | null;
  subscription_done_at: string | null;
  preview_done_at: string | null;
  sites_done_at: string | null;
  github_done_at: string | null;
  referrals_done_at: string | null;
  last_error: string | null;
  attempts: number;
  last_attempt_at: string | null;
  purge_step: number;
  purged_at: string | null;
  forget_after: string | null;
}

function recordOf(row: DeletionRow): DeletionRecord {
  return {
    userId: row.user_id,
    tombstone: row.tombstone,
    requestedAt: row.requested_at,
    purgeAfter: row.purge_after,
    cancelledAt: row.cancelled_at,
    done: {
      subscription: row.subscription_done_at,
      preview: row.preview_done_at,
      sites: row.sites_done_at,
      github: row.github_done_at,
      referrals: row.referrals_done_at,
    },
    lastError: row.last_error,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    purgeStep: row.purge_step,
    purgedAt: row.purged_at,
    forgetAfter: row.forget_after,
  };
}

/** The column each step's completion is written to. Never from input. */
const DONE_COLUMN: Record<ImmediateStep, string> = {
  subscription: 'subscription_done_at',
  preview: 'preview_done_at',
  sites: 'sites_done_at',
  github: 'github_done_at',
  referrals: 'referrals_done_at',
};

/** Whether every immediate step has been established as done. */
export function immediateStepsDone(record: DeletionRecord): boolean {
  return IMMEDIATE_STEPS.every((step) => record.done[step] !== null);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Calendar months rather than a fixed number of days, as L32 says "12 months". */
export function addMonths(iso: string, months: number): string {
  const at = new Date(iso);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.toISOString();
}

/** One pending deletion as the operator's panel shows it. */
export interface PendingDeletion {
  userId: string;
  requestedAt: string;
  purgeAfter: string;
  done: Record<ImmediateStep, string | null>;
  lastError: string | null;
  attempts: number;
  purgeStep: number;
  /**
   * A site of this account's that is still serving, which the nightly pass
   * will not take down on its own (see `account-deletion.ts`) and which
   * blocks the purge until somebody does.
   */
  liveSlug: string | null;
}

/** What one night's lookup found. */
export interface DeletionWork {
  /** Requests with a step to retry or a purge that is due. */
  records: DeletionRecord[];
  /** Tombstones of audit records whose 12 months are up. */
  expired: string[];
}

export class AccountDeletionStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Record that this account asked to be deleted, and return the request.
   *
   * Asking twice is the same request, not a second one: the date the person
   * was promised is the first one, so a retry cannot push the purge back.
   * The only thing that starts it again is a request that had been
   * cancelled, which is a new decision and gets a new date and a new
   * tombstone.
   */
  async request(
    userId: string,
    now: string,
    tombstone: string,
  ): Promise<DeletionRecord> {
    await this.#db
      .prepare(
        `INSERT INTO account_deletions (
           user_id, tombstone, requested_at, purge_after, attempts, purge_step
         ) VALUES (?1, ?2, ?3, ?4, 0, 0)
         ON CONFLICT(user_id) DO UPDATE SET
           tombstone = excluded.tombstone,
           requested_at = excluded.requested_at,
           purge_after = excluded.purge_after,
           cancelled_at = NULL,
           subscription_done_at = NULL,
           preview_done_at = NULL,
           sites_done_at = NULL,
           github_done_at = NULL,
           referrals_done_at = NULL,
           last_error = NULL,
           attempts = 0,
           last_attempt_at = NULL,
           purge_step = 0
         WHERE account_deletions.cancelled_at IS NOT NULL`,
      )
      .bind(userId, tombstone, now, addDays(now, PURGE_AFTER_DAYS))
      .run();
    const record = await this.find(userId);
    if (!record) throw new Error('The deletion request was not recorded.');
    return record;
  }

  /** The request as stored, whatever state it is in. */
  async find(userId: string): Promise<DeletionRecord | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM account_deletions WHERE user_id = ?1`)
      .bind(userId)
      .first<DeletionRow>();
    return row ? recordOf(row) : null;
  }

  /**
   * The request that stops this account using the product, if there is one.
   *
   * One read on the primary key, because it runs on every authenticated
   * request (`principal.ts`).
   */
  async pending(
    userId: string,
  ): Promise<{ requestedAt: string; purgeAfter: string } | null> {
    const row = await this.#db
      .prepare(
        `SELECT requested_at, purge_after FROM account_deletions
          WHERE user_id = ?1 AND cancelled_at IS NULL AND purged_at IS NULL`,
      )
      .bind(userId)
      .first<{ requested_at: string; purge_after: string }>();
    return row
      ? { requestedAt: row.requested_at, purgeAfter: row.purge_after }
      : null;
  }

  /**
   * Keep the account after all.
   *
   * Only while the purge has not started. Once one step of it has run,
   * something is already gone for good, and handing the account back
   * without it would be a worse surprise than finishing.
   */
  async cancel(userId: string, now: string): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE account_deletions SET cancelled_at = ?2
          WHERE user_id = ?1 AND cancelled_at IS NULL
            AND purged_at IS NULL AND purge_step = 0`,
      )
      .bind(userId, now)
      .run();
    return result.meta.changes > 0;
  }

  /**
   * Record one attempt at the immediate steps: which of them are now done,
   * and what failed.
   *
   * One statement for the whole attempt, so a pass that has a query
   * allowance to keep pays for it once. `COALESCE` keeps the first time a
   * step was done rather than moving it on every retry, and never clears a
   * step that is done: a later attempt that fails at something else says
   * nothing about the steps that already happened.
   *
   * `attempts` counts failures only. It is what the backoff reads, and an
   * attempt that finished everything is not a reason to wait longer.
   */
  async recordAttempt(
    userId: string,
    done: readonly ImmediateStep[],
    error: string | null,
    now: string,
  ): Promise<void> {
    const sets = IMMEDIATE_STEPS.map((step) =>
      done.includes(step)
        ? `${DONE_COLUMN[step]} = COALESCE(${DONE_COLUMN[step]}, ?2)`
        : null,
    ).filter((set): set is string => set !== null);
    await this.#db
      .prepare(
        `UPDATE account_deletions SET
           ${[
             ...sets,
             'last_error = ?3',
             'attempts = attempts + (CASE WHEN ?3 IS NULL THEN 0 ELSE 1 END)',
             'last_attempt_at = ?2',
           ].join(',\n           ')}
         WHERE user_id = ?1 AND cancelled_at IS NULL AND purged_at IS NULL`,
      )
      .bind(userId, now, error)
      .run();
  }

  /**
   * Tonight's deletion work, in one query: requests with an immediate step
   * still undone or a purge that is due, least recently tried first, and
   * after them the audit records whose 12 months are up.
   *
   * One query rather than two, because it is paid every night whether or
   * not there is anything to do, and the nightly allowance is small enough
   * on Workers Free that a second fixed query is a real cost (internal issue 176).
   *
   * A request whose steps are all done and whose 30 days are not up has
   * nothing to do and is not returned, so waiting out the period costs the
   * nightly pass nothing. A request that has failed
   * `BACKOFF_AFTER_ATTEMPTS` times is returned once a week.
   */
  async work(now: string, limit: number): Promise<DeletionWork> {
    const result = await this.#db
      .prepare(
        `SELECT * FROM account_deletions
          WHERE (purged_at IS NULL AND cancelled_at IS NULL
                 AND (subscription_done_at IS NULL OR preview_done_at IS NULL
                      OR sites_done_at IS NULL OR github_done_at IS NULL
                      OR referrals_done_at IS NULL OR purge_after <= ?1)
                 AND (attempts < ?3 OR last_attempt_at IS NULL
                      OR last_attempt_at <= ?4))
             OR (purged_at IS NOT NULL AND forget_after <= ?1)
          ORDER BY purged_at IS NOT NULL, last_attempt_at IS NOT NULL,
                   last_attempt_at, requested_at
          LIMIT ?2`,
      )
      .bind(now, limit, BACKOFF_AFTER_ATTEMPTS, addDays(now, -BACKOFF_DAYS))
      .all<DeletionRow>();
    const rows = (result.results ?? []).map(recordOf);
    return {
      records: rows.filter((record) => record.purgedAt === null),
      expired: rows
        .filter((record) => record.purgedAt !== null)
        .map((record) => record.userId),
    };
  }

  /** The operator's view: every request not yet purged or cancelled. */
  async listPending(limit: number): Promise<PendingDeletion[]> {
    const result = await this.#db
      .prepare(
        `SELECT d.*, (
            SELECT p.slug FROM published_projects AS p
             WHERE p.user_id = d.user_id AND p.unpublished_at IS NULL
               AND p.held_at IS NULL AND p.generation IS NOT NULL
             LIMIT 1) AS live_slug
           FROM account_deletions AS d
          WHERE d.purged_at IS NULL AND d.cancelled_at IS NULL
          ORDER BY d.purge_after
          LIMIT ?1`,
      )
      .bind(limit)
      .all<DeletionRow & { live_slug: string | null }>();
    return (result.results ?? []).map((row) => {
      const record = recordOf(row);
      return {
        userId: record.userId,
        requestedAt: record.requestedAt,
        purgeAfter: record.purgeAfter,
        done: record.done,
        lastError: record.lastError,
        attempts: record.attempts,
        purgeStep: record.purgeStep,
        liveSlug: row.live_slug,
      };
    });
  }

  /** How many purged accounts are still inside their 12 months of audit record. */
  async purgedCount(): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS n FROM account_deletions WHERE purged_at IS NOT NULL`,
      )
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  // ---------------------------------------------------------------------
  // The immediate steps that are D1 alone.
  // ---------------------------------------------------------------------

  /**
   * The share links this account's projects have on (`0034_project_share.
   * sql`), for stopping the live previews they started. The links stopped
   * serving the moment the request was recorded; this is only for the
   * sandboxes a viewer may still be watching.
   */
  async shareTokens(userId: string): Promise<string[]> {
    const result = await this.#db
      .prepare(
        `SELECT share_token FROM projects
          WHERE user_id = ?1 AND share_token IS NOT NULL`,
      )
      .bind(userId)
      .all<{ share_token: string }>();
    return (result.results ?? []).map((row) => row.share_token);
  }

  /**
   * Whether this account still has a site anybody can reach: any of them,
   * since an account has one per project it published.
   *
   * The same reading of a row `publish-store.ts`'s `stateOf` makes: held is
   * not serving, no revision is not serving, and a takedown is not serving.
   */
  async liveSite(userId: string): Promise<string | null> {
    const row = await this.#db
      .prepare(
        `SELECT slug FROM published_projects
          WHERE user_id = ?1 AND unpublished_at IS NULL
            AND held_at IS NULL AND generation IS NOT NULL
          LIMIT 1`,
      )
      .bind(userId)
      .first<{ slug: string }>();
    return row?.slug ?? null;
  }

  /**
   * Stop every referral reward this account has not yet been paid, on
   * either side, and stop its code from recording new ones.
   *
   * Through `reversed_at`, which is the mark `decidePayout` already refuses
   * and `markPaid` already checks inside its own write, so a payout racing
   * this cannot land after it. Paid rows are left exactly as they are: they
   * are the payout ledger, and the purge keeps them.
   *
   * Both sides, because one row holds both: a referral whose other party is
   * still a customer loses that party's pending reward too. That is the
   * cost of the reward being one row, and an operator can grant it by hand
   * (`/api/admin/topup`); paying out to an account that asked to be deleted
   * is not something that can be taken back.
   *
   * The code is deleted here rather than at the purge, because a code that
   * still resolved for 30 days would record new attributions to an account
   * that can never be paid, and those would arrive after this ran.
   */
  async cancelReferralPayouts(userId: string, now: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE referral_attributions SET reversed_at = COALESCE(reversed_at, ?2)
          WHERE (referred_user_id = ?1 OR referrer_user_id = ?1)
            AND paid_at IS NULL`,
      )
      .bind(userId, now)
      .run();
    await this.#db
      .prepare(`DELETE FROM referral_codes WHERE user_id = ?1`)
      .bind(userId)
      .run();
  }

  // ---------------------------------------------------------------------
  // The purge.
  // ---------------------------------------------------------------------

  /** Save how far the purge has got. See `PURGE_STEPS`. */
  async advancePurge(userId: string, step: number): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE account_deletions SET purge_step = ?2
          WHERE user_id = ?1 AND purge_step < ?2`,
      )
      .bind(userId, step)
      .run();
  }

  /**
   * The next of this account's projects whose content has not been purged
   * yet, or null once there are none. One read; see the `snapshots` step in
   * `account-deletion.ts` for why the purge takes projects one at a time.
   */
  async nextProjectToPurge(userId: string): Promise<string | null> {
    const row = await this.#db
      .prepare(`SELECT id FROM projects WHERE user_id = ?1 ORDER BY id LIMIT 1`)
      .bind(userId)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  static readonly NEXT_PROJECT_QUERIES = 1;

  /**
   * One project's rows, once its stored content is gone: the same
   * statements deleting a single project from the builder makes
   * (`PROJECT_ROW_DELETIONS` in `project-store.ts`), so the two cannot come
   * to disagree about what a project is made of.
   */
  async deleteOneProject(projectId: string): Promise<void> {
    for (const sql of PROJECT_ROW_DELETIONS) {
      await this.#db.prepare(sql).bind(projectId).run();
    }
  }

  static readonly ONE_PROJECT_QUERIES = PROJECT_ROW_DELETIONS.length;

  /**
   * Project content (L32): the projects, their runs and their traces, and
   * the media library's rows. The bytes are R2's and go separately.
   *
   * Keyed two ways. A project made before an account could have several
   * has the account's user id as its own id, and a project made since has
   * a row in `projects` naming its owner. By the time this runs the
   * `snapshots` step has already deleted every owned project one by one,
   * so the subqueries find nothing in the ordinary case; they are here so
   * that a deployment with no R2 bucket, where that step has nothing to do
   * and returns at once, still leaves no row behind.
   */
  async deleteProjectRows(userId: string): Promise<void> {
    const owned = `SELECT id FROM projects WHERE user_id = ?1`;
    for (const sql of [
      `DELETE FROM generation_run_traces
        WHERE project_id = ?1 OR project_id IN (${owned})`,
      `DELETE FROM generation_stages
        WHERE project_id = ?1 OR project_id IN (${owned})`,
      `DELETE FROM generation_projects WHERE id = ?1 OR id IN (${owned})`,
      `DELETE FROM project_media WHERE user_id = ?1`,
      `DELETE FROM projects WHERE user_id = ?1`,
    ]) {
      await this.#db.prepare(sql).bind(userId).run();
    }
  }

  /** Statements `deleteProjectRows` makes, for the nightly allowance. */
  static readonly PROJECT_ROW_QUERIES = 5;

  /**
   * Everything else keyed to the person that is not kept: the GitHub
   * connection, every project's binding and the push history (repository
   * names are theirs), their referral code, the invite they redeemed, which
   * is keyed by their email address, and, behind Cloudflare Access, the row
   * that maps that address to their account (0040, D123).
   *
   * `github_bindings` is still deleted although nothing reads it since D72:
   * 0039 left it in place, and the repository names in it are as much this
   * person's as the ones copied out of it.
   *
   * And what an admin set for the account (docs/decisions.md D73): a gifted
   * plan, overrides of its limits, and a ban. None of them is money, and
   * none means anything once the account is gone; what was done, and by
   * whom, stays in the audit log, re-keyed with the credit records below.
   */
  async deleteAccountRows(userId: string): Promise<void> {
    for (const sql of [
      `DELETE FROM github_pushes WHERE user_id = ?1`,
      `DELETE FROM github_project_bindings WHERE user_id = ?1`,
      `DELETE FROM github_connections WHERE user_id = ?1`,
      `DELETE FROM github_bindings WHERE user_id = ?1`,
      `DELETE FROM referral_codes WHERE user_id = ?1`,
      `DELETE FROM access_invites WHERE redeemed_by_user_id = ?1`,
      `DELETE FROM access_accounts WHERE user_id = ?1`,
      `DELETE FROM plan_gifts WHERE user_id = ?1`,
      `DELETE FROM user_overrides WHERE user_id = ?1`,
      `DELETE FROM user_bans WHERE user_id = ?1`,
    ]) {
      await this.#db.prepare(sql).bind(userId).run();
    }
  }

  static readonly ACCOUNT_ROW_QUERIES = 10;

  /**
   * The published site's catalogue, for a site that is already down.
   *
   * Its revision rows go, which leaves any bytes the owner's takedown did not
   * finish removing with no row naming them, and apps/publish's own nightly
   * sweep (`sweepOrphans`) collects exactly that. So the published revisions
   * are removed by the service that owns their layout, not by this Worker
   * reaching into its prefix.
   *
   * A held site keeps its catalogue and bytes: an operator is keeping them
   * for review (internal issue 172), and deleting them from under the hold is the
   * operator's call, not a cron's. It is marked unpublished, though, so that
   * lifting the hold later leaves it down ("its owner had already taken it
   * down") rather than putting a deleted account's site back on the web.
   *
   * The slug row itself is kept and re-keyed to the tombstone. ADR-0010 never
   * releases a slug, because a name somebody linked to must not pass to the
   * next person who asks for it, and that holds after the owner is gone.
   */
  async retirePublishedSites(
    userId: string,
    tombstone: string,
    now: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM published_generations
          WHERE slug IN (SELECT slug FROM published_projects
                          WHERE user_id = ?1 AND held_at IS NULL
                            AND (unpublished_at IS NOT NULL
                                 OR generation IS NULL))`,
      )
      .bind(userId)
      .run();
    // `project_id` is unique, so each row gets the slug appended rather
    // than all of them the same tombstone.
    await this.#db
      .prepare(
        `UPDATE published_projects
            SET user_id = ?2, project_id = ?2 || ':' || slug,
                unpublished_at = COALESCE(unpublished_at, ?3)
          WHERE user_id = ?1`,
      )
      .bind(userId, tombstone, now)
      .run();
  }

  static readonly PUBLISHED_QUERIES = 2;

  /**
   * The rows kept for accounting, re-keyed from the person to the tombstone.
   *
   * Kept, because a payment, a refund, a subscription and a credit are
   * records an accountant or a tax authority can ask for, and a referral
   * payout is money this deployment paid out. Re-keyed, because none of
   * that needs to know who it was: the tombstone keeps one account's rows
   * together, and after 12 months nothing here maps it back (L32).
   *
   * None of these rows holds the person's email address. The Stripe
   * customer id stays on `billing_customers`, and Stripe keeps its own
   * records under it; that is the accounting record, and it is Stripe's.
   */
  async tombstoneBillingRows(userId: string, tombstone: string): Promise<void> {
    for (const table of KEPT_BILLING_TABLES) {
      await this.#db
        .prepare(`UPDATE ${table} SET user_id = ?2 WHERE user_id = ?1`)
        .bind(userId, tombstone)
        .run();
    }
  }

  /** One per kept billing table; `account-deletion.test.ts` holds the two equal. */
  static readonly BILLING_ROW_QUERIES = 9;

  /**
   * The rest of what is kept: credit grants (including referral payouts,
   * which are paid as credit), both sides of a referral, parked Stripe
   * payloads, and the admin audit log. A step of its own so that no one step of the purge costs more
   * than the smallest nightly share can buy.
   *
   * Two credit ids embed the user id (`referral:<side>:<user>` and the
   * signup grant's), so the id is rewritten too. That keeps a later
   * reversal working: it finds the grant by an id built from the
   * attribution's (now tombstoned) user id.
   *
   * A parked payload is Stripe's event as it arrived, and the only kept
   * place an email address can be: a Checkout Session carries
   * `customer_details`, an invoice `customer_email`, a charge
   * `billing_details` and `receipt_email`. Those are removed from every
   * parked event naming this account or its Stripe customer, and the user
   * id in it becomes the tombstone. Nothing that attributes an event reads
   * them (`billing-events.ts` goes by customer id and metadata), so the
   * retry still works on what is left. Runs after `tombstoneBillingRows`,
   * so the customer is found under the tombstone.
   */
  async tombstoneCreditRows(userId: string, tombstone: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE billing_admin_credits
            SET user_id = CASE WHEN user_id = ?1 THEN ?2 ELSE user_id END,
                id = replace(id, ?1, ?2)
          WHERE user_id = ?1 OR instr(id, ?1) > 0`,
      )
      .bind(userId, tombstone)
      .run();
    await this.#db
      .prepare(
        `UPDATE referral_attributions SET referred_user_id = ?2
          WHERE referred_user_id = ?1`,
      )
      .bind(userId, tombstone)
      .run();
    await this.#db
      .prepare(
        `UPDATE referral_attributions SET referrer_user_id = ?2
          WHERE referrer_user_id = ?1`,
      )
      .bind(userId, tombstone)
      .run();
    await this.#db
      .prepare(
        `UPDATE billing_unattributed_events
            SET payload = json_remove(
                  replace(payload, ?1, ?2),
                  '$.data.object.customer_email',
                  '$.data.object.customer_details',
                  '$.data.object.billing_details',
                  '$.data.object.receipt_email',
                  '$.data.object.email')
          WHERE instr(payload, ?1) > 0
             OR instr(payload, (SELECT stripe_customer_id
                                  FROM billing_customers
                                 WHERE user_id = ?2)) > 0`,
      )
      .bind(userId, tombstone)
      .run();
    // The admin audit log (D73) is kept, like the credit an admin granted:
    // it is the record of what was done to an account, and it stays after
    // the account. The one column it lets change is this one, so it keeps
    // what was done without keeping whose account it was.
    await this.#db
      .prepare(
        `UPDATE admin_audit_log SET target_user_id = ?2
          WHERE target_user_id = ?1`,
      )
      .bind(userId, tombstone)
      .run();
  }

  static readonly CREDIT_ROW_QUERIES = 5;

  /**
   * The last step: the request itself becomes the audit record L32 keeps,
   * under the tombstone, until `forget_after`.
   */
  async finishPurge(
    userId: string,
    tombstone: string,
    now: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE account_deletions
            SET user_id = ?2, purged_at = ?3, forget_after = ?4,
                last_error = NULL
          WHERE user_id = ?1 AND purged_at IS NULL`,
      )
      .bind(userId, tombstone, now, addMonths(now, AUDIT_KEPT_MONTHS))
      .run();
  }

  /** Record why the purge could not go on tonight. */
  async recordPurgeBlocked(
    userId: string,
    error: string,
    now: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE account_deletions
            SET last_error = ?2, attempts = attempts + 1, last_attempt_at = ?3
          WHERE user_id = ?1 AND purged_at IS NULL`,
      )
      .bind(userId, error, now)
      .run();
  }

  /**
   * Delete audit records whose 12 months are up (L32), as `work` found
   * them. Checked again in the statement, so a tombstone that is somehow
   * not one cannot delete a live request.
   */
  async forget(tombstones: readonly string[], now: string): Promise<number> {
    if (tombstones.length === 0) return 0;
    const marks = tombstones.map((_, index) => `?${index + 2}`).join(', ');
    const result = await this.#db
      .prepare(
        `DELETE FROM account_deletions
          WHERE purged_at IS NOT NULL AND forget_after <= ?1
            AND user_id IN (${marks})`,
      )
      .bind(now, ...tombstones)
      .run();
    return result.meta.changes;
  }
}

/**
 * The billing tables whose rows are kept under the tombstone.
 *
 * Every table that holds a `user_id` and records money or the entitlement
 * money bought. A new billing table keyed by user has to be added here, or
 * a purged account's rows in it keep the Clerk id for ever;
 * `account-deletion-store.test.ts` fails on any `user_id` column in the
 * schema that neither this list nor the purge's deletions account for.
 */
export const KEPT_BILLING_TABLES = [
  'billing_customers',
  'billing_subscriptions',
  'billing_topups',
  'billing_payments',
  'billing_scheduled_cancellations',
  'billing_signup_offers',
  'billing_signup_cards',
  // The referral barrier's "a purchase started" fact. Kept with the rest of
  // the billing record rather than deleted: it is about money, and like
  // them it no longer names anyone once re-keyed.
  'billing_purchase_starts',
  // What refunds and lost disputes removed, and any suspension (with who
  // lifted it). A record of money going back out, kept like the payment it
  // reverses.
  'billing_clawbacks',
] as const;
