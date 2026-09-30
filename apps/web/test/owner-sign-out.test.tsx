import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { ownerSignOut } from '../src/auth/mode.ts';
import { OwnerSignOut } from '../src/auth/owner.tsx';

/**
 * Signing out of an owner copy (D123). The cookie is HttpOnly, so only the
 * Worker can clear it, and the page must not reload as though it had when
 * it did not (Codex review of internal PR 337): the owner would still be signed in,
 * which matters on a shared browser.
 */
describe('signing out of an owner copy', () => {
  it('counts only a sign-out the Worker accepted', async () => {
    const answering = (status: number) =>
      (async () => new Response('{}', { status })) as typeof fetch;
    assert.equal(await ownerSignOut(answering(200)), true);
    assert.equal(await ownerSignOut(answering(403)), false);
    assert.equal(
      await ownerSignOut((async () => {
        throw new TypeError('offline');
      }) as typeof fetch),
      false,
    );
  });

  it('says it failed instead of reloading', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let reloaded = false;
    await act(async () => {
      createRoot(container).render(
        <OwnerSignOut
          signOut={async () => false}
          onSignedOut={() => {
            reloaded = true;
          }}
        />,
      );
    });
    await act(async () => {
      container.querySelector('button')!.click();
    });
    assert.equal(reloaded, false);
    assert.match(
      container.querySelector('[role=alert]')?.textContent ?? '',
      /Could not sign out/,
    );

    await act(async () => {
      createRoot(container).render(
        <OwnerSignOut
          signOut={async () => true}
          onSignedOut={() => {
            reloaded = true;
          }}
        />,
      );
    });
    await act(async () => {
      container.querySelector('button')!.click();
    });
    assert.equal(reloaded, true);
    container.remove();
  });
});
