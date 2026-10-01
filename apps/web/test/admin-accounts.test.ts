import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  accountQueryFrom,
  handleAccountImport,
  handleAccountList,
  handleAdminList,
  IMPORT_PAGE_SIZE,
  IMPORT_TIE_LIMIT,
  MAX_IMPORT_PAGES,
  type AdminAccountsDeps,
} from '../worker/admin-accounts.ts';
import { AccountsStore } from '../worker/accounts-store.ts';
import { appendAudit } from '../worker/admin-users.ts';
import type { AuditEntry } from '../worker/admin-store.ts';
import type { ClerkListedUser, ClerkUserPage } from '../worker/clerk-lookup.ts';
import { listClerkUsers } from '../worker/clerk-lookup.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function deps(overrides: Partial<AdminAccountsDeps> = {}) {
  const db = new SqliteD1Database(schemaSql());
  const audits: AuditEntry[] = [];
  const base: AdminAccountsDeps = {
    db,
    importPage: null,
    audit: async (entry) => {
      audits.push(entry);
      return true;
    },
    adminEmail: 'admin@example.com',
    now: () => NOW,
    ...overrides,
  };
  return { db, audits, deps: base };
}

function clerkUser(n: number): ClerkListedUser {
  return {
    userId: `user_${n}`,
    email: `person${n}@example.com`,
    createdAt: Date.parse('2026-09-01T00:00:00.000Z') + n * 1000,
    lastSignInAt: null,
    banned: false,
  };
}

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const at = (n: number) => T0 + n * 1000;

/**
 * Clerk's directory as `listClerkUsers` reads it: oldest first, created
 * after `after` and, when given, before `before`.
 */
function clerkDirectory(directory: ClerkListedUser[]) {
  return async (query: {
    after: number | null;
    before?: number;
    limit: number;
    offset?: number;
  }): Promise<ClerkUserPage> => {
    const users = directory
      .filter(
        (user) =>
          (query.after === null || (user.createdAt ?? 0) > query.after) &&
          (query.before === undefined || (user.createdAt ?? 0) < query.before),
      )
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    return {
      ok: true,
      users,
      read: users.length,
      lastCreatedAt: users.length > 0 ? users.at(-1)!.createdAt : null,
    };
  };
}

describe('the account list query', () => {
  it('keeps what it recognizes and drops the rest', () => {
    const q = accountQueryFrom(
      new URL(
        'https://app.test/api/admin/accounts?q=%20ana%20&plan=ship&status=banned&since=2026-10-01&sort=spend&dir=asc&page=3&pageSize=25',
      ),
    );
    assert.deepEqual(q, {
      search: 'ana',
      plan: 'ship',
      status: 'banned',
      since: '2026-10-01',
      sort: 'spend',
      direction: 'asc',
      page: 3,
      pageSize: 25,
    });
    assert.deepEqual(
      accountQueryFrom(
        new URL(
          'https://app.test/api/admin/accounts?plan=gold&status=x&since=yesterday&sort=name&dir=up&page=-1&pageSize=1.5&q=%20',
        ),
      ),
      {},
    );
  });
});

describe('/api/admin/accounts', () => {
  it('answers a page as JSON and says whether an import is possible', async () => {
    const w = deps();
    await new AccountsStore(w.db).recordSeen('user_a', 'a@example.com', NOW);
    const response = await handleAccountList(
      new Request('https://app.test/api/admin/accounts'),
      w.deps,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      accounts: { userId: string }[];
      total: number;
      canImport: boolean;
    };
    assert.equal(body.total, 1);
    assert.equal(body.accounts[0]!.userId, 'user_a');
    assert.equal(body.canImport, false);
  });

  it('exports every match as a CSV download', async () => {
    const w = deps();
    await new AccountsStore(w.db).recordSeen('user_a', 'a@example.com', NOW);
    const response = await handleAccountList(
      new Request('https://app.test/api/admin/accounts?format=csv'),
      w.deps,
    );
    assert.equal(
      response.headers.get('content-type'),
      'text/csv; charset=utf-8',
    );
    assert.equal(
      response.headers.get('content-disposition'),
      'attachment; filename="vibld-accounts-2026-10-15.csv"',
    );
    assert.equal(response.headers.get('x-accounts-total'), '1');
    assert.equal(response.headers.get('x-accounts-exported'), '1');
    const text = await response.text();
    assert.match(text, /^user_id,email/);
    assert.match(text, /user_a,a@example.com/);
  });

  it('refuses anything but GET', async () => {
    const w = deps();
    const response = await handleAccountList(
      new Request('https://app.test/api/admin/accounts', { method: 'POST' }),
      w.deps,
    );
    assert.equal(response.status, 405);
  });
});

