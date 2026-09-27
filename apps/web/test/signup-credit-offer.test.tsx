import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { SignupCreditOffer } from '../src/components/SignupCreditOffer.tsx';
import { BillingStatusPanel } from '../src/components/BillingStatus.tsx';
import {
  CARD_ADDED_PATH,
  formatCredit,
  signupCreditPrompt,
  startCardSetup,
} from '../src/billing/billing-client.ts';
import type {
  BillingStatus,
  SignupCredit,
} from '../src/billing/billing-client.ts';

/**
 * The welcome credit, as a new account meets it (Chris, 2026-09-27).
 *
 * The credit waits for a card on file, so a new account starts with none of
 * it. Without this screen nothing would tell them why, or what to do.
 */

const OFFER =
  "Add a card to get $1 of free build credit. You won't be charged.";

function billing(
  signupCredit?: SignupCredit,
  over: Partial<BillingStatus> = {},
) {
  return {
    tier: 'free',
    allowanceMicroUsd: 1_000_000,
    spentMicroUsd: 0,
    topupRemainingMicroUsd: 0,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasStripeCustomer: false,
    billingConfigured: true,
    ...(signupCredit ? { signupCredit } : {}),
    ...over,
  } satisfies BillingStatus;
}

const NEEDS_CARD: SignupCredit = {
  state: 'needs-card',
  cents: 100,
  cardAlreadyUsed: false,
};

describe('what the builder says about the welcome credit', () => {
  it('tells a new account how to get it, and that nothing is charged', () => {
    assert.deepEqual(signupCreditPrompt(billing(NEEDS_CARD), '/'), {
      kind: 'offer',
      message: OFFER,
    });
  });

  it('says nothing to an account that has it, or is not offered it', () => {
    for (const credit of [
      { state: 'granted', cents: 100 },
      { state: 'none', reason: 'not-in-cohort' },
      { state: 'none', reason: 'no-access' },
      undefined,
    ] as (SignupCredit | undefined)[]) {
      assert.equal(signupCreditPrompt(billing(credit), '/'), null);
    }
  });

  it('offers nothing on a deployment with no way to save a card', () => {
    assert.equal(
      signupCreditPrompt(
        billing(NEEDS_CARD, { billingConfigured: false }),
        '/',
      ),
      null,
    );
  });

  it('says why a card that was saved paid nothing, and asks for another', () => {
    const prompt = signupCreditPrompt(
      billing({ ...NEEDS_CARD, cardAlreadyUsed: true }),
      '/',
    );
    assert.equal(prompt?.kind, 'card-used');
    assert.match(
      prompt!.message,
      /already claimed the welcome credit on another account/,
    );
    assert.ok(prompt!.message.endsWith(OFFER));
  });

  it('says the credit is on its way when Stripe has just sent the browser back', () => {
    const prompt = signupCreditPrompt(billing(NEEDS_CARD), CARD_ADDED_PATH);
    assert.equal(prompt?.kind, 'pending');
    assert.match(prompt!.message, /appears here once Stripe confirms it/);
  });

  it('states the amount the account was offered', () => {
    assert.equal(formatCredit(100), '$1');
    assert.equal(formatCredit(250), '$2.50');
    assert.match(
      signupCreditPrompt(billing({ ...NEEDS_CARD, cents: 250 }), '/')!.message,
      /\$2\.50 of free build credit/,
    );
  });
});

describe('starting the card setup', () => {
  it('posts to the card route with the session token and follows its URL', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const url = await startCardSetup(
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), init });
        return new Response(
          JSON.stringify({ url: 'https://checkout.stripe.com/c/setup' }),
          { status: 200 },
        );
      }) as typeof fetch,
      async () => 'token_1',
    );
    assert.equal(url, 'https://checkout.stripe.com/c/setup');
    assert.equal(seen[0]!.url, '/api/billing/card');
    assert.equal(seen[0]!.init?.method, 'POST');
    assert.equal(
      (seen[0]!.init?.headers as Record<string, string>).Authorization,
      'Bearer token_1',
    );
  });

  it("surfaces the Worker's refusal rather than a generic failure", async () => {
    await assert.rejects(
      startCardSetup(
        (async () =>
          new Response(
            JSON.stringify({
              error: 'This account already has its welcome credit.',
            }),
            { status: 409 },
          )) as unknown as typeof fetch,
        async () => 'token_1',
      ),
      /already has its welcome credit/,
    );
  });
});

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    text: () => container.textContent ?? '',
    buttons: () =>
      [...container.querySelectorAll('button')].map((b) => b.textContent),
    button: (label: RegExp) =>
      [...container.querySelectorAll('button')].find((b) =>
        label.test(b.textContent ?? ''),
      ),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the welcome-credit offer, rendered', () => {
  it('shows the sentence and one button that starts the setup flow', async () => {
    let started = 0;
    const view = await mount(
      <SignupCreditOffer
        status={billing(NEEDS_CARD)}
        pathname="/"
        start={async () => {
          started += 1;
          throw new Error('Could not open the card form. Try again shortly.');
        }}
      />,
    );
    assert.ok(view.text().includes(OFFER));
    assert.deepEqual(view.buttons(), ['Add a card']);

    await act(async () => {
      view.button(/Add a card/)!.click();
    });
    assert.equal(started, 1);
    // A failure is said where the button is, and the button comes back.
    assert.match(view.text(), /Could not open the card form/);
    assert.equal(view.button(/Add a card/)!.disabled, false);
    view.unmount();
  });

  it('offers no second card while the first is being confirmed', async () => {
    const view = await mount(
      <SignupCreditOffer
        status={billing(NEEDS_CARD)}
        pathname={CARD_ADDED_PATH}
      />,
    );
    assert.match(view.text(), /Card saved/);
    assert.deepEqual(view.buttons(), []);
    view.unmount();
  });

  it('asks for a different card when the last one was already used', async () => {
    const view = await mount(
      <SignupCreditOffer
        status={billing({ ...NEEDS_CARD, cardAlreadyUsed: true })}
        pathname="/"
      />,
    );
    assert.deepEqual(view.buttons(), ['Add a different card']);
    view.unmount();
  });

  it('renders nothing for an account that already has its credit', async () => {
    const view = await mount(
      <SignupCreditOffer
        status={billing({ state: 'granted', cents: 100 })}
        pathname="/"
      />,
    );
    assert.equal(view.text(), '');
    view.unmount();
  });

  it('appears in the plan and usage panel as well', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(billing(NEEDS_CARD)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const view = await mount(<BillingStatusPanel />);
    assert.ok(view.text().includes(OFFER));
    assert.ok(view.button(/^Add a card$/));
    view.unmount();
  });
});
