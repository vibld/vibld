import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import {
  describeBalance,
  formatCents,
  formatRate,
  formatShortDay,
  readOverview,
} from '../src/admin/overview-client.ts';
import {
  ADMIN_OVERVIEW_PATH,
  isAdminArea,
  isAdminOverviewPath,
} from '../src/admin/route.ts';
import { AdminOverview } from '../src/components/AdminOverview.tsx';

/** The platform overview page (docs/decisions.md D128), as it is wired. */

const day = (d: string, over: Record<string, number> = {}) => ({
  day: d,
  signups: 0,
  builders: 0,
  builds: 0,
  accepted: 0,
  failed: 0,
  cancelled: 0,
  spendMicroUsd: 0,
  revenueUsdCents: 0,
  refundedUsdCents: 0,
  ...over,
});

const OVERVIEW = {
  from: '2026-09-30',
  to: '2026-10-01',
  days: [
    day('2026-09-30', {
      signups: 2,
      builders: 2,
      builds: 3,
      accepted: 1,
      failed: 1,
      cancelled: 1,
      spendMicroUsd: 150_000,
      revenueUsdCents: 1_200,
    }),
    day('2026-10-01', { builds: 1, refundedUsdCents: 300 }),
  ],
  totals: {
    signups: 2,
    builders: 2,
    builds: 4,
    accepted: 1,
    failed: 1,
    cancelled: 1,
    spendMicroUsd: 150_000,
    revenueUsdCents: 1_200,
    refundedUsdCents: 300,
    failureRate: 0.5,
  },
  accounts: { total: 3, seen1d: 1, seen7d: 2, seen30d: 3 },
  unendedBuilds: 1,
  balances: [
    {
      provider: 'DeepSeek',
      balance: { amount: 42.5, currency: 'USD' },
      note: null,
    },
    {
      provider: 'Anthropic',
      balance: null,
      note: 'Not readable with a model key: it needs an Admin API key.',
    },
  ],
};

async function mount(isAdmin: boolean | null) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return Response.json(OVERVIEW);
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminOverview isAdmin={isAdmin} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    asked,
    text: () => container.textContent ?? '',
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the overview page', () => {
  it('fetches nothing until it knows the caller is an admin', async () => {
    const checking = await mount(null);
    assert.deepEqual(checking.asked, []);
    assert.match(checking.text(), /Checking your access/);
    checking.unmount();
    const denied = await mount(false);
    assert.deepEqual(denied.asked, []);
    assert.match(denied.text(), /Nothing here/);
    denied.unmount();
  });

  it('shows the totals, the balances, and the days newest first', async () => {
    const page = await mount(true);
    assert.deepEqual(page.asked, ['/api/admin/overview?days=30']);
    const text = page.text();
    assert.match(text, /Builds: 4 \(1 accepted, 1 failed, 1 canceled\)/);
    assert.match(text, /Failure rate: 50%/);
    assert.match(text, /Taken: \$12\.00, refunded \$3\.00, net \$9\.00/);
    assert.match(text, /Seen in the last day 1, week 2, 30 days 3/);
    assert.match(text, /DeepSeek: 42\.50 USD/);
    assert.match(text, /Anthropic: Not readable with a model key/);
    const rows = [...page.container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.textContent,
    );
    assert.deepEqual(rows, ['Oct 1', 'Sep 30']);
    const heads = [...page.container.querySelectorAll('thead th')].map(
      (th) => th.textContent,
    );
    const sep30 = [
      ...page.container.querySelectorAll('tbody tr:last-child td'),
    ].map((td) => td.textContent);
    const at = (name: string) => sep30[heads.indexOf(name)];
    assert.deepEqual(
      [at('Builds'), at('Accepted'), at('Failed'), at('Canceled')],
      ['3', '1', '1', '1'],
    );
    page.unmount();
  });

  it('asks again for another window', async () => {
    const page = await mount(true);
    const week = [...page.container.querySelectorAll('button')].find(
      (button) => button.textContent === '7 days',
    )!;
    await act(async () => {
      week.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(page.asked.at(-1), '/api/admin/overview?days=7');
    assert.equal(week.getAttribute('aria-pressed'), 'true');
    page.unmount();
  });
});

describe('what the overview says', () => {
  it('formats money, rates and days', () => {
    assert.equal(formatCents(1_234), '$12.34');
    assert.equal(formatRate(null), 'n/a');
    assert.equal(formatRate(0.123), '12%');
    assert.equal(formatShortDay('2026-01-05'), 'Jan 5');
    assert.equal(
      describeBalance({ provider: 'X', balance: null, note: null }),
      'Not available.',
    );
  });

  it('drops what it cannot read', () => {
    const read = readOverview({
      ...OVERVIEW,
      days: [day('yesterday'), day('2026-10-01'), 'x'],
      balances: [{ provider: 'X', balance: { amount: 'lots' } }, 7],
      totals: { failureRate: 'high' },
    })!;
    assert.deepEqual(
      read.days.map((each) => each.day),
      ['2026-10-01'],
    );
    assert.deepEqual(read.balances, [
      { provider: 'X', balance: null, note: null },
    ]);
    assert.equal(read.totals.failureRate, null);
    assert.equal(read.totals.builds, 0);
    assert.equal(readOverview({ days: 'none' }), null);
  });

  it('has a page of its own the builder steps aside for', () => {
    assert.equal(isAdminOverviewPath(ADMIN_OVERVIEW_PATH), true);
    assert.equal(isAdminOverviewPath(`${ADMIN_OVERVIEW_PATH}/`), true);
    assert.equal(isAdminOverviewPath('/admin/overviews'), false);
    assert.equal(isAdminArea(ADMIN_OVERVIEW_PATH), true);
  });
});