describe('/api/admin/accounts/import', () => {
  it('says so where there is no directory to import from', async () => {
    const w = deps();
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(response.status, 400);
    assert.equal(w.audits.length, 0);
  });

  it('reads pages until a short one, and audits the import', async () => {
    const directory = Array.from({ length: IMPORT_PAGE_SIZE + 5 }, (_, n) =>
      clerkUser(n),
    );
    const asked: (number | null)[] = [];
    const list = clerkDirectory(directory);
    const w = deps({
      importPage: (query) => {
        asked.push(query.after);
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
        body: '{}',
      }),
      w.deps,
    );
    // The second page starts on the first page's last millisecond, in case
    // the page stopped part way through it: that account is written twice
    // and counted once.
    assert.deepEqual(await response.json(), {
      imported: IMPORT_PAGE_SIZE + 5,
      next: null,
      audited: true,
    });
    assert.deepEqual(asked, [null, at(IMPORT_PAGE_SIZE - 1) - 1]);
    assert.equal(w.audits[0]!.action, 'accounts-import');
    assert.deepEqual(w.audits[0]!.detail, {
      imported: IMPORT_PAGE_SIZE + 5,
      partial: false,
    });
    const page = await new AccountsStore(w.db).list({}, NOW);
    assert.equal(page.total, IMPORT_PAGE_SIZE + 5);
  });

  it('misses nobody when the directory changes during an import', async () => {
    const directory = Array.from({ length: 3 * IMPORT_PAGE_SIZE }, (_, n) =>
      clerkUser(n),
    );
    const list = clerkDirectory(directory);
    let pages = 0;
    const w = deps({
      importPage: (query) => {
        pages += 1;
        if (pages === 2) {
          // Between pages: sixty people from the first page delete their
          // accounts, and two people sign up.
          directory.splice(10, 60);
          directory.push(clerkUser(5_000), clerkUser(5_001));
        }
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(((await response.json()) as { next: unknown }).next, null);
    const listed = new Set(
      (await new AccountsStore(w.db).exportRows({}, NOW)).rows.map(
        (row) => row.userId,
      ),
    );
    const missed = directory.filter((user) => !listed.has(user.userId));
    assert.deepEqual(missed, []);
  });

  it('reads every account in a millisecond that fills a whole page', async () => {
    const directory = [
      ...Array.from({ length: IMPORT_PAGE_SIZE + 50 }, (_, n) => ({
        ...clerkUser(n),
        createdAt: T0,
      })),
      { ...clerkUser(900), createdAt: T0 + 1 },
    ];
    const list = clerkDirectory(directory);
    const asked: { after: number | null; before?: number }[] = [];
    const w = deps({
      importPage: (query) => {
        asked.push({ after: query.after, before: query.before });
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.deepEqual(await response.json(), {
      imported: IMPORT_PAGE_SIZE + 51,
      next: null,
      audited: true,
    });
    // The page that came back all one millisecond is followed by a read of
    // that millisecond alone, then the import moves past it.
    assert.deepEqual(asked, [
      { after: null, before: undefined },
      { after: T0 - 1, before: undefined },
      { after: T0 - 1, before: T0 + 1 },
      { after: T0, before: undefined },
    ]);
    const page = await new AccountsStore(w.db).list({}, NOW);
    assert.equal(page.total, IMPORT_PAGE_SIZE + 51);
  });

  it('pages through a millisecond holding more accounts than one page of it', async () => {
    const tied = 2 * IMPORT_TIE_LIMIT + 200;
    const directory = [
      ...Array.from({ length: tied }, (_, n) => ({
        ...clerkUser(n),
        createdAt: T0,
      })),
      { ...clerkUser(9_000), createdAt: T0 + 1 },
    ];
    const w = deps({ importPage: clerkDirectory(directory) });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.deepEqual(await response.json(), {
      imported: tied + 1,
      next: null,
      audited: true,
    });
    const stored = (await new AccountsStore(w.db).list({}, NOW)).total;
    assert.equal(stored, tied + 1);
  });

  it('reads a tied millisecond again until a deletion during it costs nobody', async () => {
    const tied = 2 * IMPORT_TIE_LIMIT + 200;
    const directory = Array.from({ length: tied }, (_, n) => ({
      ...clerkUser(n),
      createdAt: T0,
    }));
    const list = clerkDirectory(directory);
    let deleted = false;
    const w = deps({
      importPage: (query) => {
        if (query.offset === IMPORT_TIE_LIMIT && !deleted) {
          // Ten accounts already read leave before the second offset page,
          // shifting the ten after the first page's edge back into it.
          deleted = true;
          directory.splice(0, 10);
        }
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(response.status, 200);
    const listed = new Set(
      (await new AccountsStore(w.db).exportRows({}, NOW)).rows.map(
        (row) => row.userId,
      ),
    );
    assert.deepEqual(
      directory.filter((user) => !listed.has(user.userId)),
      [],
    );
  });

  it('says so, rather than moving on, when a millisecond will not settle', async () => {
    const directory = Array.from(
      { length: IMPORT_TIE_LIMIT + 100 },
      (_, n) => ({
        ...clerkUser(n),
        createdAt: T0,
      }),
    );
    const list = clerkDirectory(directory);
    let added = 0;
    const w = deps({
      importPage: (query) => {
        if (query.before !== undefined && !query.offset) {
          // Someone new is created in that millisecond on every pass.
          directory.push({ ...clerkUser(50_000 + added), createdAt: T0 });
          added += 1;
        }
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: string; next: unknown };
    assert.match(body.error, /kept changing/);
    // Carrying on starts before that millisecond, not after it.
    assert.equal(body.next, T0 - 1);
  });

  it('stops after a bounded number of pages and says where to carry on', async () => {
    const directory = Array.from({ length: 20 * IMPORT_PAGE_SIZE }, (_, n) =>
      clerkUser(n),
    );
    const w = deps({ importPage: clerkDirectory(directory) });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    const body = (await response.json()) as { imported: number; next: number };
    // Each page after the first re-reads the last one's final account.
    const imported =
      IMPORT_PAGE_SIZE + (MAX_IMPORT_PAGES - 1) * (IMPORT_PAGE_SIZE - 1);
    assert.equal(body.imported, imported);
    // The request finishes the millisecond it stopped in, so it hands on
    // a cursor at the end of it.
    assert.equal(body.next, at(imported - 1));
    assert.deepEqual(w.audits[0]!.detail, { imported, partial: true });

    // Carrying on from `next` reads the rest.
    const rest = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
        body: JSON.stringify({ after: body.next }),
      }),
      w.deps,
    );
    // Nothing read by the first request is counted again by the second.
    const restImported = ((await rest.json()) as { imported: number }).imported;
    const stored = (await new AccountsStore(w.db).list({}, NOW)).total;
    assert.equal(imported + restImported, stored);
  });

  it('reports a Clerk failure with the cursor to retry from, and audits what it wrote', async () => {
    const directory = Array.from({ length: 3 * IMPORT_PAGE_SIZE }, (_, n) =>
      clerkUser(n),
    );
    const list = clerkDirectory(directory);
    let calls = 0;
    const w = deps({
      importPage: async (query) => {
        calls += 1;
        if (calls === 2) return { ok: false, error: 'Could not reach Clerk.' };
        return list(query);
      },
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Could not reach Clerk.',
      imported: IMPORT_PAGE_SIZE,
      next: at(IMPORT_PAGE_SIZE - 1) - 1,
      audited: true,
    });
    // The first page was written before the second failed, so the log
    // records it.
    assert.deepEqual(w.audits[0]!.detail, {
      imported: IMPORT_PAGE_SIZE,
      partial: true,
    });
  });

  it('audits nothing when the first page fails, since nothing was written', async () => {
    const w = deps({
      importPage: async () => ({ ok: false, error: 'Could not reach Clerk.' }),
    });
    const response = await handleAccountImport(
      new Request('https://app.test/api/admin/accounts/import', {
        method: 'POST',
      }),
      w.deps,
    );
    assert.equal(response.status, 502);
    assert.equal(w.audits.length, 0);
  });
});

describe("Clerk's user directory", () => {
  it('lists a page oldest first from a creation-time cursor, stepping past entries it cannot read', async () => {
    let url = '';
    const page = await listClerkUsers(
      { CLERK_SECRET_KEY: 'sk_test_x' },
      { after: 100, before: 200, limit: 3, offset: 500 },
      (async (input: RequestInfo | URL) => {
        url = String(input);
        return Response.json([
          {
            id: 'user_1',
            primary_email_address_id: 'e2',
            email_addresses: [
              {
                id: 'e1',
                email_address: 'old@example.com',
                verification: { status: 'verified' },
              },
              {
                id: 'e2',
                email_address: 'new@example.com',
                verification: { status: 'verified' },
              },
            ],
            created_at: 1,
            last_sign_in_at: 2,
          },
          {
            id: 'user_2',
            primary_email_address_id: 'e3',
            email_addresses: [
              {
                id: 'e3',
                email_address: 'claimed@example.com',
                verification: { status: 'unverified' },
              },
            ],
            created_at: 3,
            last_sign_in_at: null,
          },
          { nope: true },
        ]);
      }) as typeof fetch,
    );
    assert.equal(
      url,
      'https://api.clerk.com/v1/users?limit=3&order_by=%2Bcreated_at&created_at_after=100&created_at_before=200&offset=500',
    );
    assert.ok(page.ok);
    assert.equal(page.read, 3);
    assert.equal(page.lastCreatedAt, 3);
    // An unverified address is not imported: the account is, by id alone.
    assert.deepEqual(page.users, [
      {
        userId: 'user_1',
        email: 'new@example.com',
        createdAt: 1,
        lastSignInAt: 2,
        banned: null,
      },
      {
        userId: 'user_2',
        email: null,
        createdAt: 3,
        lastSignInAt: null,
        banned: null,
      },
    ]);
  });
});

describe("Clerk's user directory, from the start", () => {
  it('asks for the oldest accounts with no cursor', async () => {
    let url = '';
    await listClerkUsers(
      { CLERK_SECRET_KEY: 'sk_test_x' },
      { after: null, limit: 100 },
      (async (input: RequestInfo | URL) => {
        url = String(input);
        return Response.json([]);
      }) as typeof fetch,
    );
    assert.equal(
      url,
      'https://api.clerk.com/v1/users?limit=100&order_by=%2Bcreated_at',
    );
  });
});

describe('an admin action on an account that never signed in', () => {
  it('lists the account, unless the action was its deletion', async () => {
    const db = new SqliteD1Database(schemaSql());
    const entry = (action: AuditEntry['action'], targetUserId: string) => ({
      at: NOW.toISOString(),
      adminEmail: 'admin@example.com',
      action,
      targetUserId,
      target: null,
      reason: null,
      detail: null,
    });
    assert.equal(
      await appendAudit(db, entry('ban', 'user_banned_early')),
      true,
    );
    assert.equal(await appendAudit(db, entry('delete', 'user_gone')), true);
    const ids = (await new AccountsStore(db).list({}, NOW)).accounts.map(
      (a) => a.userId,
    );
    assert.deepEqual(ids, ['user_banned_early']);
  });
});

describe('/api/admin/admins', () => {
  it('lists the admins read-only, with the account each signs in as', async () => {
    const db = new SqliteD1Database(schemaSql());
    await new AccountsStore(db).recordSeen('user_b', 'b@example.com', NOW);
    const response = await handleAdminList(
      new Request('https://app.test/api/admin/admins'),
      { VIBLD_PLATFORM_ADMINS: 'B@example.com, c@example.com', DB: db },
      'clerk',
      null,
    );
    assert.deepEqual(await response.json(), {
      admins: [
        {
          identity: 'b@example.com',
          source: 'VIBLD_PLATFORM_ADMINS',
          userId: 'user_b',
        },
        {
          identity: 'c@example.com',
          source: 'VIBLD_PLATFORM_ADMINS',
          userId: null,
        },
      ],
    });
  });

  it('names only the owner on a one-owner copy', async () => {
    const response = await handleAdminList(
      new Request('https://app.test/api/admin/admins'),
      // A secret left over from before the copy moved to one owner names
      // people who can no longer sign in to it.
      { VIBLD_PLATFORM_ADMINS: 'owner@localhost, old@example.com' },
      'owner',
      'owner@localhost',
    );
    assert.deepEqual(await response.json(), {
      admins: [
        { identity: 'owner@localhost', source: 'owner', userId: 'owner' },
      ],
    });
  });

  it('lists the admins with no database, which only adds account links', async () => {
    const response = await handleAdminList(
      new Request('https://app.test/api/admin/admins'),
      { VIBLD_PLATFORM_ADMINS: 'a@example.com' },
      'clerk',
      null,
    );
    assert.deepEqual(await response.json(), {
      admins: [
        {
          identity: 'a@example.com',
          source: 'VIBLD_PLATFORM_ADMINS',
          userId: null,
        },
      ],
    });
    // And the Worker answers it before refusing for want of D1. Read from
    // the source: `worker/index.ts` imports `cloudflare:workers`, which
    // this runner cannot load (see access-gate.test.ts).
    const source = readFileSync(
      new URL('../worker/index.ts', import.meta.url),
      'utf8',
    );
    const block = source.slice(
      source.indexOf("pathname === '/api/admin/accounts' ||"),
    );
    assert.ok(
      block.indexOf('handleAdminList(') <
        block.indexOf("'Accounts are not configured here.'"),
      '/api/admin/admins is refused when there is no D1',
    );
    // Nor does the admin check itself refuse it for want of D1.
    assert.match(
      block.slice(0, block.indexOf('handleAdminList(')),
      /requireAdmin\(request, env, \{\s*needsDatabase: pathname !== '\/api\/admin\/admins',\s*\}\)/,
    );
    assert.match(
      source,
      /function adminConfigured\(env: Env, needsDatabase = true\)[\s\S]*?\(!needsDatabase \|\| Boolean\(env\.DB\)\)/,
    );
  });

  it('cannot change the list', async () => {
    const response = await handleAdminList(
      new Request('https://app.test/api/admin/admins', { method: 'POST' }),
      {},
      'clerk',
      null,
    );
    assert.equal(response.status, 405);
  });
});
