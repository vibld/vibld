import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { SettingsMenu } from '../src/components/SettingsMenu.tsx';

/**
 * The header's one control, and the rules a popover owes a keyboard.
 *
 * The panel is hidden rather than unmounted, which is the part worth a test:
 * the GitHub section inside it claims the OAuth fragment when it mounts, so
 * a panel that only existed while the menu was open would drop the callback
 * for anybody who was not looking at it, and the connection would fail with
 * nothing on screen to explain it.
 *
 * Mounted with a plain child rather than the real sections. Those are Clerk
 * gated, and a test that stood up a provider to press a button would be
 * testing Clerk.
 */

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <SettingsMenu>
        <section>A section that was mounted</section>
      </SettingsMenu>,
    );
  });
  const gear = () => {
    const button = container.querySelector('button');
    assert.ok(button, 'no settings button');
    return button;
  };
  return {
    container,
    gear,
    panel: () => container.querySelector('.settings__panel'),
    async press() {
      await act(async () => gear().click());
    },
    async key(key: string) {
      await act(async () => {
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
      });
    },
    async clickOutside() {
      await act(async () => {
        document.dispatchEvent(
          new window.MouseEvent('mousedown', { bubbles: true }),
        );
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the settings menu', () => {
  it('starts closed, and says so', async () => {
    const view = await mount();

    assert.equal(view.gear().getAttribute('aria-expanded'), 'false');
    assert.equal(view.panel()?.hasAttribute('hidden'), true);
    view.unmount();
  });

  it('opens and closes on the button', async () => {
    const view = await mount();

    await view.press();
    assert.equal(view.gear().getAttribute('aria-expanded'), 'true');
    assert.equal(view.panel()?.hasAttribute('hidden'), false);

    await view.press();
    assert.equal(view.gear().getAttribute('aria-expanded'), 'false');
    view.unmount();
  });

  it('closes on Escape', async () => {
    const view = await mount();
    await view.press();

    await view.key('Escape');

    assert.equal(view.gear().getAttribute('aria-expanded'), 'false');
    view.unmount();
  });

  it('closes when something else is clicked', async () => {
    const view = await mount();
    await view.press();

    await view.clickOutside();

    assert.equal(view.gear().getAttribute('aria-expanded'), 'false');
    view.unmount();
  });

  it('keeps its sections mounted while closed', async () => {
    // The rule this menu is most likely to break. The GitHub section handles
    // the OAuth callback on mount, and the callback arrives on a page load
    // where nobody has opened the menu. Hidden is not unmounted.
    const view = await mount();

    assert.ok(
      view.panel()?.textContent?.includes('A section that was mounted'),
      'the sections are not in the document while the menu is closed',
    );
    view.unmount();
  });
});
