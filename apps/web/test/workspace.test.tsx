import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { BuilderState } from '../src/generation/session.ts';
import { Workspace } from '../src/components/Workspace.tsx';
import { noteFor } from '../src/generation/pane-gaps.ts';

/**
 * The workspace shell, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 */

function reply(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Nothing running: the workspace's own rules are the subject. */
const QUIET = () => reply({ status: 'ready-to-start' });

/**
 * A sandbox that comes up immediately.
 *
 * Immediately on purpose: an unsettled status starts a poll interval, and a
 * test that then fails its assertion never reaches its `unmount`, so the
 * interval outlives it and the runner waits on it for ever. The first cut of
 * this file did exactly that and hung.
 */
const READY = () =>
  reply({
    status: 'ready',
    url: 'https://sandbox.example/app',
    expiresAt: Date.UTC(2026, 0, 1),
  });

function serving(preview: () => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/preview/share')) return reply({ shares: [] });
    if (url.includes('/api/preview')) return preview();
    return reply({});
  }) as typeof fetch;
}

const ACCEPTED = [{ path: 'index.html', content: '<h1>hi</h1>' }];
const STAGED = [{ path: 'index.html', content: '<h1>newer</h1>' }];

/** Accepted and listed are the same files, as they are after an acceptance. */
function builder(overrides: Partial<BuilderState> = {}): BuilderState {
  return {
    status: 'accepted',
    stagedFiles: ACCEPTED.map((file) => ({ ...file })),
    problems: [],
    timeline: [],
    acceptedSnapshot: { revision: 'r1', files: ACCEPTED },
    acceptedBrief: null,
    ...overrides,
  } as BuilderState;
}

