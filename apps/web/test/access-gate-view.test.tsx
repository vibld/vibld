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

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let mounted = false;
  function Builder() {
    mounted = true;
    return <p>the builder</p>;
  }
  await act(async () => {
    createRoot(container).render(
      <AccessGate>
        <Builder />
      </AccessGate>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { text: container.textContent ?? '', mounted: () => mounted };
}

describe('the access gate', () => {
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

  it('says nothing has been charged, because nothing has', async () => {
    serving({ allowed: false, mode: 'invite', message: null });
    const view = await mount();
    assert.match(view.text, /nothing has been charged/i);
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
