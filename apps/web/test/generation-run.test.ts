import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { FakeModelProvider } from '@vibld/core';
import type { GenerationPlan, ModelProvider, ProjectFile } from '@vibld/core';
import { ProviderError, ProviderRefusalError } from '@vibld/ai';

import {
  SanitizingModelProvider,
  runGeneration,
  settleBudget,
  traceOf,
} from '../worker/generation-run.ts';
import type { WorkflowParams } from '../worker/generation-run.ts';
import { D1GenerationStore } from '../worker/generation-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0001_generation_store.sql'),
  'utf8',
);

function newStore(): D1GenerationStore {
  return new D1GenerationStore(
    new SqliteD1Database(SCHEMA),
    new InMemoryR2Bucket(),
  );
}

/** Everything `createValidator()`'s `requiredPaths` demands, plus one real file. */
function validFiles(marker: string): ProjectFile[] {
  return [
    { path: 'package.json', content: '{}' },
    { path: 'index.html', content: '<html></html>' },
    { path: 'src/main.tsx', content: 'render();' },
    {
      path: 'src/App.tsx',
      content: `export default function App() { return '${marker}'; }`,
    },
  ];
}

const BASE_PARAMS: Pick<
  WorkflowParams,
  'projectId' | 'runId' | 'prompt' | 'base'
> = {
  projectId: 'user_abc',
  runId: 'run-1',
  prompt: 'Build a landing page',
  base: undefined,
};

describe('SanitizingModelProvider', () => {
  it('passes a ProviderError through unchanged', async () => {
    const inner: ModelProvider = {
      id: 'inner',
      generate: async () => {
        throw new ProviderRefusalError('policy', 'no');
      },
    };
    const provider = new SanitizingModelProvider(inner);
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      ProviderError,
    );
  });

  it('replaces any other error with a generic message', async () => {
    const inner: ModelProvider = {
      id: 'inner',
      generate: async () => {
        throw new Error('upstream said something with a token in it');
      },
    };
    const provider = new SanitizingModelProvider(inner);
    await assert.rejects(() => provider.generate({ prompt: 'x' }), {
      message: 'Generation failed unexpectedly.',
    });
  });

  it('carries the inner provider id', () => {
    const inner: ModelProvider = {
      id: 'anthropic:x',
      generate: async () => ({ summary: '', files: [] }),
    };
    assert.equal(new SanitizingModelProvider(inner).id, 'anthropic:x');
  });
});

describe('runGeneration', () => {
  it('accepts a valid plan and promotes it', async () => {
    const store = newStore();
    const plan: GenerationPlan = {
      summary: 'A landing page',
      files: validFiles('hello'),
    };
    const provider = new FakeModelProvider([plan]);

    const { result, outcome } = await runGeneration(
      store,
      provider,
      BASE_PARAMS,
    );

    assert.equal(outcome, 'ok');
    assert.equal(result.state, 'accepted');
    assert.equal(result.summary, 'A landing page');
    assert.ok(
      result.accepted?.files.some((file) => file.path === 'src/App.tsx'),
    );
    assert.equal(
      (await store.loadAccepted(BASE_PARAMS.projectId))?.revision,
      result.accepted?.revision,
    );
  });

  it('reports a validation failure without promoting, but still with a summary', async () => {
    const store = newStore();
    const plan: GenerationPlan = {
      summary: 'Missing files',
      files: [{ path: 'src/App.tsx', content: 'x' }],
    };
    const provider = new FakeModelProvider([plan]);

    const { result, outcome } = await runGeneration(
      store,
      provider,
      BASE_PARAMS,
    );

    assert.equal(outcome, 'failed');
    assert.equal(result.state, 'failed');
    assert.equal(result.summary, 'Missing files');
    assert.ok(result.errors.length > 0);
    assert.equal(await store.loadAccepted(BASE_PARAMS.projectId), undefined);
  });

  it('turns a store failure into a failed result instead of throwing', async () => {
    const brokenStore = {
      saveStage: async () => {
        throw new Error('D1 is down');
      },
      loadStage: async () => undefined,
      loadAccepted: async () => undefined,
      promote: async () => ({ promoted: false }),
    };
    const provider = new FakeModelProvider([
      { summary: 'ok', files: validFiles('x') },
    ]);

    const { result, outcome } = await runGeneration(
      brokenStore,
      provider,
      BASE_PARAMS,
    );

    assert.equal(outcome, 'failed');
    assert.equal(result.state, 'failed');
    assert.deepEqual(result.errors, ['Generation failed unexpectedly.']);
  });
});

