import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { testGenerationStoreContract } from '@vibld/core/test-contract';
import type { ProjectSnapshot, RunTrace } from '@vibld/core';

import {
  D1GenerationStore,
  readSteps,
  writeSteps,
} from '../worker/generation-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

function migration(file: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'migrations', file),
    'utf8',
  );
}

// The migrations the store reads and writes, because the store is one
// object and the trace table is part of what it is now. Reading them from
// the files that ship means a column added to the schema without being
// written here fails the tests rather than passing against a hand-copied
// definition that drifted.
const SCHEMA = [
  migration('0001_generation_store.sql'),
  migration('0014_run_traces.sql'),
  migration('0037_run_trace_steps.sql'),
].join('\n');

function newStore(): D1GenerationStore {
  return new D1GenerationStore(
    new SqliteD1Database(SCHEMA),
    new InMemoryR2Bucket(),
  );
}

const TRACE = {
  runId: 'run-1',
  projectId: 'project-1',
  stop: 'applied',
  model: 'claude-haiku-4-5',
  inputTokens: 900,
  cachedInputTokens: 300,
  outputTokens: 100,
  contextWindow: 200_000,
  costMicroUsd: 1234,
  elapsedMs: 5_000,
  endedAt: '2026-03-04T05:06:07.000Z',
} satisfies RunTrace;

testGenerationStoreContract('d1', newStore);

test('[d1] two promotions racing for the same base: exactly one wins', async () => {
  const store = newStore();
  const snapshot = (revision: string): ProjectSnapshot => ({
    revision,
    files: [{ path: 'index.html', content: revision }],
  });

  // Two runs staged against the same, still-unaccepted base -- the shape a
  // real race takes: two edits started from the same project state before
  // either had promoted.
  await store.saveStage({
    runId: 'run-a',
    projectId: 'project-1',
    baseRevision: null,
    state: 'validating',
    snapshot: snapshot('r-a'),
  });
  await store.saveStage({
    runId: 'run-b',
    projectId: 'project-1',
    baseRevision: null,
    state: 'validating',
    snapshot: snapshot('r-b'),
  });

  const [resultA, resultB] = await Promise.all([
    store.promote('project-1', 'run-a', null, snapshot('r-a')),
    store.promote('project-1', 'run-b', null, snapshot('r-b')),
  ]);

  const promotedCount = [resultA, resultB].filter((r) => r.promoted).length;
  assert.equal(promotedCount, 1, 'exactly one promotion must win the race');

  const winner = resultA.promoted ? resultA : resultB;
  const loser = resultA.promoted ? resultB : resultA;
  assert.equal(loser.current?.revision, winner.current?.revision);
  assert.equal(
    (await store.loadAccepted('project-1'))?.revision,
    winner.current?.revision,
  );
});

test('[d1] a saved trace comes back with every field intact', async () => {
  const store = newStore();
  await store.saveTrace(TRACE);

  assert.deepEqual(await store.tracesForProject('project-1'), [TRACE]);
});

test('[d1] a stop that did not describe a run is never written', async () => {
  const store = newStore();
  await store.saveTrace({ ...TRACE, stop: 'not-started' });

  // The rule the two outcome vocabularies exist to keep: somebody who was
  // refused has not had a failed generation, and their history must not
  // show them one.
  assert.deepEqual(await store.tracesForProject('project-1'), []);
});

test('[d1] a second write for the same run keeps the first answer', async () => {
  const store = newStore();
  await store.saveTrace(TRACE);
  await store.saveTrace({ ...TRACE, stop: 'provider-error', outputTokens: 0 });

  const traces = await store.tracesForProject('project-1');
  assert.equal(traces.length, 1);
  assert.equal(traces[0]?.stop, 'applied');
  assert.equal(traces[0]?.outputTokens, 100);
});

test("[d1] traces come back newest first, and only this project's", async () => {
  const store = newStore();
  await store.saveTrace({
    ...TRACE,
    runId: 'older',
    endedAt: '2026-03-01T00:00:00.000Z',
  });
  await store.saveTrace({
    ...TRACE,
    runId: 'newer',
    endedAt: '2026-03-09T00:00:00.000Z',
  });
  await store.saveTrace({
    ...TRACE,
    runId: 'elsewhere',
    projectId: 'project-2',
    endedAt: '2026-03-10T00:00:00.000Z',
  });

  assert.deepEqual(
    (await store.tracesForProject('project-1')).map((t) => t.runId),
    ['newer', 'older'],
  );
});

