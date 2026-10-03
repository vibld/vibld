import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { describe, it } from 'node:test';

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
  // Read by `rollback`, which refuses an archived project.
  migration('0033_projects.sql'),
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

describe('[d1] checkpoint history (D152)', () => {
  const snapshot = (revision: string): ProjectSnapshot => ({
    revision,
    files: [{ path: 'index.html', content: revision }],
  });

  /** A build accepted at `revision`, from whatever is accepted now. */
  async function accept(
    store: D1GenerationStore,
    runId: string,
    revision: string,
  ): Promise<void> {
    const base = (await store.loadAccepted('project-1'))?.revision ?? null;
    await store.saveStage({
      runId,
      projectId: 'project-1',
      baseRevision: base,
      state: 'validating',
      snapshot: snapshot(revision),
    });
    const promoted = await store.promote(
      'project-1',
      runId,
      base,
      snapshot(revision),
    );
    assert.ok(promoted.promoted);
  }

  /** Lets the clock move, so newest-first is a real ordering. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('lists every accepted checkpoint newest first, leaving out build checks', async () => {
    const store = newStore();
    await accept(store, 'run-1', 'r1');
    // The check row D69 writes for run-1, accepted because it builds.
    await store.openCheck({
      runId: 'run-1',
      projectId: 'project-1',
      baseRevision: null,
      revision: 'r1',
    });
    await store.closeCheck('run-1', 'accepted', 'r1');
    await tick();
    await accept(store, 'run-2', 'r2');
    // A run that failed is not a checkpoint.
    await store.saveStage({
      runId: 'run-3',
      projectId: 'project-1',
      baseRevision: 'r2',
      state: 'failed',
    });

    const history = await store.listCheckpoints('project-1');
    assert.equal(history.current, 'r2');
    assert.deepEqual(
      history.checkpoints.map(({ runId, revision, kind }) => ({
        runId,
        revision,
        kind,
      })),
      [
        { runId: 'run-2', revision: 'r2', kind: 'build' },
        { runId: 'run-1', revision: 'r1', kind: 'build' },
      ],
    );
  });

  it('lists the accepted revision of a project no run here accepted, as a copy', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const bucket = new InMemoryR2Bucket();
    await bucket.put(
      'projects/copy-1/snapshots/r9.json',
      JSON.stringify(snapshot('r9')),
    );
    await db
      .prepare(
        `INSERT INTO generation_projects VALUES ('copy-1', 'r9', ?1, ?1)`,
      )
      .bind('2026-10-01T00:00:00.000Z')
      .run();
    const history = await new D1GenerationStore(db, bucket).listCheckpoints(
      'copy-1',
    );
    assert.deepEqual(history, {
      current: 'r9',
      checkpoints: [
        {
          revision: 'r9',
          runId: null,
          kind: 'copy',
          acceptedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    });
  });

  /** A store whose project-1 has its `projects` row, as every real one does. */
  async function owned(archivedAt: string | null = null) {
    const db = new SqliteD1Database(SCHEMA);
    const store = new D1GenerationStore(db, new InMemoryR2Bucket());
    await db
      .prepare(
        `INSERT INTO projects
           (id, user_id, name, archived_at, created_at, updated_at, last_opened_at)
         VALUES ('project-1', 'user-1', 'Bakery', ?1, ?2, ?2, ?2)`,
      )
      .bind(archivedAt, '2026-10-01T00:00:00.000Z')
      .run();
    return { db, store };
  }

  it('moves the pointer to an earlier checkpoint and records it as one more acceptance', async () => {
    const { store } = await owned();
    await accept(store, 'run-1', 'r1');
    await tick();
    await accept(store, 'run-2', 'r2');
    await tick();

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-one',
    );
    assert.equal(result.outcome, 'restored');
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r1');
    const row = await store.loadStage('rollback-one');
    assert.equal(row?.state, 'accepted');
    assert.equal(row?.baseRevision, 'r2');

    // Nothing is lost: r2 is still in the history, and can be put back.
    const history = await store.listCheckpoints('project-1');
    assert.deepEqual(
      history.checkpoints.map(({ revision, kind }) => `${revision} ${kind}`),
      ['r1 rollback', 'r2 build', 'r1 build'],
    );
    assert.equal((await store.loadRevision('project-1', 'r2'))?.revision, 'r2');
  });

  it('keeps one rollback row per revision, however often it is restored', async () => {
    // Codex review of internal PR 360: restores are free, so a row per restore would
    // let two checkpoints traded back and forth grow the table for ever.
    const { db, store } = await owned();
    await accept(store, 'run-1', 'r1');
    await tick();
    await accept(store, 'run-2', 'r2');
    await tick();
    let current = 'r2';
    for (let round = 0; round < 6; round += 1) {
      const target = current === 'r2' ? 'r1' : 'r2';
      const result = await store.rollback(
        'project-1',
        target,
        current,
        `rollback-${round}`,
      );
      assert.equal(result.outcome, 'restored');
      current = target;
      await tick();
    }

    const rows = await db
      .prepare(
        `SELECT run_id FROM generation_stages WHERE project_id = 'project-1'`,
      )
      .all<{ run_id: string }>();
    assert.deepEqual(rows.results.map((row) => row.run_id).sort(), [
      'rollback-4',
      'rollback-5',
      'run-1',
      'run-2',
    ]);
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r2');
    const history = await store.listCheckpoints('project-1');
    assert.deepEqual(
      history.checkpoints.map(({ revision, kind }) => `${revision} ${kind}`),
      ['r2 rollback', 'r1 rollback', 'r2 build', 'r1 build'],
    );
  });

  it('changes nothing from a stale base, and leaves no row behind', async () => {
    const { store } = await owned();
    await accept(store, 'run-1', 'r1');
    await accept(store, 'run-2', 'r2');
    await accept(store, 'run-3', 'r3');

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-late',
    );
    assert.deepEqual(result, { outcome: 'stale', current: 'r3' });
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r3');
    assert.equal(await store.loadStage('rollback-late'), undefined);
  });

  it('changes nothing while a build is running, even one that started after the handler looked', async () => {
    const { store } = await owned();
    await accept(store, 'run-1', 'r1');
    await accept(store, 'run-2', 'r2');
    // A build based on r2 that has written its stage row and not ended.
    await store.saveStage({
      runId: 'run-3',
      projectId: 'project-1',
      baseRevision: 'r2',
      state: 'validating',
      snapshot: snapshot('r3'),
    });

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-busy',
    );
    assert.deepEqual(result, { outcome: 'busy' });
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r2');
    assert.equal(await store.loadStage('rollback-busy'), undefined);
  });

  it('counts a build whose row has not moved for longer than half an hour', async () => {
    // A repair can work past `RUN_IN_FLIGHT_MS` without touching its row;
    // runs the engine abandoned are the handler's to settle first.
    const { db, store } = await owned();
    await accept(store, 'run-1', 'r1');
    await accept(store, 'run-2', 'r2');
    await store.saveStage({
      runId: 'run-3:verify',
      projectId: 'project-1',
      baseRevision: 'r2',
      state: 'validating',
      snapshot: snapshot('r3'),
    });
    await db
      .prepare(`UPDATE generation_stages SET updated_at = ?1 WHERE run_id = ?2`)
      .bind('2026-01-01T00:00:00.000Z', 'run-3:verify')
      .run();

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-long',
    );
    assert.deepEqual(result, { outcome: 'busy' });
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r2');
  });

  it('changes nothing in a project archived since the handler looked', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new D1GenerationStore(db, new InMemoryR2Bucket());
    await accept(store, 'run-1', 'r1');
    await accept(store, 'run-2', 'r2');
    await db
      .prepare(
        `INSERT INTO projects
           (id, user_id, name, archived_at, created_at, updated_at, last_opened_at)
         VALUES ('project-1', 'user-1', 'Bakery', ?1, ?1, ?1, ?1)`,
      )
      .bind('2026-10-03T12:00:00.000Z')
      .run();

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-archived',
    );
    assert.deepEqual(result, { outcome: 'archived' });
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r2');
    assert.equal(await store.loadStage('rollback-archived'), undefined);
  });

  it('writes nothing for a project deleted since the handler looked', async () => {
    const { db, store } = await owned();
    await accept(store, 'run-1', 'r1');
    await accept(store, 'run-2', 'r2');
    await db.prepare(`DELETE FROM projects WHERE id = 'project-1'`).run();

    const result = await store.rollback(
      'project-1',
      'r1',
      'r2',
      'rollback-deleted',
    );
    assert.deepEqual(result, { outcome: 'gone' });
    assert.equal(await store.loadStage('rollback-deleted'), undefined);
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r2');
  });

  it('refuses a revision that is not stored, and writes nothing', async () => {
    const { store } = await owned();
    await accept(store, 'run-1', 'r1');

    const result = await store.rollback(
      'project-1',
      'r-gone',
      'r1',
      'rollback-gone',
    );
    assert.deepEqual(result, { outcome: 'missing' });
    assert.equal(await store.loadStage('rollback-gone'), undefined);
    assert.equal((await store.loadAccepted('project-1'))?.revision, 'r1');
  });
});
