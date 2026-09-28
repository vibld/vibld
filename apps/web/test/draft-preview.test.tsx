import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { BuilderState, DraftPreview } from '../src/generation/session.ts';
import type { PreviewStatus } from '../src/generation/preview-client.ts';
import type { PreviewSandbox } from '../src/generation/use-preview-sandbox.ts';
import { PreviewPanel } from '../src/components/PreviewPanel.tsx';
import { Workspace } from '../src/components/Workspace.tsx';
import {
  DRAFT_BUILDING_LABEL,
  DRAFT_BUILT_LABEL,
} from '../src/components/DraftPreview.tsx';

/**
 * The draft preview on screen (docs/decisions.md, 2026-09-28): a sketch of
 * the page while a first build runs, labelled as a draft, with the build's
 * progress over it, and gone once the live preview is running.
 */

const DRAFT: DraftPreview = {
  label: 'Warm bakery',
  html: '<!doctype html><body><h1>Crumb and Co.</h1><script>parent.x=1</script></body>',
  source: 'quick',
  runId: 'run-1',
};

function building(overrides: Partial<BuilderState> = {}): BuilderState {
  return {
    status: 'staging',
    running: true,
    progress: { elapsedMs: 42_000, stage: 'running' },
    acceptedBrief: null,
    acceptedSnapshot: null,
    stagedFiles: [],
    problems: [],
    timeline: [],
    draft: DRAFT,
    ...overrides,
  } as BuilderState;
}

function accepted(overrides: Partial<BuilderState> = {}): BuilderState {
  return building({
    status: 'accepted',
    running: false,
    progress: null,
    acceptedSnapshot: {
      revision: 'r1',
      files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
    },
    ...overrides,
  });
}

function sandboxWith(
  status: PreviewStatus | null,
  ran: string[] = [],
): PreviewSandbox {
  return {
    status,
    ranRevision: status ? 'r1' : null,
    pending: false,
    run(_files, revision) {
      ran.push(revision);
    },
    stop() {},
    stopError: null,
    shares: [],
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

async function mountPanel(
  state: BuilderState,
  sandbox: PreviewSandbox,
  draft: DraftPreview | null = state.draft,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<PreviewPanel state={state} sandbox={sandbox} draft={draft} />);
  });
  return {
    container,
    text: () => container.textContent ?? '',
    frames: () => [...container.querySelectorAll('iframe')],
    button: (label: RegExp) =>
      [...container.querySelectorAll('button')].find((each) =>
        label.test(each.textContent ?? ''),
      ),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the draft while a first build runs', () => {
  it('shows the draft under its label, instead of an empty pane', async () => {
    const view = await mountPanel(building(), sandboxWith(null));
    assert.ok(view.text().includes(DRAFT_BUILDING_LABEL));
    assert.equal(DRAFT_BUILDING_LABEL, 'Draft, building the real site');
    assert.doesNotMatch(view.text(), /Nothing to preview yet/);
    const [frame] = view.frames();
    assert.ok(frame, 'no frame for the draft');
    assert.match(frame.getAttribute('srcdoc') ?? '', /Crumb and Co\./);
    view.unmount();
  });

  it('renders it in a fully restricted frame, never in the builder', async () => {
    const view = await mountPanel(building(), sandboxWith(null));
    const [frame] = view.frames();
    assert.equal(frame?.getAttribute('sandbox'), '');
    // Through `mockupFrameDocument`, which adds the content policy.
    assert.match(
      frame?.getAttribute('srcdoc') ?? '',
      /Content-Security-Policy/,
    );
    assert.equal(
      view.container.querySelector('h1'),
      null,
      'the draft markup reached the builder document',
    );
    view.unmount();
  });

  it('lays the build stage and progress over it', async () => {
    const view = await mountPanel(building(), sandboxWith(null));
    const overlay = view.container.querySelector('.preview__draft-overlay');
    assert.ok(overlay, 'no overlay');
    const active = overlay.querySelector('.lifecycle__step--active');
    assert.match(active?.textContent ?? '', /Write/);
    assert.ok(overlay.querySelector('.progress'), 'no progress meter');
    // The conversation already announces progress; this copy stays quiet.
    assert.equal(overlay.querySelector('[aria-live]'), null);
    view.unmount();
  });

  it('shows the draft rather than a sandbox left over from before', async () => {
    const view = await mountPanel(building(), sandboxWith(READY));
    assert.ok(view.text().includes(DRAFT_BUILDING_LABEL));
    assert.equal(
      view.frames().some((frame) => frame.getAttribute('src') === READY.url),
      false,
    );
    view.unmount();
  });

  it('shows the pane as it was when there is no draft', async () => {
    const view = await mountPanel(building({ draft: null }), sandboxWith(null));
    assert.match(view.text(), /Nothing to preview yet/);
    assert.equal(view.frames().length, 0);
    view.unmount();
  });
});

