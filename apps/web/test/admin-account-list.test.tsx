import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import {
  DEFAULT_FILTERS,
  accountListQuery,
  describeExport,
  describeRange,
  describeSpend,
  fetchAccountList,
  fetchAccountsCsv,
  fetchAdminList,
  nextSort,
  pageCount,
  postAccountImport,
} from '../src/admin/accounts-client.ts';
import type { AccountListRow } from '../src/admin/accounts-client.ts';
import { describeAuditEntry } from '../src/admin/admin-users-client.ts';
import {
  ADMIN_ACCOUNTS_PATH,
  isAdminAccountsPath,
  isAdminArea,
} from '../src/admin/route.ts';
import { AdminAccountList } from '../src/components/AdminAccountList.tsx';

const noToken = async () => null;

function row(overrides: Partial<AccountListRow> = {}): AccountListRow {
  return {
    userId: 'user_a',
    email: 'a@example.com',
    firstSeenAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-10-01T00:00:00.000Z',
    plan: 'build',
    gifted: false,
    banned: false,
    suspended: false,
    activeProjects: 2,
    spendMicroUsd: 1_500_000,
    monthSpendMicroUsd: 0,
    ...overrides,
  };
}

describe('the account list, in the browser (D128)', () => {
  it('asks for only what differs from the defaults', () => {
    assert.equal(accountListQuery(DEFAULT_FILTERS), 'pageSize=50');
    assert.equal(
      accountListQuery({
        search: '  ana ',
        plan: 'ship',
        status: 'banned',
        since: '2026-10-01',
        sort: 'email',
        direction: 'asc',
        page: 2,
      }),
      'q=ana&plan=ship&status=banned&since=2026-10-01&sort=email&dir=asc&page=2&pageSize=50',
    );
    assert.equal(
      accountListQuery(
        { ...DEFAULT_FILTERS, since: 'not a date' },
        { format: 'csv' },
      ),
      'pageSize=50&format=csv',
    );
  });

  it('flips a column it already sorts by, and starts a new one from the top', () => {
    const bySpend = nextSort(DEFAULT_FILTERS, 'spend');
    assert.deepEqual([bySpend.sort, bySpend.direction], ['spend', 'desc']);
    const flipped = nextSort({ ...bySpend, page: 4 }, 'spend');
    assert.deepEqual([flipped.direction, flipped.page], ['asc', 1]);
    assert.equal(nextSort(DEFAULT_FILTERS, 'email').direction, 'asc');
  });

  it('says what range it shows', () => {
    const page = {
      accounts: [row(), row({ userId: 'user_b' })],
      total: 52,
      page: 2,
      pageSize: 50,
      canImport: false,
    };
    assert.equal(describeRange(page), 'Showing 51 to 52 of 52');
    assert.equal(pageCount(page), 2);
    assert.equal(
      describeRange({ ...page, accounts: [], total: 0 }),
      'No accounts match.',
    );
    // Past the last page is not "nothing matches".
    assert.equal(
      describeRange({ ...page, accounts: [], total: 4, page: 9 }),
      'Page 9 is past the end: 4 accounts match, on 1 page.',
    );
    assert.equal(describeExport(10, 10), null);
    assert.equal(
      describeExport(5000, 5210),
      'The file holds the first 5000 of 5210 matching accounts. Narrow the filters to export the rest.',
    );
    assert.equal(describeSpend(row()), '$1.50');
    assert.equal(
      describeSpend(row({ monthSpendMicroUsd: 250_000 })),
      '$1.50 ($0.25 this month)',
    );
  });

  it('reads a page, dropping rows it cannot read', async () => {
    let asked = '';
    const result = await fetchAccountList(
      { ...DEFAULT_FILTERS, plan: 'free' },
      (async (input: RequestInfo | URL) => {
        asked = String(input);
        return Response.json({
          accounts: [row(), { userId: 7 }, { ...row(), plan: 'gold' }],
          total: 3,
          page: 1,
          pageSize: 50,
          canImport: true,
        });
      }) as typeof fetch,
      noToken,
    );
    assert.equal(asked, '/api/admin/accounts?plan=free&pageSize=50');
    assert.ok(result.ok);
    assert.equal(result.value.accounts.length, 1);
    assert.equal(result.value.canImport, true);
  });

  it("names the export after the Worker's file", async () => {
    let asked = '';
    const result = await fetchAccountsCsv(
      { ...DEFAULT_FILTERS, page: 3 },
      (async (input: RequestInfo | URL) => {
        asked = String(input);
        return new Response('user_id\r\n', {
          headers: {
            'content-disposition':
              'attachment; filename="vibld-accounts-2026-10-15.csv"',
            'x-accounts-exported': '5000',
            'x-accounts-total': '5210',
          },
        });
      }) as typeof fetch,
      noToken,
    );
    assert.equal(asked, '/api/admin/accounts?pageSize=50&format=csv');
    assert.ok(result.ok);
    assert.equal(result.value.filename, 'vibld-accounts-2026-10-15.csv');
    assert.deepEqual([result.value.exported, result.value.total], [5000, 5210]);
  });

  it('posts an import from a cursor and reads where to carry on', async () => {
    let sent = '';
    const result = await postAccountImport(
      300,
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = String(init?.body);
        return Response.json({ imported: 100, next: 400, audited: true });
      }) as typeof fetch,
      noToken,
    );
    assert.equal(sent, '{"after":300}');
    assert.deepEqual(result, {
      ok: true,
      value: { imported: 100, next: 400, audited: true },
    });
  });

  it('keeps what an import wrote before it failed part way', async () => {
    const result = await postAccountImport(
      null,
      (async () =>
        Response.json(
          {
            error: 'Could not reach Clerk.',
            imported: 100,
            next: 100,
            audited: false,
          },
          { status: 502 },
        )) as typeof fetch,
      noToken,
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'Could not reach Clerk.',
      imported: 100,
      audited: false,
    });
  });

  it('reads the admin list', async () => {
    const result = await fetchAdminList(
      (async () =>
        Response.json({
          admins: [
            {
              identity: 'a@example.com',
              source: 'VIBLD_PLATFORM_ADMINS',
              userId: null,
            },
            { identity: 5 },
          ],
        })) as typeof fetch,
      noToken,
    );
    assert.deepEqual(result, {
      ok: true,
      value: [
        {
          identity: 'a@example.com',
          source: 'VIBLD_PLATFORM_ADMINS',
          userId: null,
        },
      ],
    });
  });

  it('has a page of its own the builder steps aside for', () => {
    assert.equal(isAdminAccountsPath(ADMIN_ACCOUNTS_PATH), true);
    assert.equal(isAdminAccountsPath(`${ADMIN_ACCOUNTS_PATH}/`), true);
    assert.equal(isAdminAccountsPath('/admin/accountsx'), false);
    assert.equal(isAdminArea(ADMIN_ACCOUNTS_PATH), true);
  });

  it('describes an import in the audit log', () => {
    assert.match(
      describeAuditEntry({
        id: 1,
        at: '2026-10-15T00:00:00.000Z',
        adminEmail: 'admin@example.com',
        action: 'accounts-import',
        targetUserId: null,
        target: null,
        reason: null,
        detail: { imported: 240 },
      }),
      /^Imported accounts from Clerk · 240 accounts · by admin@example.com$/,
    );
  });
});

