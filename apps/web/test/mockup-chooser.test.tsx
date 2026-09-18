import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { MockupChooser } from '../src/components/MockupChooser.tsx';
import type { ParsedMockup } from '@vibld/ai/mockup-schema';

/**
 * Three directions on screen, and the rule that keeps them harmless (#185).
 *
 * Every mockup is model output. The assertions about the frame are the
 * security ones: this markup must never reach the shell's own document,
 * where it would have the shell's origin and its Clerk session.
 */

function mockup(label: string, html = `<!doctype html><body>${label}</body>`) {
  return { label, rationale: `Why ${label}.`, html } as ParsedMockup;
}

async function mount(mockups: ParsedMockup[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const chosen: ParsedMockup[] = [];
  let discarded = 0;
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MockupChooser
        mockups={mockups}
        onChoose={(each) => chosen.push(each)}
        onDiscard={() => {
          discarded += 1;
        }}
      />,
    );
  });
  return {
    container,
    chosen,
    discarded: () => discarded,
    frames: () => [...container.querySelectorAll('iframe')],
    button: (label: RegExp) =>
      [...container.querySelectorAll('button')].find((each) =>
        label.test(each.textContent ?? ''),
      ),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('choosing a direction', () => {
  it('shows one frame per direction that arrived', async () => {
    // Two, not three, on purpose: the schema accepts two to four because a
    // paid run should not be discarded over a count the reader never sees.
    const view = await mount([mockup('Quiet'), mockup('Loud')]);
    assert.equal(view.frames().length, 2);
    view.unmount();
  });

  it('renders each one in a fully restricted frame', async () => {
    // The security assertion. An empty sandbox is the deny-everything list:
    // no scripts, no same-origin, no forms, no navigation.
    const view = await mount([mockup('Quiet'), mockup('Loud')]);
    for (const frame of view.frames()) {
      assert.equal(
        frame.getAttribute('sandbox'),
        '',
        'a mockup frame is not fully restricted',
      );
      assert.ok(
        frame.hasAttribute('srcdoc'),
        'a mockup frame is not carrying its document',
      );
    }
    view.unmount();
  });

  it('never puts model markup in this document', async () => {
    // `dangerouslySetInnerHTML` here would give model output the shell's
    // origin, session and DOM, which is the one thing ADR-0004 prevents.
    const view = await mount([
      mockup('Sneaky', '<!doctype html><body><h1 id="escaped">no</h1></body>'),
    ]);
    assert.equal(
      view.container.querySelector('#escaped'),
      null,
      'mockup markup was parsed into the shell document',
    );
    view.unmount();
  });

  it('hands back the direction that was picked', async () => {
    const view = await mount([mockup('Quiet'), mockup('Loud')]);
    const buttons = [...view.container.querySelectorAll('button')].filter(
      (each) => /Build this one/.test(each.textContent ?? ''),
    );
    await act(async () => buttons[1]?.click());
    assert.deepEqual(
      view.chosen.map((each) => each.label),
      ['Loud'],
    );
    view.unmount();
  });

  it('offers a way to want none of them', async () => {
    const view = await mount([mockup('Quiet'), mockup('Loud')]);
    await act(async () => view.button(/None of these/)?.click());
    assert.equal(view.discarded(), 1);
    view.unmount();
  });

  it('draws nothing at all when there is nothing to choose between', async () => {
    const view = await mount([]);
    assert.equal(view.container.textContent, '');
    view.unmount();
  });
});
