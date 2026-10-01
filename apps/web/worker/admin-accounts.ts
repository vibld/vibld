/**
 * The platform admins' account list (docs/decisions.md D128), the Clerk
 * import that fills it, and the read-only list of who is an admin (D129).
 *
 * The handlers only parse, answer and shape. The admin check runs before
 * any of them (`requireAdmin` in index.ts), and the reading is
 * `AccountsStore`'s.
 */

import {
  AccountsStore,
  accountsCsv,
  type AccountPlan,
  type AccountQuery,
  type AccountSort,
  type AccountStatus,
} from './accounts-store.ts';
import type { AuditEntry } from './admin-store.ts';
import type { ClerkListedUser, ClerkUserPage } from './clerk-lookup.ts';
import { OWNER_USER_ID } from './owner-auth.ts';
import { parsePlatformAdmins } from './platform-admins.ts';
import type { SignInMode } from './principal.ts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PLANS: readonly AccountPlan[] = ['free', 'build', 'ship'];
const STATUSES: readonly AccountStatus[] = ['active', 'banned', 'suspended'];
const SORTS: readonly AccountSort[] = [
  'last_active',
  'signed_up',
  'spend',
  'email',
];

function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** The list's query from its URL. Anything unrecognized is left out. */
export function accountQueryFrom(url: URL): AccountQuery {
  const p = url.searchParams;
  const since = p.get('since');
  const page = Number(p.get('page'));
  const pageSize = Number(p.get('pageSize'));
  const search = p.get('q')?.trim().slice(0, 200);
  return {
    ...(search ? { search } : {}),
    ...(oneOf(p.get('plan'), PLANS)
      ? { plan: oneOf(p.get('plan'), PLANS) }
      : {}),
    ...(oneOf(p.get('status'), STATUSES)
      ? { status: oneOf(p.get('status'), STATUSES) }
      : {}),
    ...(since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? { since } : {}),
    ...(oneOf(p.get('sort'), SORTS)
      ? { sort: oneOf(p.get('sort'), SORTS) }
      : {}),
    ...(p.get('dir') === 'asc' ? { direction: 'asc' as const } : {}),
    ...(Number.isInteger(page) && page > 0 ? { page } : {}),
    ...(Number.isInteger(pageSize) && pageSize > 0 ? { pageSize } : {}),
  };
}

export interface AdminAccountsDeps {
  db: D1Database;
  /** Where the directory can be imported from, or null where there is none. */
  importPage:
    | ((query: {
        after: number | null;
        before?: number;
        limit: number;
        offset?: number;
      }) => Promise<ClerkUserPage>)
    | null;
  audit: (entry: AuditEntry) => Promise<boolean>;
  adminEmail: string;
  now?: () => Date;
}

/**
 * `/api/admin/accounts`: GET a page of accounts as JSON, or every match as
 * CSV with `format=csv`.
 */
