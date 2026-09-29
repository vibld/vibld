import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DurableGenerationResult, ProjectSnapshot } from '@vibld/core';

import {
  CHECK_STAGE,
  checkVerdictOf,
  openBuildCheck,
} from '../worker/generation-run.ts';
import type { GenerationWorkflowEnv } from '../worker/generation-run.ts';
import { D1GenerationStore, checkRunId } from '../worker/generation-store.ts';
import { handleProjects } from '../worker/project-handlers.ts';
import { ProjectStore } from '../worker/project-store.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { checkingUpdate, endedWith, handleRun } from '../worker/run-control.ts';
import type { RunControlDeps } from '../worker/run-control.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Show early, badge it (docs/decisions.md, D69), on the Worker's side,
 * against the real schema over SQLite and an in-memory R2.
 *
 * A build's revision is promoted in `assemble`, before it is built and
 * checked. The builder is now told of it then: the run's check row
 * (`<runId>:verify`) is open from that moment until the check ends, and
 * both ways the builder learns of a build, the stream and asking, read the
 * code on screen from it. The accepted revision is exactly what it was
 * before; only when the builder hears of it moves.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const PROJECT = 'project-001';
const RUN = '553ea6c7-0000-4000-8000-000000000069';

const FIRST: ProjectSnapshot = {
  revision: 'r-first',
  files: [{ path: 'index.html', content: '<h1>Bakery</h1>' }],
};
const REPAIRED: ProjectSnapshot = {
  revision: 'r-repaired',
  files: [{ path: 'index.html', content: '<h1>Bakery, fixed</h1>' }],
};

interface World {
  db: SqliteD1Database;
  bucket: InMemoryR2Bucket;
  generation: D1GenerationStore;
  instances: Map<string, string>;
  terminated: string[];
  run(
    method: string,
    query?: string,
  ): Promise<{ status: number; body: Record<string, any> }>;
  open(): Promise<Record<string, any>>;
  state(runId: string): Promise<string | undefined>;
  rows(): ReturnType<ProjectStore['runStages']>;
}

