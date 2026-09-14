import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { usePreviewSandbox } from '../src/generation/use-preview-sandbox.ts';
import type { PreviewSandbox } from '../src/generation/use-preview-sandbox.ts';

/**
 * The half of the staleness rule that has to survive a tab switch.
 *
 * `PreviewPanel` is unmounted every time the Preview tab stops being the
 * active one, so the checkpoint a sandbox was started from cannot be kept
 * there: it would be forgotten while the sandbox it describes carried on
 * running. It lives in the hook, which `Workspace` holds.
 */

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serving(answers: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    // Longest path first, so /api/preview/share is not answered by
    // /api/preview.
    for (const path of Object.keys(answers).sort(
      (a, b) => b.length - a.length,
    )) {
      if (url.includes(path)) return answers[path]!();
    }
    throw new Error(`nothing is serving ${url}`);
  }) as typeof fetch;
  return calls;
}

/** Mounts the hook and hands back the latest value it returned. */
async function mount() {
  let latest: PreviewSandbox | undefined;
  function Probe() {
    latest = usePreviewSandbox();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    get sandbox(): PreviewSandbox {
      assert.ok(latest, 'the hook never returned');
      return latest;
    },
    async run(revision: string) {
      await act(async () => {
        this.sandbox.run(
          [{ path: 'index.html', content: '<h1>hi</h1>' }],
          revision,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    async stop() {
      await act(async () => {
        this.sandbox.stop();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const READY = {
  status: 'ready',
  url: 'https://sandbox.example/app',
  expiresAt: Date.UTC(2026, 0, 1),
};

describe('what a running sandbox remembers', () => {
  it('remembers the checkpoint it was started from', async () => {
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    const view = await mount();
    await view.run('r1');

    assert.equal(view.sandbox.status?.status, 'ready');
    assert.equal(view.sandbox.ranRevision, 'r1');
    view.unmount();
  });

  it('forgets it when the sandbox is stopped', async () => {
    // Nothing is running, so there is no longer a checkpoint being served
    // and nothing to be out of date about.
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    await view.stop();

    assert.equal(view.sandbox.status, null);
    assert.equal(view.sandbox.ranRevision, null);
    view.unmount();
  });

  it('moves to the checkpoint a restart was asked for', async () => {
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    await view.run('r2');

    assert.equal(view.sandbox.ranRevision, 'r2');
    view.unmount();
  });
});