async function mount(state: BuilderState, preview: () => Response = QUIET) {
  serving(preview);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<Workspace state={state} />);
  });
  const tab = (label: RegExp): HTMLButtonElement => {
    const found = [...container.querySelectorAll('[role="tab"]')].find(
      (button) => label.test(button.textContent ?? ''),
    );
    assert.ok(found, `no ${String(label)} tab`);
    return found as HTMLButtonElement;
  };
  return {
    container,
    text: () => container.textContent ?? '',
    tab,
    async render(next: BuilderState) {
      await act(async () => root.render(<Workspace state={next} />));
    },
    async run() {
      const button = [...container.querySelectorAll('button')].find((element) =>
        /Run in sandbox/.test(element.textContent ?? ''),
      );
      assert.ok(button, 'no run button');
      await act(async () => {
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async open(label: RegExp) {
      await act(async () => {
        tab(label).click();
      });
    },
    async press(label: RegExp, key: string) {
      await act(async () => {
        tab(label).dispatchEvent(
          new window.KeyboardEvent('keydown', { key, bubbles: true }),
        );
      });
    },
    panel: () => container.querySelector('[role="tabpanel"]'),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the workspace, as it is actually wired', () => {
  it('says the buttons act on the checkpoint, not the files listed', async () => {
    // All three take the accepted snapshot on purpose. The list beside them
    // is showing the staged files, so without this they sit beneath one set
    // of files and act on another.
    const view = await mount(
      builder({ status: 'staging', stagedFiles: STAGED }),
    );
    await view.open(/Code/);

    assert.match(view.text(), /act on the last accepted checkpoint/);
    view.unmount();
  });

  it('says nothing of the kind when the list is the accepted checkpoint', async () => {
    const view = await mount(builder({ status: 'accepted' }));
    await view.open(/Code/);

    assert.doesNotMatch(view.text(), /act on the last accepted checkpoint/);
    assert.doesNotMatch(view.text(), /staged/);
    view.unmount();
  });

  it('says nothing of the kind after a submit that never started', async () => {
    // `BuilderSession.submit` sets `failed` when the budget reservation
    // refuses a run, and never touches `stagedFiles`. After an accepted
    // checkpoint the list is still that checkpoint, so reading the status
    // here would mark those very files "staged" and tell somebody the
    // buttons act on something else.
    const view = await mount(
      builder({ status: 'failed', problems: ['Run budget exceeded'] }),
    );
    await view.open(/Code/);

    assert.doesNotMatch(view.text(), /act on the last accepted checkpoint/);
    assert.doesNotMatch(view.text(), /staged/);
    view.unmount();
  });

  it('says nothing about a list with nothing in it', async () => {
    // A run in progress clears `stagedFiles` while the accepted snapshot
    // still has files, so "not the staged files listed below" would point
    // at an empty list.
    const view = await mount(builder({ status: 'planning', stagedFiles: [] }));
    await view.open(/Code/);

    assert.doesNotMatch(view.text(), /act on the last accepted checkpoint/);
    view.unmount();
  });

  it('marks a list of staged files as staged', async () => {
    const view = await mount(
      builder({ status: 'staging', stagedFiles: STAGED }),
    );
    await view.open(/Code/);

    assert.match(view.text(), /staged/);
    view.unmount();
  });

  it('counts problems and events on their own tabs', async () => {
    const view = await mount(
      builder({
        problems: ['index.html is empty'],
        timeline: [{ id: 1, at: 0, level: 'info', message: 'Planning' }],
      }),
    );

    assert.match(view.tab(/Problems/).textContent ?? '', /1/);
    assert.match(view.tab(/Console/).textContent ?? '', /1/);
    view.unmount();
  });

  it('leaves a tab uncounted when there is nothing to count', async () => {
    const view = await mount(builder());

    assert.doesNotMatch(view.tab(/Problems/).textContent ?? '', /\d/);
    assert.doesNotMatch(view.tab(/Console/).textContent ?? '', /\d/);
    view.unmount();
  });

  it('moves between tabs with the arrow keys, as a tablist should', async () => {
    const view = await mount(builder());
    assert.equal(view.tab(/Preview/).getAttribute('aria-selected'), 'true');

    await view.press(/Preview/, 'ArrowRight');
    assert.equal(view.tab(/Code/).getAttribute('aria-selected'), 'true');

    await view.press(/Code/, 'ArrowLeft');
    assert.equal(view.tab(/Preview/).getAttribute('aria-selected'), 'true');

    await view.press(/Preview/, 'End');
    assert.equal(view.tab(/Runs/).getAttribute('aria-selected'), 'true');

    // Wrapping, so End then Right returns to the first rather than sticking.
    await view.press(/Runs/, 'ArrowRight');
    assert.equal(view.tab(/Preview/).getAttribute('aria-selected'), 'true');
    view.unmount();
  });

  it('keeps only the active tab in the tab order', async () => {
    const view = await mount(builder());

    assert.equal(view.tab(/Preview/).tabIndex, 0);
    assert.equal(view.tab(/Code/).tabIndex, -1);
    view.unmount();
  });

  it('shows one panel at a time, labelled by its tab', async () => {
    const view = await mount(builder());
    await view.open(/Problems/);

    const panel = view.panel();
    assert.equal(panel?.getAttribute('aria-labelledby'), 'tab-problems');
    assert.match(view.text(), /No problems reported/);
    assert.doesNotMatch(view.text(), /No events yet/);
    view.unmount();
  });

  it('gives run history a tab of its own', async () => {
    // Reachable at all is the thing worth asserting here: the pane's own
    // rules live in `run-history.test.tsx`, but a panel nothing routes to
    // is a panel nobody sees.
    const view = await mount(builder());
    await view.open(/Runs/);

    assert.equal(view.panel()?.getAttribute('aria-labelledby'), 'tab-runs');
    view.unmount();
  });

  it('flags a running sandbox on the tab nobody is looking at', async () => {
    const view = await mount(builder(), READY);
    await view.run();

    assert.match(view.tab(/Preview/).textContent ?? '', /live/);
    view.unmount();
  });

  it('stops calling it live once it is running an older checkpoint', async () => {
    // The badge exists for the person who has looked away from Preview, so
    // it is the one place "live" must not mean "an older one is".
    const view = await mount(builder(), READY);
    await view.run();
    assert.match(view.tab(/Preview/).textContent ?? '', /live/);

    await view.render(
      builder({
        acceptedSnapshot: {
          revision: 'r2',
          files: [{ path: 'index.html', content: '<h1>new</h1>' }],
        } as BuilderState['acceptedSnapshot'],
      }),
    );

    assert.doesNotMatch(view.tab(/Preview/).textContent ?? '', /live/);
    assert.match(view.tab(/Preview/).textContent ?? '', /older/);
    view.unmount();
  });

  it('takes both pane notes from the one list of gaps', async () => {
    // Not a match on the wording: the whole point is that the pane renders
    // the recorded note itself, so correcting the record corrects the pane.
    // A hand-written sentence that happens to read the same passes a regex
    // and is exactly what went wrong three times.
    const view = await mount(builder());

    await view.open(/Console/);
    assert.ok(view.text().includes(noteFor('console')));

    await view.open(/Problems/);
    assert.ok(view.text().includes(noteFor('problems')));
    view.unmount();
  });
});