describe('settleBudget', () => {
  function fakeLedger() {
    const calls: { name: string; id: number; actual: number }[] = [];
    return {
      ledger: {
        getByName: (name: string) => ({
          settle: async (id: number, actual: number) => {
            calls.push({ name, id, actual });
          },
        }),
      },
      calls,
    };
  }

  const PRICE_PARAMS = {
    userId: 'user_abc',
    reservationId: 11,
    accountReservationId: 22,
    worstCaseMicroUsd: 999_999,
    prices: {
      inputMicroUsd: 5,
      outputMicroUsd: 25,
      cachedInputMicroUsd: 0.5,
      cacheWriteMicroUsd: 6.25,
    },
  };

  it('settles both layers at the usage-derived cost', async () => {
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(ledger, PRICE_PARAMS, {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });

    assert.equal(actual, 100 * 5 + 200 * 25);
    assert.deepEqual(calls, [
      { name: 'user_abc', id: 11, actual },
      { name: '__account__', id: 22, actual },
    ]);
  });

  it('settles at the worst case when usage was never reported', async () => {
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(ledger, PRICE_PARAMS, undefined);

    assert.equal(actual, PRICE_PARAMS.worstCaseMicroUsd);
    assert.equal(calls.length, 2);
  });

  it('skips a layer whose reservation never got an id', async () => {
    const { ledger, calls } = fakeLedger();
    await settleBudget(
      ledger,
      {
        ...PRICE_PARAMS,
        reservationId: undefined,
        accountReservationId: undefined,
      },
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    );

    assert.deepEqual(calls, []);
  });
});

describe('traceOf', () => {
  const TRACE_PARAMS: Pick<WorkflowParams, 'projectId' | 'runId' | 'model'> = {
    projectId: 'user_abc',
    runId: 'run-9',
    model: 'claude-haiku-4-5',
  };
  const TIMING = {
    costMicroUsd: 4321,
    elapsedMs: 8_000,
    endedAt: '2026-03-04T05:06:07.000Z',
  };

  it('carries the run stop, not the run state', () => {
    const trace = traceOf(
      TRACE_PARAMS,
      { stop: 'conflict' },
      {
        inputTokens: 900,
        outputTokens: 100,
        cacheReadInputTokens: 300,
        cacheWriteInputTokens: 0,
      },
      TIMING,
    );

    assert.equal(trace.stop, 'conflict');
    assert.equal(trace.runId, 'run-9');
    assert.equal(trace.projectId, 'user_abc');
    assert.equal(trace.model, 'claude-haiku-4-5');
  });

  it('keeps the cached read split out of the input total', () => {
    const trace = traceOf(
      TRACE_PARAMS,
      { stop: 'applied' },
      {
        inputTokens: 900,
        outputTokens: 100,
        cacheReadInputTokens: 300,
        cacheWriteInputTokens: 0,
      },
      TIMING,
    );

    // Not netted off: the reported input is the whole of it, and the cached
    // part is a fact about that same number.
    assert.equal(trace.inputTokens, 900);
    assert.equal(trace.cachedInputTokens, 300);
    assert.equal(trace.outputTokens, 100);
  });

  it("reads the window from the model's catalogue entry", () => {
    const trace = traceOf(
      TRACE_PARAMS,
      { stop: 'applied' },
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      TIMING,
    );

    assert.equal(trace.contextWindow, 200_000);
  });

  it('records no window for a model this build does not know', () => {
    const trace = traceOf(
      { ...TRACE_PARAMS, model: 'retired-model-7' },
      { stop: 'applied' },
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      TIMING,
    );

    // Zero rather than a guess. A policy can still name a model the
    // catalogue has dropped, and inventing a window for it would make
    // context pressure read as a real measurement when it is not.
    assert.equal(trace.contextWindow, 0);
  });

  it('records zero tokens, and the real cost, when usage never arrived', () => {
    const trace = traceOf(TRACE_PARAMS, { stop: 'provider-error' }, undefined, {
      ...TIMING,
      costMicroUsd: 50_000,
    });

    assert.equal(trace.inputTokens, 0);
    assert.equal(trace.cachedInputTokens, 0);
    assert.equal(trace.outputTokens, 0);
    // The run still cost its full reservation (`settleBudget`), and the row
    // says so rather than inventing tokens to justify the money.
    assert.equal(trace.costMicroUsd, 50_000);
  });

  it('passes the measured timing through untouched', () => {
    const trace = traceOf(
      TRACE_PARAMS,
      { stop: 'applied' },
      {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      TIMING,
    );

    assert.equal(trace.elapsedMs, 8_000);
    assert.equal(trace.endedAt, '2026-03-04T05:06:07.000Z');
  });
});