async function world(): Promise<World> {
  const db = new SqliteD1Database(schemaSql());
  const bucket = new InMemoryR2Bucket();
  const generation = new D1GenerationStore(db, bucket);
  const instances = new Map<string, string>();
  const terminated: string[] = [];
  const deps = (): RunControlDeps => ({
    resolvePrincipal: async () =>
      ({ denied: null, principal: { userId: ALICE } }) as PrincipalGranted,
    instanceStatus: async (runId) => instances.get(runId),
    terminate: async (runId) => {
      terminated.push(runId);
      instances.set(runId, 'terminated');
    },
  });
  const made = await new ProjectStore(db, bucket).create(
    ALICE,
    { id: PROJECT, name: 'Bakery', now: new Date().toISOString() },
    null,
  );
  assert.ok(made);
  return {
    db,
    bucket,
    generation,
    instances,
    terminated,
    async run(method, query = '') {
      const response = await handleRun(
        new Request(`${ORIGIN}/api/runs/${RUN}${query}`, {
          method,
          headers: { origin: ORIGIN },
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps(),
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
    async open() {
      const response = await handleProjects(
        new Request(`${ORIGIN}/api/projects/${PROJECT}`),
        { DB: db, PROJECT_CONTENT: bucket },
        deps(),
      );
      return (await response.json()) as Record<string, any>;
    },
    async state(runId) {
      const row = await db
        .prepare(`SELECT state FROM generation_stages WHERE run_id = ?1`)
        .bind(runId)
        .first<{ state: string }>();
      return row?.state;
    },
    rows() {
      return new ProjectStore(db, bucket).runStages(ALICE, RUN);
    },
  };
}

/** A run as `assemble` leaves it: its revision promoted. */
async function assembled(w: World): Promise<void> {
  await w.generation.openStage({
    runId: RUN,
    projectId: PROJECT,
    baseRevision: null,
  });
  w.instances.set(RUN, 'running');
  await w.generation.saveStage({
    runId: RUN,
    projectId: PROJECT,
    baseRevision: null,
    state: 'validating',
    snapshot: FIRST,
  });
  assert.ok((await w.generation.promote(PROJECT, RUN, null, FIRST)).promoted);
}

/** And then `open-check`: shown, and being checked. */
async function checking(w: World): Promise<void> {
  await assembled(w);
  await w.generation.openCheck({
    runId: RUN,
    projectId: PROJECT,
    baseRevision: null,
    revision: FIRST.revision,
  });
}

/** A repair the check bought, promoted in its own row. */
async function repaired(w: World): Promise<void> {
  const repairRun = `${RUN}:repair`;
  await w.generation.saveStage({
    runId: repairRun,
    projectId: PROJECT,
    baseRevision: FIRST.revision,
    state: 'planning',
  });
  await w.generation.saveStage({
    runId: repairRun,
    projectId: PROJECT,
    baseRevision: FIRST.revision,
    state: 'validating',
    snapshot: REPAIRED,
  });
  assert.ok(
    (await w.generation.promote(PROJECT, repairRun, FIRST.revision, REPAIRED))
      .promoted,
  );
}

const ACCEPTED = {
  state: 'accepted',
  stop: 'applied',
  accepted: FIRST,
  errors: [],
  conflict: false,
} as unknown as DurableGenerationResult;

const WITH_BUILDS = {
  PREVIEW: { fetch: async () => new Response('{}') },
  PREVIEW_INTERNAL_SECRET: 'shh',
} as unknown as GenerationWorkflowEnv;

describe('opening a check', () => {
  it('records the promoted revision as being checked, once', async () => {
    const w = await world();
    await assembled(w);
    const opened = await openBuildCheck(
      w.generation,
      WITH_BUILDS,
      { runId: RUN, projectId: PROJECT },
      ACCEPTED,
    );
    assert.equal(opened, true);
    assert.equal(await w.state(checkRunId(RUN)), 'validating');

    // A replayed step never reopens a check that has ended.
    await w.generation.closeCheck(RUN, 'accepted', FIRST.revision);
    await openBuildCheck(
      w.generation,
      WITH_BUILDS,
      { runId: RUN, projectId: PROJECT },
      ACCEPTED,
    );
    assert.equal(await w.state(checkRunId(RUN)), 'accepted');
  });

  it('opens nothing where nothing is built, or nothing was accepted', async () => {
    const w = await world();
    await assembled(w);
    const none = await openBuildCheck(
      w.generation,
      {} as GenerationWorkflowEnv,
      { runId: RUN, projectId: PROJECT },
      ACCEPTED,
    );
    assert.equal(none, false, 'a deployment with no build service');
    const failed = await openBuildCheck(
      w.generation,
      WITH_BUILDS,
      { runId: RUN, projectId: PROJECT },
      { ...ACCEPTED, state: 'failed' } as DurableGenerationResult,
    );
    assert.equal(failed, false, 'a run that accepted nothing');
    assert.equal(await w.state(checkRunId(RUN)), undefined);
  });
});

describe('what a check comes to', () => {
  it('passes code that builds, and fails code that does not', () => {
    assert.equal(checkVerdictOf({ built: true }), 'passed');
    assert.equal(
      checkVerdictOf({ built: true, designErrors: 2, skipped: 'no-budget' }),
      'passed',
      'design errors are not whether it builds',
    );
    assert.equal(checkVerdictOf({ built: false, repaired: true }), 'passed');
    assert.equal(
      checkVerdictOf({ built: true, repaired: false, restored: true }),
      'passed',
      'the first attempt put back builds',
    );
    assert.equal(checkVerdictOf({ built: false, repaired: false }), 'failed');
    assert.equal(
      checkVerdictOf({ built: false, skipped: 'no-budget' }),
      'failed',
    );
    assert.equal(
      checkVerdictOf({ built: false, skipped: 'timed-out' }),
      'failed',
    );
  });

  it('claims nothing where nothing judged the code', () => {
    assert.equal(checkVerdictOf({ skipped: 'unavailable' }), 'unchecked');
    assert.equal(checkVerdictOf({ skipped: 'not-the-project' }), 'unchecked');
    assert.equal(
      checkVerdictOf({ built: false, unverified: 'busy' }),
      'unchecked',
      'a repair promoted and never built',
    );
    assert.deepEqual(CHECK_STAGE, {
      passed: 'accepted',
      failed: 'failed',
      unchecked: 'idle',
    });
  });
});

describe('asking after a build being checked', () => {
  it('reads as running, with the code it promoted', async () => {
    const w = await world();
    await checking(w);

    const asked = await w.run('GET');
    assert.equal(asked.status, 200);
    assert.equal(asked.body.run.state, 'running');
    assert.deepEqual(asked.body.run.checking, { revision: FIRST.revision });
    assert.equal(asked.body.run.phase, 'validating');
    assert.deepEqual(asked.body.snapshot, FIRST);

    // Not sent again to a builder that has it: it is asked every poll.
    const known = await w.run('GET', `?known=${FIRST.revision}`);
    assert.deepEqual(known.body.run.checking, { revision: FIRST.revision });
    assert.equal(known.body.snapshot, null);
  });

  it('says a repair is running, and shows the repair once promoted', async () => {
    const w = await world();
    await checking(w);
    await w.generation.saveStage({
      runId: `${RUN}:repair`,
      projectId: PROJECT,
      baseRevision: FIRST.revision,
      state: 'planning',
    });
    const repairing = await w.run('GET', `?known=${FIRST.revision}`);
    assert.equal(repairing.body.run.phase, 'repairing');
    assert.deepEqual(repairing.body.run.checking, {
      revision: FIRST.revision,
    });

    await repaired(w);
    const replaced = await w.run('GET', `?known=${FIRST.revision}`);
    assert.equal(replaced.body.run.state, 'running');
    assert.deepEqual(replaced.body.run.checking, {
      revision: REPAIRED.revision,
    });
    assert.deepEqual(replaced.body.snapshot, REPAIRED);
  });

  it('says what the check found once it ends', async () => {
    for (const [stage, verdict] of [
      ['accepted', 'passed'],
      ['failed', 'failed'],
      ['idle', 'unchecked'],
    ] as const) {
      const w = await world();
      await checking(w);
      await w.generation.closeCheck(RUN, stage, FIRST.revision);
      w.instances.set(RUN, 'complete');
      const asked = await w.run('GET');
      assert.equal(asked.body.run.state, 'accepted');
      assert.equal(asked.body.run.revision, FIRST.revision);
      assert.equal(asked.body.run.check, verdict);
      assert.deepEqual(asked.body.snapshot, FIRST);
    }
  });

  it('keeps today’s answer for a build that was never checked', async () => {
    const w = await world();
    await assembled(w);
    w.instances.set(RUN, 'complete');
    const asked = await w.run('GET');
    assert.equal(asked.body.run.state, 'accepted');
    assert.equal('check' in asked.body.run, false);
  });

  it('ends a check the engine cut off as unchecked, never as failed', async () => {
    const w = await world();
    await checking(w);
    w.instances.set(RUN, 'errored');
    const asked = await w.run('GET');
    assert.equal(asked.body.run.state, 'accepted');
    assert.equal(asked.body.run.check, 'unchecked');
    assert.equal(await w.state(checkRunId(RUN)), 'idle');
    assert.equal(await w.state(RUN), 'accepted', 'the accepted run moved');
  });
});

describe('a reopened project whose build is being checked', () => {
  it('finds the build still running, with the code it promoted', async () => {
    const w = await world();
    await checking(w);
    const opened = await w.open();
    assert.equal(opened.build?.runId, RUN);
    // The accepted revision is the one being checked: exactly what the
    // store held before any of this.
    assert.equal(opened.snapshot?.revision, FIRST.revision);
  });

  it('cannot be deleted from under the check', async () => {
    const w = await world();
    await checking(w);
    assert.equal(
      await new ProjectStore(w.db, w.bucket).runInFlight(PROJECT, new Date()),
      true,
    );
  });
});

describe('Stop, once the build is being checked', () => {
  it('leaves a check alone: there is nothing left to stop', async () => {
    const w = await world();
    await checking(w);
    const stopped = await w.run('DELETE');
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.run.state, 'running');
    assert.deepEqual(stopped.body.run.checking, { revision: FIRST.revision });
    assert.deepEqual(w.terminated, [], 'terminated a build with no step left');
    assert.equal(await w.state(checkRunId(RUN)), 'validating');
  });

  it('stops a repair, as it always did, and keeps the code unchecked', async () => {
    const w = await world();
    await checking(w);
    await w.generation.saveStage({
      runId: `${RUN}:repair`,
      projectId: PROJECT,
      baseRevision: FIRST.revision,
      state: 'planning',
    });
    const stopped = await w.run('DELETE');
    assert.deepEqual(w.terminated, [RUN]);
    assert.equal(stopped.body.run.state, 'accepted');
    assert.equal(stopped.body.run.revision, FIRST.revision);
    assert.equal(stopped.body.run.check, 'unchecked');
    assert.equal(await w.state(`${RUN}:repair`), 'cancelled');
    assert.equal(await w.state(checkRunId(RUN)), 'idle');
  });
});

describe('the stream', () => {
  it('sends the code once, and again when a repair replaces it', async () => {
    const w = await world();
    const rows = () => w.rows();
    assert.equal(
      await checkingUpdate(rows, w.generation, RUN, undefined),
      undefined,
      'nothing before the run is promoted',
    );
    await checking(w);

    const first = await checkingUpdate(rows, w.generation, RUN, undefined);
    assert.equal(first?.revision, FIRST.revision);
    assert.equal(first?.phase, 'validating');
    assert.deepEqual(first?.snapshot, FIRST);

    const again = await checkingUpdate(rows, w.generation, RUN, FIRST.revision);
    assert.equal(again?.revision, FIRST.revision);
    assert.equal(again?.snapshot, undefined, 'the same code sent twice');

    await repaired(w);
    const replaced = await checkingUpdate(
      rows,
      w.generation,
      RUN,
      FIRST.revision,
    );
    assert.deepEqual(replaced?.snapshot, REPAIRED);

    await w.generation.closeCheck(RUN, 'accepted', REPAIRED.revision);
    assert.equal(
      await checkingUpdate(rows, w.generation, RUN, REPAIRED.revision),
      undefined,
      'still checking after the check ended',
    );
  });

  it('hands a builder the code of a run stopped after it promoted', async () => {
    const w = await world();
    await checking(w);
    await w.generation.settleRun(RUN, 'cancelled');
    const ended = await endedWith(() => w.rows(), w.generation, RUN);
    assert.deepEqual(ended?.snapshot, FIRST);
    assert.equal(ended?.check, 'unchecked');
  });

  it('hands nothing for a run stopped before it promoted', async () => {
    const w = await world();
    await w.generation.openStage({
      runId: RUN,
      projectId: PROJECT,
      baseRevision: null,
    });
    await w.generation.settleRun(RUN, 'cancelled');
    assert.equal(await endedWith(() => w.rows(), w.generation, RUN), undefined);
  });
});

describe('the Workflow', () => {
  async function source(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return readFile(
      join(import.meta.dirname, '..', 'worker', 'generation-workflow.ts'),
      'utf8',
    );
  }

  it('opens the check after settling, and closes it last', async () => {
    // `generation-workflow.ts` imports `cloudflare:workers` and cannot be
    // loaded under `node --test`, so the order of its steps is read.
    const text = await source();
    const at = (name: string) => {
      const index = text.indexOf(`'${name}',`);
      assert.ok(index > 0, `no step named ${name}`);
      return index;
    };
    assert.ok(at('assemble') < at('settle-budget'));
    // Nothing added may come between a run and the settling of what it
    // spent: a Stop from here on finds it settled, as it always did.
    assert.ok(at('settle-budget') < at('open-check'));
    assert.ok(at('open-check') < at('verify-and-repair'));
    assert.ok(at('record-trace') < at('close-check'));
  });
});
