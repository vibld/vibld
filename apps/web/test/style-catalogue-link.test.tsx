import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { STYLE_PRESETS } from '@vibld/ai/style-presets';

import { StylePicker } from '../src/components/StylePicker.tsx';

/**
 * The way out of the empty prompt box (#186).
 *
 * Chris asked for "linking from the app to see a preview sample catalog",
 * and the reason is the one the issue names: a chip reading "Brutalist"
 * tells somebody who has not seen one nothing at all, so the cheapest way
 * to find out what a direction looks like was to spend a run on it.
 *
 * What makes the link honest rather than decorative is that both ends are
 * generated from `STYLE_PRESETS`: these chips send ids from that list, and
 * vibld.com/styles is built from the same list. Neither can drift into
 * advertising a direction the builder does not know.
 */

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <StylePicker value={null} onChange={() => {}} disabled={false} />,
    );
  });
  return {
    container,
    link: () =>
      container.querySelector<HTMLAnchorElement>('a.styles__catalogue'),
    unmount: () => act(() => root.unmount()),
  };
}

describe('finding out what a style looks like', () => {
  it('offers a way to see the directions rather than only their names', async () => {
    const view = await mount();
    const link = view.link();
    assert.ok(link, 'the style picker names directions and shows none of them');
    assert.equal(link.getAttribute('href'), 'https://vibld.com/styles');
    assert.ok(
      (link.textContent ?? '').trim().length > 0,
      'the link has no label, so nothing on screen says where it goes',
    );
    view.unmount();
  });

  it('opens the catalogue without discarding the session', async () => {
    // The builder holds a run and unsaved state. A link that replaced the
    // document would throw both away to look at a picture.
    const view = await mount();
    const link = view.link()!;
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(
      link.getAttribute('rel') ?? '',
      /noopener/,
      'a new tab is opened without severing the opener reference',
    );
    view.unmount();
  });

  it('still draws the link while a run is going', async () => {
    // The fieldset is disabled during a run, which greys every chip. A
    // link is not a control that could disturb the run, and somebody
    // watching a build is exactly who is choosing the next direction.
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <StylePicker value={null} onChange={() => {}} disabled={true} />,
      );
    });
    assert.ok(
      container.querySelector('a.styles__catalogue'),
      'the catalogue link vanishes while a run is going',
    );
    await act(() => root!.unmount());
  });

  it('points at a page built from the list these chips send', async () => {
    // The drift guard, stated where somebody changing either end will see
    // it. If the catalogue ever stops being generated from STYLE_PRESETS,
    // this link starts advertising directions the builder may not know.
    const marketing = await readFile(
      join(
        fileURLToPath(new URL('../../marketing/app/', import.meta.url)),
        'catalogue.ts',
      ),
      'utf8',
    ).catch(() => '');
    assert.match(
      marketing,
      /STYLE_PRESETS/,
      'the catalogue page no longer reads the preset list the builder sends',
    );
    assert.ok(STYLE_PRESETS.length > 0);
  });
});
