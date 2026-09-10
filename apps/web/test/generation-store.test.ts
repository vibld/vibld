import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { testGenerationStoreContract } from '@vibld/core/test-contract';
import type { ProjectSnapshot } from '@vibld/core';

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
