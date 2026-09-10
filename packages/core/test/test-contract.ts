/**
 * The behavioural contract every `GenerationStore` implementation must
 * satisfy, extracted from what were originally `InMemoryGenerationStore`-only
 * tests so a second implementation (a D1/R2-backed one, for instance) is
 * proven equivalent rather than merely typechecking against the interface.
 *
 * Test-only: imports nothing beyond `node:assert`/`node:test` and this
 * package's own types, and is never imported from application runtime code.
 * Exported at the `@vibld/core/test-contract` subpath rather than the
 * package root so it never reaches a production bundle by accident.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectSnapshot } from '../src/types.ts';
import type { GenerationStore } from '../src/store.ts';

function snapshot(revision: string, content: string): ProjectSnapshot {
  return {
    revision,
    files: [{ path: 'index.html', content }],
  };
}

/**
 * Runs the full contract against a fresh store from `createStore()` per
 * test. `label` distinguishes the suite in test output when more than one
 * implementation is exercised in the same run.
 */
export function testGenerationStoreContract(
  label: string,
  createStore: () => GenerationStore | Promise<GenerationStore>,
): void {
  test(`[${label}] persists and reloads a staged generation record`, async () => {
    const store = await createStore();

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

  test(`[${label}] promotes a staged snapshot when the expected base matches`, async () => {
    const store = await createStore();
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

  test(`[${label}] rejects a stale promotion and preserves the accepted checkpoint`, async () => {
    const store = await createStore();
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

  test(`[${label}] returns defensive copies from persisted state`, async () => {
    const store = await createStore();
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

  test(`[${label}] a promotion attempt against an unknown project is refused`, async () => {
    const store = await createStore();

    const result = await store.promote(
      'never-created',
      'no-such-run',
      null,
      snapshot('r11111111', 'first'),
    );

    assert.equal(result.promoted, false);
    assert.equal(result.current, undefined);
  });

  test(`[${label}] loading an unknown project or run returns undefined, not an error`, async () => {
    const store = await createStore();

    assert.equal(await store.loadAccepted('never-created'), undefined);
    assert.equal(await store.loadStage('no-such-run'), undefined);
  });

  test(`[${label}] two projects promote independently`, async () => {
    const store = await createStore();
    const a = snapshot('r-a', 'project a content');
    const b = snapshot('r-b', 'project b content');

    await store.saveStage({
      runId: 'run-a',
      projectId: 'project-a',
      baseRevision: null,
      state: 'validating',
      snapshot: a,
    });
    await store.saveStage({
      runId: 'run-b',
      projectId: 'project-b',
      baseRevision: null,
      state: 'validating',
      snapshot: b,
    });

    const resultA = await store.promote('project-a', 'run-a', null, a);
    const resultB = await store.promote('project-b', 'run-b', null, b);

    assert.equal(resultA.promoted, true);
    assert.equal(resultB.promoted, true);
    assert.equal(
      (await store.loadAccepted('project-a'))?.files[0]?.content,
      'project a content',
    );
    assert.equal(
      (await store.loadAccepted('project-b'))?.files[0]?.content,
      'project b content',
    );
  });
}
