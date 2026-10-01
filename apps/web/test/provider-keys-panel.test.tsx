import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { describeAuditEntry } from '../src/admin/admin-users-client.ts';
import { describeKey, fetchKeys } from '../src/admin/keys-client.ts';
import { ProviderKeysPanel } from '../src/components/ProviderKeysPanel.tsx';

/** The provider keys panel (docs/decisions.md D127, D131), as it is wired. */

const KEYS = [
  {
    provider: 'anthropic',
    name: 'Anthropic',
    source: 'secret',
    last4: 'abcd',
    stored: false,
    unreadable: false,
    storedLast4: null,
    updatedAt: null,
    updatedBy: null,
    secretSet: true,
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    source: 'panel',
    last4: 'wxyz',
    stored: true,
    unreadable: false,
    storedLast4: 'wxyz',
    updatedAt: '2026-10-01T03:00:00.000Z',
    updatedBy: 'admin@example.com',
    secretSet: false,
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    source: null,
    last4: null,
    stored: false,
    unreadable: false,
    storedLast4: null,
    updatedAt: null,
    updatedBy: null,
    secretSet: false,
  },
];

async function mount(canStore = true) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      return Response.json({ ok: true, audited: true, keys: KEYS });
    }
    return Response.json({ keys: KEYS, canStore });
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ProviderKeysPanel />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const group = (name: string) =>
    container.querySelector(`[aria-label="${name}"]`)!;
  const button = (scope: Element, label: RegExp) =>
    [...scope.querySelectorAll('button')].find((b) =>
      label.test(b.textContent ?? ''),
    )!;
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
    container,
    posts,
    group,
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

describe('the provider keys panel', () => {
  it('says where each key comes from, by its last four only', async () => {
    const panel = await mount();
    assert.match(panel.text(), /From the Worker secret, ending abcd/);
    assert.match(
      panel.text(),
      /Set here, ending wxyz\. Set Oct 1, 2026 by admin@example\.com/,
    );
    assert.match(
      panel.text(),
      /No key\. Models from this provider are not offered/,
    );
    // A key field is never readable back off the page.
    for (const input of panel.container.querySelectorAll('input')) {
      assert.equal(input.getAttribute('type'), 'password');
      assert.equal(input.getAttribute('autocomplete'), 'off');
    }
    panel.unmount();
  });

  it('sends a typed key once, then clears the field', async () => {
    const panel = await mount();
    const openai = panel.group('OpenAI');
    const field = openai.querySelector('input') as HTMLInputElement;
    const save = panel.button(openai, /^Save$/) as HTMLButtonElement;
    assert.equal(save.disabled, true);
    await panel.type(field, 'sk-openai-typed-1234');
    await panel.click(save);
    assert.deepEqual(panel.posts, [
      {
        url: '/api/admin/keys',
        body: { provider: 'openai', key: 'sk-openai-typed-1234' },
      },
    ]);
    assert.equal(field.value, '');
    assert.match(panel.text(), /Saved the OpenAI key\./);
    panel.unmount();
  });

  it('asks before removing a key', async () => {
    const panel = await mount();
    const deepseek = panel.group('DeepSeek');
    await panel.click(panel.button(deepseek, /^Remove$/));
    assert.deepEqual(panel.posts, []);
    await panel.click(panel.button(deepseek, /Remove the DeepSeek key/));
    assert.deepEqual(panel.posts, [
      { url: '/api/admin/keys/remove', body: { provider: 'deepseek' } },
    ]);
    // Only a key the panel holds can be removed here.
    assert.equal(panel.button(panel.group('Anthropic'), /^Remove$/), undefined);
    panel.unmount();
  });

  it('turns the fields off where keys cannot be stored, and says why', async () => {
    const panel = await mount(false);
    assert.match(panel.text(), /no VIBLD_KEY_ENCRYPTION_KEY/);
    for (const input of panel.container.querySelectorAll('input')) {
      assert.equal((input as HTMLInputElement).disabled, true);
    }
    panel.unmount();
  });
});

describe('what the keys client keeps', () => {
  it('never holds more than four characters of a key', async () => {
    const result = await fetchKeys(
      (async () =>
        Response.json({
          keys: [{ ...KEYS[0], last4: 'sk-ant-whole-key' }, { provider: 'x' }],
          canStore: true,
        })) as typeof fetch,
      async () => null,
    );
    assert.ok(result.ok);
    assert.equal(result.value.keys.length, 1);
    assert.equal(result.value.keys[0]!.last4, '-key');
    assert.equal(
      describeKey({
        ...result.value.keys[0]!,
        source: 'panel',
        secretSet: true,
      }),
      'Set here, ending -key. Used instead of the Worker secret.',
    );
  });

  it('says a stored key that does not open is not in use, and what is', () => {
    const base = {
      provider: 'openai' as const,
      name: 'OpenAI',
      stored: true,
      unreadable: true,
      storedLast4: 'wxyz',
      updatedAt: null,
      updatedBy: null,
    };
    assert.equal(
      describeKey({
        ...base,
        source: 'secret',
        last4: 'abcd',
        secretSet: true,
      }),
      "A key ending wxyz is stored here but cannot be opened with this deployment's encryption key, so it is not used. The Worker secret, ending abcd, is used instead. Set it again, or remove it.",
    );
    assert.match(
      describeKey({ ...base, source: null, last4: null, secretSet: false }),
      /No key is in use for this provider\./,
    );
  });

  it('describes a key change in the audit log by its last four', () => {
    assert.match(
      describeAuditEntry({
        id: 1,
        at: '2026-10-01T00:00:00.000Z',
        adminEmail: 'admin@example.com',
        action: 'provider-key-set',
        targetUserId: null,
        target: 'openai',
        reason: null,
        detail: { last4: 'wxyz' },
      }),
      /^Set a provider key \(openai\) · ending wxyz · by admin@example\.com$/,
    );
  });
});
