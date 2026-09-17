import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { RunTrace } from '@vibld/core';

import { RunHistory } from '../src/components/RunHistory.tsx';

/**
 * The run history pane, as it is actually wired.
 *
 * The point of #167 is that these facts survive a reload, so the rule worth
 * testing is that the list comes from the route rather than from anything
 * this tab accumulated while it was open.
 */

function trace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    runId: 'run-1',
    projectId: 'user_abc',
    stop: 'applied',
    model: 'claude-haiku-4-5',
    inputTokens: 10_000,
    cachedInputTokens: 6_000,
    outputTokens: 2_000,
    contextWindow: 200_000,
    costMicroUsd: 14_300,
    elapsedMs: 8_200,
    endedAt: '2026-03-04T05:06:07.000Z',
    ...overrides,
  };
}

function serving(answer: () => Response): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls += 1;
    return answer();
  }) as typeof fetch;
  return state;
}

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function mount(runCount = 0) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<RunHistory runCount={runCount} />);
  });
  return {
    text: () => container.textContent ?? '',
    async setRunCount(next: number) {
      await act(async () => {
        root.render(<RunHistory runCount={next} />);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('the run history pane', () => {
  it('shows what a stored run did, in words and in figures', async () => {
    serving(() => reply({ runs: [trace()] }));
    const view = await mount();

    assert.match(view.text(), /Applied/);
    assert.match(view.text(), /claude-haiku-4-5/);
    assert.match(view.text(), /60% cached/);
    assert.match(view.text(), /\$0\.0143/);
    view.unmount();
  });

  it('never shows a stop as its own identifier', async () => {
    serving(() => reply({ runs: [trace({ stop: 'model-refused' })] }));
    const view = await mount();

    assert.match(view.text(), /The model declined this request/);
    assert.doesNotMatch(view.text(), /model-refused/);
    view.unmount();
  });

  it('lists runs this tab never watched', async () => {
    // The whole point: mounting fetches, so a run from before the reload is
    // here, and nothing about it came from this session's own memory.
    serving(() =>
      reply({ runs: [trace({ runId: 'older', stop: 'no-changes' })] }),
    );
    const view = await mount(0);

    assert.match(view.text(), /No changes needed/);
    view.unmount();
  });

  it('re-reads the history when a run finishes', async () => {
    const state = serving(() => reply({ runs: [trace()] }));
    const view = await mount(1);
    assert.equal(state.calls, 1);

    await view.setRunCount(2);

    assert.equal(state.calls, 2, 'a finished run left the list stale');
    view.unmount();
  });

  it('says the history is unavailable rather than claiming no runs', async () => {
    // These are two different facts and only one of them is good news. A
    // database that will not answer must not read as an empty history.
    serving(() => reply({ error: 'no' }, 503));
    const view = await mount();

    assert.match(view.text(), /unavailable/);
    assert.doesNotMatch(view.text(), /No runs yet/);
    view.unmount();
  });

  it('says so plainly when there are no runs', async () => {
    serving(() => reply({ runs: [] }));
    const view = await mount();

    assert.match(view.text(), /No runs yet/);
    view.unmount();
  });
});
