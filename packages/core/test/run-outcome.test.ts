import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RUN_REFUSALS,
  RUN_STOPS,
  cachedFraction,
  contextPressure,
  isRunRefusal,
  isRunStop,
  stopChangedTheProject,
  stopIsRetryable,
} from '../src/run-outcome.ts';
import type { RunTrace } from '../src/run-outcome.ts';

const trace = (over: Partial<RunTrace> = {}): RunTrace => ({
  runId: 'run_1',
  projectId: 'proj_1',
  stop: 'applied',
  model: 'deepseek-flash',
  inputTokens: 1000,
  cachedInputTokens: 0,
  outputTokens: 500,
  contextWindow: 100_000,
  costMicroUsd: 1234,
  elapsedMs: 5000,
  endedAt: '2026-09-17T00:00:00.000Z',
  ...over,
});

describe('the reason vocabulary', () => {
  it('keeps refusals and stops apart', async () => {
    // The split is the rule that a refused run leaves no run record: a
    // refusal names something that happened instead of a run, a stop names
    // how a run that really started ended. A value that was both would let
    // a refusal be written into a trace, which is the lie this prevents.
    for (const refusal of RUN_REFUSALS) {
      assert.equal(isRunStop(refusal), false, `${refusal} is also a stop`);
    }
    for (const stop of RUN_STOPS) {
      assert.equal(isRunRefusal(stop), false, `${stop} is also a refusal`);
    }
  });

  it('recognises only its own identifiers', () => {
    assert.equal(isRunRefusal('account-ceiling'), true);
    assert.equal(isRunStop('applied'), true);
    for (const wrong of ['', 'Applied', 'applied ', 'unknown', 42, null]) {
      assert.equal(isRunRefusal(wrong), false, String(wrong));
      assert.equal(isRunStop(wrong), false, String(wrong));
    }
  });

  it('names the two budget refusals separately', async () => {
    // The distinction #159 asks for by name. Being out of allowance and
    // already having a run in flight are both "not now" and lead a person
    // to do completely different things about it.
    assert.ok((RUN_REFUSALS as readonly string[]).includes('account-ceiling'));
    assert.ok((RUN_REFUSALS as readonly string[]).includes('already-running'));
  });

  it('tells not knowing the balance apart from having spent it', () => {
    // Reporting a ledger this service could not read as an exhausted
    // allowance tells a paying user they are out of money when they are not.
    assert.notEqual('accounting-unavailable', 'account-ceiling');
    assert.ok(
      (RUN_REFUSALS as readonly string[]).includes('accounting-unavailable'),
    );
  });

  it('holds no duplicate identifier', () => {
    assert.equal(new Set(RUN_REFUSALS).size, RUN_REFUSALS.length);
    assert.equal(new Set(RUN_STOPS).size, RUN_STOPS.length);
  });

  it('spells every identifier the one way a caller can match on', () => {
    // These strings cross the network and land in stored records. Mixed case
    // or a stray space is how two surfaces come to disagree about the same
    // stop, so the shape is pinned rather than trusted to review.
    for (const id of [...RUN_REFUSALS, ...RUN_STOPS]) {
      assert.match(id, /^[a-z]+(-[a-z]+)*$/, id);
    }
  });
});

describe('what a stop says about the run', () => {
  it('counts only an applied run as having changed the project', () => {
    // `no-changes` is a run that worked and had nothing to do. Treating it
    // as a change would put a revision in the history that is identical to
    // the one before it.
    assert.equal(stopChangedTheProject('applied'), true);
    assert.equal(stopChangedTheProject('no-changes'), false);
    for (const stop of RUN_STOPS) {
      if (stop === 'applied') continue;
      assert.equal(stopChangedTheProject(stop), false, stop);
    }
  });

  it('does not offer a retry that would ask the same question again', () => {
    // A refused model and a rejected validation both answer the same way to
    // the same input. A provider error and an exhausted run ceiling do not.
    assert.equal(stopIsRetryable('provider-error'), true);
    assert.equal(stopIsRetryable('run-budget-exceeded'), true);
    assert.equal(stopIsRetryable('model-refused'), false);
    assert.equal(stopIsRetryable('validation-failed'), false);
    assert.equal(stopIsRetryable('applied'), false);
  });
});

describe('what a run trace measures', () => {
  it('reports context pressure against the window the run actually had', () => {
    assert.equal(
      contextPressure(trace({ inputTokens: 40_000, outputTokens: 10_000 })),
      0.5,
    );
  });

  it('answers zero rather than dividing by an unknown window', () => {
    assert.equal(contextPressure(trace({ contextWindow: 0 })), 0);
  });

  it('reports the cached fraction of input', () => {
    assert.equal(
      cachedFraction(trace({ inputTokens: 1000, cachedInputTokens: 900 })),
      0.9,
    );
  });

  it('calls a run that sent nothing zero cached, not perfectly cached', () => {
    // 0/0 is NaN, which renders as "NaN%" and reads as a bug in the meter
    // rather than as a run that never sent anything.
    assert.equal(cachedFraction(trace({ inputTokens: 0 })), 0);
  });

  it('carries no field that could hold a prompt or a path', async () => {
    // D20 keeps source, prompts and secrets out of telemetry, and this
    // record must not become the second channel that carries them. Asserted
    // against the declaration rather than an instance, because the risk is a
    // field added later rather than a value set today.
    const source = await readFile(
      fileURLToPath(new URL('../src/run-outcome.ts', import.meta.url)),
      'utf8',
    );
    const shape = source.slice(
      source.indexOf('export interface RunTrace'),
      source.indexOf('export function contextPressure'),
    );
    for (const banned of [
      'prompt',
      'path',
      'files',
      'content',
      'source',
      'secret',
      'message',
      'error:',
    ]) {
      assert.ok(
        !new RegExp(`\\n  ${banned}`, 'i').test(shape),
        `RunTrace declares a ${banned} field`,
      );
    }
  });
});
