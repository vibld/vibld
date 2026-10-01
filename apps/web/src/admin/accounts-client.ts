import { getClerkToken } from '../auth/clerk-token.ts';
import { formatUsd } from './admin-users-client.ts';
import type { AdminResult, Tier } from './admin-users-client.ts';

/**
 * Calls the Worker's account list, its Clerk import and its read-only
 * admin list (docs/decisions.md D128, D129; `worker/admin-accounts.ts`),
 * and the pure helpers the page renders with.
 *
 * JSX-free for the reason `admin-users-client.ts` gives.
 *
 * Nothing here is a permission. Every route checks the caller is a
 * platform admin itself (ADR-0006).
 */

export type AccountSort = 'last_active' | 'signed_up' | 'spend' | 'email';
export type AccountStatus = 'active' | 'banned' | 'suspended';

export interface AccountFilters {
  search: string;
  plan: Tier | '';
  status: AccountStatus | '';
  /** Signed up on or after, as YYYY-MM-DD, or '' for any time. */
  since: string;
  sort: AccountSort;
  direction: 'asc' | 'desc';
  page: number;
}

export const DEFAULT_FILTERS: AccountFilters = {
  search: '',
  plan: '',
  status: '',
  since: '',
  sort: 'last_active',
  direction: 'desc',
  page: 1,
};

export const PAGE_SIZE = 50;

export interface AccountListRow {
  userId: string;
  email: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  plan: Tier;
  gifted: boolean;
  banned: boolean;
  suspended: boolean;
  activeProjects: number;
  spendMicroUsd: number;
  monthSpendMicroUsd: number;
}

export interface AccountListPage {
  accounts: AccountListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Whether this copy has a directory (Clerk's) to import accounts from. */
  canImport: boolean;
}

export interface AdminListing {
  identity: string;
  source: 'VIBLD_PLATFORM_ADMINS' | 'owner';
  userId: string | null;
}

export interface ImportResult {
  imported: number;
  /** Where to carry on from, or null when the directory has been read. */
  next: number | null;
  audited: boolean;
}

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);
const UNREACHABLE = 'The admin service could not be reached.';
const UNEXPECTED = 'The admin service returned an unexpected response.';

async function authHeaders(
  getToken: GetToken,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return isRecord(problem) && typeof problem.error === 'string'
    ? problem.error
    : `The admin request failed (${response.status}).`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function readRow(value: unknown): AccountListRow | null {
  if (!isRecord(value)) return null;
  const userId = str(value.userId);
  const plan = value.plan;
  if (
    userId === null ||
    (plan !== 'free' && plan !== 'build' && plan !== 'ship')
  ) {
    return null;
  }
  return {
    userId,
    email: str(value.email),
    firstSeenAt: str(value.firstSeenAt) ?? '',
    lastSeenAt: str(value.lastSeenAt) ?? '',
    plan,
    gifted: value.gifted === true,
    banned: value.banned === true,
    suspended: value.suspended === true,
    activeProjects: num(value.activeProjects),
    spendMicroUsd: num(value.spendMicroUsd),
    monthSpendMicroUsd: num(value.monthSpendMicroUsd),
  };
}

/** The list's query string, leaving out what is at its default. */
export function accountListQuery(
  filters: AccountFilters,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set('q', search);
  if (filters.plan) params.set('plan', filters.plan);
  if (filters.status) params.set('status', filters.status);
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.since)) {
    params.set('since', filters.since);
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.direction === 'asc') params.set('dir', 'asc');
  if (filters.page > 1) params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return params.toString();
}

export async function fetchAccountList(
  filters: AccountFilters,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<AccountListPage>> {
  let response: Response;
  try {
    response = await fetchImpl(
      `/api/admin/accounts?${accountListQuery(filters)}`,
      { headers: await authHeaders(getToken) },
    );
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.accounts)) {
    return { ok: false, error: UNEXPECTED };
  }
  return {
    ok: true,
    value: {
      accounts: body.accounts
        .map(readRow)
        .filter((row): row is AccountListRow => row !== null),
      total: num(body.total),
      page: num(body.page) || 1,
      pageSize: num(body.pageSize) || PAGE_SIZE,
      canImport: body.canImport === true,
    },
  };
}

/**
 * Every account matching the filters, as the CSV the Worker writes. A
 * fetch rather than a link, because the request has to carry the session
 * token a link cannot.
 */