test('[d1] the limit takes the newest runs, not the first ones found', async () => {
  const store = newStore();
  for (const day of ['01', '02', '03']) {
    await store.saveTrace({
      ...TRACE,
      runId: `run-${day}`,
      endedAt: `2026-03-${day}T00:00:00.000Z`,
    });
  }

  assert.deepEqual(
    (await store.tracesForProject('project-1', 2)).map((t) => t.runId),
    ['run-03', 'run-02'],
  );
});

test('[d1] a stop this build cannot read comes back as a provider error', async () => {
  const database = new SqliteD1Database(SCHEMA);
  const store = new D1GenerationStore(database, new InMemoryR2Bucket());
  // Written the way an older deployment, or a hand-edited row, could leave
  // it: a value that is not in this build's vocabulary.
  await database
    .prepare(
      `INSERT INTO generation_run_traces
         (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
          output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
       VALUES ('run-x', 'project-1', 'invented-later', 'm', 0, 0, 0, 0, 0, 0,
               '2026-03-04T00:00:00.000Z')`,
    )
    .run();

  const [trace] = await store.tracesForProject('project-1');
  assert.equal(trace?.stop, 'provider-error');
});

test('[d1] reasoning and the steps come back as they were saved', async () => {
  const store = newStore();
  const measured = {
    ...TRACE,
    outputTokens: 35_354,
    reasoningTokens: 16_200,
    steps: [
      { name: 'prepare', ms: 120, outputTokens: 0 },
      {
        name: 'outline',
        ms: 61_000,
        outputTokens: 9_800,
        reasoningTokens: 4_100,
      },
      {
        name: 'write-1',
        ms: 90_500,
        outputTokens: 12_000,
        reasoningTokens: 6_000,
      },
      // A provider that did not say: no reasoning, rather than zero.
      { name: 'write-2', ms: 70_000, outputTokens: 13_554 },
      { name: 'assemble', ms: 900, outputTokens: 0 },
      { name: 'verify-and-repair', ms: 44_000, outputTokens: 0 },
    ],
  } satisfies RunTrace;
  await store.saveTrace(measured);
  assert.deepEqual(await store.tracesForProject('project-1'), [measured]);
});

test('[d1] a row written before 0037 reads with neither, not with zeros', async () => {
  const database = new SqliteD1Database(SCHEMA);
  const store = new D1GenerationStore(database, new InMemoryR2Bucket());
  // The insert an older deployment makes: it names its eleven columns and
  // leaves the two new ones NULL.
  await database
    .prepare(
      `INSERT INTO generation_run_traces
         (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
          output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
       VALUES ('run-old', 'project-1', 'applied', 'm', 1, 0, 1, 100, 5, 10,
               '2026-03-04T00:00:00.000Z')`,
    )
    .run();
  const [trace] = await store.tracesForProject('project-1');
  assert.equal(trace?.runId, 'run-old');
  assert.equal('reasoningTokens' in trace!, false);
  assert.equal('steps' in trace!, false);
});

test('the steps column is compact JSON, and read back defensively', () => {
  assert.equal(writeSteps(undefined), null);
  assert.equal(writeSteps([]), null);
  assert.equal(
    writeSteps([
      { name: 'outline', ms: 1234.4, outputTokens: 10, reasoningTokens: 4 },
      { name: 'assemble', ms: 5, outputTokens: 0 },
    ]),
    '[{"name":"outline","ms":1234,"outputTokens":10,"reasoningTokens":4},{"name":"assemble","ms":5,"outputTokens":0}]',
  );
  assert.equal(readSteps(null), undefined);
  assert.equal(readSteps('not json'), undefined);
  assert.equal(readSteps('{"name":"x"}'), undefined);
  assert.deepEqual(
    readSteps(
      '[{"name":"ok","ms":1,"outputTokens":2},{"ms":1},{"name":"bad","ms":-1},null,{"name":"r","ms":3,"outputTokens":"x","reasoningTokens":2}]',
    ),
    [
      { name: 'ok', ms: 1, outputTokens: 2 },
      { name: 'r', ms: 3, outputTokens: 0, reasoningTokens: 2 },
    ],
  );
});
