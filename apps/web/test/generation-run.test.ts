import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { FakeModelProvider } from '@vibld/core';
import type { GenerationPlan, ModelProvider, ProjectFile } from '@vibld/core';
import {
  DEFAULT_MAX_TOKENS,
  ProviderError,
  ProviderRefusalError,
  maxTokensFor,
} from '@vibld/ai';

import {
  SanitizingModelProvider,
  assertedBaseRevision,
  ceilingForRun,
  PartialSettlement,
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
  'projectId' | 'runId' | 'prompt' | 'baseRevision'
> = {
  projectId: 'user_abc',
  runId: 'run-1',
  prompt: 'Build a landing page',
  baseRevision: undefined,
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

function fakeLedger(rejects?: string) {
  const calls: { name: string; id: number; actual: number }[] = [];
  return {
    ledger: {
      getByName: (name: string) => ({
        settle: async (id: number, actual: number) => {
          calls.push({ name, id, actual });
          if (name === rejects) throw new Error(`${name} is unreachable`);
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

describe('settleBudget', () => {
  it('settles both layers at the usage-derived cost', async () => {
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
    );

    assert.equal(actual, 100 * 5 + 200 * 25);
    assert.deepEqual(calls, [
      { name: 'user_abc', id: 11, actual },
      { name: '__account__', id: 22, actual },
    ]);
  });

  it('settles at the worst case when a run that happened could not be measured', async () => {
    // The model was asked and what it cost is unknown, so failing safe means
    // over-counting rather than under.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(ledger, PRICE_PARAMS, undefined, true);

    assert.equal(actual, PRICE_PARAMS.worstCaseMicroUsd);
    assert.equal(calls.length, 2);
  });

  it('settles at nothing when the model was never asked', async () => {
    // The case that used to share the fallback above and should not: a run
    // refused before the provider ran spent nothing, and we know it. Charging
    // its worst case billed a caller a whole generation for being told no.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(ledger, PRICE_PARAMS, undefined, false);

    assert.equal(actual, 0, 'a refusal that cost nothing was charged for');
    assert.deepEqual(calls, [
      { name: 'user_abc', id: 11, actual: 0 },
      { name: '__account__', id: 22, actual: 0 },
    ]);
  });

  it('still charges measured usage even if the flag says otherwise', async () => {
    // Belt and braces: a measurement is evidence the model ran, so it wins
    // over the flag rather than being discarded by it. A caller that got the
    // flag wrong must not get a free generation out of it.
    const { ledger } = fakeLedger();
    const actual = await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      false,
    );

    assert.equal(actual, 10 * 5 + 10 * 25);
  });

  it('settles the account layer at what its own reservation covered', async () => {
    // The two layers answer different questions, and #191's review found
    // where they part company. A mockup run absorbs a discarded empty
    // reply so the reader does not pay for a provider defect; the account
    // reservation taken at admission covered that attempt, so that
    // attempt's cost is what it settles at. The retry has a reservation
    // of its own, and the route settles that one with the reader's
    // figure.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
      7_500,
    );

    assert.equal(actual, 100 * 5 + 200 * 25, 'the reader was billed for it');
    assert.notEqual(
      actual,
      7_500,
      'the two figures are the same, so this proves nothing',
    );
    assert.deepEqual(calls, [
      { name: 'user_abc', id: 11, actual },
      { name: '__account__', id: 22, actual: 7_500 },
    ]);
  });

  it('leaves the two layers equal when the caller says nothing', async () => {
    // The ordinary run, stated so the parameter above cannot quietly
    // change what every other settlement charges the account ledger.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
    );

    assert.deepEqual(calls, [
      { name: 'user_abc', id: 11, actual },
      { name: '__account__', id: 22, actual },
    ]);
  });

  it('honours a zero the caller asked for', async () => {
    // Not `|| actual`: an account reservation whose attempt really cost
    // nothing has to settle at nothing, and a falsy check would quietly
    // charge it the reader's figure instead.
    const { ledger, calls } = fakeLedger();
    await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 10,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
      0,
    );

    assert.equal(calls[1]?.actual, 0);
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
      true,
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

/**
 * The ceiling a run may ask for, across a deploy boundary.
 *
 * A Workflow's params are persisted JSON, so the declared type describes
 * what new code writes rather than what an in-flight payload holds. A run
 * queued before `maxTokens` existed was funded against the flat 64000 the
 * old code reserved with, and must not inherit the derived ceiling that
 * replaced it.
 */
describe('the ceiling a run may ask for', () => {
  it('uses the ceiling its reservation was computed against', () => {
    assert.equal(ceilingForRun({ maxTokens: 384_000 }), 384_000);
  });

  it('holds a payload from before the field to the old flat ceiling', () => {
    // The shape a Workflow queued by the previous deployment resumes with.
    // JSON has no such field, so the cast is the honest description of it.
    const legacy = {} as Pick<WorkflowParams, 'maxTokens'>;
    assert.equal(ceilingForRun(legacy), DEFAULT_MAX_TOKENS);
  });

  it('does not let a legacy run reach a derived ceiling', () => {
    // The failure this guards, named rather than implied: DeepSeek Flash
    // derives 384000, and a run reserved at 64000 reaching it would emit six
    // times what it is holding. Skipped if the two ever coincide, because
    // then this asserts nothing.
    const derived = maxTokensFor('deepseek-flash');
    assert.notEqual(
      derived,
      DEFAULT_MAX_TOKENS,
      'the derived and flat ceilings now match, so this test proves nothing',
    );
    const legacy = {} as Pick<WorkflowParams, 'maxTokens'>;
    assert.ok(
      ceilingForRun(legacy) < derived,
      `a legacy run could ask for ${ceilingForRun(legacy)} against a 64000 reservation`,
    );
  });
});

/**
 * The project, read rather than received (#181).
 *
 * A follow-up used to upload the whole project and have it sent straight
 * into the prompt, which capped what could be edited at a model's context
 * window: a site could be generated and then never changed again. The files
 * now come from storage, and what the caller sends is the revision it
 * believes it is editing.
 *
 * That assertion is the part worth testing. Dropping it would be a lost
 * update, and a silent one: a run would build on whatever happened to be
 * accepted and hand back an edit of a project the user never saw.
 */
describe('which project a follow-up edits', () => {
  async function seeded() {
    const store = newStore();
    const first = await runGeneration(
      store,
      new FakeModelProvider([
        { summary: 'First', files: validFiles('original') },
      ]),
      BASE_PARAMS,
    );
    const revision = first.result.accepted?.revision;
    assert.ok(revision, 'the seed run did not promote');
    return { store, revision };
  }

  it('edits the stored project without being sent it', async () => {
    const { store, revision } = await seeded();

    const { result, outcome } = await runGeneration(
      store,
      new FakeModelProvider([
        { summary: 'Second', files: validFiles('edited') },
      ]),
      { ...BASE_PARAMS, runId: 'run-2', baseRevision: revision },
    );

    assert.equal(outcome, 'ok');
    assert.equal(result.state, 'accepted');
    assert.ok(
      result.accepted?.files.some((file) => file.content.includes('edited')),
      'the follow-up did not land',
    );
  });

  it('refuses a revision that is no longer the accepted one', async () => {
    // Two tabs. The other one promoted while this one sat open, so the
    // revision this caller is holding is stale. Building on the newer
    // project anyway would return an edit of something it never saw.
    const { store, revision } = await seeded();
    await runGeneration(
      store,
      new FakeModelProvider([
        { summary: 'Other tab', files: validFiles('elsewhere') },
      ]),
      { ...BASE_PARAMS, runId: 'run-other', baseRevision: revision },
    );

    const { result, outcome } = await runGeneration(
      store,
      new FakeModelProvider([{ summary: 'Stale', files: validFiles('stale') }]),
      { ...BASE_PARAMS, runId: 'run-3', baseRevision: revision },
    );

    assert.equal(outcome, 'failed');
    assert.equal(result.stop, 'conflict');
    assert.equal(result.conflict, true);
  });

  it('reports a preflight refusal as having spent nothing', async () => {
    // The half of "free" that not calling the model does not prove. Usage
    // is undefined either way, and `settleBudget` charges the worst case for
    // undefined usage unless it is told the provider never ran. Asserting
    // only that the model was not asked left that gap, and the gap billed a
    // caller a whole generation for a stale revision.
    const { store, revision } = await seeded();
    await runGeneration(
      store,
      new FakeModelProvider([
        { summary: 'Other tab', files: validFiles('elsewhere') },
      ]),
      { ...BASE_PARAMS, runId: 'run-other', baseRevision: revision },
    );

    const refused = await runGeneration(
      store,
      new FakeModelProvider([{ summary: 'Stale', files: validFiles('stale') }]),
      { ...BASE_PARAMS, runId: 'run-5', baseRevision: revision },
    );

    assert.equal(refused.providerRan, false);

    const { ledger, calls } = fakeLedger();
    const charged = await settleBudget(
      ledger,
      PRICE_PARAMS,
      undefined,
      refused.providerRan,
    );
    assert.equal(charged, 0, 'a refused run was billed');
    assert.deepEqual(
      calls.map((call) => call.actual),
      [0, 0],
      'a refused run drew down a ledger',
    );
  });

  it('refuses an oversized project without calling the model', async () => {
    // The guard used to catch this for free, and cannot any more: a
    // generation request carries no files, so nothing at the edge knows how
    // big the project is. The run loads it and has to refuse just as cheaply,
    // because the provider's own check fires only after the run is paid for.
    const store = newStore();
    // A project the validator accepts, padded past the budget, so what is
    // being tested is the size rather than the shape.
    // Spread across several files: the validator caps one file at 128 KB,
    // so a project past the budget is necessarily a few large files rather
    // than one enormous one. That is also what a real large site looks like.
    const huge = [
      ...validFiles('big'),
      ...Array.from({ length: 3 }, (_, n) => ({
        path: `src/Bulk${n}.tsx`,
        content: 'x'.repeat(60_000),
      })),
    ];
    const seeded = await runGeneration(
      store,
      new FakeModelProvider([{ summary: 'Big', files: huge }]),
      BASE_PARAMS,
    );
    const revision = seeded.result.accepted?.revision;
    assert.ok(revision, 'the oversized seed did not promote');

    let asked = false;
    const provider: ModelProvider = {
      id: 'counting',
      generate: async () => {
        asked = true;
        throw new Error('the model should not have been asked');
      },
    };

    const { result, outcome } = await runGeneration(store, provider, {
      ...BASE_PARAMS,
      runId: 'run-big',
      baseRevision: revision,
    });

    assert.equal(outcome, 'failed');
    assert.equal(result.stop, 'context-exceeded');
    assert.equal(asked, false, 'a doomed run still spent a model call');
  });

  it('refuses a stale revision without calling the model at all', async () => {
    // The point of checking up front: a run that cannot be promoted should
    // not be paid for first. An empty provider throws if it is asked for a
    // plan, so reaching the model fails this test rather than passing it.
    const { store, revision } = await seeded();
    await runGeneration(
      store,
      new FakeModelProvider([
        { summary: 'Other tab', files: validFiles('elsewhere') },
      ]),
      { ...BASE_PARAMS, runId: 'run-other', baseRevision: revision },
    );

    let asked = false;
    const provider: ModelProvider = {
      id: 'counting',
      generate: async () => {
        asked = true;
        throw new Error('the model should not have been asked');
      },
    };

    const { outcome } = await runGeneration(store, provider, {
      ...BASE_PARAMS,
      runId: 'run-4',
      baseRevision: revision,
    });

    assert.equal(outcome, 'failed');
    assert.equal(asked, false, 'a doomed run still spent a model call');
  });
});

/**
 * What a run queued before #181 shipped still contains.
 *
 * A Workflow's params are persisted JSON, so an interface change does not
 * reach the payloads already on disk. Both halves of this change had to be
 * told that, and in opposite directions: the revision assertion has to be
 * found in the old shape, and the spend flag has to be absent-means-charge.
 * Getting either backwards costs somebody their work or their money.
 */
describe('a run that predates the change', () => {
  it('finds the asserted revision in the old shape', () => {
    // The old payload said the same thing in a different place. Reading only
    // the new field would take it for a run asserting nothing, which is the
    // lost update this change exists to prevent.
    const legacy = { base: { revision: 'r-old', files: [] } } as unknown as {
      baseRevision?: string;
    };
    assert.equal(assertedBaseRevision(legacy), 'r-old');
  });

  it('prefers the new field when both are present', () => {
    const both = {
      baseRevision: 'r-new',
      base: { revision: 'r-old', files: [] },
    } as unknown as { baseRevision?: string };
    assert.equal(assertedBaseRevision(both), 'r-new');
  });

  it('asserts nothing for a genuinely new project', () => {
    assert.equal(assertedBaseRevision({ baseRevision: undefined }), undefined);
    assert.equal(
      assertedBaseRevision({ base: {} } as unknown as {
        baseRevision?: string;
      }),
      undefined,
    );
  });

  it('charges nothing when the provider was never asked', async () => {
    // The case both routes now lean on to release a reservation for a
    // caller who disconnected before anything was requested (#189 review):
    // `handlePlan` settles this way instead of creating a Workflow it would
    // then have to terminate, and `handleMockups` returns before marking the
    // provider as having run. Neither had anything asserting the settlement
    // itself was free.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(ledger, PRICE_PARAMS, undefined, false);

    assert.equal(actual, 0, 'a run that never reached a model cost money');
    assert.deepEqual(
      calls.map((call) => call.actual),
      [0, 0],
      'both ledger layers must be released, not just the per-user one',
    );
  });

  it('charges a step result with no spend flag rather than zeroing it', async () => {
    // The opposite direction, and the expensive one. A `generate` step
    // cached before `providerRan` existed resumes without it. Reading that
    // absence as "never ran" would settle a real generation at nothing.
    const { ledger, calls } = fakeLedger();
    const actual = await settleBudget(
      ledger,
      PRICE_PARAMS,
      undefined,
      undefined,
    );

    assert.equal(
      actual,
      PRICE_PARAMS.worstCaseMicroUsd,
      'a legacy run settled free',
    );
    assert.deepEqual(
      calls.map((call) => call.actual),
      [PRICE_PARAMS.worstCaseMicroUsd, PRICE_PARAMS.worstCaseMicroUsd],
    );
  });
});

/**
 * Which ledger layer was left open, when they do not fail together
 * (#196 review).
 *
 * The caller's layer is written first and the account layer second, so the
 * two can fail apart. They also answer to different people: the caller's
 * hold decides what the caller is billed, the account hold decides what
 * this deployment has spent today. A caller told only "settlement failed"
 * has to assume the worst of both, and for a run whose own layer closed at
 * a measured figure that overstates a bill which is already correct.
 */
describe('a settlement that closed one layer and not the other', () => {
  it('still rejects, so every existing caller retries as before', async () => {
    const { ledger } = fakeLedger('__account__');
    await assert.rejects(() =>
      settleBudget(ledger, PRICE_PARAMS, undefined, false),
    );
  });

  it('carries what the caller was actually charged', async () => {
    const { ledger } = fakeLedger('__account__');
    const raised = await settleBudget(
      ledger,
      PRICE_PARAMS,
      {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(
      raised instanceof PartialSettlement,
      "the account layer failing said nothing about the caller's",
    );
    assert.equal(raised.charged, 100 * 5 + 200 * 25);
    assert.match(String(raised.cause), /unreachable/);
  });

  it('does not claim the caller settled when their own layer is what failed', async () => {
    // The distinction is the whole value of the type. Reporting
    // `userSettled: true` here would hand a caller a figure nobody wrote.
    const { ledger } = fakeLedger('user_abc');
    const raised = await settleBudget(
      ledger,
      PRICE_PARAMS,
      undefined,
      true,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    assert.ok(
      !(raised instanceof PartialSettlement),
      "a failure of the caller's own layer was reported as a partial settlement",
    );
  });
});