export async function fetchAccountsCsv(
  filters: AccountFilters,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<
  AdminResult<{
    blob: Blob;
    filename: string;
    /** How many rows the file holds, and how many matched. */
    exported: number;
    total: number;
  }>
> {
  let response: Response;
  try {
    response = await fetchImpl(
      `/api/admin/accounts?${accountListQuery(
        { ...filters, page: 1 },
        { format: 'csv' },
      )}`,
      { headers: await authHeaders(getToken) },
    );
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const named = /filename="([^"]+)"/.exec(
    response.headers.get('content-disposition') ?? '',
  );
  const exported = Number(response.headers.get('x-accounts-exported'));
  const total = Number(response.headers.get('x-accounts-total'));
  return {
    ok: true,
    value: {
      blob: await response.blob(),
      filename: named?.[1] ?? 'vibld-accounts.csv',
      exported: Number.isFinite(exported) ? exported : 0,
      total: Number.isFinite(total) ? total : 0,
    },
  };
}

/**
 * An import request's outcome. A failure part way still says what it had
 * written before it stopped, and whether the log recorded that, because
 * the Worker keeps those rows either way.
 */
export type ImportOutcome =
  | { ok: true; value: ImportResult }
  | { ok: false; error: string; imported: number; audited: boolean };

export async function postAccountImport(
  after: number | null,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<ImportOutcome> {
  let response: Response;
  try {
    response = await fetchImpl('/api/admin/accounts/import', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify(after === null ? {} : { after }),
    });
  } catch {
    return { ok: false, error: UNREACHABLE, imported: 0, audited: true };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const partial = isRecord(body) ? body : {};
    return {
      ok: false,
      error:
        typeof partial.error === 'string'
          ? partial.error
          : `The admin request failed (${response.status}).`,
      imported: num(partial.imported),
      audited: partial.audited !== false,
    };
  }
  if (!isRecord(body) || typeof body.imported !== 'number') {
    return { ok: false, error: UNEXPECTED, imported: 0, audited: true };
  }
  return {
    ok: true,
    value: {
      imported: body.imported,
      next: typeof body.next === 'number' ? body.next : null,
      audited: body.audited !== false,
    },
  };
}

export async function fetchAdminList(
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<AdminListing[]>> {
  let response: Response;
  try {
    response = await fetchImpl('/api/admin/admins', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.admins)) {
    return { ok: false, error: UNEXPECTED };
  }
  const admins: AdminListing[] = [];
  for (const entry of body.admins) {
    if (!isRecord(entry)) continue;
    const identity = str(entry.identity);
    if (identity === null) continue;
    admins.push({
      identity,
      source: entry.source === 'owner' ? 'owner' : 'VIBLD_PLATFORM_ADMINS',
      userId: str(entry.userId),
    });
  }
  return { ok: true, value: admins };
}

// -------------------------------------------------------------------------
// What the page says.
// -------------------------------------------------------------------------

/** The status cell: what stops the account, or that nothing does. */
export function describeStatus(row: AccountListRow): string {
  if (row.banned) return 'Banned';
  if (row.suspended) return 'Suspended';
  return 'Active';
}

/** The spend cell: all time, with this month's share when there is one. */
export function describeSpend(row: AccountListRow): string {
  const all = formatUsd(row.spendMicroUsd);
  return row.monthSpendMicroUsd > 0
    ? `${all} (${formatUsd(row.monthSpendMicroUsd)} this month)`
    : all;
}

/**
 * "Showing 51 to 100 of 212", that nothing matched, or that this page is
 * past the last match (the list shrank under the admin).
 */
export function describeRange(page: AccountListPage): string {
  if (page.total === 0) return 'No accounts match.';
  if (page.accounts.length === 0) {
    return `Page ${page.page} is past the end: ${page.total} account${
      page.total === 1 ? ' matches' : 's match'
    }, on ${pageCount(page)} page${pageCount(page) === 1 ? '' : 's'}.`;
  }
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + page.accounts.length - 1;
  return `Showing ${first} to ${last} of ${page.total}`;
}

/**
 * The line after an export: nothing when the file holds every match, and
 * what was left out when it was cut short.
 */
export function describeExport(exported: number, total: number): string | null {
  return total > exported
    ? `The file holds the first ${exported} of ${total} matching accounts. Narrow the filters to export the rest.`
    : null;
}

export function pageCount(page: AccountListPage): number {
  return Math.max(1, Math.ceil(page.total / page.pageSize));
}

/** Sorting by a column: the same column flips direction, a new one starts descending. */
export function nextSort(
  filters: AccountFilters,
  sort: AccountSort,
): AccountFilters {
  if (filters.sort === sort) {
    return {
      ...filters,
      direction: filters.direction === 'desc' ? 'asc' : 'desc',
      page: 1,
    };
  }
  return {
    ...filters,
    sort,
    direction: sort === 'email' ? 'asc' : 'desc',
    page: 1,
  };
}
