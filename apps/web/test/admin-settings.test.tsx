import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { AdminSettings } from '../src/components/AdminSettings.tsx';

/**
 * The page the admin tools moved onto (#184).
 *
 * Nothing here is a permission. Every `/api/admin/*` route checks the
 * caller at the trusted boundary (ADR-0006), and these assertions are about
 * what is drawn, not about what anyone may do.
 */

/** Answers anything, so a mounted panel's probe does not throw. */
function servingNothing(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

async function mount(isAdmin: boolean | null) {
  servingNothing();
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<AdminSettings isAdmin={isAdmin} />);
  });
  return {
    text: () => container.textContent ?? '',
    // The four tools each render a disclosure. Counting them is what tells
    // "the page is drawn" apart from "the page is drawn empty".
    tools: () => container.querySelectorAll('details').length,
    unmount: () => act(() => root.unmount()),
  };
}

describe('the platform admin page', () => {
  it('draws no tools while the probe has not answered', async () => {
    const page = await mount(null);
    assert.equal(page.tools(), 0);
    page.unmount();
  });

  it('does not tell a caller the page is not theirs before it knows', async () => {
    // The whole reason `isAdmin` has three states. An admin who opened
    // /admin directly would otherwise read a refusal for as long as a
    // fetch takes, and then watch it be taken back.
    const page = await mount(null);
    assert.doesNotMatch(
      page.text(),
      /Nothing here/,
      'an unanswered probe was rendered as a refusal',
    );
    page.unmount();
  });

  it('draws no tools for a caller who is not an admin', async () => {
    const page = await mount(false);
    assert.equal(
      page.tools(),
      0,
      'the admin tools were drawn for somebody the probe said is not an admin',
    );
    assert.match(page.text(), /Nothing here/);
    page.unmount();
  });

  it('draws all four tools for an admin', async () => {
    const page = await mount(true);
    assert.equal(
      page.tools(),
      4,
      'the page is missing one of credit, invites, parked payments or takedowns',
    );
    page.unmount();
  });

  it('offers a way back to the builder', async () => {
    const page = await mount(true);
    assert.match(page.text(), /Back to the builder/);
    page.unmount();
  });
});

describe('where the admin tools are mounted', () => {
  it('lives on the admin page and nowhere else', async () => {
    // They used to sit in the composer, under the style controls, on every
    // admin's every session -- which is what `builder-layout.test.ts`
    // records growing the composer past a viewport told not to scroll.
    // Moving them is only worth anything while they stay moved.
    const app = await readFile(
      new URL('../src/App.tsx', import.meta.url).pathname,
      'utf8',
    );
    for (const tool of [
      'AdminPanel',
      'InvitePanel',
      'ParkedQueuePanel',
      'SiteTakedown',
    ]) {
      assert.doesNotMatch(
        app,
        new RegExp(`\\b${tool}\\b`),
        `${tool} is back in the shell; it belongs to AdminSettings`,
      );
    }
  });

  it('shuts the settings popover on its way to the page', async () => {
    // `settings-menu.test.tsx` proves the popover can be closed by what is
    // inside it. This is the other half: that the one control which needs
    // to actually does. Without it the admin page opened underneath a menu
    // still standing over it (#188 review).
    const app = await readFile(
      new URL('../src/App.tsx', import.meta.url).pathname,
      'utf8',
    );
    const at = app.indexOf('href={ADMIN_PATH}');
    assert.ok(at >= 0, 'the settings link to the admin page is gone');
    // As far as the end of the element that carries it.
    const handler = app.slice(at, app.indexOf('</a>', at));

    assert.match(
      handler,
      /navigate\(ADMIN_PATH\)/,
      'the link no longer navigates',
    );
    assert.match(
      handler,
      /closeSettings\(\)/,
      'the link navigates without closing the popover it sits in',
    );
  });
});
