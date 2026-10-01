/**
 * The D1 half of the admin controls over one account (docs/decisions.md
 * D73, `0038_admin_controls.sql`): gifted plans, overrides, bans, and the
 * audit log every admin action is written to.
 *
 * Each change and its audit row are written in one batch, so a change
 * cannot land without its record or a record without its change. The
 * exceptions are the admin actions that predate this file (a credit grant,
 * a suspension lift, a site hold), whose own stores write the change; the
 * route appends their row once the change has landed (`admin-users.ts`,
 * `withAudit`).
 *
 * Nothing here reads or writes project content or a prompt. A project's
 * name is read for the user page, which shows it; it is never written to
 * the log.
 */

import type { PlanGift, Tier, UserOverrides } from './entitlement.ts';

/** Every action the audit log records, by the name it is stored under. */
export const AUDIT_ACTIONS = [
  'gift',
  'gift-revoke',
  'ban',
  'unban',
  'delete',
  'overrides',
  'topup',
  'suspension-lift',
  'site-hold',
  'site-release',
  'share-hold',
  'share-release',
  // Importing Clerk's directory into the account list (D128).
  'accounts-import',
  // Stopping an account's running builds from its page (D128).
  'stop-builds',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  at: string;
  /** The admin's Clerk-verified email, the identity the admin list names. */
  adminEmail: string;
  action: AuditAction;
  targetUserId: string | null;
  /** A slug or a project, when the action named one. Never an email or a token. */
  target: string | null;
  reason: string | null;
  /** Facts about the action: a tier, an amount, a date. Never content. */
  detail: Record<string, unknown> | null;
}

export interface AuditRecord extends AuditEntry {
  id: number;
}

