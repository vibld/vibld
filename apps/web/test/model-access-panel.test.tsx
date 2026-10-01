import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { describeAuditEntry } from '../src/admin/admin-users-client.ts';
import { fetchModelAccess, toggled } from '../src/admin/models-client.ts';
import { ModelAccessPanel } from '../src/components/ModelAccessPanel.tsx';

/** The Models panel (docs/decisions.md D133), as it is wired. */

const CATALOG = [
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    provider: 'anthropic',
    deployable: true,
  },
  {
    id: 'gpt-6-luna',
    label: 'GPT-6 Luna',
    provider: 'openai',
    deployable: true,
  },
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    provider: 'deepseek',
    deployable: false,
  },
];

const STARTING = {
  catalog: CATALOG,
  plans: {
    free: ['gpt-6-luna'],
    build: CATALOG.map((model) => model.id),
    ship: CATALOG.map((model) => model.id),
  },
  saved: null,
  policySet: true,
};

const SAVED = {
  ...STARTING,
  saved: { updatedAt: '2026-10-01T05:00:00.000Z', updatedBy: 'a@example.com' },
};

async function mount(shown: unknown) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({
        url: String(input),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return Response.json({ ok: true, audited: true, ...SAVED });
    }
    return Response.json(shown);
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ModelAccessPanel />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const box = (label: string) =>
    container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const button = (label: RegExp) =>
    [...container.querySelectorAll('button')].find((each) =>
      label.test(each.textContent ?? ''),
    ) as HTMLButtonElement | undefined;
  async function click(target: HTMLElement) {
    await act(async () => {
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return {
    posts,
    box,
    button,
    click,
    text: () => container.textContent ?? '',
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the Models panel', () => {
  it('shows the starting setting and says the policy decides until saved', async () => {
    const panel = await mount(STARTING);
    assert.match(panel.text(), /Not saved yet: VIBLD_MODEL_POLICY decides/);
    assert.equal(panel.box('GPT-6 Luna on Free').checked, true);
    assert.equal(panel.box('Claude Sonnet 5 on Free').checked, false);
    assert.equal(panel.box('Claude Sonnet 5 on Ship').checked, true);
    assert.match(panel.text(), /DeepSeek Flash \(no key, not offered\)/);
    // Nothing to go back from.
    assert.equal(panel.button(/^Go back to the policy$/), undefined);
    panel.unmount();
  });

  it('saves all three plans at once, with what was ticked', async () => {
    const panel = await mount(STARTING);
    await panel.click(panel.box('Claude Sonnet 5 on Free'));
    await panel.click(panel.box('DeepSeek Flash on Build'));
    await panel.click(panel.button(/^Save model access$/)!);
    assert.deepEqual(panel.posts, [
      {
        url: '/api/admin/models',
        body: {
          plans: {
            free: ['claude-sonnet-5', 'gpt-6-luna'],
            build: ['claude-sonnet-5', 'gpt-6-luna'],
            ship: ['claude-sonnet-5', 'gpt-6-luna', 'deepseek-flash'],
          },
        },
      },
    ]);
    assert.match(panel.text(), /Saved which models each plan includes\./);
    assert.match(panel.text(), /These lists decide/);
    panel.unmount();
  });

  it('goes back to the policy only after a second click', async () => {
    const panel = await mount(SAVED);
    await panel.click(panel.button(/^Go back to the policy$/)!);
    assert.deepEqual(panel.posts, []);
    await panel.click(panel.button(/^Stop using these lists$/)!);
    assert.deepEqual(panel.posts, [
      { url: '/api/admin/models/reset', body: {} },
    ]);
    panel.unmount();
  });
});

describe('what the models client reads', () => {
  it('keeps catalog order when a box is ticked or cleared', () => {
    assert.deepEqual(
      toggled(CATALOG, ['deepseek-flash'], 'claude-sonnet-5', true),
      ['claude-sonnet-5', 'deepseek-flash'],
    );
    assert.deepEqual(
      toggled(CATALOG, ['gpt-6-luna', 'deepseek-flash'], 'gpt-6-luna', false),
      ['deepseek-flash'],
    );
  });

  it('refuses an answer with no plans', async () => {
    const result = await fetchModelAccess(
      (async () => Response.json({ catalog: CATALOG })) as typeof fetch,
      async () => null,
    );
    assert.equal(result.ok, false);
  });

  it('describes each change in the audit log', () => {
    const base = {
      id: 1,
      at: '2026-10-01T05:00:00.000Z',
      adminEmail: 'a@example.com',
      targetUserId: null,
      target: null,
      reason: null,
    };
    assert.equal(
      describeAuditEntry({
        ...base,
        action: 'model-access',
        detail: { free: ['gpt-6-luna'], build: [], ship: ['a', 'b'] },
      }),
      'Set which models each plan includes · Free 1, Build 0, Ship 2 models · by a@example.com',
    );
    assert.equal(
      describeAuditEntry({
        ...base,
        action: 'person-models',
        targetUserId: 'user_a',
        detail: { models: ['claude-sonnet-5'] },
      }),
      'Set extra models (user_a) · claude-sonnet-5 · by a@example.com',
    );
  });
});
