import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { describeAuditEntry } from '../src/admin/admin-users-client.ts';
import {
  describeProjectLimit,
  fetchPlans,
  parsePlanFields,
} from '../src/admin/plans-client.ts';
import { PlansPanel } from '../src/components/PlansPanel.tsx';

/** The Plans panel (docs/decisions.md D134), as it is wired. */

const PLANS = [
  {
    tier: 'free',
    limits: { activeProjectLimit: 5, monthlyAllowanceMicroUsd: 2_500_000 },
    code: { activeProjectLimit: 3, monthlyAllowanceMicroUsd: 1_000_000 },
    saved: {
      activeProjectLimit: 5,
      monthlyAllowanceMicroUsd: 2_500_000,
      updatedAt: '2026-10-01T04:00:00.000Z',
      updatedBy: 'admin@example.com',
    },
  },
  {
    tier: 'build',
    limits: { activeProjectLimit: null, monthlyAllowanceMicroUsd: 14_000_000 },
    code: { activeProjectLimit: null, monthlyAllowanceMicroUsd: 14_000_000 },
    saved: null,
  },
  {
    tier: 'ship',
    limits: { activeProjectLimit: null, monthlyAllowanceMicroUsd: 40_000_000 },
    code: { activeProjectLimit: null, monthlyAllowanceMicroUsd: 40_000_000 },
    saved: null,
  },
];

async function mount(answered: unknown[] = PLANS) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({
        url: String(input),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return Response.json({ ok: true, audited: true, plans: answered });
    }
    return Response.json({ plans: PLANS });
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<PlansPanel />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const group = (name: string) =>
    container.querySelector(`[aria-label="${name}"]`)!;
  const inputs = (name: string) =>
    [...group(name).querySelectorAll('input')] as HTMLInputElement[];
  const button = (name: string, label: RegExp) =>
    [...group(name).querySelectorAll('button')].find((b) =>
      label.test(b.textContent ?? ''),
    ) as HTMLButtonElement | undefined;
  async function type(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function click(target: HTMLElement) {
    await act(async () => {
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return {
    posts,
    group,
    inputs,
    button,
    type,
    click,
    text: () => container.textContent ?? '',
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the Plans panel', () => {
  it('shows each plan’s limits now, and the code’s beside a saved one', async () => {
    const panel = await mount();
    const free = panel.group('Free').textContent ?? '';
    assert.match(free, /Now: 5 active projects, \$2\.50 a month\./);
    assert.match(
      free,
      /Set Oct 1, 2026 by admin@example\.com; in code: 3 active projects, \$1\.00\./,
    );
    assert.match(
      panel.group('Build').textContent ?? '',
      /Now: No project limit, \$14\.00 a month\. The limits in code\./,
    );
    // Reset only where there is something to reset.
    assert.ok(panel.button('Free', /^Reset to code$/));
    assert.equal(panel.button('Build', /^Reset to code$/), undefined);
    assert.match(
      panel.text(),
      /vibld\.com\/pricing is built from the limits in code/,
    );
    panel.unmount();
  });

  it('saves what was typed, blank as no limit', async () => {
    const panel = await mount();
    const [limit, allowance] = panel.inputs('Build');
    assert.equal(limit!.value, '');
    assert.equal(allowance!.value, '14.00');
    await panel.type(limit!, '25');
    await panel.type(allowance!, '$12.5');
    await panel.click(panel.button('Build', /^Save$/)!);
    assert.deepEqual(panel.posts, [
      {
        url: '/api/admin/plans',
        body: {
          tier: 'build',
          activeProjectLimit: 25,
          monthlyAllowanceUsdCents: 1_250,
        },
      },
    ]);
    assert.match(panel.text(), /Saved the Build plan's limits\./);
    panel.unmount();
  });

  it('refuses what it cannot send, and sends nothing', async () => {
    const panel = await mount();
    const [limit] = panel.inputs('Ship');
    await panel.type(limit!, '2.5');
    await panel.click(panel.button('Ship', /^Save$/)!);
    assert.deepEqual(panel.posts, []);
    assert.match(panel.text(), /whole number from 0 to 1000/);
    panel.unmount();
  });

  it('resets a plan to the code’s, and its fields with it', async () => {
    const reset = [
      { ...PLANS[0], limits: PLANS[0]!.code, saved: null },
      PLANS[1],
      PLANS[2],
    ];
    const panel = await mount(reset);
    assert.deepEqual(
      panel.inputs('Free').map((input) => input.value),
      ['5', '2.50'],
    );
    await panel.click(panel.button('Free', /^Reset to code$/)!);
    assert.deepEqual(panel.posts, [
      { url: '/api/admin/plans/reset', body: { tier: 'free' } },
    ]);
    // The fields show the limits now in force, so Save does not put the
    // old ones back (Codex review of internal PR 343).
    assert.deepEqual(
      panel.inputs('Free').map((input) => input.value),
      ['3', '1.00'],
    );
    assert.equal(panel.button('Free', /^Reset to code$/), undefined);
    panel.unmount();
  });
});

describe('what the plans client reads', () => {
  it('parses the fields an admin types', () => {
    assert.deepEqual(parsePlanFields('', '1'), {
      ok: true,
      activeProjectLimit: null,
      monthlyAllowanceUsdCents: 100,
    });
    assert.deepEqual(parsePlanFields(' 0 ', '0'), {
      ok: true,
      activeProjectLimit: 0,
      monthlyAllowanceUsdCents: 0,
    });
    assert.equal(parsePlanFields('1001', '1').ok, false);
    assert.equal(parsePlanFields('-1', '1').ok, false);
    assert.equal(parsePlanFields('1', '').ok, false);
    assert.equal(parsePlanFields('1', '10000.01').ok, false);
    assert.equal(parsePlanFields('1', 'ten').ok, false);
    assert.equal(describeProjectLimit(1), '1 active project');
    assert.equal(describeProjectLimit(null), 'No project limit');
  });

  it('drops a plan it cannot read', async () => {
    const result = await fetchPlans(
      (async () =>
        Response.json({
          plans: [PLANS[1], { tier: 'gold' }, { ...PLANS[2], limits: null }],
        })) as typeof fetch,
      async () => null,
    );
    assert.ok(result.ok);
    assert.deepEqual(
      result.value.plans.map((plan) => plan.tier),
      ['build'],
    );
  });

  it('describes a change in the audit log', () => {
    assert.match(
      describeAuditEntry({
        id: 1,
        at: '2026-10-01T00:00:00.000Z',
        adminEmail: 'admin@example.com',
        action: 'plan-limits',
        targetUserId: null,
        target: 'free',
        reason: null,
        detail: { activeProjectLimit: 5, monthlyAllowanceMicroUsd: 2_500_000 },
      }),
      /^Set a plan's limits \(free\) · 5 active projects, \$2\.50 a month · by admin@example\.com$/,
    );
  });
});
