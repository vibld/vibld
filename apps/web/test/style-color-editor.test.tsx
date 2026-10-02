import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import type {
  StyleColorEdits,
  StyleColorSubject,
} from '@vibld/ai/style-gallery';

import { StyleColorEditor } from '../src/components/StyleColorEditor.tsx';

/** The theme guard in the builder (D147). */

const SUBJECT: StyleColorSubject = {
  design_tokens: {
    colors: [
      { token: '--color-canvas', role: 'canvas', hex: '#ffffff' },
      { token: '--color-text', role: 'text', hex: '#111111' },
      { token: '--color-glow', role: 'glow (decorative)', hex: '#ff66cc' },
    ],
  },
  contrast_checks: [
    {
      use: 'body text on canvas',
      fg: '#111111',
      bg: '#ffffff',
      ratio: 18.88,
      target: 4.5,
    },
    {
      use: 'glow fill, exempt (decorative)',
      fg: '#ff66cc',
      bg: '#ffffff',
      target: 3,
    },
  ],
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

async function mount(value: StyleColorEdits | null = null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const changes: (StyleColorEdits | null)[] = [];
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <StyleColorEditor
        styleId="fixture"
        value={value}
        onChange={(edits) => changes.push(edits)}
        disabled={false}
        loader={async () => ({ ok: true, subject: SUBJECT })}
      />,
    );
  });
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
  const input = (name: string) =>
    [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.startsWith(name))!
      .querySelector('input')!;
  return {
    container,
    changes,
    input,
    async pick(name: string, hex: string) {
      const field = input(name);
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set?.call(field, hex);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    alert: () => container.querySelector('[role="alert"]'),
  };
}

describe('the color editor', () => {
  it("lists the style's colors, the decorative one marked", async () => {
    const view = await mount();
    assert.equal(view.input('canvas').value, '#ffffff');
    assert.match(view.container.textContent!, /never behind text/);
  });

  it('keeps an edit that passes every contrast pair', async () => {
    const view = await mount();
    await view.pick('text', '#000000');
    assert.deepEqual(view.changes, [{ '--color-text': '#000000' }]);
    assert.equal(view.alert(), null);
  });

  it('rejects an edit that fails one, and says which', async () => {
    const view = await mount();
    await view.pick('text', '#dddddd');
    assert.deepEqual(view.changes, []);
    assert.match(
      view.alert()!.textContent!,
      /body text on canvas: 1\.36:1, needs 4\.5:1/,
    );
  });

  it('puts the colors back', async () => {
    const view = await mount({ '--color-text': '#000000' });
    assert.equal(view.input('text').value, '#000000');
    const reset = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset colors',
    )!;
    await act(async () => reset.click());
    assert.deepEqual(view.changes, [null]);
  });
});