export async function handleAccountList(
  request: Request,
  deps: AdminAccountsDeps,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const url = new URL(request.url);
  const query = accountQueryFrom(url);
  const store = new AccountsStore(deps.db);
  const now = deps.now?.() ?? new Date();
  if (url.searchParams.get('format') === 'csv') {
    const { rows, total } = await store.exportRows(query, now);
    return new Response(accountsCsv(rows), {
      headers: {
        // How many matched, beside how many the file holds: an export cut
        // at MAX_EXPORT_ROWS must not pass for the whole list.
        'x-accounts-total': String(total),
        'x-accounts-exported': String(rows.length),
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="vibld-accounts-${now.toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }
  return json({
    ...(await store.list(query, now)),
    canImport: deps.importPage !== null,
  });
}

/** The most Clerk pages one import reads, so one request stays bounded. */
export const MAX_IMPORT_PAGES = 10;
export const IMPORT_PAGE_SIZE = 100;
/** How many accounts one page of a single creation millisecond reads (Clerk's largest page). */
export const IMPORT_TIE_LIMIT = 500;
/** How many times a millisecond read by offset is read, at most, to settle it. */
export const IMPORT_TIE_PASSES = 4;

/**
 * `/api/admin/accounts/import`: POST `{ after? }` to copy Clerk's
 * directory into the list, for the people who have not been back since it
 * existed. At most MAX_IMPORT_PAGES pages a request; `next` is the cursor
 * (a creation time, Unix ms) to carry on from when there is more.
 *
 * The cursor is a creation time rather than an offset, so nobody is
 * skipped when the directory changes during an import: a deletion cannot
 * shift it, and a sign-up is created after it (`listClerkUsers`).
 */
export async function handleAccountImport(
  request: Request,
  deps: AdminAccountsDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!deps.importPage) {
    return json(
      {
        error:
          'There is no directory to import from here. Accounts are listed as they sign in.',
      },
      400,
    );
  }
  let after: number | null = null;
  try {
    const body = (await request.json()) as { after?: unknown };
    if (Number.isSafeInteger(body.after) && (body.after as number) > 0) {
      after = body.after as number;
    }
  } catch {
    // An empty body starts from the beginning.
  }

  const importPage = deps.importPage;
  const store = new AccountsStore(deps.db);
  // Counted by id, since a millisecond on a page's edge is read twice
  // within a request. A request never ends inside a millisecond (below), so
  // the next one reads nothing this one counted.
  const seen = new Set<string>();
  const iso = (ms: number | null) =>
    ms === null ? null : new Date(ms).toISOString();
  const write = async (users: ClerkListedUser[]) => {
    await store.importAccounts(
      users.map((user) => ({
        userId: user.userId,
        email: user.email,
        createdAt: iso(user.createdAt) ?? new Date(0).toISOString(),
        lastSignInAt: iso(user.lastSignInAt),
      })),
    );
    for (const user of users) seen.add(user.userId);
  };
  const failed = async (error: string) => {
    // What earlier pages wrote is written; the log says so either way.
    const audited =
      seen.size > 0 ? await auditImport(deps, seen.size, true) : true;
    return json({ error, imported: seen.size, next: after, audited }, 502);
  };
  /**
   * Every account created in one millisecond, in pages bounded on both
   * sides until a short one. Within a millisecond there is nothing left to
   * order by, so pages past the first go by offset, which a deletion in
   * that millisecond during the read can shift past an account. So when a
   * read took more than one page, it is read again, until a whole pass
   * finds nobody new; a millisecond that will not settle is reported
   * rather than passed over.
   */
  const readMillisecond = async (ms: number): Promise<string | null> => {
    for (let pass = 0; pass < IMPORT_TIE_PASSES; pass += 1) {
      const before = seen.size;
      let pages = 0;
      for (let offset = 0; ; offset += IMPORT_TIE_LIMIT) {
        const tie = await importPage({
          after: ms - 1,
          before: ms + 1,
          limit: IMPORT_TIE_LIMIT,
          offset,
        });
        if (!tie.ok) return tie.error;
        await write(tie.users);
        pages += 1;
        if (tie.read < IMPORT_TIE_LIMIT) break;
      }
      // One page needed no offset, so nothing could have shifted. A pass
      // that found nobody new confirms the one before it.
      if (pages === 1 || (pass > 0 && seen.size === before)) return null;
    }
    return 'Clerk kept changing while the import read it. Import again to finish.';
  };

  // `after` is how far the import has read: every account created at or
  // before it has been written. `edge` is a millisecond the last page may
  // have stopped part way through, which the next page starts on again.
  let next: number | null = null;
  let edge: number | null = null;
  for (let page = 0; page < MAX_IMPORT_PAGES; page += 1) {
    const listed = await importPage({ after, limit: IMPORT_PAGE_SIZE });
    if (!listed.ok) return failed(listed.error);
    await write(listed.users);
    if (listed.read < IMPORT_PAGE_SIZE || listed.lastCreatedAt === null) {
      next = null;
      edge = null;
      break;
    }
    const last = listed.lastCreatedAt;
    if (after === null || last - 1 > after) {
      after = last - 1;
      edge = last;
    } else {
      // The whole page was one millisecond: read it whole, then move on.
      const error = await readMillisecond(last);
      if (error !== null) return failed(error);
      after = last;
      edge = null;
    }
    next = after;
  }
  // Out of pages for this request: finish the millisecond it stopped in,
  // so the request that carries on starts cleanly after it.
  if (next !== null && edge !== null) {
    const error = await readMillisecond(edge);
    if (error !== null) return failed(error);
    after = edge;
    next = edge;
  }
  const imported = seen.size;

  const audited = await auditImport(deps, imported, next !== null);
  return json({ imported, next, audited });
}

function auditImport(
  deps: AdminAccountsDeps,
  imported: number,
  partial: boolean,
): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  return deps.audit({
    at: now.toISOString(),
    adminEmail: deps.adminEmail,
    action: 'accounts-import',
    targetUserId: null,
    target: null,
    reason: null,
    detail: { imported, partial },
  });
}

export interface AdminListing {
  /** The address as the admin list names it. */
  identity: string;
  /** Where the grant comes from. Changing it is a secret change (L4). */
  source: 'VIBLD_PLATFORM_ADMINS' | 'owner';
  /** The account that signs in with it, when one has been seen. */
  userId: string | null;
}

/**
 * `/api/admin/admins`: who can use these tools, read-only (D129). Adding
 * or removing an admin stays a change to the `VIBLD_PLATFORM_ADMINS`
 * secret, which an admin session cannot make (L4).
 */
export async function handleAdminList(
  request: Request,
  env: {
    VIBLD_PLATFORM_ADMINS?: string;
    DB?: D1Database;
  },
  mode: SignInMode | undefined,
  ownerIdentity: string | null,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const store = env.DB ? new AccountsStore(env.DB) : null;
  const listings: AdminListing[] = [];
  const seen = async (identity: string) =>
    store ? await store.userIdForEmail(identity).catch(() => null) : null;
  if (mode === 'owner') {
    // One password, one identity: nobody else the secret names can sign
    // in to a one-owner copy, so nobody else is an admin of it.
    return json({
      admins: ownerIdentity
        ? [{ identity: ownerIdentity, source: 'owner', userId: OWNER_USER_ID }]
        : [],
    });
  }
  for (const identity of parsePlatformAdmins(env.VIBLD_PLATFORM_ADMINS)) {
    if (listings.some((l) => l.identity === identity)) continue;
    listings.push({
      identity,
      source: 'VIBLD_PLATFORM_ADMINS',
      userId: await seen(identity),
    });
  }
  return json({ admins: listings });
}
