/**
 * The platform overview (docs/decisions.md D128): how the platform is
 * doing, day by day, for a platform admin.
 *
 *     GET /api/admin/overview?days=30
 *
 * One row per UTC day over the window: sign-ups, people who built, builds
 * started and how they ended, model spend, money taken and money returned.
 * With the totals over the window, how many accounts were seen in the last
 * day, week and month, the builds not yet ended, and the providers'
 * balances where this deployment can read them.
 *
 * Reads only. The admin check runs before this (`requireAdmin` in
 * index.ts). Every figure comes from a table this deployment already
 * writes, so nothing new is recorded to answer it.
 */

import { fetchDeepseekBalance } from './provider-balance.ts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const DEFAULT_OVERVIEW_DAYS = 30;
export const MAX_OVERVIEW_DAYS = 90;

/** A run's stage state once it has ended (`unendedRuns` in project-store.ts). */
const ENDED = `('accepted', 'failed', 'cancelled', 'idle')`;

export interface OverviewDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  signups: number;
  /** Accounts that started at least one build that day. */
  builders: number;
  builds: number;
  accepted: number;
  failed: number;
  cancelled: number;
  spendMicroUsd: number;
  revenueUsdCents: number;
  refundedUsdCents: number;
}

export interface ProviderBalanceView {
  provider: string;
  /** null where it could not be read; `note` says why. */
  balance: { amount: number; currency: string } | null;
  note: string | null;
}

export interface Overview {
  from: string;
  to: string;
  days: OverviewDay[];
  totals: Omit<OverviewDay, 'day'> & {
    /** failed / (accepted + failed), or null with nothing ended either way. */
    failureRate: number | null;
  };
  accounts: { total: number; seen1d: number; seen7d: number; seen30d: number };
  unendedBuilds: number;
  balances: ProviderBalanceView[];
}

/** The window's length from `?days=`, within bounds. */
export function overviewDays(raw: string | null): number {
  const days = Number(raw);
  return Number.isInteger(days) && days >= 1
    ? Math.min(days, MAX_OVERVIEW_DAYS)
    : DEFAULT_OVERVIEW_DAYS;
}

