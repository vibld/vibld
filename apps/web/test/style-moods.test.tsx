import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import {
  PRESET_MOODS,
  STYLE_PRESETS,
  findStylePreset,
} from '@vibld/ai/style-presets';

import { StylePicker } from '../src/components/StylePicker.tsx';

/**
 * D76: moods narrow the style rows and the request suggests styles, but a
 * suggestion is only a mark. Nothing is chosen for the person.
 */

async function mount(props: { prompt?: string; value?: 'dark' | null }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const changes: (string | null)[] = [];
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <StylePicker
        value={props.value ?? null}
        onChange={(value) => changes.push(value)}
        disabled={false}
        prompt={props.prompt ?? ''}
      />,
    );
  });
  const styleChips = () => [
    ...container.querySelectorAll<HTMLButtonElement>('button.chip--style'),
  ];
  const moodChip = (name: string) =>
    [
      ...container.querySelectorAll<HTMLButtonElement>('button.chip--mood'),
    ].find((chip) => chip.textContent === name)!;
  return {
    container,
    changes,
    styleChips,
    moodChip,
    unmount: () => act(() => root.unmount()),
  };
}

describe('style moods in the picker (D76)', () => {
  it('shows every style until a mood is chosen, then only that mood', async () => {
    const view = await mount({});
    assert.equal(view.styleChips().length, STYLE_PRESETS.length);
    await act(async () => view.moodChip('Calm').click());
    const calm = STYLE_PRESETS.filter((preset) =>
      PRESET_MOODS[preset.id].includes('calm'),
    ).map((preset) => preset.name);
    assert.deepEqual(
      view.styleChips().map((chip) => chip.textContent),
      calm,
    );
    assert.equal(view.moodChip('Calm').getAttribute('aria-pressed'), 'true');
    // Choosing the mood again clears it.
    await act(async () => view.moodChip('Calm').click());
    assert.equal(view.styleChips().length, STYLE_PRESETS.length);
    view.unmount();
  });

  it('keeps the chosen style visible under a mood it does not carry', async () => {
    const view = await mount({ value: 'dark' });
    await act(async () => view.moodChip('Playful').click());
    assert.ok(
      view.styleChips().some((chip) => chip.textContent === 'Dark'),
      'a chosen style that vanished could not be cleared',
    );
    view.unmount();
  });

  it('marks the styles the request suggests, and chooses none of them', async () => {
    const view = await mount({ prompt: 'A calm, premium spa website' });
    const marked = view
      .styleChips()
      .filter((chip) => chip.dataset.suggested === 'true')
      .map((chip) => chip.textContent);
    const expected = ['glassmorphism', 'aurora'].map(
      (id) => findStylePreset(id)!.name,
    );
    assert.deepEqual(marked, expected);
    assert.ok(
      (
        view.container.querySelector('.styles__suggested')?.textContent ?? ''
      ).includes(expected.join(', ')),
    );
    assert.deepEqual(view.changes, [], 'a suggestion picked a style');
    view.unmount();
  });

  it('suggests nothing for a request that names no mood', async () => {
    const view = await mount({ prompt: 'A bakery website' });
    assert.equal(view.container.querySelector('.styles__suggested'), null);
    assert.ok(view.styleChips().every((chip) => !chip.dataset.suggested));
    view.unmount();
  });
});
