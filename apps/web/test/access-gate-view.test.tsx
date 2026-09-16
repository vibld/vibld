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

  it('stays closed when the answer is not an explicit yes', async () => {
    serving({ allowed: 'true', mode: 'open' });
    const view = await mount();
    assert.equal(view.mounted(), false);
  });
});
