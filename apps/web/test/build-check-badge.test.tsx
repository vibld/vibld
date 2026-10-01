import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { PreviewPanel } from '../src/components/PreviewPanel.tsx';
import { Transcript } from '../src/components/Transcript.tsx';
import {
  CHECK_FAILED,
  CHECK_UNFINISHED,
} from '../src/generation/build-check.ts';
import type { BuildCheck } from '../src/generation/build-check.ts';
import type {
  BuilderState,
  DraftPreview,
  TranscriptTurn,
} from '../src/generation/session.ts';
import type { PreviewSandbox } from '../src/generation/use-preview-sandbox.ts';

/**
 * Show early, badge it (docs/decisions.md, D69), as it is drawn: the
 * preview runs a build's own code while its check runs, with a badge that
 * says so, and code that did not pass says so in the preview and in the
 * conversation.
 */

const ACCEPTED = {
  revision: 'r-old',
  files: [{ path: 'index.html', content: '<h1>Old</h1>' }],
};
const EARLY = {
  revision: 'r-early',
  files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }],
};

function state(over: Partial<BuilderState>): BuilderState {
  return {
    acceptedBrief: null,
    acceptedSnapshot: ACCEPTED,
    early: null,
    check: null,
    running: false,
    status: 'accepted',
    progress: null,
    ...over,
  } as BuilderState;
}

const checking = (revision = EARLY.revision): BuildCheck => ({
  state: 'checking',
  revision,
});

function sandbox(ran: string[] = []): PreviewSandbox {
  return {
    status: null,
    ranRevision: null,
    ranProjectId: null,
    mode: 'sandbox',
    page: null,
    pending: false,
    run(_files, revision) {
      ran.push(revision);
    },
    update() {},
    updating: false,
    updateNote: null,
    stop() {},
    stopError: null,
    shares: [],
    sharePending: false,
    shareError: null,
    share() {},
    revokeShare() {},
  };
}

async function mount(
  element: Parameters<ReturnType<typeof createRoot>['render']>[0],
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    text: () => container.textContent ?? '',
    async press(label: RegExp) {
      const button = [...container.querySelectorAll('button')].find((b) =>
        label.test(b.textContent ?? ''),
      );
      assert.ok(button, `no ${String(label)} button`);
      await act(async () => button.click());
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the preview of a build being checked', () => {
  it('badges it, and runs its code rather than the last checkpoint', async () => {
    const ran: string[] = [];
    const view = await mount(
      <PreviewPanel
        state={state({
          running: true,
          status: 'planning',
          early: EARLY,
          check: checking(),
        })}
        sandbox={sandbox(ran)}
      />,
    );
    assert.match(view.text(), /Checking the build/);
    const badge = view.container.querySelector('.check-badge');
    assert.equal(badge?.getAttribute('role'), 'status');
    await view.press(/Run live preview/);
    assert.deepEqual(ran, [EARLY.revision]);
    view.unmount();
  });

  it('says a repair is running', async () => {
    const view = await mount(
      <PreviewPanel
        state={state({
          running: true,
          status: 'planning',
          early: EARLY,
          check: { state: 'repairing', revision: EARLY.revision },
        })}
        sandbox={sandbox()}
      />,
    );
    assert.match(view.text(), /Fixing a problem/);
    assert.match(view.text(), /fixed version will replace this one/);
    view.unmount();
  });

  it('gives the sketch way to the code once it is here', async () => {
    const draft: DraftPreview = {
      label: 'Warm and bright',
      html: '<p>sketch</p>',
      source: 'quick',
      runId: 'run-1',
    };
    const view = await mount(
      <PreviewPanel
        state={state({
          acceptedSnapshot: null,
          running: true,
          status: 'planning',
          early: EARLY,
          check: checking(),
          draft,
        })}
        sandbox={sandbox()}
        draft={draft}
      />,
    );
    // The sketch stays up, but as the built site's, with the way to run it.
    assert.match(view.text(), /the real site is built/);
    assert.ok(
      [...view.container.querySelectorAll('button')].some((b) =>
        /Run live preview/.test(b.textContent ?? ''),
      ),
    );
    view.unmount();
  });

  it('says plainly when the code did not pass, and clears for code that did', async () => {
    const failed = await mount(
      <PreviewPanel
        state={state({
          acceptedSnapshot: EARLY,
          check: { state: 'failed', revision: EARLY.revision },
        })}
        sandbox={sandbox()}
      />,
    );
    assert.match(failed.text(), /Does not build/);
    assert.match(failed.text(), /still your current version/);
    assert.ok(failed.container.querySelector('.check-badge--failed'));
    failed.unmount();

    const unchecked = await mount(
      <PreviewPanel
        state={state({
          acceptedSnapshot: EARLY,
          check: { state: 'unchecked', revision: EARLY.revision },
        })}
        sandbox={sandbox()}
      />,
    );
    assert.match(unchecked.text(), /Not checked/);
    unchecked.unmount();

    const passed = await mount(
      <PreviewPanel
        state={state({ acceptedSnapshot: EARLY })}
        sandbox={sandbox()}
      />,
    );
    assert.equal(passed.container.querySelector('.check-badge'), null);
    passed.unmount();
  });
});

describe('the conversation, for a build whose code did not pass', () => {
  const turn = (problem: string | null): TranscriptTurn => ({
    id: 1,
    runId: 'run-1',
    prompt: 'a bakery site',
    at: 1,
    status: 'accepted',
    summary: 'A bakery site.',
    fileCount: 4,
    revision: 'r-early',
    problem,
    providerId: null,
    agentMessage: null,
  });

  it('says so under the turn, after what was built', async () => {
    const view = await mount(<Transcript turns={[turn(CHECK_FAILED)]} />);
    const text = view.text();
    assert.ok(text.indexOf('A bakery site.') < text.indexOf(CHECK_FAILED));
    view.unmount();

    const unchecked = await mount(
      <Transcript turns={[turn(CHECK_UNFINISHED)]} />,
    );
    assert.match(unchecked.text(), /has not been checked/);
    unchecked.unmount();
  });

  it('says nothing more for a build that passed', async () => {
    const view = await mount(<Transcript turns={[turn(null)]} />);
    assert.doesNotMatch(view.text(), /check/i);
    view.unmount();
  });
});
