/**
 * The accounts a deployment knows (0041), for the platform admins' account
 * list (docs/decisions.md D128), and the directory behind a copy signed in
 * by Cloudflare Access (D123).
 *
 * One row per account: the address it signs in with, when it was first
 * seen and when last. Everything else an admin filters or sorts by is read
 * from the tables that already own it, in the same query, so the list never
 * disagrees with the account's own page: its plan from the subscription and
 * any gift in force (as `effectiveTier` decides it), a ban or a suspension
 * still open, its active projects, and what its runs cost.
 */

export type AccountPlan = 'free' | 'build' | 'ship';
export type AccountStatus = 'active' | 'banned' | 'suspended';
export type AccountSort = 'last_active' | 'signed_up' | 'spend' | 'email';

export interface AccountQuery {
  /** Part of an address, or a whole account id. */
  search?: string;
  plan?: AccountPlan;
  status?: AccountStatus;
  /** Signed up on or after this ISO date. */
  since?: string;
  sort?: AccountSort;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AccountRow {
  userId: string;
  email: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  plan: AccountPlan;
  /** True when a gift, not a subscription, is what gives the plan. */
  gifted: boolean;
  banned: boolean;
  suspended: boolean;
  activeProjects: number;
  /** What the account's runs have cost, in all and this calendar month. */
  spendMicroUsd: number;
  monthSpendMicroUsd: number;
}

export interface AccountPage {
  accounts: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const MAX_PAGE_SIZE = 100;
/** The most rows one export holds. */
export const MAX_EXPORT_ROWS = 5_000;
/** How stale `last_seen_at` may get before a visit writes it again. */
export const SEEN_RESOLUTION_MS = 60 * 60 * 1000;

/**
 * True of an id this table must not (re)create a row for: one whose purge
 * has begun or finished, or a purge's tombstone (0031). A started purge
 * cannot be cancelled, and its `account rows` step runs once; a row written
 * after it (an import while Clerk still lists the person, a sign-in before
 * the Clerk account goes) would outlive the deletion.
 */
const BEING_DELETED = `(
  EXISTS (SELECT 1 FROM account_deletions d
           WHERE d.user_id = ?1 AND d.cancelled_at IS NULL
             AND (d.purge_step > 0 OR d.purged_at IS NOT NULL))
  OR EXISTS (SELECT 1 FROM account_deletions d WHERE d.tombstone = ?1)
)`;

const SORT_COLUMNS: Record<AccountSort, string> = {
  last_active: 'last_seen_at',
  signed_up: 'first_seen_at',
  spend: 'spend_micro_usd',
  email: 'email',
};

function normaliseEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}

interface Row {
  user_id: string;
  email: string | null;
  first_seen_at: string;
  last_seen_at: string;
  plan: AccountPlan;
  gifted: number;
  banned: number;
  suspended: number;
  active_projects: number;
  spend_micro_usd: number;
  month_spend_micro_usd: number;
  total: number;
}

function toAccount(row: Row): AccountRow {
  return {
    userId: row.user_id,
    email: row.email,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    plan: row.plan,
    gifted: row.gifted === 1,
    banned: row.banned === 1,
    suspended: row.suspended === 1,
    activeProjects: row.active_projects,
    spendMicroUsd: row.spend_micro_usd,
    monthSpendMicroUsd: row.month_spend_micro_usd,
  };
}

/** The first instant of `at`'s calendar month, UTC, as ISO. */
export function monthStart(at: Date): string {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1),
  ).toISOString();
}

