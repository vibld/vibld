import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { testGenerationStoreContract } from '@vibld/core/test-contract';
import type { ProjectSnapshot, RunTrace } from '@vibld/core';

import { D1GenerationStore } from '../worker/generation-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

function migration(file: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'migrations', file),
    'utf8',
  );
}

// Both migrations, because the store is one object and the trace table is
// part of what it is now. Reading them from the files that ship means a
// column added to the schema without being written here fails the tests
// rather than passing against a hand-copied definition that drifted.
const SCHEMA = [
  migration('0001_generation_store.sql'),
  migration('0014_run_traces.sql'),
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
