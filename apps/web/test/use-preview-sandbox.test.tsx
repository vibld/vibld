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

  it('stops the running sandbox before it claims to have restarted it', async () => {
    // `startPreview` reports an existing preview rather than replacing it,
    // so without the stop the second run hands back the sandbox still
    // serving r1 while this records r2 against it. The staleness warning
    // would then be hidden in exactly the case it exists for, and its
    // absence is itself a claim that the frame is current.
    const calls = serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    const before = calls.length;
    await view.run('r2');

    const restart = calls
      .slice(before)
      .filter((call) => call.endsWith('/api/preview'));
    assert.deepEqual(restart, ['DELETE /api/preview', 'POST /api/preview']);
    assert.equal(view.sandbox.ranRevision, 'r2');
    view.unmount();
  });

  it("stops first even on the session's first run", async () => {
    // A sandbox outlives a reload of the page and nothing here reads the
    // status on mount, so "none is running" is not something a first run
    // knows. Unknown has to behave as "there may be one": the worker
    // answers a stop with nothing to stop `{ ok: true }`, while a missed
    // stop hands back the old sandbox under the new checkpoint's name.
    const calls = serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    const view = await mount();
    await view.run('r1');

    assert.deepEqual(
      calls.filter((call) => call.endsWith('/api/preview')),
      ['DELETE /api/preview', 'POST /api/preview'],
    );
    view.unmount();
  });

  it('does not stop again after a stop that succeeded', async () => {
    // The one case where nothing needs stopping is known rather than
    // assumed: a stop that actually answered.
    const view = await mount();
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r1');
    await view.stop();

    const calls = serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r2');

    assert.deepEqual(
      calls.filter((call) => call.endsWith('/api/preview')),
      ['POST /api/preview'],
      'it stopped a sandbox it had already stopped',
    );
    view.unmount();
  });

  it('assumes a start whose reply was lost created one anyway', async () => {
    // The sandbox may exist even though the answer never arrived, so the
    // next run has to stop it first.
    const view = await mount();
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r1');
    await view.stop();

    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => {
        throw new Error('Connection dropped.');
      },
    });
    await view.run('r2');
    assert.equal(view.sandbox.status?.status, 'failed');

    const calls = serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r2');

    assert.deepEqual(
      calls.filter((call) => call.endsWith('/api/preview')),
      ['DELETE /api/preview', 'POST /api/preview'],
      'it left a sandbox a lost start may have created',
    );
    view.unmount();
  });

  it('still stops first when the retry follows a stop that failed', async () => {
    // The screen says failed, but the sandbox is still running: those are
    // different facts. A retry that read the failure as "nothing is
    // running" would skip the stop, be handed the old sandbox back, and
    // record the new checkpoint against it.
    const view = await mount();
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r1');

    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply({ error: 'The sandbox is busy.' }, 503),
    });
    await view.run('r2');
    assert.equal(view.sandbox.status?.status, 'failed');

    const calls = serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r2');

    assert.deepEqual(
      calls.filter((call) => call.endsWith('/api/preview')),
      ['DELETE /api/preview', 'POST /api/preview'],
      'the retry after a failed stop did not stop first',
    );
    assert.equal(view.sandbox.ranRevision, 'r2');
    view.unmount();
  });

  it('claims no checkpoint when the running sandbox will not stop', async () => {
    // Without a stop there is no restart, so recording the new checkpoint
    // would put the current revision on the older project.
    let stops = 0;
    const view = await mount();
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r1');
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => {
        stops += 1;
        return reply({ error: 'The sandbox is busy.' }, 503);
      },
    });
    await view.run('r2');

    assert.equal(stops, 1, 'it did not try to stop the running sandbox');
    assert.equal(view.sandbox.status?.status, 'failed');
    assert.match(
      (view.sandbox.status as { error: string }).error,
      /has not been restarted/,
    );
    assert.equal(view.sandbox.ranRevision, null);
    view.unmount();
  });
});
