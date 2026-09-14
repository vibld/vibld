import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { BillingStatusPanel } from '../src/components/BillingStatus.tsx';
import type { BillingStatus } from '../src/billing/billing-client.ts';

/**
 * The billing readout, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 * It is the one that talks about money, which is the worst place for a
 * sentence nobody has ever checked.
 */

function billing(overrides: Partial<BillingStatus> = {}): BillingStatus {
  return {
    tier: 'free',
    allowanceMicroUsd: 1_000_000,
    spentMicroUsd: 0,
    topupRemainingMicroUsd: 0,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasStripeCustomer: false,
    billingConfigured: true,
    ...overrides,
  };
}

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
function serving(answers: Record<string, () => Response>): Call[] {
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

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<BillingStatusPanel />);
  });
  const find = (label: RegExp): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((button) =>
      label.test(button.textContent ?? ''),
    );
  return {
    container,
    text: () => container.textContent ?? '',
    button: find,
    async press(label: RegExp) {
      const button = find(label);
      assert.ok(button, `no ${String(label)} button`);
      await act(async () => {
        button.click();
      });
    },
    async choose(value: string) {
      const select = container.querySelector('select');
      assert.ok(select, 'no tier picker');
      await act(async () => {
        // What React listens for: setting `.value` alone does not notify it.
        Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          'value',
        )?.set?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the billing readout, as it is actually wired', () => {
  it('shows the tier and what this month has cost', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ tier: 'build', spentMicroUsd: 2_500_000 })),
    });
    const view = await mount();

    assert.match(view.text(), /Build/);
    assert.match(view.text(), /\$2\.50 \/ \$1\.00 this month/);
    assert.doesNotMatch(
      view.text(),
      /cancels at period end/,
      'it announced an ending nobody asked for',
    );
    view.unmount();
  });

  it('shows credit that is still spendable', async () => {
    // `reserveBudget` falls through to this balance the moment the monthly
    // allowance is exhausted, so a line that stops at the allowance tells
    // somebody they are finished for the month when they are not. It is also
    // money they paid for, or were granted, and never saw again.
    serving({
      '/api/billing/status': () =>
        reply(
          billing({
            spentMicroUsd: 1_000_000,
            topupRemainingMicroUsd: 9_600_000,
          }),
        ),
    });
    const view = await mount();

    assert.match(view.text(), /\$9\.60 credit/);
    view.unmount();
  });

  it('does not mention credit nobody has', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ topupRemainingMicroUsd: 0 })),
    });
    const view = await mount();

    assert.doesNotMatch(view.text(), /credit/);
    view.unmount();
  });

  it('says when the subscription is ending', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ tier: 'ship', cancelAtPeriodEnd: true })),
    });
    const view = await mount();

    assert.match(view.text(), /cancels at period end/);
    view.unmount();
  });

  it('renders nothing this deployment cannot answer for', async () => {
    serving({
      '/api/billing/status': () => reply(billing({ billingConfigured: false })),
    });
    const view = await mount();

    assert.equal(view.text(), '', 'it offered billing that is not configured');
    view.unmount();
  });

  it('renders nothing when the status cannot be read', async () => {
    // Signed out, expired, or simply unreachable. Nobody asked for this
    // widget, so nothing is the right answer rather than an error.
    serving({ '/api/billing/status': () => reply({ error: 'nope' }, 401) });
    const view = await mount();

    assert.equal(view.text(), '', 'it drew a readout from nothing');
    view.unmount();
  });

  it('offers the upgrade picker only on the free tier', async () => {
    serving({ '/api/billing/status': () => reply(billing({ tier: 'build' })) });
    const view = await mount();

    assert.equal(view.container.querySelector('select'), null);
    assert.equal(view.button(/Upgrade/), undefined);
    view.unmount();
  });

  it('offers the portal only to somebody Stripe knows', async () => {
    // `handleBillingPortal` 502s without a customer to manage, so offering
    // the button before there is one is offering a failure.
    serving({
      '/api/billing/status': () => reply(billing({ hasStripeCustomer: false })),
    });
    const view = await mount();
    assert.equal(view.button(/Manage billing/), undefined);
    view.unmount();

    serving({
      '/api/billing/status': () => reply(billing({ hasStripeCustomer: true })),
    });
    const second = await mount();
    assert.ok(second.button(/Manage billing/));
    second.unmount();
  });

  it('sends the browser to the Checkout page for the tier that was chosen', async () => {
    const was = window.location.href;
    const calls = serving({
      '/api/billing/status': () => reply(billing()),
      '/api/billing/checkout': () =>
        reply({ url: 'https://checkout.example/session' }),
    });
    const view = await mount();
    await view.choose('ship');
    await view.press(/Upgrade/);

    const checkout = calls.find((call) => call.url.includes('/checkout'));
    assert.equal(checkout?.method, 'POST');
    assert.deepEqual(checkout?.body, { tier: 'ship', interval: 'monthly' });
    assert.equal(window.location.href, 'https://checkout.example/session');

    window.location.href = was;
    view.unmount();
  });

  it('asks for a top-up rather than a subscription', async () => {
    const was = window.location.href;
    const calls = serving({
      '/api/billing/status': () => reply(billing()),
      '/api/billing/checkout': () =>
        reply({ url: 'https://checkout.example/topup' }),
    });
    const view = await mount();
    await view.press(/Buy top-up/);

    const checkout = calls.find((call) => call.url.includes('/checkout'));
    assert.deepEqual(checkout?.body, { topup: true });
    window.location.href = was;
    view.unmount();
  });

  it('says why a refused billing request was refused, and lets it be tried again', async () => {
    serving({
      '/api/billing/status': () => reply(billing()),
      '/api/billing/checkout': () =>
        reply({ error: 'That tier is not for sale yet.' }, 400),
    });
    const view = await mount();
    await view.press(/Upgrade/);

    const alert = view.container.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? '', /not for sale yet/);
    assert.equal(
      view.button(/Upgrade/)?.disabled,
      false,
      'a refusal left the buttons disabled',
    );
    view.unmount();
  });
});
