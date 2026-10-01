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
 * until the harness on internal PR 124 this component was typechecked and nothing more.
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
  stopError: string | null = null,
  live: { updating?: boolean; updateNote?: string | null } = {},
): PreviewSandbox {
  return {
    status,
    ranRevision,
    ranProjectId: null,
    mode: 'sandbox',
    page: null,
    pending: false,
    run(files, revision) {
      ran.push({ revision, paths: files.map((file) => file.path) });
    },
    update() {},
    updating: live.updating ?? false,
    updateNote: live.updateNote ?? null,
    stop() {},
    stopError,
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
    // same thing internal PR 123 and internal PR 126 fixed for the push and publish buttons.
    const view = await mount(stateWith('r2'), sandboxWith(READY, 'r1'));

    assert.match(view.text(), /not the one accepted since/);
    view.unmount();
  });

  it('says nothing of the kind while it is running the accepted one', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.doesNotMatch(view.text(), /not the one accepted since/);
    view.unmount();
  });

  it('says it is updating, not that it needs a restart, while an update is on its way (D74)', async () => {
    const view = await mount(
      stateWith('r2'),
      sandboxWith(READY, 'r1', [], [], null, { updating: true }),
    );

    assert.match(view.text(), /Updating preview…/);
    assert.doesNotMatch(view.text(), /not the one accepted since/);
    // The frame stays up: the dev server reloads it in place.
    assert.ok(view.container.querySelector('iframe[src]'));
    // Restart stays on offer for anyone who wants a clean one anyway.
    assert.ok(view.button(/^Restart$/));
    view.unmount();
  });

  it('explains a restart that nobody pressed (D74)', async () => {
    const view = await mount(
      stateWith('r2'),
      sandboxWith(null, null, [], [], null, {
        updateNote:
          'Restarted the preview: the change could not be applied to it in place. The dev server was no longer running.',
      }),
    );

    assert.match(view.text(), /could not be applied to it in place/);
    assert.match(view.text(), /no longer running/);
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
    await view.press(/Run live preview/);

    assert.deepEqual(ran, [{ revision: 'r3', paths: ['index.html'] }]);
    view.unmount();
  });

  it('offers a restart rather than a first run once one is up', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.ok(view.button(/^Restart$/));
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

    assert.match(view.text(), /Nothing to preview yet/);
    assert.equal(view.button(/Run live preview/), undefined);
    view.unmount();
  });

  it('warns what a share link gives away, beside the button that mints one', async () => {
    const view = await mount(stateWith('r1'), sandboxWith(READY, 'r1'));

    assert.ok(view.button(/Share/));
    assert.match(view.text(), /Anyone with a share link can view this running/);
    view.unmount();
  });
});

describe('a preview whose project does not compile', () => {
  it('says so, and quotes the output rather than paraphrasing it', async () => {
    // internal issue 194. Without this the reader still sees the failure, as Vite's own
    // transform error inside the frame, which reads as Vibld being broken
    // rather than as their project needing a fix. The exact words are what
    // make it actionable, so they are shown verbatim.
    const said =
      "src/App.tsx(3,10): error TS1484: 'ReactNode' is a type and must be imported using a type-only import";
    const ui = await mount(
      stateWith('rev-1'),
      sandboxWith({ ...READY, typecheckFailure: said }, 'rev-1'),
    );
    assert.match(ui.text(), /npm run typecheck/);
    assert.ok(ui.text().includes(said), 'the output was not shown');
    ui.unmount();
  });

  it('claims nothing about a command it did not run', async () => {
    // internal PR 195 review. An earlier draft said `npm run build` would fail. The
    // model writes the manifest, and the prompt requires a "build" and a
    // "typecheck" script without requiring the first to invoke the second,
    // so a project whose build is a bare `vite build` can bundle perfectly
    // well while this fails. What ran was `npm run typecheck`, and that is
    // the whole of what can be reported.
    const ui = await mount(
      stateWith('rev-1'),
      sandboxWith(
        { ...READY, typecheckFailure: 'src/App.tsx(1,1): error TS1005' },
        'rev-1',
      ),
    );
    assert.equal(
      /npm run build/.test(ui.text()),
      false,
      'the panel predicted the outcome of a command nothing ran',
    );
    ui.unmount();
  });

  it('does not call a running preview broken', async () => {
    // The sandbox is up, the URL works and the dev server is serving. This
    // is a finding about the project, which is the user's to edit, so it
    // is not an alert and does not claim the preview failed.
    const ui = await mount(
      stateWith('rev-1'),
      sandboxWith(
        { ...READY, typecheckFailure: 'src/App.tsx(1,1): error TS1005' },
        'rev-1',
      ),
    );
    // Compared as booleans rather than against the nodes themselves: a
    // failed assertion on a happy-dom element serialises the whole tree
    // into the diff, which turns a one-line failure into a hang.
    assert.equal(
      ui.container.querySelector('[role="alert"]') !== null,
      false,
      'a running preview was announced as an error',
    );
    assert.equal(
      ui.container.querySelector('[role="status"]') !== null,
      true,
      'the finding was not announced at all',
    );
    ui.unmount();
  });

  it('says nothing when the project compiles', async () => {
    const ui = await mount(stateWith('rev-1'), sandboxWith(READY, 'rev-1'));
    assert.equal(/npm run typecheck/.test(ui.text()), false);
    ui.unmount();
  });
});

