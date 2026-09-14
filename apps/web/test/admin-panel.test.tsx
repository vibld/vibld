import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { AdminPanel } from '../src/components/AdminPanel.tsx';

/**
 * The tool that moves other people's money, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 */

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Answers the first route whose path the request's URL contains. */
function serving(
  answers: Record<string, () => Response | Promise<Response>>,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      ...(init?.body
        ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
        : {}),
    });
    for (const [path, answer] of Object.entries(answers)) {
      if (url.includes(path)) return answer();
    }
    throw new Error(`nothing is serving ${url}`);
  }) as typeof fetch;
  return calls;
}

/**
 * A reply held back, so a request can be caught mid-flight. `land` resolves
 * it and drains the microtasks behind it: the request settling is several
 * awaits away from the state it sets.
 */
function held(response: () => Response) {
  let open: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    answer: async () => {
      await waiting;
      return response();
    },
    async land() {
      await act(async () => {
        open?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminPanel />);
  });
  const field = (selector: string): HTMLInputElement => {
    const input = container.querySelector<HTMLInputElement>(selector);
    assert.ok(input, `no ${selector}`);
    return input;
  };
  const find = (label: RegExp): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((button) =>
      label.test(button.textContent ?? ''),
    );
  async function fill(selector: string, value: string) {
    const input = field(selector);
    await act(async () => {
      // What React listens for: setting `.value` alone does not notify it.
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  return {
    container,
    text: () => container.textContent ?? '',
    email: (value: string) => fill('input[type="email"]', value),
    amount: (value: string) => fill('input[type="number"]', value),
    note: (value: string) => fill('input[type="text"]', value),
    async lookUp() {
      const button = find(/Look up/);
      assert.ok(button, 'no lookup button');
      await act(async () => {
        button.click();
      });
    },
    async grant() {
      const form = container.querySelector('form');
      assert.ok(form, 'no grant form');
      await act(async () => {
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const FOUND = {
  userId: 'user_alice',
  spendableCreditMicroUsd: 1_000_000,
  grants: [
    {
      creditUsdCents: 500,
      grantedByEmail: 'admin@vibld.com',
      note: 'outage',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('granting credit, as it is actually wired', () => {
  it('shows who was found, what they can spend, and what they were given before', async () => {
    serving({ '/api/admin/user': () => reply(FOUND) });
    const view = await mount();
    await view.email('alice@example.com');
    await view.lookUp();

    assert.match(view.text(), /user_alice has \$1\.00 spendable credit/);
    assert.match(view.text(), /\$5\.00 by admin@vibld\.com \(outage\)/);
    view.unmount();
  });

  it('sends the address, the amount in cents and the note', async () => {
    const calls = serving({
      '/api/admin/user': () => reply(FOUND),
      '/api/admin/topup': () =>
        reply({ userId: 'user_alice', creditUsdCents: 250 }),
    });
    const view = await mount();
    await view.email('alice@example.com');
    await view.amount('2.50');
    await view.note('goodwill');
    await view.grant();

    const topup = calls.find((call) => call.url.includes('/topup'));
    assert.equal(topup?.method, 'POST');
    assert.deepEqual(topup?.body, {
      email: 'alice@example.com',
      amountUsdCents: 250,
      note: 'goodwill',
    });
    view.unmount();
  });

  it('says what was granted and to whom', async () => {
    // The only thing that says the money moved. Without it the fields simply
    // empty themselves, which is what a failure looks like too, and the
    // answer to a grant that looks like it failed is to make it again.
    serving({
      '/api/admin/user': () => reply(FOUND),
      '/api/admin/topup': () =>
        reply({ userId: 'user_alice', creditUsdCents: 250 }),
    });
    const view = await mount();
    await view.email('alice@example.com');
    await view.amount('2.50');
    await view.grant();

    assert.match(view.text(), /Granted \$2\.50 to user_alice/);
    view.unmount();
  });

  it('keeps that confirmation when the refresh behind it fails', async () => {
    // The refresh is not the confirmation. A 503 on the way to re-reading
    // the balance says nothing about the grant that already landed.
    serving({
      '/api/admin/user': () => reply({ error: 'Lookup is down.' }, 503),
      '/api/admin/topup': () =>
        reply({ userId: 'user_alice', creditUsdCents: 250 }),
    });
    const view = await mount();
    await view.email('alice@example.com');
    await view.amount('2.50');
    await view.grant();

    assert.match(view.text(), /Granted \$2\.50 to user_alice/);
    view.unmount();
  });

  it('refuses an amount that is not money, without asking the server', async () => {
    const calls = serving({ '/api/admin/user': () => reply(FOUND) });
    const view = await mount();
    await view.email('alice@example.com');
    await view.amount('0');
    await view.grant();

    assert.equal(
      calls.filter((call) => call.url.includes('/topup')).length,
      0,
      'it asked the server to grant nothing',
    );
    assert.match(view.text(), /positive dollar amount/);
    view.unmount();
  });

  it('says why a refused grant was refused', async () => {
    serving({
      '/api/admin/user': () => reply(FOUND),
      '/api/admin/topup': () =>
        reply({ error: 'That user does not exist.' }, 404),
    });
    const view = await mount();
    await view.email('nobody@example.com');
    await view.amount('2.50');
    await view.grant();

    assert.match(view.text(), /That user does not exist/);
    view.unmount();
  });

  it('stops naming one user beside a form aimed at another', async () => {
    // A balance and a grant history are statements about an address. Once
    // the field names somebody else they are about somebody else.
    serving({ '/api/admin/user': () => reply(FOUND) });
    const view = await mount();
    await view.email('alice@example.com');
    await view.lookUp();
    assert.match(view.text(), /user_alice/);

    await view.email('bob@example.com');
    assert.doesNotMatch(
      view.text(),
      /user_alice/,
      "it kept one user's credit beside a form that would pay another",
    );
    view.unmount();
  });

  it('clears a refusal that was about somebody else', async () => {
    // Same reason as the balance above: the message named the address the
    // form was aimed at, and the form is aimed somewhere else now.
    serving({
      '/api/admin/user': () => reply(FOUND),
      '/api/admin/topup': () =>
        reply({ error: 'That user does not exist.' }, 404),
    });
    const view = await mount();
    await view.email('nobody@example.com');
    await view.amount('2.50');
    await view.grant();
    assert.match(view.text(), /does not exist/);

    await view.email('alice@example.com');
    assert.doesNotMatch(
      view.text(),
      /does not exist/,
      'a refusal about one address was left standing over another',
    );
    view.unmount();
  });

  it('does not let an answer about the old address land on the new one', async () => {
    const slow = held(() => reply(FOUND));
    serving({ '/api/admin/user': slow.answer });
    const view = await mount();
    await view.email('alice@example.com');
    await view.lookUp();

    await view.email('bob@example.com');
    await slow.land();

    assert.doesNotMatch(
      view.text(),
      /user_alice/,
      'a lookup for the address just abandoned attached itself to this one',
    );
    view.unmount();
  });

  it('lets the refresh after a grant win over a lookup started before it', async () => {
    // The older answer carries the balance from before the grant. Landing
    // last, it says the grant did not happen, and the answer to that is to
    // make it again.
    const stale = held(() => reply({ ...FOUND, userId: 'user_stale' }));
    let first = true;
    serving({
      '/api/admin/user': () => {
        if (first) {
          first = false;
          return stale.answer();
        }
        return reply({ ...FOUND, spendableCreditMicroUsd: 3_500_000 });
      },
      '/api/admin/topup': () =>
        reply({ userId: 'user_alice', creditUsdCents: 250 }),
    });
    const view = await mount();
    await view.email('alice@example.com');
    await view.lookUp();
    await view.amount('2.50');
    await view.grant();

    assert.match(view.text(), /\$3\.50 spendable credit/);
    await stale.land();
    assert.match(
      view.text(),
      /\$3\.50 spendable credit/,
      'the lookup from before the grant landed last and undid the refresh',
    );
    assert.doesNotMatch(view.text(), /user_stale/);
    view.unmount();
  });
});