export class AccountsStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Note an account the builder let in. The address is kept current (a
   * person can change it at Clerk), and `last_seen_at` is written at most
   * once an hour, so a busy account is not a write per request.
   */
  async recordSeen(
    userId: string,
    rawEmail: string | null | undefined,
    at: Date,
  ): Promise<void> {
    const email = normaliseEmail(rawEmail);
    const now = at.toISOString();
    const stale = new Date(at.getTime() - SEEN_RESOLUTION_MS).toISOString();
    await this.#db
      .prepare(
        `INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
         SELECT ?1, ?2, ?3, ?3 WHERE NOT ${BEING_DELETED}
         ON CONFLICT (user_id) DO UPDATE
           SET email = COALESCE(excluded.email, accounts.email),
               last_seen_at = excluded.last_seen_at
           WHERE accounts.last_seen_at < ?4
              OR accounts.email IS NOT COALESCE(excluded.email, accounts.email)`,
      )
      .bind(userId, email, now, stale)
      .run();
  }

  /**
   * Accounts from a directory (Clerk's), for the people who have not been
   * back since this table existed. Never moves `last_seen_at` backwards or
   * `first_seen_at` forwards.
   */
  async importAccounts(
    accounts: {
      userId: string;
      email: string | null;
      createdAt: string;
      lastSignInAt: string | null;
    }[],
  ): Promise<number> {
    if (accounts.length === 0) return 0;
    await this.#db.batch(
      accounts.map((account) =>
        this.#db
          .prepare(
            `INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
             SELECT ?1, ?2, ?3, ?4 WHERE NOT ${BEING_DELETED}
             ON CONFLICT (user_id) DO UPDATE
               SET email = COALESCE(excluded.email, accounts.email),
                   first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
                   last_seen_at = MAX(accounts.last_seen_at, excluded.last_seen_at)`,
          )
          .bind(
            account.userId,
            normaliseEmail(account.email),
            account.createdAt,
            account.lastSignInAt ?? account.createdAt,
          ),
      ),
    );
    return accounts.length;
  }

  async userIdForEmail(rawEmail: string): Promise<string | null> {
    const email = normaliseEmail(rawEmail);
    if (email === null) return null;
    const row = await this.#db
      .prepare(
        `SELECT user_id FROM accounts WHERE email = ?1
         ORDER BY last_seen_at DESC LIMIT 1`,
      )
      .bind(email)
      .first<{ user_id: string }>();
    return row?.user_id ?? null;
  }

  async emailForUserId(userId: string): Promise<string | null> {
    const row = await this.#db
      .prepare(`SELECT email FROM accounts WHERE user_id = ?1`)
      .bind(userId)
      .first<{ email: string | null }>();
    return row?.email ?? null;
  }

  /** One page of accounts, filtered and sorted, with the matching total. */
  async list(query: AccountQuery, at: Date): Promise<AccountPage> {
    const pageSize = Math.min(
      Math.max(Math.trunc(query.pageSize ?? 50), 1),
      MAX_PAGE_SIZE,
    );
    const page = Math.max(Math.trunc(query.page ?? 1), 1);
    const rows = await this.#rows(query, at, pageSize, (page - 1) * pageSize);
    // A page past the last match has no row to carry the total, though
    // matches remain (the list shrank under an admin on its last page). The
    // total is then read on its own, so the page can offer the way back.
    const total =
      rows[0]?.total ??
      (page > 1 ? ((await this.#rows(query, at, 1, 0))[0]?.total ?? 0) : 0);
    return {
      accounts: rows.map(toAccount),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Every matching account, up to MAX_EXPORT_ROWS, for a CSV export, with
   * how many matched, so an export cut short can say so.
   */
  async exportRows(
    query: AccountQuery,
    at: Date,
  ): Promise<{ rows: AccountRow[]; total: number }> {
    const rows = await this.#rows(query, at, MAX_EXPORT_ROWS, 0);
    return { rows: rows.map(toAccount), total: rows[0]?.total ?? 0 };
  }

  async #rows(
    query: AccountQuery,
    at: Date,
    limit: number,
    offset: number,
  ): Promise<Row[]> {
    const where: string[] = [];
    const binds: unknown[] = [at.toISOString(), monthStart(at)];
    const bind = (value: unknown) => {
      binds.push(value);
      return `?${binds.length}`;
    };

    const search = query.search?.trim().toLowerCase();
    if (search) {
      // An id is matched whole; an address in part. LIKE's own wildcards in
      // what an admin typed are matched literally.
      const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        `(user_id = ${bind(query.search!.trim())} OR email LIKE ${bind(pattern)} ESCAPE '\\')`,
      );
    }
    if (query.plan) where.push(`plan = ${bind(query.plan)}`);
    if (query.status === 'banned') where.push('banned = 1');
    // One status per row, as the list shows it: a ban outranks a
    // suspension, so a banned account is never listed as Suspended.
    if (query.status === 'suspended') {
      where.push('suspended = 1 AND banned = 0');
    }
    if (query.status === 'active') where.push('banned = 0 AND suspended = 0');
    if (query.since) where.push(`first_seen_at >= ${bind(query.since)}`);

    const column = SORT_COLUMNS[query.sort ?? 'last_active'];
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const nulls = column === 'email' ? `${column} IS NULL, ` : '';

    const sql = `
      WITH ranked AS (
        SELECT
          a.user_id,
          a.email,
          a.first_seen_at,
          a.last_seen_at,
          (SELECT s.tier FROM billing_subscriptions s
             WHERE s.user_id = a.user_id AND s.status IN ('active', 'trialing')
               -- As BillingStore.findActiveSubscription: a refunded or
               -- disputed subscription entitles nothing, whatever Stripe's
               -- mirrored status still says.
               AND NOT EXISTS (
                 SELECT 1 FROM billing_clawbacks c
                  WHERE c.stripe_subscription_id = s.stripe_subscription_id)
             ORDER BY s.updated_at DESC LIMIT 1) AS paid_tier,
          (SELECT g.tier FROM plan_gifts g
             WHERE g.user_id = a.user_id AND g.revoked_at IS NULL
               AND (g.ends_at IS NULL OR g.ends_at > ?1)
             ORDER BY CASE g.tier WHEN 'ship' THEN 2 ELSE 1 END DESC
             LIMIT 1) AS gift_tier,
          EXISTS (SELECT 1 FROM user_bans b
                    WHERE b.user_id = a.user_id AND b.lifted_at IS NULL) AS banned,
          EXISTS (SELECT 1 FROM billing_clawbacks c
                    WHERE c.user_id = a.user_id AND c.suspends = 1
                      AND c.lifted_at IS NULL) AS suspended,
          (SELECT COUNT(*) FROM projects p
             WHERE p.user_id = a.user_id AND p.archived_at IS NULL) AS active_projects,
          COALESCE((SELECT SUM(t.cost_micro_usd) FROM generation_run_traces t
             WHERE t.project_id = a.user_id
                OR t.project_id IN (SELECT id FROM projects WHERE user_id = a.user_id)), 0)
            AS spend_micro_usd,
          COALESCE((SELECT SUM(t.cost_micro_usd) FROM generation_run_traces t
             WHERE (t.project_id = a.user_id
                OR t.project_id IN (SELECT id FROM projects WHERE user_id = a.user_id))
               AND t.ended_at >= ?2), 0)
            AS month_spend_micro_usd
        FROM accounts a
      ),
      planned AS (
        SELECT *,
          CASE
            WHEN (CASE gift_tier WHEN 'ship' THEN 2 WHEN 'build' THEN 1 ELSE 0 END)
               > (CASE paid_tier WHEN 'ship' THEN 2 WHEN 'build' THEN 1 ELSE 0 END)
              THEN gift_tier
            ELSE COALESCE(paid_tier, 'free')
          END AS plan,
          CASE
            WHEN (CASE gift_tier WHEN 'ship' THEN 2 WHEN 'build' THEN 1 ELSE 0 END)
               > (CASE paid_tier WHEN 'ship' THEN 2 WHEN 'build' THEN 1 ELSE 0 END)
              THEN 1 ELSE 0
          END AS gifted
        FROM ranked
      )
      SELECT user_id, email, first_seen_at, last_seen_at, plan, gifted,
             banned, suspended, active_projects, spend_micro_usd,
             month_spend_micro_usd, COUNT(*) OVER () AS total
      FROM planned
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${nulls}${column} ${direction}, user_id ASC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;

    const result = await this.#db
      .prepare(sql)
      .bind(...binds)
      .all<Row>();
    return result.results ?? [];
  }
}

const CSV_COLUMNS: [string, (row: AccountRow) => string | number][] = [
  ['user_id', (r) => r.userId],
  ['email', (r) => r.email ?? ''],
  ['plan', (r) => r.plan],
  ['gifted', (r) => (r.gifted ? 'yes' : 'no')],
  [
    'status',
    (r) => (r.banned ? 'banned' : r.suspended ? 'suspended' : 'active'),
  ],
  ['active_projects', (r) => r.activeProjects],
  ['spend_usd', (r) => (r.spendMicroUsd / 1_000_000).toFixed(4)],
  ['month_spend_usd', (r) => (r.monthSpendMicroUsd / 1_000_000).toFixed(4)],
  ['first_seen_at', (r) => r.firstSeenAt],
  ['last_seen_at', (r) => r.lastSeenAt],
];

/**
 * A cell as a spreadsheet reads it safely: quoted when it holds a comma, a
 * quote or a line break, and with a leading `=`, `+`, `-` or `@` defused,
 * since an address is somebody else's text and a spreadsheet runs formulas.
 */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function accountsCsv(rows: AccountRow[]): string {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, cell]) => csvCell(cell(row))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
