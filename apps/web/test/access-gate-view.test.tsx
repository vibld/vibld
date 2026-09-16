import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '../src/components/AccessGate.tsx';

/**
 * The screen a signed-in but uninvited account sees.
 *
 * The rule that matters is the negative one: the builder must not mount. It
 * probes on load, and those probes are exactly what an uninvited account may
 * not do, so rendering it behind a notice would still make the calls.
 */

function serving(body: unknown, ok = true): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

async function mount(configured = true) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let mounted = false;
  function Builder() {
    mounted = true;
    return <p>the builder</p>;
  }
  await act(async () => {
    createRoot(container).render(
      <AccessGate
        configured={configured}
        signOut={<button type="button">Sign out</button>}
      >
        <Builder />
      </AccessGate>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { text: container.textContent ?? '', mounted: () => mounted };
}

describe('the access gate', () => {
  it('renders the builder when there is no Clerk to identify anybody', async () => {
    // The local `pnpm dev` path. There is no identity, so there is no list to
    // be on, and showing a developer a waiting-list notice for a deployment
    // that has no waiting list is nonsense. Not a hole either: the Worker
    // refuses every endpoint that costs anything without Clerk, and the
    // router's gate is a separate check that never consults this component.
    //
    // Serving a refusal proves the endpoint is never consulted: if it were,
    // this answer would close the gate.
    serving({ allowed: false, mode: 'invite', message: 'Invite only.' });
    const view = await mount(false);
    assert.equal(view.mounted(), true);
  });

  it('renders the builder for an allowed account', async () => {
    serving({ allowed: true, mode: 'open', message: null });
    const view = await mount();
    assert.match(view.text, /the builder/);
    assert.equal(view.mounted(), true);
  });

  it('never mounts the builder for an account that is not on the list', async () => {
    serving({ allowed: false, mode: 'invite', message: 'Invite only.' });
    const view = await mount();
    assert.equal(view.mounted(), false, 'the builder mounted and probed');
    assert.doesNotMatch(view.text, /the builder/);
  });

  it('says what is happening rather than showing an error', async () => {
    serving({ allowed: false, mode: 'invite', message: 'Invite only.' });
    const view = await mount();
    assert.match(view.text, /waiting list/i);
    assert.match(view.text, /Invite only\./);
  });

  it('does not tell a paying customer that nothing has been charged', async () => {
    // It used to say exactly that. True of somebody who never paid, false of
    // a subscriber whose invite was withdrawn, and revocation does not
    // cancel anything in Stripe. The screen cannot tell which it is talking
    // to, so it must not claim either.
    serving({ allowed: false, mode: 'invite', message: null });
    const view = await mount();

    assert.doesNotMatch(
      view.text,
      /nothing has been charged/i,
      'told a possibly-billed customer that nothing was charged',
    );
    assert.match(view.text, /costs anything while access is closed/i);
  });

  it('offers a control for each thing the locked-out account still owns', async () => {
    // Opening the routes was not enough, twice over. An endpoint nobody can
    // press is not a way out, and this screen replaces every control in the
    // builder, so a running sandbox, a public link to somebody's code and a
    // repository grant all became unreachable at the moment access went.
    const byUrl: Record<string, unknown> = {
      '/api/access/status': { allowed: false, mode: 'invite', message: null },
      '/api/billing/status': {
        tier: 'free',
        allowanceMicroUsd: 0,
        spentMicroUsd: 0,
        topupRemainingMicroUsd: 2_500_000,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        hasStripeCustomer: true,
        billingConfigured: true,
      },
      '/api/preview': { status: 'ready', url: 'https://x', expiresAt: 1 },
      '/api/preview/share': {
        // A live grant: not revoked, and not yet expired. Both halves matter,
        // and a fixture with an expiry in the past would pass this test for
        // the wrong reason before the expiry filter existed.
        shares: [
          {
            shareId: 's1',
            createdAt: 1,
            expiresAt: Date.now() + 60_000,
            revoked: false,
          },
        ],
      },
      '/api/github/status': {
        configured: true,
        connected: true,
        owner: 'chris',
        repo: 'thing',
      },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      const path = url.split('?')[0] ?? url;
      return new Response(JSON.stringify(byUrl[path] ?? {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const view = await mount();

    assert.match(view.text, /manage or cancel a subscription/i);
    assert.match(view.text, /stop the running sandbox/i, 'sandbox unreachable');
    assert.match(view.text, /public link/i, 'public code unreachable');
    assert.match(view.text, /disconnect chris\/thing/i, 'grant unreachable');
    assert.match(view.text, /unspent credit/i, 'no sight of their money');
  });

  it('shows why the portal failed, rather than guessing', async () => {
    // The catch used to report "No subscription found for this account" for
    // every failure, including Stripe being unavailable. That is a false
    // diagnosis handed to a possibly still-billed customer on the only
    // screen they have left.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.startsWith('/api/billing/portal')) {
        return new Response(
          JSON.stringify({ error: 'Billing is temporarily unavailable.' }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      const body =
        url === '/api/access/status'
          ? { allowed: false, mode: 'invite', message: null }
          : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <AccessGate signOut={<button type="button">Sign out</button>}>
          <p>the builder</p>
        </AccessGate>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const button = [...container.querySelectorAll('button')].find((node) =>
      /manage or cancel/i.test(node.textContent ?? ''),
    );
    assert.ok(button, 'no portal control to press');

    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.match(
      container.textContent ?? '',
      /temporarily unavailable/i,
      'replaced the real reason with a guess',
    );
    assert.doesNotMatch(
      container.textContent ?? '',
      /no subscription found/i,
      'told them something untrue about their subscription',
    );
  });

  it('hides the portal from an account that never had a subscription', async () => {
    // An ordinary uninvited signup has no Stripe customer, so the portal
    // cannot open for them. Showing the only billing control on the screen
    // and having it fail every time is a dead end dressed as a way out.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      const path = url.split('?')[0] ?? url;
      const body =
        path === '/api/access/status'
          ? { allowed: false, mode: 'invite', message: null }
          : path === '/api/billing/status'
            ? {
                // A whole status, not the two fields this rule reads.
                // `fetchBillingStatus` validates the shape and answers null
                // for anything else, which would leave `hasCustomer`
                // undefined and show the portal for the wrong reason.
                tier: 'free',
                allowanceMicroUsd: 0,
                spentMicroUsd: 0,
                topupRemainingMicroUsd: 0,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                hasStripeCustomer: false,
                billingConfigured: true,
              }
            : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const view = await mount();

    assert.doesNotMatch(
      view.text,
      /manage or cancel a subscription/i,
      'offered a portal to somebody with no customer',
    );
  });

  /**
   * The share list is every grant ever issued, live or not. "Live" is a
   * conjunction: not revoked *and* not yet expired. Each half is checked on
   * its own below, because a filter that drops one of them still passes a
   * fixture that violates both, and the claim on the screen ("your code is
   * public, here is the button that stops that") is false either way round.
   */
  function servingShare(share: Record<string, unknown>): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      const path = url.split('?')[0] ?? url;
      const body =
        path === '/api/access/status'
          ? { allowed: false, mode: 'invite', message: null }
          : path === '/api/preview/share'
            ? { shares: [share] }
            : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  it('does not count an expired share as a live public link', async () => {
    servingShare({
      shareId: 'old',
      createdAt: 1,
      expiresAt: Date.now() - 60_000,
      revoked: false,
    });

    const view = await mount();

    assert.doesNotMatch(
      view.text,
      /public link/i,
      'counted an expired grant as live exposure',
    );
  });

  it('does not count a revoked share as a live public link', async () => {
    // Withdrawn by hand, and still inside its window. Nothing is exposed,
    // so offering to remove it is an invented worry on the one screen this
    // account has left.
    servingShare({
      shareId: 'pulled',
      createdAt: 1,
      expiresAt: Date.now() + 60_000,
      revoked: true,
    });

    const view = await mount();

    assert.doesNotMatch(
      view.text,
      /public link/i,
      'counted a withdrawn grant as live exposure',
    );
  });

  it('stays quiet for an account that owns none of it', async () => {
    serving({ allowed: false, mode: 'invite', message: null });
    const view = await mount();

    assert.doesNotMatch(view.text, /stop the running sandbox/i);
    assert.doesNotMatch(view.text, /disconnect/i);
  });

  it('offers a locked-out customer a way to cancel, and a way to sign out', async () => {
    // This screen replaces the whole builder, including the only control
    // that opens the billing portal and the only one that signs out.
    // Ungating the portal route did nothing while no button reached it.
    serving({ allowed: false, mode: 'invite', message: null });
    const view = await mount();

    assert.match(
      view.text,
      /manage or cancel a subscription/i,
      'no way to stop being charged',
    );
    assert.match(view.text, /sign out/i, 'no way to switch account');
  });

  it('stays closed when the status endpoint cannot be reached', async () => {
    // An unknown answer is not a yes. Showing a builder that refuses every
    // action is the worse of the two failures.
    serving({}, false);
    const view = await mount();
    assert.equal(view.mounted(), false);
  });

  it('does not call an unknown answer a refusal', async () => {
    // A 5xx from `/api/access/status` used to render the ordinary
    // waiting-list notice, so an invited customer was told their account
    // was not on the list because D1 was unavailable for a moment. Shut is
    // right; saying that about them is not.
    serving({}, false);
    const view = await mount();

    assert.doesNotMatch(
      view.text,
      /waiting list/i,
      'told an account it was refused when nothing had decided that',
    );
    assert.match(view.text, /could not check your account/i);
  });

  it('asks again when told to, and opens on the answer', async () => {
    // The screen offering nothing to do was half the finding: the first
    // answer stood until somebody thought to reload the page.
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('{}', { status: 503 })
        : new Response(
            JSON.stringify({ allowed: true, mode: 'open', message: null }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    let mounted = false;
    function Builder() {
      mounted = true;
      return <p>the builder</p>;
    }
    await act(async () => {
      createRoot(container).render(
        <AccessGate signOut={<button type="button">Sign out</button>}>
          <Builder />
        </AccessGate>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(mounted, false, 'opened before anything said yes');

    const button = [...container.querySelectorAll('button')].find((node) =>
      /try again/i.test(node.textContent ?? ''),
    );
    assert.ok(button, 'nothing to press');

    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(mounted, true, 'the retry never reached the endpoint');
    assert.equal(attempts, 2);
  });

  it('stays closed when the answer is not an explicit yes', async () => {
    serving({ allowed: 'true', mode: 'open' });
    const view = await mount();
    assert.equal(view.mounted(), false);
  });
});