async function mount(
  isAdmin: boolean | null,
  answer: (url: string) => unknown,
) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    return Response.json(answer(url));
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminAccountList isAdmin={isAdmin} />);
  });
  // Let the list and admin fetches settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    asked,
    text: () => container.textContent ?? '',
    unmount: () => act(() => root.unmount()),
  };
}

describe('the account list page', () => {
  const listing = (url: string) =>
    url.startsWith('/api/admin/admins')
      ? {
          admins: [
            {
              identity: 'admin@example.com',
              source: 'VIBLD_PLATFORM_ADMINS',
              userId: 'user_admin',
            },
          ],
        }
      : {
          accounts: [
            row(),
            row({
              userId: 'user_b',
              email: null,
              plan: 'ship',
              gifted: true,
              banned: true,
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 50,
          canImport: false,
        };

  it('fetches nothing and draws nothing until it knows the caller is an admin', async () => {
    const page = await mount(null, listing);
    assert.deepEqual(page.asked, []);
    assert.match(page.text(), /Checking your access/);
    await page.unmount();
    const denied = await mount(false, listing);
    assert.deepEqual(denied.asked, []);
    assert.match(denied.text(), /Nothing here/);
    await denied.unmount();
  });

  it('lists accounts linking to their pages, and the admins read-only', async () => {
    const page = await mount(true, listing);
    const links = [...page.container.querySelectorAll('tbody a')].map((a) =>
      a.getAttribute('href'),
    );
    assert.deepEqual(links, ['/admin/users/user_a', '/admin/users/user_b']);
    assert.match(page.text(), /Showing 1 to 2 of 2/);
    assert.match(page.text(), /Ship \(gifted\)/);
    assert.match(page.text(), /Banned/);
    assert.match(page.text(), /VIBLD_PLATFORM_ADMINS/);
    // No directory to import from, so no button offering one.
    assert.doesNotMatch(page.text(), /Import from Clerk/);
    // Nothing on the page changes who is an admin.
    const adminGroup = page.container.querySelector(
      '[aria-label="Platform admins"]',
    )!;
    assert.equal(adminGroup.querySelectorAll('button, input').length, 0);
    await page.unmount();
  });

  it('asks again, from page one, when a column is sorted', async () => {
    const page = await mount(true, listing);
    const spend = [...page.container.querySelectorAll('th button')].find(
      (b) => b.textContent === 'Spend',
    ) as HTMLButtonElement;
    await act(async () => {
      spend.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      page.asked.filter((url) => url.startsWith('/api/admin/accounts')).at(-1),
      '/api/admin/accounts?sort=spend&pageSize=50',
    );
    await page.unmount();
  });

  it('tells a one-owner copy where its admin comes from, not the admin secret', async () => {
    const page = await mount(true, (url) =>
      url.startsWith('/api/admin/admins')
        ? {
            admins: [
              { identity: 'me@example.com', source: 'owner', userId: 'owner' },
            ],
          }
        : { accounts: [], total: 0, page: 1, pageSize: 50, canImport: false },
    );
    const group = page.container.querySelector(
      '[aria-label="Platform admins"]',
    )!;
    assert.match(group.textContent ?? '', /VIBLD_OWNER_EMAIL/);
    assert.doesNotMatch(group.textContent ?? '', /VIBLD_PLATFORM_ADMINS/);
    await page.unmount();
  });

  it('offers the Clerk import only where there is a directory', async () => {
    const page = await mount(true, (url) =>
      url.startsWith('/api/admin/admins')
        ? { admins: [] }
        : { accounts: [], total: 0, page: 1, pageSize: 50, canImport: true },
    );
    assert.match(page.text(), /Import from Clerk/);
    assert.match(page.text(), /No accounts match/);
    await page.unmount();
  });
});
