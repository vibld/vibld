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
 * until the harness on internal PR 124 this component was typechecked and nothing more.
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

  it('offers to cancel only a plan that is live and not already ending', async () => {
    // Nothing to cancel on the free tier, and a plan already set to end
    // says so in the readout and is kept or left from the portal.
    for (const [overrides, offered] of [
      [{ tier: 'free', hasStripeCustomer: true }, false],
      [{ tier: 'build', hasStripeCustomer: true }, true],
      [{ tier: 'ship', hasStripeCustomer: true }, true],
      [{ tier: 'build', cancelAtPeriodEnd: true }, false],
    ] as const) {
      serving({ '/api/billing/status': () => reply(billing(overrides)) });
      const view = await mount();
      assert.equal(
        Boolean(view.button(/Cancel plan/)),
        offered,
        `${JSON.stringify(overrides)}: cancel offered should be ${offered}`,
      );
      view.unmount();
    }
  });

  it('sends the browser to the cancel flow vibld opens', async () => {
    // Through `/api/billing/cancel` rather than the portal's front page,
    // because that route is what decides whether a monthly plan is offered
    // half off a month first.
    const was = window.location.href;
    const calls = serving({
      '/api/billing/status': () =>
        reply(billing({ tier: 'build', hasStripeCustomer: true })),
      '/api/billing/cancel': () =>
        reply({ url: 'https://billing.example/cancel' }),
    });
    const view = await mount();
    await view.press(/Cancel plan/);

    const cancel = calls.find((call) =>
      call.url.includes('/api/billing/cancel'),
    );
    assert.equal(cancel?.method, 'POST');
    assert.equal(cancel?.body, undefined);
    assert.equal(
      calls.some((call) => call.url.includes('/api/billing/portal')),
      false,
    );
    assert.equal(window.location.href, 'https://billing.example/cancel');

    window.location.href = was;
    view.unmount();
  });

  it('says why the cancel flow could not be opened', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ tier: 'build', hasStripeCustomer: true })),
      '/api/billing/cancel': () =>
        reply(
          { error: 'Could not open the cancellation page. Try again shortly.' },
          502,
        ),
    });
    const view = await mount();
    await view.press(/Cancel plan/);

    const alert = view.container.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? '', /cancellation page/);
    assert.equal(view.button(/Cancel plan/)?.disabled, false);
    view.unmount();
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

describe('auto-reload in the billing readout (D166)', () => {
  const AUTO = {
    enabled: false,
    monthlyCapUsdCents: 3000,
    card: null,
    disabledReason: null,
    reloadsThisMonth: 0,
  } as const;

  function checkbox(container: HTMLElement): HTMLInputElement {
    const box = container.querySelector<HTMLInputElement>(
      '.billing__auto-reload input[type="checkbox"]',
    );
    assert.ok(box, 'no auto-reload switch');
    return box;
  }

  it('is offered off, with the $30 cap, and turning it on posts both', async () => {
    const calls = serving({
      '/api/billing/status': () => reply(billing({ autoReload: { ...AUTO } })),
      '/api/billing/auto-reload': () =>
        reply({ enabled: true, monthlyCapUsdCents: 3000 }),
    });
    const view = await mount();
    assert.match(view.text(), /Auto-reload \$10 when under \$1/);
    assert.match(view.text(), /up to \$30 a month/);
    const box = checkbox(view.container);
    assert.equal(box.checked, false);
    await act(async () => {
      box.click();
    });
    const posted = calls.find((call) => call.url.includes('/auto-reload'));
    assert.deepEqual(posted?.body, { enabled: true, monthlyCapUsdCents: 3000 });
    view.unmount();
  });

  it('offers to add a card when there is none to charge', async () => {
    serving({
      '/api/billing/status': () => reply(billing({ autoReload: { ...AUTO } })),
      '/api/billing/auto-reload': () =>
        reply({ error: 'Add a card first.', needsCard: true }, 409),
    });
    const view = await mount();
    await act(async () => {
      checkbox(view.container).click();
    });
    assert.match(view.text(), /Add a card first/);
    assert.ok(view.button(/Add a card/));
    view.unmount();
  });

  it('says why it turned itself off, and keeps the one-click top-up', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ autoReload: { ...AUTO, disabledReason: 'declined' } })),
    });
    const view = await mount();
    assert.match(view.text(), /Auto-reload is off: your card was declined/);
    assert.ok(view.button(/Buy top-up/));
    view.unmount();
  });

  it('names the card it charges while on', async () => {
    serving({
      '/api/billing/status': () =>
        reply(
          billing({
            autoReload: {
              ...AUTO,
              enabled: true,
              card: { brand: 'visa', last4: '4242' },
              reloadsThisMonth: 2,
            },
          }),
        ),
    });
    const view = await mount();
    assert.match(view.text(), /Charges visa ending 4242/);
    assert.match(view.text(), /\$20 reloaded this month/);
    view.unmount();
  });

  it('lets a suspended account turn it off, and offers nothing else', async () => {
    const calls = serving({
      '/api/billing/status': () =>
        reply(
          billing({
            suspended: true,
            autoReload: {
              ...AUTO,
              enabled: true,
              card: { brand: 'visa', last4: '4242' },
            },
          }),
        ),
      '/api/billing/auto-reload': () =>
        reply({ enabled: false, monthlyCapUsdCents: 3000 }),
    });
    const view = await mount();
    const cap = view.container.querySelector<HTMLSelectElement>(
      '.billing__auto-reload select',
    );
    assert.equal(cap?.disabled, true);
    const box = checkbox(view.container);
    assert.equal(box.disabled, false);
    await act(async () => {
      box.click();
    });
    const posted = calls.find((call) => call.url.includes('/auto-reload'));
    assert.deepEqual(posted?.body, {
      enabled: false,
      monthlyCapUsdCents: 3000,
    });
    view.unmount();
  });

  it('is not offered to a suspended account that has it off', async () => {
    serving({
      '/api/billing/status': () =>
        reply(billing({ suspended: true, autoReload: { ...AUTO } })),
    });
    const view = await mount();
    assert.equal(view.container.querySelector('.billing__auto-reload'), null);
    view.unmount();
  });
});
