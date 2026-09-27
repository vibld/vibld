import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
} from '../src/index.ts';
import type {
  GenerationPlan,
  ModelProvider,
  ProjectSnapshot,
  Validator,
} from '../src/index.ts';

const acceptAll: Validator = async () => ({ ok: true, errors: [] });

async function seedAccepted(
  store: InMemoryGenerationStore,
  projectId: string,
  accepted: ProjectSnapshot,
): Promise<void> {
  await store.saveStage({
    runId: 'seed',
    projectId,
    baseRevision: null,
    state: 'validating',
    snapshot: accepted,
  });
  const result = await store.promote(projectId, 'seed', null, accepted);
  assert.equal(result.promoted, true);
}

function deferredProvider(): {
  provider: ModelProvider;
  release: (plan: GenerationPlan) => void;
} {
  let resolvePlan: ((plan: GenerationPlan) => void) | undefined;
  return {
    provider: {
      id: 'deferred',
      generate: () =>
        new Promise<GenerationPlan>((resolve) => {
          resolvePlan = resolve;
        }),
    },
    release: (plan) => {
      assert.ok(resolvePlan);
      resolvePlan(plan);
    },
  };
}

test('persists an accepted run after successful validation and promotion', async () => {
  const store = new InMemoryGenerationStore();
  const runner = new DurableGenerationRunner(store);
  const provider = new FakeModelProvider([
    {
      summary: 'First site',
      files: [{ path: 'index.html', content: 'first' }],
    },
  ]);

  const result = await runner.run(
    { projectId: 'project-1', runId: 'run-1', prompt: 'Build it' },
    provider,
    acceptAll,
  );

  assert.equal(result.state, 'accepted');
  assert.equal(result.conflict, false);
  assert.equal((await store.loadStage('run-1'))?.state, 'accepted');
  assert.equal(
    (await store.loadAccepted('project-1'))?.files[0]?.content,
    'first',
  );
});

test('persists validation failure while preserving the prior checkpoint', async () => {
  const store = new InMemoryGenerationStore();
  const base: ProjectSnapshot = {
    revision: 'rbase0001',
    files: [{ path: 'index.html', content: 'base' }],
  };
  await seedAccepted(store, 'project-1', base);

  const runner = new DurableGenerationRunner(store);
  const provider = new FakeModelProvider([
    {
      summary: 'Broken change',
      files: [{ path: 'index.html', content: 'broken' }],
    },
  ]);
  const rejectAll: Validator = async () => ({
    ok: false,
    errors: ['build failed'],
  });

  const result = await runner.run(
    { projectId: 'project-1', runId: 'run-2', prompt: 'Change it' },
    provider,
    rejectAll,
  );

  assert.equal(result.state, 'failed');
  assert.equal(result.accepted?.revision, 'rbase0001');
  assert.equal((await store.loadStage('run-2'))?.state, 'failed');
  assert.equal((await store.loadAccepted('project-1'))?.revision, 'rbase0001');
});

test('rejects a distributed stale writer at promotion time', async () => {
  const store = new InMemoryGenerationStore();
  const base: ProjectSnapshot = {
    revision: 'rbase0001',
    files: [{ path: 'index.html', content: 'base' }],
  };
  await seedAccepted(store, 'project-1', base);

  const slowRunner = new DurableGenerationRunner(store);
  const fastRunner = new DurableGenerationRunner(store);
  const delayed = deferredProvider();

  const slowPending = slowRunner.run(
    { projectId: 'project-1', runId: 'run-slow', prompt: 'Slow change' },
    delayed.provider,
    acceptAll,
  );

  const fast = await fastRunner.run(
    { projectId: 'project-1', runId: 'run-fast', prompt: 'Fast change' },
    new FakeModelProvider([
      {
        summary: 'Fast change',
        files: [{ path: 'index.html', content: 'fast' }],
      },
    ]),
    acceptAll,
  );
  assert.equal(fast.state, 'accepted');

  delayed.release({
    summary: 'Slow stale change',
    files: [{ path: 'index.html', content: 'slow' }],
  });
  const slow = await slowPending;

  assert.equal(slow.state, 'failed');
  assert.equal(slow.conflict, true);
  assert.deepEqual(slow.errors, ['Accepted revision changed before promotion']);
  assert.equal(slow.accepted?.revision, fast.accepted?.revision);
  assert.equal((await store.loadStage('run-slow'))?.state, 'failed');
  assert.equal(
    (await store.loadAccepted('project-1'))?.files[0]?.content,
    'fast',
  );
});