export interface GiftRecord extends PlanGift {
  id: string;
  userId: string;
  grantedBy: string;
  reason: string | null;
  createdAt: string;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface BanRecord {
  userId: string;
  bannedAt: string;
  bannedBy: string;
  reason: string;
  liftedAt: string | null;
  liftedBy: string | null;
  liftReason: string | null;
}

export interface OverrideRecord extends UserOverrides {
  updatedBy: string;
  updatedAt: string;
}

/** One project as the admin user page shows it. */
export interface AdminProjectView {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
  site: { slug: string; state: 'live' | 'down' | 'held' } | null;
}

/** One run as the admin user page shows it: metadata only (D20). */
export interface AdminRunView {
  runId: string;
  projectId: string;
  projectName: string;
  /** The run's stage state: planning, accepted, failed, cancelled, ... */
  state: string;
  startedAt: string;
  /** The trace's `RunStop`, where the run wrote one. */
  stop: string | null;
  model: string | null;
  costMicroUsd: number | null;
  elapsedMs: number | null;
  endedAt: string | null;
}

/** One calendar month (UTC) of model spend, as the admin user page shows it. */
export interface AdminMonthSpend {
  /** YYYY-MM. */
  month: string;
  costMicroUsd: number;
  runs: number;
}

/**
 * The account's GitHub sign-in and the repositories its projects push to.
 * Names and dates only: never a token.
 */
export interface AdminGitHubView {
  connection: {
    login: string | null;
    connectedAt: string;
    revokedAt: string | null;
  } | null;
  repositories: {
    projectId: string;
    projectName: string | null;
    owner: string;
    repo: string;
    defaultBranch: string;
    grantedAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }[];
}

/** A build that has not ended, as the admin user page shows it. */
export interface AdminUnendedRun {
  runId: string;
  projectId: string;
  projectName: string;
  state: string;
  startedAt: string;
}

interface GiftRow {
  id: string;
  user_id: string;
  tier: string;
  ends_at: string | null;
  granted_by: string;
  reason: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

interface AuditRow {
  id: number;
  at: string;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  target: string | null;
  reason: string | null;
  detail: string | null;
}

function giftOf(row: GiftRow): GiftRecord | null {
  // The table's CHECK already holds this; read defensively anyway, because
  // a tier this code does not know must never become a plan it grants.
  if (row.tier !== 'build' && row.tier !== 'ship') return null;
  return {
    id: row.id,
    userId: row.user_id,
    tier: row.tier,
    endsAt: row.ends_at,
    grantedBy: row.granted_by,
    reason: row.reason,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revokeReason: row.revoke_reason,
  };
}

function detailOf(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function auditOf(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    at: row.at,
    adminEmail: row.admin_email,
    action: row.action as AuditAction,
    targetUserId: row.target_user_id,
    target: row.target,
    reason: row.reason,
    detail: detailOf(row.detail),
  };
}

const AUDIT_COLUMNS = `INSERT INTO admin_audit_log
  (at, admin_email, action, target_user_id, target, reason, detail)`;

const INSERT_AUDIT = `${AUDIT_COLUMNS} VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`;

function auditValues(entry: AuditEntry): unknown[] {
  return [
    entry.at,
    entry.adminEmail,
    entry.action,
    entry.targetUserId,
    entry.target,
    entry.reason,
    entry.detail === null ? null : JSON.stringify(entry.detail),
  ];
}

/** A clamp on list reads, so a query string cannot ask for the whole table. */
function boundedLimit(limit: number, most: number): number {
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, most) : most;
}

export class AdminStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  #audit(entry: AuditEntry): D1PreparedStatement {
    return this.#db.prepare(INSERT_AUDIT).bind(...auditValues(entry));
  }

  // -----------------------------------------------------------------------
  // The audit log.
  // -----------------------------------------------------------------------

  /** Append one row. There is no method that changes or removes one. */
  async append(entry: AuditEntry): Promise<void> {
    await this.#audit(entry).run();
  }

  /** The rows about one account, newest first. */
  async auditFor(userId: string, limit = 100): Promise<AuditRecord[]> {
    const result = await this.#db
      .prepare(
        `SELECT * FROM admin_audit_log WHERE target_user_id = ?1
          ORDER BY id DESC LIMIT ?2`,
      )
      .bind(userId, boundedLimit(limit, 200))
      .all<AuditRow>();
    return (result.results ?? []).map(auditOf);
  }

  /** The most recent rows across every account, newest first. */
  async recentAudit(limit = 50): Promise<AuditRecord[]> {
    const result = await this.#db
      .prepare(`SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ?1`)
      .bind(boundedLimit(limit, 200))
      .all<AuditRow>();
    return (result.results ?? []).map(auditOf);
  }

  // -----------------------------------------------------------------------
  // Gifted plans.
  // -----------------------------------------------------------------------

  /**
   * The gift not yet revoked, if there is one, whether or not its end date
   * has passed: `giftInForce` in `entitlement.ts` decides that, so the
   * clock is read in one place. At most one is unrevoked, because giving a
   * new one revokes the last.
   *
   * On the path of every request that asks for a tier, so one read on an
   * index.
   */
  async currentGift(userId: string): Promise<GiftRecord | null> {
    const row = await this.#db
      .prepare(
        `SELECT * FROM plan_gifts WHERE user_id = ?1 AND revoked_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .bind(userId)
      .first<GiftRow>();
    return row ? giftOf(row) : null;
  }

  /** Every gift this account has had, newest first. */
  async gifts(userId: string): Promise<GiftRecord[]> {
    const result = await this.#db
      .prepare(
        `SELECT * FROM plan_gifts WHERE user_id = ?1
          ORDER BY created_at DESC, id DESC LIMIT 50`,
      )
      .bind(userId)
      .all<GiftRow>();
    return (result.results ?? [])
      .map(giftOf)
      .filter((gift): gift is GiftRecord => gift !== null);
  }

  /**
   * Give a plan. Any gift still unrevoked is revoked in the same batch, so
   * there is never more than one to reason about and a new end date
   * replaces the old rather than racing it.
   */
  async giveGift(
    gift: {
      id: string;
      userId: string;
      tier: Exclude<Tier, 'free'>;
      endsAt: string | null;
      by: string;
      reason: string | null;
      now: string;
    },
    audit: AuditEntry,
  ): Promise<void> {
    await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE plan_gifts
              SET revoked_at = ?2, revoked_by = ?3,
                  revoke_reason = 'Replaced by a new gift.'
            WHERE user_id = ?1 AND revoked_at IS NULL`,
        )
        .bind(gift.userId, gift.now, gift.by),
      this.#db
        .prepare(
          `INSERT INTO plan_gifts
             (id, user_id, tier, ends_at, granted_by, reason, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          gift.id,
          gift.userId,
          gift.tier,
          gift.endsAt,
          gift.by,
          gift.reason,
          gift.now,
        ),
      this.#audit(audit),
    ]);
  }

  /**
   * Take a gift back. False when there was none to revoke, in which case
   * nothing is written, the audit row included: the row is inserted only
   * where a gift stands, before the statement that revokes it.
   */
  async revokeGift(
    userId: string,
    by: string,
    reason: string | null,
    now: string,
    audit: AuditEntry,
  ): Promise<boolean> {
    const [, revoked] = await this.#db.batch([
      this.#db
        .prepare(
          `${AUDIT_COLUMNS}
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
            WHERE EXISTS (SELECT 1 FROM plan_gifts
                           WHERE user_id = ?8 AND revoked_at IS NULL)`,
        )
        .bind(...auditValues(audit), userId),
      this.#db
        .prepare(
          `UPDATE plan_gifts
              SET revoked_at = ?2, revoked_by = ?3, revoke_reason = ?4
            WHERE user_id = ?1 AND revoked_at IS NULL`,
        )
        .bind(userId, now, by, reason),
    ]);
    return (revoked?.meta.changes ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // Overrides.
  // -----------------------------------------------------------------------

  async overrides(userId: string): Promise<OverrideRecord | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM user_overrides WHERE user_id = ?1`)
      .bind(userId)
      .first<{
        active_project_limit: number | null;
        monthly_spend_cap_micro_usd: number | null;
        updated_by: string;
        updated_at: string;
      }>();
    return row
      ? {
          activeProjectLimit: row.active_project_limit,
          monthlySpendCapMicroUsd: row.monthly_spend_cap_micro_usd,
          updatedBy: row.updated_by,
          updatedAt: row.updated_at,
        }
      : null;
  }

  /** Set both overrides at once. Null clears one back to the plan's. */
  async setOverrides(
    userId: string,
    overrides: UserOverrides,
    by: string,
    now: string,
    audit: AuditEntry,
  ): Promise<void> {
    await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO user_overrides
             (user_id, active_project_limit, monthly_spend_cap_micro_usd,
              updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(user_id) DO UPDATE SET
             active_project_limit = excluded.active_project_limit,
             monthly_spend_cap_micro_usd = excluded.monthly_spend_cap_micro_usd,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .bind(
          userId,
          overrides.activeProjectLimit,
          overrides.monthlySpendCapMicroUsd,
          by,
          now,
        ),
      this.#audit(audit),
    ]);
  }

  // -----------------------------------------------------------------------
  // Bans.
  // -----------------------------------------------------------------------

  async ban(userId: string): Promise<BanRecord | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM user_bans WHERE user_id = ?1`)
      .bind(userId)
      .first<{
        user_id: string;
        banned_at: string;
        banned_by: string;
        reason: string;
        lifted_at: string | null;
        lifted_by: string | null;
        lift_reason: string | null;
      }>();
    return row
      ? {
          userId: row.user_id,
          bannedAt: row.banned_at,
          bannedBy: row.banned_by,
          reason: row.reason,
          liftedAt: row.lifted_at,
          liftedBy: row.lifted_by,
          liftReason: row.lift_reason,
        }
      : null;
  }

  /**
   * Whether this account is banned now. One read on the primary key,
   * because it runs on every authenticated request (`principal.ts`).
   */
  async isBanned(userId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT 1 AS banned FROM user_bans
          WHERE user_id = ?1 AND lifted_at IS NULL`,
      )
      .bind(userId)
      .first<{ banned: number }>();
    return row !== null;
  }

  /**
   * Record a ban. Banning an account that is already banned replaces the
   * reason and keeps the original date, so the page says how long it has
   * been banned; the audit log keeps both reasons.
   */
  async recordBan(
    userId: string,
    by: string,
    reason: string,
    now: string,
    audit: AuditEntry,
  ): Promise<void> {
    await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO user_bans (user_id, banned_at, banned_by, reason)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(user_id) DO UPDATE SET
             banned_at = CASE WHEN user_bans.lifted_at IS NULL
                              THEN user_bans.banned_at
                              ELSE excluded.banned_at END,
             banned_by = excluded.banned_by,
             reason = excluded.reason,
             lifted_at = NULL, lifted_by = NULL, lift_reason = NULL`,
        )
        .bind(userId, now, by, reason),
      this.#audit(audit),
    ]);
  }

  /**
   * Lift a ban. False when there was none standing, and then nothing is
   * written, for the reason `revokeGift` gives.
   */
  async liftBan(
    userId: string,
    by: string,
    reason: string | null,
    now: string,
    audit: AuditEntry,
  ): Promise<boolean> {
    const [, lifted] = await this.#db.batch([
      this.#db
        .prepare(
          `${AUDIT_COLUMNS}
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
            WHERE EXISTS (SELECT 1 FROM user_bans
                           WHERE user_id = ?8 AND lifted_at IS NULL)`,
        )
        .bind(...auditValues(audit), userId),
      this.#db
        .prepare(
          `UPDATE user_bans SET lifted_at = ?2, lifted_by = ?3, lift_reason = ?4
            WHERE user_id = ?1 AND lifted_at IS NULL`,
        )
        .bind(userId, now, by, reason),
    ]);
    return (lifted?.meta.changes ?? 0) > 0;
  }

  // -----------------------------------------------------------------------
  // What an action acts on.
  // -----------------------------------------------------------------------

  /**
   * The slugs of this account's sites that are serving, for a ban to hold.
   * Read the way `liveSiteProjects` in `project-store.ts` reads them, so
   * "every live site" is the same set the account deletion takes down.
   */
  async liveSiteSlugs(userId: string): Promise<string[]> {
    const result = await this.#db
      .prepare(
        `SELECT slug FROM published_projects
          WHERE user_id = ?1 AND unpublished_at IS NULL
            AND held_at IS NULL AND generation IS NOT NULL
          ORDER BY slug`,
      )
      .bind(userId)
      .all<{ slug: string }>();
    return (result.results ?? []).map((row) => row.slug);
  }

  /** The account a slug belongs to, for the audit row of a hold. */
  async siteOwner(slug: string): Promise<string | null> {
    const row = await this.#db
      .prepare(`SELECT user_id FROM published_projects WHERE slug = ?1`)
      .bind(slug)
      .first<{ user_id: string }>();
    return row?.user_id ?? null;
  }

  /**
   * The project and account a share token belongs to, now or when it was
   * last held, for the audit row of a share hold. The token itself is
   * never written down.
   */
  async shareOwner(
    token: string,
  ): Promise<{ projectId: string; userId: string } | null> {
    const row = await this.#db
      .prepare(
        `SELECT p.id AS project_id, p.user_id FROM projects AS p
          WHERE p.share_token = ?1
            OR p.id = (SELECT h.project_id FROM project_share_holds AS h
                        WHERE h.share_token = ?1
                        ORDER BY h.id DESC LIMIT 1)
          LIMIT 1`,
      )
      .bind(token)
      .first<{ project_id: string; user_id: string }>();
    return row ? { projectId: row.project_id, userId: row.user_id } : null;
  }

  // -----------------------------------------------------------------------
  // The user page.
  // -----------------------------------------------------------------------

  /** Every project this account has, most recently changed first. */
  async projectsOf(userId: string): Promise<AdminProjectView[]> {
    const result = await this.#db
      .prepare(
        `SELECT p.id, p.name, p.archived_at,
                MAX(p.updated_at, COALESCE(g.updated_at, p.updated_at))
                  AS edited_at,
                s.slug, s.unpublished_at, s.held_at, s.generation
           FROM projects AS p
           LEFT JOIN generation_projects AS g ON g.id = p.id
           LEFT JOIN published_projects AS s ON s.project_id = p.id
          WHERE p.user_id = ?1
          ORDER BY edited_at DESC, p.id
          LIMIT 200`,
      )
      .bind(userId)
      .all<{
        id: string;
        name: string;
        archived_at: string | null;
        edited_at: string;
        slug: string | null;
        unpublished_at: string | null;
        held_at: string | null;
        generation: string | null;
      }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      archived: row.archived_at !== null,
      updatedAt: row.edited_at,
      // The same reading `siteOf` in `project-store.ts` makes.
      site:
        row.slug === null
          ? null
          : {
              slug: row.slug,
              state:
                row.held_at !== null
                  ? 'held'
                  : row.generation === null || row.unpublished_at !== null
                    ? 'down'
                    : 'live',
            },
    }));
  }

  /**
   * This account's most recent runs across its projects, with what each
   * ended as: the stage's state and, where the run wrote one, its trace's
   * stop. Top-level runs only; a repair or a check is part of the run it
   * belongs to.
   */
  async recentRuns(userId: string, limit = 20): Promise<AdminRunView[]> {
    const result = await this.#db
      .prepare(
        `SELECT s.run_id, s.project_id, p.name AS project_name, s.state,
                s.created_at, t.stop, t.model, t.cost_micro_usd,
                t.elapsed_ms, t.ended_at
           FROM generation_stages AS s
           JOIN projects AS p ON p.id = s.project_id
           LEFT JOIN generation_run_traces AS t ON t.run_id = s.run_id
          WHERE p.user_id = ?1 AND instr(s.run_id, ':') = 0
          ORDER BY s.created_at DESC, s.run_id
          LIMIT ?2`,
      )
      .bind(userId, boundedLimit(limit, 100))
      .all<{
        run_id: string;
        project_id: string;
        project_name: string;
        state: string;
        created_at: string;
        stop: string | null;
        model: string | null;
        cost_micro_usd: number | null;
        elapsed_ms: number | null;
        ended_at: string | null;
      }>();
    return (result.results ?? []).map((row) => ({
      runId: row.run_id,
      projectId: row.project_id,
      projectName: row.project_name,
      state: row.state,
      startedAt: row.created_at,
      stop: row.stop,
      model: row.model,
      costMicroUsd: row.cost_micro_usd,
      elapsedMs: row.elapsed_ms,
      endedAt: row.ended_at,
    }));
  }

  /**
   * Model spend by calendar month (UTC), newest first, for the months
   * from `since` on that had any. Counted the way the account list counts
   * it: the traces of the account's projects, and those written against
   * the account itself.
   */
  async spendByMonth(
    userId: string,
    since: string,
  ): Promise<AdminMonthSpend[]> {
    const result = await this.#db
      .prepare(
        `SELECT substr(t.ended_at, 1, 7) AS month,
                SUM(t.cost_micro_usd) AS cost, COUNT(*) AS runs
           FROM generation_run_traces AS t
          WHERE (t.project_id = ?1
                 OR t.project_id IN (SELECT id FROM projects WHERE user_id = ?1))
            AND t.ended_at >= ?2
          GROUP BY month
          ORDER BY month DESC`,
      )
      .bind(userId, since)
      .all<{ month: string; cost: number; runs: number }>();
    return (result.results ?? []).map((row) => ({
      month: row.month,
      costMicroUsd: row.cost,
      runs: row.runs,
    }));
  }

  /** The account's GitHub sign-in and every repository binding it has had. */
  async githubOf(userId: string): Promise<AdminGitHubView> {
    const [connection, bindings] = await Promise.all([
      this.#db
        .prepare(
          `SELECT login, connected_at, revoked_at FROM github_connections
            WHERE user_id = ?1`,
        )
        .bind(userId)
        .first<{
          login: string | null;
          connected_at: string;
          revoked_at: string | null;
        }>(),
      this.#db
        .prepare(
          `SELECT b.project_id, p.name AS project_name, b.owner, b.repo,
                  b.default_branch, b.granted_at, b.expires_at, b.revoked_at
             FROM github_project_bindings AS b
             LEFT JOIN projects AS p ON p.id = b.project_id
            WHERE b.user_id = ?1
            ORDER BY b.granted_at DESC, b.project_id
            LIMIT 200`,
        )
        .bind(userId)
        .all<{
          project_id: string;
          project_name: string | null;
          owner: string;
          repo: string;
          default_branch: string;
          granted_at: string;
          expires_at: string;
          revoked_at: string | null;
        }>(),
    ]);
    return {
      connection: connection
        ? {
            login: connection.login,
            connectedAt: connection.connected_at,
            revokedAt: connection.revoked_at,
          }
        : null,
      repositories: (bindings.results ?? []).map((row) => ({
        projectId: row.project_id,
        projectName: row.project_name,
        owner: row.owner,
        repo: row.repo,
        defaultBranch: row.default_branch,
        grantedAt: row.granted_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      })),
    };
  }

  /**
   * The builds the account has that have not ended: the runs "Stop builds"
   * would stop. The same reading `unendedRuns` in `project-store.ts` makes,
   * across every project, one row per run.
   */
  async unendedRunsOf(userId: string): Promise<AdminUnendedRun[]> {
    const result = await this.#db
      .prepare(
        `SELECT s.run_id, s.project_id, p.name AS project_name, s.state,
                s.created_at
           FROM generation_stages AS s
           JOIN projects AS p ON p.id = s.project_id
          WHERE p.user_id = ?1
            AND s.state NOT IN ('accepted', 'failed', 'cancelled', 'idle')
          ORDER BY s.created_at DESC, s.run_id
          LIMIT 200`,
      )
      .bind(userId)
      .all<{
        run_id: string;
        project_id: string;
        project_name: string;
        state: string;
        created_at: string;
      }>();
    const seen = new Set<string>();
    const runs: AdminUnendedRun[] = [];
    for (const row of result.results ?? []) {
      const runId = row.run_id.split(':')[0]!;
      if (seen.has(runId)) continue;
      seen.add(runId);
      runs.push({
        runId,
        projectId: row.project_id,
        projectName: row.project_name,
        state: row.state,
        startedAt: row.created_at,
      });
    }
    return runs;
  }
}
