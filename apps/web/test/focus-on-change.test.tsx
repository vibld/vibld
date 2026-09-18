import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { useFocusOnChange } from '../src/admin/use-focus-on-change.ts';

/**
 * Where focus lands when the view changes but the document does not (#188
 * review).
 *
 * A document load repositions focus by itself. A view switch inside one
 * does not, and both of this shell's links intercept the click, so the
 * element that was focused is hidden or unmounted a moment later and focus
 * falls to `document.body`: nothing announced, and the next Tab starting
 * from the top of the document rather than the view that just appeared.
 */

function Harness({ value }: { value: string }) {
  const target = useRef<HTMLElement | null>(null);
  useFocusOnChange(value, target);
  return (
    <main ref={target} tabIndex={-1}>
      {value}
    </main>
  );
}

async function mount(value: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness value={value} />);
  });
  return {
    focused: () => document.activeElement,
    main: () => container.querySelector('main'),
    async go(next: string) {
      await act(async () => root.render(<Harness value={next} />));
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('focus across a view switch', () => {
  it('takes no focus on the first render', async () => {
    // Focus already belongs to whatever the reader was doing when the page
    // loaded. Stealing it to a container would be a regression for
    // everybody rather than a fix for anybody.
    const view = await mount('/');
    assert.notEqual(
      view.focused(),
      view.main(),
      'the shell grabbed focus on load, which nobody asked it to do',
    );
    view.unmount();
  });

  it('moves focus to the view when the path changes', async () => {
    const view = await mount('/');

    await view.go('/admin');

    assert.equal(
      view.focused(),
      view.main(),
      'the view changed and focus stayed on an element that is no longer there',
    );
    view.unmount();
  });

  it('does not take focus again while the path holds still', async () => {
    // Re-renders happen constantly during a run. Focus must move on a
    // change of view, not on every state update behind it.
    const view = await mount('/');
    await view.go('/admin');

    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    await view.go('/admin');

    assert.equal(
      view.focused(),
      elsewhere,
      'a re-render at the same path pulled focus away from the reader',
    );
    elsewhere.remove();
    view.unmount();
  });

  it('moves focus back when the reader returns', async () => {
    const view = await mount('/admin');
    await view.go('/');
    assert.equal(view.focused(), view.main());
    view.unmount();
  });
});
