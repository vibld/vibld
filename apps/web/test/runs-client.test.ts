import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RUN_STOPS } from '@vibld/core';
import type { RunTrace } from '@vibld/core';

import {
  STOP_LABELS,
  fetchRuns,
  formatElapsed,
  formatFraction,
  formatRunCost,
  formatTokens,
  stopTone,
  summarise,
} from '../src/generation/runs-client.ts';

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

function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noToken = async () => null;

describe('run labels', () => {
  it('has a sentence for every stop in the vocabulary', () => {
    // Not a spot check: a stop added to `RunStop` without a label here would
    // otherwise render as its own identifier in the middle of English.
    for (const stop of RUN_STOPS) {
      assert.equal(typeof STOP_LABELS[stop], 'string', stop);
      assert.notEqual(STOP_LABELS[stop], stop, `${stop} reads as an id`);
    }
  });

  it('reads a run that had nothing to do as neither a win nor a fault', () => {
    assert.equal(stopTone('applied'), 'kept');
    assert.equal(stopTone('no-changes'), 'quiet');
    assert.equal(stopTone('cancelled'), 'quiet');
    assert.equal(stopTone('provider-error'), 'failed');
    assert.equal(stopTone('conflict'), 'failed');
  });
});

describe('run figures', () => {
  it('shows a run cost that two models can be told apart by', () => {
    // Four places, not two: at two, a real run rounds to $0.00 and reads as
    // free, and the difference this panel exists to show disappears.
    assert.equal(formatRunCost(14_300), '$0.0143');
    assert.equal(formatRunCost(900), '$0.0009');
  });

  it('switches to minutes once seconds stop being readable', () => {
    assert.equal(formatElapsed(8_200), '8.2s');
    assert.equal(formatElapsed(59_900), '59.9s');
    assert.equal(formatElapsed(64_000), '1m 04s');
  });

  it('groups token counts', () => {
    assert.equal(formatTokens(12_400), '12,400');
  });

  it('reports nothing rather than a zero reading', () => {
    // A "0%" beside the others reads as a measurement that was taken. It
    // was not: there is nothing to report.
    assert.equal(formatFraction(0), null);
    assert.equal(formatFraction(0.62), '62%');
  });

  it('summarises the run with both measurements a trace exists for', () => {
    const line = summarise(trace());

    assert.match(line, /claude-haiku-4-5/);
    assert.match(line, /10,000 in/);
    assert.match(line, /2,000 out/);
    assert.match(line, /60% cached/);
    assert.match(line, /6% of context/);
    assert.match(line, /\$0\.0143/);
    assert.match(line, /8\.2s/);
  });

  it('leaves out a measurement it does not have, separator and all', () => {
    const line = summarise(trace({ cachedInputTokens: 0, contextWindow: 0 }));

    assert.doesNotMatch(line, /cached/);
    assert.doesNotMatch(line, /of context/);
    assert.doesNotMatch(line, / · · /);
  });
});

describe('fetching run history', () => {
  it('returns the runs the route sent', async () => {
    const runs = await fetchRuns(
      async () => reply({ runs: [trace()] }),
      noToken,
    );

    assert.equal(runs?.length, 1);
    assert.equal(runs?.[0]?.runId, 'run-1');
  });

  it('drops a row it cannot read rather than the whole history', async () => {
    const runs = await fetchRuns(
      async () => reply({ runs: [{ nonsense: true }, trace()] }),
      noToken,
    );

    assert.deepEqual(
      runs?.map((run) => run.runId),
      ['run-1'],
    );
  });

  it('answers null for a route that refused', async () => {
    assert.equal(
      await fetchRuns(async () => reply({ error: 'no' }, 503), noToken),
      null,
    );
  });

  it('answers null when the request never got out', async () => {
    assert.equal(
      await fetchRuns(async () => {
        throw new Error('offline');
      }, noToken),
      null,
    );
  });

  it('sends the session token when there is one', async () => {
    let sent: string | null = null;
    await fetchRuns(
      async (_input, init) => {
        sent = new Headers(init?.headers).get('authorization');
        return reply({ runs: [] });
      },
      async () => 'tok',
    );

    assert.equal(sent, 'Bearer tok');
  });
});