describe('a stop that did not happen', () => {
  it('says the sandbox is still running, rather than removing it', async () => {
    // The panel used to clear the sandbox whatever the stop answered. Stop
    // is pressed by somebody who wants it not running, usually because a
    // share link is serving their code, and "done" is the one answer that
    // stops them trying again.
    const view = await mount(
      stateWith('r1'),
      sandboxWith(
        { status: 'ready', url: 'https://sandbox.example', expiresAt: 1 },
        'r1',
        [],
        [],
        'The preview service is unavailable.',
      ),
    );

    assert.match(view.text(), /may still be running/i);
    assert.match(view.text(), /could not be confirmed/i);
    assert.doesNotMatch(
      view.text(),
      /The sandbox is still running/,
      'swapped one false certainty for its opposite',
    );
    assert.match(
      view.text(),
      /preview service is unavailable/i,
      'replaced the reason with a guess',
    );
  });

  it('says nothing when the stop worked', async () => {
    const view = await mount(
      stateWith('r1'),
      sandboxWith(
        { status: 'ready', url: 'https://sandbox.example', expiresAt: 1 },
        'r1',
      ),
    );
    assert.doesNotMatch(view.text(), /may still be running/i);
  });
});

describe('the preview in this browser (D125)', () => {
  /** A message as if `source` had posted it. */
  function message(data: unknown, source: unknown): MessageEvent {
    // The page's own MessageEvent: Node has one too, which the page's
    // `dispatchEvent` refuses.
    const PageMessageEvent = (
      window as unknown as { MessageEvent: typeof MessageEvent }
    ).MessageEvent;
    const event = new PageMessageEvent('message', { data });
    Object.defineProperty(event, 'source', { value: source });
    return event;
  }
  const blob = new Blob(['x'], { type: 'image/png' });
  function inBrowser(status: PreviewStatus | null): PreviewSandbox {
    return {
      ...sandboxWith(status, status ? 'r1' : null),
      mode: 'browser',
      page:
        status?.status === 'ready'
          ? {
              document: '<!doctype html><p>the app</p>',
              assets: [{ path: 'media/hero.png', kind: 'media', blob }],
              key: 1,
            }
          : null,
    };
  }
  const READY_HERE: PreviewStatus = {
    status: 'ready',
    url: 'about:srcdoc',
    expiresAt: 0,
    revision: 'r1',
  };

  it('shows the page in a frame with no origin of its own, and no share links', async () => {
    const view = await mount(stateWith('r1'), inBrowser(READY_HERE));
    const frame = view.container.querySelector('iframe');
    assert.ok(frame);
    assert.equal(frame.getAttribute('srcdoc'), '<!doctype html><p>the app</p>');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    assert.match(sandbox, /allow-scripts/);
    assert.doesNotMatch(sandbox, /allow-same-origin/);
    assert.match(
      view.text(),
      /Running in this browser, with packages from esm\.sh/,
    );
    assert.equal(view.button(/^Share$/), undefined);
    assert.doesNotMatch(view.text(), /Expires around/);
    view.unmount();
  });

  it('says it is bundling, not installing, while it runs', async () => {
    const view = await mount(
      stateWith('r1'),
      inBrowser({ status: 'starting' }),
    );
    assert.match(view.text(), /Bundling your app in this browser/);
    assert.match(view.text(), /loads the bundler/);
    view.unmount();
  });

  it('offers to bundle in this browser rather than in a sandbox', async () => {
    const view = await mount(stateWith('r1'), inBrowser(null));
    assert.match(view.text(), /Bundles your app in this browser/);
    assert.doesNotMatch(view.text(), /private sandbox/);
    view.unmount();
  });

  it('hands the page its files when it asks, and shows what the app throws', async () => {
    const view = await mount(stateWith('r1'), inBrowser(READY_HERE));
    const frame = view.container.querySelector('iframe')!;
    const target = frame.contentWindow;
    assert.ok(target, 'the frame has a window to talk to');
    const sent: unknown[] = [];
    target.postMessage = ((message: unknown) => {
      sent.push(message);
    }) as typeof target.postMessage;

    await act(async () => {
      window.dispatchEvent(
        message({ source: 'vibld-preview', kind: 'assets' }, target),
      );
    });
    assert.deepEqual(sent, [
      {
        source: 'vibld-builder',
        assets: [{ path: 'media/hero.png', kind: 'media', blob }],
      },
    ]);

    // Another window saying the same thing is not the page.
    await act(async () => {
      window.dispatchEvent(
        message(
          { source: 'vibld-preview', kind: 'error', message: 'forged' },
          window,
        ),
      );
    });
    assert.doesNotMatch(view.text(), /forged/);

    await act(async () => {
      window.dispatchEvent(
        message(
          {
            source: 'vibld-preview',
            kind: 'error',
            message: 'x is not defined',
          },
          target,
        ),
      );
    });
    assert.match(view.text(), /The app reported an error: x is not defined/);
    view.unmount();
  });
});
