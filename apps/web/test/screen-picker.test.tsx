import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SCREENS, SCREEN_BASELINE } from '@vibld/ai/screen-patterns';
import { ScreenPicker } from '../src/components/ScreenPicker.tsx';

/**
 * The builder's screen picker (docs/decisions.md, D110): chosen screen
 * patterns are added to the message as text, never sent out of sight.
 */

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function mount(props: { active: boolean; room?: number }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const added: string[] = [];
  const root = createRoot(container);
  const render = (active: boolean) =>
    root.render(
      <ScreenPicker
        active={active}
        disabled={false}
        room={props.room ?? 40_000}
        onAdd={(text) => added.push(text)}
      />,
    );
  await act(async () => render(props.active));
  await settle();
  return {
    container,
    added,
    open: async () => {
      await act(async () => render(true));
      await settle();
    },
  };
}

function click(element: Element | null | undefined) {
  assert.ok(element, 'no such element');
  act(() => {
    (element as HTMLElement).click();
  });
}

describe('the screen picker', () => {
  it('loads nothing until its panel opens', async () => {
    const view = await mount({ active: false });
    assert.match(view.container.textContent ?? '', /Loading screens/);
    await view.open();
    assert.equal(
      view.container.querySelectorAll('input[type="checkbox"]').length,
      SCREENS.length,
    );
  });

  it('adds the chosen screens to the message, with the screen baseline', async () => {
    const view = await mount({ active: true });
    const boxes = view.container.querySelectorAll('input[type="checkbox"]');
    click(boxes[0]);
    click(boxes[1]);
    const add = [...view.container.querySelectorAll('button')].find((b) =>
      /Add to the message/.test(b.textContent ?? ''),
    );
    click(add);
    assert.equal(view.added.length, 1);
    const text = view.added[0]!;
    assert.ok(text.startsWith('## Screens to add'));
    assert.ok(text.includes(SCREEN_BASELINE));
    assert.ok(text.includes(`### ${SCREENS[0]!.name}:`));
    assert.ok(text.includes(`### ${SCREENS[1]!.name}:`));
  });

  it('says when the message has no room for what was chosen', async () => {
    const view = await mount({ active: true, room: 100 });
    click(view.container.querySelector('input[type="checkbox"]'));
    assert.match(
      view.container.textContent ?? '',
      /0 of 1 fit in what the message has left/,
    );
    const add = [...view.container.querySelectorAll('button')].find((b) =>
      /Add to the message/.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    assert.equal(add.disabled, true);
  });
});
