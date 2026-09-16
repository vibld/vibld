import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import {
  POLL_INTERVAL_MS,
  usePreviewSandbox,
} from '../src/generation/use-preview-sandbox.ts';
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

function serving(
  answers: Record<string, (method: string) => Response | Promise<Response>>,
): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    // Longest path first, so /api/preview/share is not answered by
    // /api/preview.
    for (const path of Object.keys(answers).sort(
      (a, b) => b.length - a.length,
    )) {
      if (url.includes(path)) return answers[path]!(init?.method ?? 'GET');
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

  it('does not let a poll from before a restart put the old sandbox back', async () => {
    // `stopPolling` clears the interval, which stops the next tick and does
    // nothing about the request a tick already sent. That reply is about
    // the sandbox from before the restart: committed, it puts the old frame
    // back while `ranRevision` names the new checkpoint, so the warning
    // stays hidden and the old sandbox is shown as the current one.
    const held = (() => {
      let open: ((value: Response) => void) | undefined;
      const waiting = new Promise<Response>((resolve) => {
        open = resolve;
      });
      return { waiting, answer: (value: Response) => open?.(value) };
    })();

    let polled = false;
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) => {
        if (method === 'GET') {
          polled = true;
          return held.waiting;
        }
        return reply({ status: 'installing' });
      },
    });
    const view = await mount();
    await view.run('r1');
    assert.equal(view.sandbox.status?.status, 'installing');

    // One tick of the real interval, so a status request is in flight.
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 200),
      );
    });
    assert.ok(polled, 'the poll never asked for a status');

    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': () => reply(READY),
    });
    await view.run('r2');
    assert.equal(view.sandbox.status?.status, 'ready');

    await act(async () => {
      held.answer(
        new Response(
          JSON.stringify({
            status: 'ready',
            url: 'https://sandbox.example/old',
            expiresAt: Date.UTC(2026, 0, 1),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(
      (view.sandbox.status as { url: string }).url,
      READY.url,
      'a poll from before the restart put the old sandbox back',
    );
    assert.equal(view.sandbox.ranRevision, 'r2');
    view.unmount();
  });
});

describe('a stop that the service refused', () => {
  it('keeps showing the sandbox, and says why it is still there', async () => {
    // The old behaviour cleared the screen either way, arguing that the
    // sandbox times out on its own (L9) so a failed stop had nothing left
    // to do. Eventually is not now: any share link pointed at it keeps
    // serving the code until then, and the person who pressed Stop has been
    // told they are done.
    // The flag matters: a run clears any sandbox left by an earlier session
    // first, so failing every DELETE would fail the run rather than the
    // stop and this test would be about the wrong thing.
    let failStop = false;
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    assert.equal(view.sandbox.status?.status, 'ready', 'the run itself failed');

    failStop = true;
    await view.stop();

    assert.equal(
      view.sandbox.status?.status,
      'ready',
      'told the user a running sandbox was gone',
    );
    assert.equal(view.sandbox.ranRevision, 'r1');
    assert.match(
      view.sandbox.stopError ?? '',
      /preview service is unavailable/,
      'lost the reason the service gave',
    );
    view.unmount();
  });

  it('clears the complaint when a new sandbox is started', async () => {
    // It was about the last one. Leaving it up would be a different false
    // statement from the one just fixed.
    let failStop = false;
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    failStop = true;
    await view.stop();
    assert.ok(view.sandbox.stopError, 'nothing to clear');

    failStop = false;
    await view.run('r2');
    assert.equal(view.sandbox.stopError, null);
    view.unmount();
  });

  it('still clears it when the stop works', async () => {
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' ? reply({ ok: true }) : reply(READY),
    });
    const view = await mount();
    await view.run('r1');
    await view.stop();

    assert.equal(view.sandbox.status, null);
    assert.equal(view.sandbox.stopError, null);
    view.unmount();
  });
});

describe('a stop pressed before the sandbox settled', () => {
  it('starts polling again when the stop is not confirmed', async () => {
    // Stop cancels the poll before sending the request. A sandbox still
    // installing would otherwise sit on that word for the rest of the
    // session, whatever became of it, and asking again is also the only
    // thing that can resolve an unconfirmed stop.
    let failStop = false;
    let phase: unknown = { status: 'installing' };
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(phase),
    });
    const view = await mount();
    await view.run('r1');
    assert.equal(view.sandbox.status?.status, 'installing');

    failStop = true;
    await view.stop();
    assert.ok(view.sandbox.stopError, 'the stop was taken as confirmed');

    // The sandbox carried on and became ready. Without a poll the screen
    // would still say installing.
    phase = READY;
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });

    assert.equal(
      view.sandbox.status?.status,
      'ready',
      'stopped asking what happened to it',
    );
    view.unmount();
  });

  it('asks once about a ready sandbox, and stops when it is still there', async () => {
    // A ready sandbox whose DELETE succeeded with the reply lost is the
    // case that reads worst, so this asks too. It costs one request when
    // the sandbox really is still ready: `pollUntilSettled` stops on the
    // first settled answer rather than running for the session.
    let failStop = false;
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(READY),
    });
    const calls: string[] = [];
    const inner = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return inner(input, init);
    }) as typeof fetch;

    const view = await mount();
    await view.run('r1');
    failStop = true;
    await view.stop();

    const before = calls.length;
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });
    const afterFirst = calls.length;
    assert.equal(afterFirst, before + 1, 'never asked what happened to it');

    // And then stops, because the answer settled it.
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS * 2 + 20),
      );
    });
    assert.equal(calls.length, afterFirst, 'kept polling a settled sandbox');
    view.unmount();
  });
});

