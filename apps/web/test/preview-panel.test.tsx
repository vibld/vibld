import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { BuilderState } from '../src/generation/session.ts';
import type {
  PreviewStatus,
  PreviewShare,
} from '../src/generation/preview-client.ts';
import type { PreviewSandbox } from '../src/generation/use-preview-sandbox.ts';
import { PreviewPanel } from '../src/components/PreviewPanel.tsx';

/**
 * The preview, as it is actually wired.
 *
 * Every rule in here was written and never run: the runner errors on JSX, so
 * until the harness on #124 this component was typechecked and nothing more.
 */

function stateWith(revision: string | null): BuilderState {
  return {
    acceptedBrief: null,
    acceptedSnapshot:
      revision === null
        ? null
        : {
            revision,
            files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
          },
  } as BuilderState;
}

interface Ran {
  revision: string;
  paths: string[];
}

function sandboxWith(
  status: PreviewStatus | null,
  ranRevision: string | null,
  ran: Ran[] = [],
  shares: PreviewShare[] = [],
): PreviewSandbox {
  return {
    status,
    ranRevision,
    pending: false,
    run(files, revision) {
      ran.push({ revision, paths: files.map((file) => file.path) });
    },
    stop() {},
    shares,
    sharePending: false,
    shareError: null,
    share() {},
    revokeShare() {},
  };
}

const READY: PreviewStatus = {
  status: 'ready',
  url: 'https://sandbox.example/app',
  expiresAt: Date.UTC(2026, 0, 1),
};

async function mount(state: BuilderState, sandbox: PreviewSandbox) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<PreviewPanel state={state} sandbox={sandbox} />);
  });
  const find = (label: RegExp): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((button) =>
      label.test(button.textContent ?? ''),
    );
  return {
    container,
    text: () => container.textContent ?? '',
    button: find,
    async press(label: RegExp) {
      const button = find(label);
      assert.ok(button, `no ${String(label)} button`);
      await act(async () => {
        button.click();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the preview, as it is actually wired', () => {
  it('says when the sandbox is running a checkpoint that has been moved on from', async () => {
    // The address is still live; it is live on the previous checkpoint. The
    // same thing #123 and #126 fixed for the push and publish buttons.
    const view = await mount(stateWith('r2'), sandboxWith(READY, 'r1'));

    assert.match(view.text(), /not the one accepted since/);
    view.unmount();
  });

  it('says nothing of the kind while it is running the accepted one', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.doesNotMatch(view.text(), /not the one accepted since/);
    view.unmount();
  });

  it('says nothing of the kind before there is a frame to be wrong about', async () => {
    const view = await mount(
      stateWith('r2'),
      sandboxWith({ status: 'installing' }, 'r1'),
    );

    assert.doesNotMatch(view.text(), /not the one accepted since/);
    assert.match(view.text(), /Installing dependencies/);
    view.unmount();
  });

  it('runs the checkpoint that is accepted, and says which it is', async () => {
    const ran: Ran[] = [];
    const view = await mount(stateWith('r3'), sandboxWith(null, null, ran));
    await view.press(/Run in sandbox/);

    assert.deepEqual(ran, [{ revision: 'r3', paths: ['index.html'] }]);
    view.unmount();
  });

  it('offers a restart rather than a first run once one is up', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.ok(view.button(/Restart in sandbox/));
    assert.ok(view.button(/Stop/), 'nothing offered to stop a running sandbox');
    view.unmount();
  });

  it('offers nothing to stop when nothing is running', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(null, null));

    assert.equal(view.button(/Stop/), undefined);
    view.unmount();
  });

  it('reports a sandbox that failed, as an alert', async () => {
    const view = await mount(
      stateWith('r1'),
      sandboxWith({ status: 'failed', error: 'The install failed.' }, 'r1'),
    );

    const alert = view.container.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? '', /The install failed/);
    assert.equal(
      view.button(/Stop/),
      undefined,
      'it offered to stop a failure',
    );
    view.unmount();
  });

  it('asks for a checkpoint before there is anything to preview', async () => {
    const view = await mount(stateWith(null), sandboxWith(null, null));

    assert.match(view.text(), /Accept a checkpoint/);
    assert.equal(view.button(/Run in sandbox/), undefined);
    view.unmount();
  });

  it('warns what a share link gives away, beside the button that mints one', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.ok(view.button(/Share/));
    assert.match(view.text(), /Anyone with a share link can view this running/);
    view.unmount();
  });
});
