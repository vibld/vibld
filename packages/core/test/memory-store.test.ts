import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryGenerationStore } from '../src/index.ts';
import type { ProjectSnapshot } from '../src/index.ts';

function snapshot(revision: string, content: string): ProjectSnapshot {
  return {
    revision,
    files: [{ path: 'index.html', content }],
  };
}

test('persists and reloads a staged generation record', async () => {
  const store = new InMemoryGenerationStore();

  await store.saveStage({
    runId: 'run-1',
    projectId: 'project-1',
    baseRevision: null,
    state: 'staging',
    snapshot: snapshot('r11111111', 'draft'),
  });

  const loaded = await store.loadStage('run-1');

  assert.equal(loaded?.projectId, 'project-1');
  assert.equal(loaded?.state, 'staging');
  assert.equal(loaded?.snapshot?.files[0]?.content, 'draft');
});

test('promotes a staged snapshot when the expected base matches', async () => {
  const store = new InMemoryGenerationStore();
  const first = snapshot('r11111111', 'first');

  await store.saveStage({
    runId: 'run-1',
    projectId: 'project-1',
    baseRevision: null,
    state: 'validating',
    snapshot: first,
  });

  const result = await store.promote('project-1', 'run-1', null, first);

  assert.equal(result.promoted, true);
  assert.equal(result.current?.revision, 'r11111111');
  assert.equal((await store.loadStage('run-1'))?.state, 'accepted');
});

test('rejects a stale promotion and preserves the accepted checkpoint', async () => {
  const store = new InMemoryGenerationStore();
  const first = snapshot('r11111111', 'first');
  const second = snapshot('r22222222', 'second');
  const stale = snapshot('r33333333', 'stale');

  await store.saveStage({
    runId: 'run-1',
    projectId: 'project-1',
    baseRevision: null,
    state: 'validating',
    snapshot: first,
  });
  await store.promote('project-1', 'run-1', null, first);

  await store.saveStage({
    runId: 'run-2',
    projectId: 'project-1',
    baseRevision: 'r11111111',
    state: 'validating',
    snapshot: second,
  });
  await store.promote('project-1', 'run-2', 'r11111111', second);

  await store.saveStage({
    runId: 'run-stale',
    projectId: 'project-1',
    baseRevision: 'r11111111',
    state: 'validating',
    snapshot: stale,
  });
  const result = await store.promote(
    'project-1',
    'run-stale',
    'r11111111',
    stale,
  );

  assert.equal(result.promoted, false);
  assert.equal(result.current?.revision, 'r22222222');
  assert.equal(
    (await store.loadAccepted('project-1'))?.files[0]?.content,
    'second',
  );
  assert.equal((await store.loadStage('run-stale'))?.state, 'validating');
});

test('returns defensive copies from persisted state', async () => {
  const store = new InMemoryGenerationStore();
  const first = snapshot('r11111111', 'first');

  await store.saveStage({
    runId: 'run-1',
    projectId: 'project-1',
    baseRevision: null,
    state: 'validating',
    snapshot: first,
  });
  await store.promote('project-1', 'run-1', null, first);

  const loaded = await store.loadAccepted('project-1');
  assert.ok(loaded);
  loaded.files[0]!.content = 'mutated';

  assert.equal(
    (await store.loadAccepted('project-1'))?.files[0]?.content,
    'first',
  );
});