/** Every UTC day from the one `days - 1` before `now`'s through `now`'s, oldest first. */
export function overviewWindow(now: Date, days: number): string[] {
  const out: string[] = [];
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(new Date(today - back * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** How long the overview waits for the providers' balances. */
export const BALANCE_WAIT_MS = 4_000;

/** `promise`'s value, or `fallback` if it fails or has not settled within `ms`. */
export function withinTime<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

type DayRows<T> = Map<string, T>;

async function byDay<T extends { day: string }>(
  db: D1Database,
  sql: string,
  since: string,
): Promise<DayRows<T>> {
  const result = await db.prepare(sql).bind(since).all<T>();
  return new Map((result.results ?? []).map((row) => [row.day, row]));
}

/**
 * The overview over the `days` UTC days ending today.
 *
 * Each figure is one grouped statement, rather than one compound query,
 * because D1 refuses a compound SELECT of more than a few terms (0041).
 */
export async function readOverview(
  db: D1Database,
  now: Date,
  days: number,
  balances: () => Promise<ProviderBalanceView[]>,
  balanceWaitMs = BALANCE_WAIT_MS,
): Promise<Overview> {
  const window = overviewWindow(now, days);
  const since = `${window[0]!}T00:00:00.000Z`;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const [signups, builds, spend, revenue, refunds, accounts, unended, read] =
    await Promise.all([
      byDay<{ day: string; n: number }>(
        db,
        `SELECT substr(first_seen_at, 1, 10) AS day, COUNT(*) AS n
           FROM accounts WHERE first_seen_at >= ?1 GROUP BY day`,
        since,
      ),
      // A run's first stage row is its own id; a later stage's id carries a
      // ':' suffix (the same reading as the account page's runs).
      byDay<{
        day: string;
        builds: number;
        builders: number;
        accepted: number;
        failed: number;
        cancelled: number;
      }>(
        db,
        `SELECT substr(s.created_at, 1, 10) AS day,
                COUNT(*) AS builds,
                COUNT(DISTINCT p.user_id) AS builders,
                SUM(s.state = 'accepted') AS accepted,
                SUM(s.state = 'failed') AS failed,
                SUM(s.state = 'cancelled') AS cancelled
           FROM generation_stages AS s
           JOIN projects AS p ON p.id = s.project_id
          WHERE s.created_at >= ?1 AND instr(s.run_id, ':') = 0
          GROUP BY day`,
        since,
      ),
      byDay<{ day: string; micro: number }>(
        db,
        `SELECT substr(ended_at, 1, 10) AS day, SUM(cost_micro_usd) AS micro
           FROM generation_run_traces WHERE ended_at >= ?1 GROUP BY day`,
        since,
      ),
      // Money that cleared. A zero-amount settlement is recorded but took
      // nothing (0007).
      byDay<{ day: string; cents: number }>(
        db,
        `SELECT substr(cleared_at, 1, 10) AS day, SUM(amount_usd_cents) AS cents
           FROM billing_payments
          WHERE cleared_at >= ?1 AND amount_usd_cents > 0
          GROUP BY day`,
        since,
      ),
      // Money that went back. A refund row carries the charge's cumulative
      // refunded amount, so each row's own share is what it raises the
      // highest refund already recorded on that charge by, in the order the
      // rows were written: an older event replayed after a newer one adds
      // nothing, as `recordClawback` owes it nothing. A lost dispute's row
      // is its amount. Every row is read, so a refund on an older charge
      // still counts the day it happened rather than being taken whole.
      byDay<{ day: string; cents: number }>(
        db,
        `SELECT day, SUM(share) AS cents FROM (
           SELECT substr(created_at, 1, 10) AS day,
                  CASE WHEN cause = 'refund'
                       THEN MAX(0, reversed_usd_cents - COALESCE(MAX(reversed_usd_cents)
                              OVER (PARTITION BY stripe_charge_id, cause
                                    ORDER BY created_at, rowid
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))
                       ELSE reversed_usd_cents END AS share,
                  created_at
             FROM billing_clawbacks
         ) WHERE created_at >= ?1 GROUP BY day`,
        since,
      ),
      db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(last_seen_at >= ?1) AS seen1d,
                  SUM(last_seen_at >= ?2) AS seen7d,
                  SUM(last_seen_at >= ?3) AS seen30d
             FROM accounts`,
        )
        .bind(ago(86_400_000), ago(7 * 86_400_000), ago(30 * 86_400_000))
        .first<{
          total: number;
          seen1d: number | null;
          seen7d: number | null;
          seen30d: number | null;
        }>(),
      db
        .prepare(
          // A run is still going while any of its stages is, its own or a
          // later one's (`run:verify`, a repair): the reading `unendedRuns`
          // in project-store.ts makes, counted once per run.
          `SELECT COUNT(DISTINCT CASE WHEN instr(run_id, ':') = 0 THEN run_id
                         ELSE substr(run_id, 1, instr(run_id, ':') - 1) END) AS n
             FROM generation_stages WHERE state NOT IN ${ENDED}`,
        )
        .first<{ n: number }>(),
      // Bounded: a provider that never answers must not hold back what the
      // database already knows.
      withinTime(balances(), balanceWaitMs, []),
    ]);

  const rows: OverviewDay[] = window.map((day) => {
    const b = builds.get(day);
    return {
      day,
      signups: signups.get(day)?.n ?? 0,
      builders: b?.builders ?? 0,
      builds: b?.builds ?? 0,
      accepted: b?.accepted ?? 0,
      failed: b?.failed ?? 0,
      cancelled: b?.cancelled ?? 0,
      spendMicroUsd: spend.get(day)?.micro ?? 0,
      revenueUsdCents: revenue.get(day)?.cents ?? 0,
      refundedUsdCents: refunds.get(day)?.cents ?? 0,
    };
  });
  const sum = (key: keyof Omit<OverviewDay, 'day'>) =>
    rows.reduce((total, row) => total + row[key], 0);
  const accepted = sum('accepted');
  const failed = sum('failed');
  // Builders over the window are distinct people, not a sum of the days.
  const builders = await db
    .prepare(
      `SELECT COUNT(DISTINCT p.user_id) AS n
         FROM generation_stages AS s
         JOIN projects AS p ON p.id = s.project_id
        WHERE s.created_at >= ?1 AND instr(s.run_id, ':') = 0`,
    )
    .bind(since)
    .first<{ n: number }>();

  return {
    from: window[0]!,
    to: window.at(-1)!,
    days: rows,
    totals: {
      signups: sum('signups'),
      builders: builders?.n ?? 0,
      builds: sum('builds'),
      accepted,
      failed,
      cancelled: sum('cancelled'),
      spendMicroUsd: sum('spendMicroUsd'),
      revenueUsdCents: sum('revenueUsdCents'),
      refundedUsdCents: sum('refundedUsdCents'),
      failureRate:
        accepted + failed === 0 ? null : failed / (accepted + failed),
    },
    accounts: {
      total: accounts?.total ?? 0,
      seen1d: accounts?.seen1d ?? 0,
      seen7d: accounts?.seen7d ?? 0,
      seen30d: accounts?.seen30d ?? 0,
    },
    unendedBuilds: unended?.n ?? 0,
    balances: read,
  };
}

export interface BalanceEnv {
  DEEPSEEK_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * The balances this deployment can read: DeepSeek's, with the key it
 * already generates with. Anthropic's needs an Admin API key this
 * deployment does not hold (`provider-balance.ts`), and the overview says
 * so rather than leaving it out.
 */
export async function readBalances(
  env: BalanceEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderBalanceView[]> {
  const out: ProviderBalanceView[] = [];
  if (env.DEEPSEEK_API_KEY) {
    const balance = await fetchDeepseekBalance(
      env.DEEPSEEK_API_KEY,
      (input, init) =>
        fetchImpl(input, {
          ...init,
          signal: AbortSignal.timeout(BALANCE_WAIT_MS),
        }),
    );
    out.push({
      provider: 'DeepSeek',
      balance: balance
        ? { amount: balance.totalBalance, currency: balance.currency }
        : null,
      note: balance ? null : 'DeepSeek did not answer.',
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    out.push({
      provider: 'Anthropic',
      balance: null,
      note: 'Not readable with a model key: it needs an Admin API key. See console.anthropic.com/settings/billing.',
    });
  }
  return out;
}

export async function handleOverview(
  request: Request,
  db: D1Database,
  balances: () => Promise<ProviderBalanceView[]>,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const days = overviewDays(new URL(request.url).searchParams.get('days'));
  return json(await readOverview(db, now, days, balances));
}