describe('what the poll does with an unconfirmed stop', () => {
  it('puts the warning down once the sandbox is reported gone', async () => {
    // The DELETE was carried out and its reply lost. The poll finds no
    // preview, which is the answer to the question the warning was asking,
    // so the warning goes: "no preview has been started" beside "it may
    // still be running" is the panel contradicting itself, and a failed
    // status takes the Stop button away so nobody could clear it by hand.
    let failStop = false;
    let phase: unknown = { status: 'installing' };
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(phase),
    });
    const view = await mount();
    await view.run('r1');

    failStop = true;
    await view.stop();
    assert.ok(view.sandbox.stopError, 'nothing to reconcile');

    phase = { status: 'failed', error: 'No preview has been started.' };
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });

    assert.equal(view.sandbox.status?.status, 'failed');
    assert.equal(
      view.sandbox.stopError,
      null,
      'said the sandbox may still be running and that it does not exist',
    );
    view.unmount();
  });

  it('keeps the warning while the sandbox is still there', async () => {
    // The other answer to the same question. A sandbox that reaches ready
    // is running, so the stop plainly did not take effect and saying so is
    // still the truth.
    let failStop = false;
    let phase: unknown = { status: 'installing' };
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(phase),
    });
    const view = await mount();
    await view.run('r1');

    failStop = true;
    await view.stop();

    phase = READY;
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });

    assert.equal(view.sandbox.status?.status, 'ready');
    assert.ok(view.sandbox.stopError, 'dropped a warning that was still true');
    view.unmount();
  });
});

describe('an answer the poll cannot read', () => {
  it('keeps the stop warning and keeps asking', async () => {
    // A malformed 200 is not the service saying the sandbox stopped. Read
    // as a failure it would take the warning down, stop the poll, and
    // remove the Stop button, all on the strength of a body this client
    // could not parse, while the sandbox may still be running.
    let failStop = false;
    let phase: unknown = { status: 'installing' };
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(phase),
    });
    const view = await mount();
    await view.run('r1');

    failStop = true;
    await view.stop();
    assert.ok(view.sandbox.stopError, 'nothing to keep');

    // Nonsense, then the truth. The poll has to survive the first to report
    // the second.
    phase = { status: 'ready' };
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });
    assert.equal(
      view.sandbox.status?.status,
      'installing',
      'took the nonsense',
    );
    assert.ok(view.sandbox.stopError, 'dropped the warning on unreadable news');

    phase = READY;
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });
    assert.equal(view.sandbox.status?.status, 'ready', 'stopped asking');
    view.unmount();
  });
});

describe('a ready sandbox whose stop was carried out but not confirmed', () => {
  it('finds out it is gone and stops saying otherwise', async () => {
    // The worst-reading case of all: the frame, the share list and the
    // warning all describing something that no longer exists, with nothing
    // asking. One poll settles it.
    let failStop = false;
    let phase: unknown = READY;
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': (method) =>
        method === 'DELETE' && failStop
          ? reply({ error: 'The preview service is unavailable.' }, 502)
          : reply(phase),
    });
    const view = await mount();
    await view.run('r1');

    failStop = true;
    phase = { status: 'failed', error: 'No preview has been started.' };
    await view.stop();
    assert.ok(view.sandbox.stopError, 'nothing to settle');

    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS + 20),
      );
    });

    assert.equal(view.sandbox.status?.status, 'failed');
    assert.equal(view.sandbox.stopError, null, 'still warning about a ghost');
    view.unmount();
  });
});

describe('a status request slower than the poll interval', () => {
  it('never has two of them in flight, and takes the answers in order', async () => {
    // What an interval does that a chain does not. It fires on the clock
    // whatever the last request is doing, so a slow status read leaves
    // several requests outstanding at once, all carrying the same gate
    // token because the gate is taken once for the whole poll. They land in
    // whatever order the network gives them and the gate cannot tell them
    // apart.
    //
    // The sequence below is the one that reads worst. The first read is
    // slow and reports `installing`; the second is prompt and reports the
    // sandbox gone, which is the answer to the question the warning was
    // asking. Overlapped, the second lands first and ends the poll, and
    // then the first overwrites it with news from before the stop: the
    // panel says a sandbox is installing, with no warning and nothing still
    // asking, about something that does not exist.
    let failStop = false;
    let slowNext = true;
    let inFlight = 0;
    let most = 0;
    let phase: unknown = { status: 'installing' };
    serving({
      '/api/preview/share': () => reply({ shares: [] }),
      '/api/preview': async (method) => {
        if (method === 'DELETE') {
          return failStop
            ? reply({ error: 'The preview service is unavailable.' }, 502)
            : reply({ ok: true });
        }
        if (method !== 'GET') return reply(phase);
        inFlight += 1;
        most = Math.max(most, inFlight);
        // Only the first read is slow, so a second one issued while it is
        // outstanding would answer before it.
        const answer = phase;
        if (slowNext) {
          slowNext = false;
          await new Promise((resolve) =>
            setTimeout(resolve, POLL_INTERVAL_MS + 400),
          );
        }
        inFlight -= 1;
        return reply(answer);
      },
    });

    const view = await mount();
    await view.run('r1');
    failStop = true;
    await view.stop();
    assert.ok(view.sandbox.stopError, 'nothing to reconcile');

    phase = { status: 'failed', error: 'No preview has been started.' };
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS * 3 + 600),
      );
    });

    assert.equal(most, 1, 'asked again while the last answer was outstanding');
    assert.equal(
      view.sandbox.status?.status,
      'failed',
      'an answer from before the stop overwrote the one that settled it',
    );
    assert.equal(view.sandbox.stopError, null, 'still warning about a ghost');
    view.unmount();
  });
});
