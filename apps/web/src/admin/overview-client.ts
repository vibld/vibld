import { getClerkToken } from '../auth/clerk-token.ts';
import type { AdminResult } from './admin-users-client.ts';

/**
 * Calls the Worker's platform overview (docs/decisions.md D128,
 * `worker/admin-overview.ts`), and the pure helpers the page renders with.
 *
 * JSX-free for the reason `admin-users-client.ts` gives.
 *
 * Nothing here is a permission. The route checks the caller is a platform
 * admin itself (ADR-0006).
 */

export interface OverviewDay {
  day: string;
  signups: number;
  builders: number;
  builds: number;
  accepted: number;
  failed: number;
  cancelled: number;
  spendMicroUsd: number;
  revenueUsdCents: number;
  refundedUsdCents: number;
}

export interface OverviewBalance {
  provider: string;
  balance: { amount: number; currency: string } | null;
  note: string | null;
}

export interface Overview {
  from: string;
  to: string;
  days: OverviewDay[];
  totals: Omit<OverviewDay, 'day'> & { failureRate: number | null };
  accounts: { total: number; seen1d: number; seen7d: number; seen30d: number };
  unendedBuilds: number;
  balances: OverviewBalance[];
}

/** The windows the page offers, in days. */
export const OVERVIEW_WINDOWS = [7, 30, 90] as const;

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const COUNTS = [
  'signups',
  'builders',
  'builds',
  'accepted',
  'failed',
  'cancelled',
  'spendMicroUsd',
  'revenueUsdCents',
  'refundedUsdCents',
] as const;

function counts(value: Record<string, unknown>): Omit<OverviewDay, 'day'> {
  const out = {} as Omit<OverviewDay, 'day'>;
  for (const key of COUNTS) out[key] = num(value[key]);
  return out;
}

function readDay(value: unknown): OverviewDay | null {
  if (!isRecord(value) || typeof value.day !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return null;
  return { day: value.day, ...counts(value) };
}

function readBalance(value: unknown): OverviewBalance | null {
  if (!isRecord(value) || typeof value.provider !== 'string') return null;
  const balance = isRecord(value.balance) ? value.balance : null;
  return {
    provider: value.provider,
    balance:
      balance &&
      typeof balance.amount === 'number' &&
      Number.isFinite(balance.amount) &&
      typeof balance.currency === 'string'
        ? { amount: balance.amount, currency: balance.currency }
        : null,
    note: typeof value.note === 'string' ? value.note : null,
  };
}

/** The route's answer, checked field by field like the rest of the admin client. */
export function readOverview(body: unknown): Overview | null {
  if (!isRecord(body) || !Array.isArray(body.days)) return null;
  if (typeof body.from !== 'string' || typeof body.to !== 'string') return null;
  const totals = isRecord(body.totals) ? body.totals : {};
  const accounts = isRecord(body.accounts) ? body.accounts : {};
  return {
    from: body.from,
    to: body.to,
    days: body.days
      .map(readDay)
      .filter((day): day is OverviewDay => day !== null),
    totals: {
      ...counts(totals),
      failureRate:
        typeof totals.failureRate === 'number' &&
        Number.isFinite(totals.failureRate)
          ? totals.failureRate
          : null,
    },
    accounts: {
      total: num(accounts.total),
      seen1d: num(accounts.seen1d),
      seen7d: num(accounts.seen7d),
      seen30d: num(accounts.seen30d),
    },
    unendedBuilds: num(body.unendedBuilds),
    balances: Array.isArray(body.balances)
      ? body.balances
          .map(readBalance)
          .filter((balance): balance is OverviewBalance => balance !== null)
      : [],
  };
}

export async function fetchOverview(
  days: number,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<Overview>> {
  let response: Response;
  try {
    const token = await getToken();
    response = await fetchImpl(`/api/admin/overview?days=${days}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    return { ok: false, error: 'The admin service could not be reached.' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error:
        isRecord(body) && typeof body.error === 'string'
          ? body.error
          : `The admin request failed (${response.status}).`,
    };
  }
  const overview = readOverview(body);
  return overview
    ? { ok: true, value: overview }
    : {
        ok: false,
        error: 'The admin service returned an unexpected response.',
      };
}

// -------------------------------------------------------------------------
// What the page says.
// -------------------------------------------------------------------------

/** "$12.00", from cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "12%", or "n/a" where nothing ended to make a rate of. */
export function formatRate(rate: number | null): string {
  return rate === null ? 'n/a' : `${Math.round(rate * 100)}%`;
}

/** "Sep 30", for a YYYY-MM-DD day in UTC. */
export function formatShortDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime())
    ? day
    : at.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

/** A provider's balance line: the amount, or why there is none. */
export function describeBalance(balance: OverviewBalance): string {
  return balance.balance
    ? `${balance.balance.amount.toFixed(2)} ${balance.balance.currency}`
    : (balance.note ?? 'Not available.');
}