describe('between the build and the live preview', () => {
  it('keeps the draft, says the real site is built, and offers to run it', async () => {
    const ran: string[] = [];
    const view = await mountPanel(accepted(), sandboxWith(null, ran));
    assert.ok(view.text().includes(DRAFT_BUILT_LABEL));
    assert.doesNotMatch(view.text(), /building the real site/);
    const run = view.button(/Run live preview/);
    assert.ok(run, 'nothing offered to run the real site');
    await act(async () => run.click());
    assert.deepEqual(ran, ['r1']);
    view.unmount();
  });

  it('says what the sandbox is doing while it starts', async () => {
    const view = await mountPanel(
      accepted(),
      sandboxWith({ status: 'installing' }),
    );
    assert.ok(view.text().includes(DRAFT_BUILT_LABEL));
    assert.match(view.text(), /Installing dependencies/);
    view.unmount();
  });

  it('is replaced by the live preview once it is running', async () => {
    const view = await mountPanel(accepted(), sandboxWith(READY));
    assert.doesNotMatch(view.text(), /Draft,/);
    const frames = view.frames();
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.getAttribute('src'), READY.url);
    view.unmount();
  });

  it('gives way to a sandbox that failed, which says so as it always has', async () => {
    const view = await mountPanel(
      accepted(),
      sandboxWith({ status: 'failed', error: 'The install failed.' }),
    );
    assert.doesNotMatch(view.text(), /Draft,/);
    assert.match(view.text(), /The install failed/);
    assert.ok(view.button(/Try again/));
    view.unmount();
  });
});

describe('the workspace retires a draft once the real site has run', () => {
  function reply(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('does not go back to the sketch after the live preview is stopped', async () => {
    // Nothing running until the button is pressed, and nothing after Stop.
    const IDLE = { status: 'ready-to-start' };
    let status: unknown = IDLE;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes('/api/preview/share')) return reply({ shares: [] });
      if (url.includes('/api/preview')) {
        if (init?.method === 'POST') status = READY;
        if (init?.method === 'DELETE') status = IDLE;
        return reply(status);
      }
      return reply({});
    }) as typeof fetch;

    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    const state = accepted();
    await act(async () => {
      root = createRoot(container);
      root.render(<Workspace state={state} />);
    });
    const button = (label: RegExp) =>
      [...container.querySelectorAll('button')].find((each) =>
        label.test(each.textContent ?? ''),
      );

    const press = async (label: RegExp) => {
      const found = button(label);
      assert.ok(found, `no ${String(label)} button`);
      await act(async () => {
        found.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    try {
      assert.ok(container.textContent?.includes(DRAFT_BUILT_LABEL));
      await press(/Run live preview/);
      const live = [...container.querySelectorAll('iframe')].find(
        (frame) => frame.getAttribute('src') === READY.url,
      );
      assert.ok(live, 'the live preview never replaced the draft');

      await press(/^Stop$/);
      assert.equal(
        container.textContent?.includes('Draft,'),
        false,
        'the sketch came back after the real site had been seen',
      );
      assert.match(container.textContent ?? '', /Ready to run/);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
