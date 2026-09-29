import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { D1GenerationStore } from '../worker/generation-store.ts';
import { handleProjects } from '../worker/project-handlers.ts';
import { ProjectStore } from '../worker/project-store.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { RUN_ABANDONED_AFTER_MS } from '@vibld/ai';

import { UserBudget } from '../worker/budget.ts';
import { stoppedFirst } from '../worker/generation-run.ts';
import { reserveBudget, topupKeyFor } from '../worker/reserve.ts';
import type { ReserveEnv } from '../worker/reserve.ts';
import { handleRun, settleStopped } from '../worker/run-control.ts';
import type { RunControlDeps } from '../worker/run-control.ts';
import { RunProgress } from '../worker/run-progress.ts';
import { ACCOUNT_BUDGET_KEY } from '../worker/spend.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * A build that outlives its page, and the one thing that stops it
 * (docs/decisions.md, "Resolved 2026-09-29", keep building), against the
 * real schema over SQLite and an in-memory R2.
 *
 * In the order somebody would notice them broken: Stop stops the build and
 * says so; Stop cannot reach somebody else's build; a reopened project
 * says its build is still running; and a build the engine ended without
 * writing its end does not read as `planning` for ever, which is what run
 * 553ea6c7 did in production.
 */

const ORIGIN = 'https://app.vibld.com';
const ALICE = 'user_alice00000000000000000001';
const BOB = 'user_bob0000000000000000000002';
const PROJECT = 'project-001';
const RUN = '553ea6c7-0000-4000-8000-000000000001';

interface World {
  db: SqliteD1Database;
  bucket: InMemoryR2Bucket;
  /** What the Workflow engine would say of each instance. */
  instances: Map<string, string>;
  terminated: string[];
  /** What the Workflow engine would give as each instance's result. */
  outputs: Map<string, unknown>;
  /** Whether `terminate` refuses, as the engine does for a finished instance. */
  refuseTerminate: boolean;
  /** How a stopped run's reservation is closed, where the test wires one. */
  settleStopped?: RunControlDeps['settleStopped'];
  generation: D1GenerationStore;
  run(
    user: string,
    method: string,
    id?: string,
  ): Promise<{ status: number; body: Record<string, any> }>;
  open(user: string): Promise<{ status: number; body: Record<string, any> }>;
  stage(runId?: string): Promise<string | undefined>;
}

async function world(): Promise<World> {
  const db = new SqliteD1Database(schemaSql());
  const bucket = new InMemoryR2Bucket();
  const instances = new Map<string, string>();
  const terminated: string[] = [];
  const outputs = new Map<string, unknown>();
  const generation = new D1GenerationStore(db, bucket);
  const w: World = {
    db,
    bucket,
    instances,
    outputs,
    terminated,
    refuseTerminate: false,
    generation,
    async run(user, method, id = RUN) {
      const deps: RunControlDeps = {
        resolvePrincipal: async () =>
          ({ denied: null, principal: { userId: user } }) as PrincipalGranted,
        instanceStatus: async (runId) => instances.get(runId),
        instanceOutput: async (runId) => outputs.get(runId),
        terminate: async (runId) => {
          if (w.refuseTerminate) throw new Error('instance is not running');
          terminated.push(runId);
          instances.set(runId, 'terminated');
        },
        ...(w.settleStopped ? { settleStopped: w.settleStopped } : {}),
      };
      const response = await handleRun(
        new Request(`${ORIGIN}/api/runs/${id}`, {
          method,
          headers: { origin: ORIGIN },
        }),
        { DB: db, PROJECT_CONTENT: bucket },
        deps,
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
    async open(user) {
      const response = await handleProjects(
        new Request(`${ORIGIN}/api/projects/${PROJECT}`),
        { DB: db, PROJECT_CONTENT: bucket },
        {
          resolvePrincipal: async () =>
            ({ denied: null, principal: { userId: user } }) as PrincipalGranted,
          instanceStatus: async (runId) => instances.get(runId),
        },
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    },
    async stage(runId = RUN) {
      const row = await db
        .prepare(`SELECT state FROM generation_stages WHERE run_id = ?1`)
        .bind(runId)
        .first<{ state: string }>();
      return row?.state;
    },
  };
  const made = await new ProjectStore(db, bucket).create(
    ALICE,
    { id: PROJECT, name: 'Bakery', now: new Date().toISOString() },
    null,
  );
  assert.ok(made);
  return w;
}

/** A build as `handlePlan` leaves it the moment the Workflow exists. */
async function started(w: World, runId = RUN): Promise<void> {
  await w.generation.openStage({
    runId,
    projectId: PROJECT,
    baseRevision: null,
  });
  w.instances.set(runId, 'running');
}

/** Age a run's row past `RUN_IN_FLIGHT_MS`, as a real one would have aged. */
async function age(w: World, runId = RUN): Promise<void> {
  await w.db
    .prepare(
      `UPDATE generation_stages SET created_at = ?2, updated_at = ?2
        WHERE run_id = ?1`,
    )
    .bind(runId, '2026-09-01T00:00:00.000Z')
    .run();
}

describe('Stop', () => {
  it('terminates the build and marks it cancelled', async () => {
    const w = await world();
    await started(w);

    const stopped = await w.run(ALICE, 'DELETE');
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.run.state, 'cancelled');
    assert.deepEqual(w.terminated, [RUN], 'the Workflow was left running');
    assert.equal(await w.stage(), 'cancelled');
    assert.equal(
      await new ProjectStore(w.db, w.bucket).runInFlight(PROJECT, new Date()),
      false,
      'the project still reports a build in flight',
    );
  });

  it('is the same answer the second time, and terminates once', async () => {
    const w = await world();
    await started(w);
    await w.run(ALICE, 'DELETE');
    const again = await w.run(ALICE, 'DELETE');
    assert.equal(again.status, 200);
    assert.equal(again.body.run.state, 'cancelled');
    assert.deepEqual(w.terminated, [RUN]);
  });

  it("cannot reach somebody else's build", async () => {
    const w = await world();
    await started(w);

    const refused = await w.run(BOB, 'DELETE');
    assert.equal(
      refused.status,
      404,
      "not 403: that it exists is Alice's business",
    );
    assert.deepEqual(w.terminated, [], "Bob stopped Alice's build");
    assert.equal(await w.stage(), 'planning');

    const asked = await w.run(BOB, 'GET');
    assert.equal(asked.status, 404);
  });

  it('says so when the build could not be stopped, and leaves it running', async () => {
    const w = await world();
    await started(w);
    w.refuseTerminate = true;

    const refused = await w.run(ALICE, 'DELETE');
    assert.equal(refused.status, 503);
    assert.match(refused.body.error, /still running/);
    assert.equal(await w.stage(), 'planning', 'marked cancelled while running');
  });

  it('counts an instance that had already ended as stopped', async () => {
    // The engine refuses to terminate an instance that has finished, and
    // that is not a stop that failed.
    const w = await world();
    await started(w);
    w.refuseTerminate = true;
    w.instances.set(RUN, 'terminated');

    const stopped = await w.run(ALICE, 'DELETE');
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.run.state, 'cancelled');
  });

  it('refuses a stop sent from another site', async () => {
    const w = await world();
    await started(w);
    const response = await handleRun(
      new Request(`${ORIGIN}/api/runs/${RUN}`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      }),
      { DB: w.db, PROJECT_CONTENT: w.bucket },
      {
        resolvePrincipal: async () =>
          ({ denied: null, principal: { userId: ALICE } }) as PrincipalGranted,
        terminate: async (runId) => {
          w.terminated.push(runId);
        },
      },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(w.terminated, []);
  });
});

describe('asking after a build', () => {
  it('reads as running while it runs', async () => {
    const w = await world();
    await started(w);
    const asked = await w.run(ALICE, 'GET');
    assert.equal(asked.status, 200);
    assert.equal(asked.body.run.state, 'running');
    assert.equal(typeof asked.body.run.startedAt, 'string');
  });

  it('hands back the code a build moved the project to', async () => {
    const w = await world();
    await started(w);
    const snapshot = {
      revision: 'r1',
      files: [{ path: 'index.html', content: '<h1>Bakery</h1>' }],
    };
    await w.generation.saveStage({
      runId: RUN,
      projectId: PROJECT,
      baseRevision: null,
      state: 'validating',
      snapshot,
    });
    assert.ok(
      (await w.generation.promote(PROJECT, RUN, null, snapshot)).promoted,
    );
    w.instances.set(RUN, 'complete');

    const asked = await w.run(ALICE, 'GET');
    assert.equal(asked.body.run.state, 'accepted');
    assert.equal(asked.body.run.revision, 'r1');
    assert.deepEqual(asked.body.snapshot, snapshot);
    assert.equal(
      'summary' in asked.body.run,
      false,
      'a summary with no result to read it from',
    );

    // What the build said it made, from the instance's own result, for a
    // builder that was not streaming it. Only for the revision it describes.
    w.outputs.set(RUN, {
      state: 'accepted',
      accepted: { revision: 'r1', files: [] },
      summary: 'A bakery site.',
    });
    assert.equal(
      (await w.run(ALICE, 'GET')).body.run.summary,
      'A bakery site.',
    );
    w.outputs.set(RUN, {
      state: 'accepted',
      accepted: { revision: 'r0', files: [] },
      summary: 'Something else.',
    });
    assert.equal('summary' in (await w.run(ALICE, 'GET')).body.run, false);
  });

  it('settles a build the engine terminated without writing its end', async () => {
    // Run 553ea6c7: terminated between steps, its row left at `planning`.
    const w = await world();
    await started(w);
    w.instances.set(RUN, 'terminated');

    const asked = await w.run(ALICE, 'GET');
    assert.equal(asked.body.run.state, 'cancelled');
    assert.equal(await w.stage(), 'cancelled');
  });

  it('settles one that errored, or that nothing can say anything about', async () => {
    const w = await world();
    await started(w);
    w.instances.set(RUN, 'errored');
    assert.equal((await w.run(ALICE, 'GET')).body.run.state, 'failed');
    assert.equal(await w.stage(), 'failed');

    // Old enough to be past a run's whole budget, with no instance left to
    // ask: the reading `runInFlight` already gives it.
    const stale = '553ea6c7-0000-4000-8000-000000000002';
    await started(w, stale);
    w.instances.delete(stale);
    await age(w, stale);
    assert.equal((await w.run(ALICE, 'GET', stale)).body.run.state, 'failed');
    assert.equal(await w.stage(stale), 'failed');
  });
});

describe('opening a project with a build still running', () => {
  it('reports the build, by the id Stop takes, and when it started', async () => {
    const w = await world();
    await started(w);
    const opened = await w.open(ALICE);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.build.runId, RUN);
    assert.equal(typeof opened.body.build.startedAt, 'string');
  });

  it('reports none once it has ended, and none for a project with no build', async () => {
    const w = await world();
    assert.equal((await w.open(ALICE)).body.build, null);
    await started(w);
    await w.run(ALICE, 'DELETE');
    assert.equal((await w.open(ALICE)).body.build, null);
  });

  it('is where a run stopped without writing its end is settled', async () => {
    const w = await world();
    await started(w);
    await age(w);
    w.instances.set(RUN, 'terminated');

    assert.equal((await w.open(ALICE)).body.build, null);
    assert.equal(await w.stage(), 'cancelled', 'still planning after the open');
  });
});

/**
 * What a stopped build is charged, and when (D60).
 *
 * Stop terminates the Workflow before the step that settles its
 * reservation, so the reservation used to stay open until the ledger's
 * abandoned-run reclaim found it, about thirty-five minutes later, holding
 * an in-flight slot the whole time. At two runs in flight, two Stops locked
 * the account out. These run the real ledger and the real per-run record
 * behind the real route.
 */
describe('the reservation of a stopped build', () => {
  const MONTH = '2026-09';
  const DAY = '2026-09-29';
  const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);
  const WORST = 3_201_250;
  const RUN_2 = '553ea6c7-0000-4000-8000-000000000002';

  /** `USER_BUDGET` and `RUN_PROGRESS` as real objects over SQLite. */
  function bindings() {
    const make = <T>(create: () => T) => {
      const objects = new Map<string, T>();
      return {
        objects,
        getByName(key: string): T {
          let object = objects.get(key);
          if (!object) {
            object = create();
            objects.set(key, object);
          }
          return object;
        },
      };
    };
    const ledger = make(() => new UserBudget(fakeDurableObjectCtx(), {}));
    const progress = make(() => new RunProgress(fakeDurableObjectCtx(), {}));
    const env = {
      USER_BUDGET: ledger as unknown as ReserveEnv['USER_BUDGET'],
      VIBLD_MAX_IN_FLIGHT: '2',
    } satisfies ReserveEnv;
    return { ledger, progress, env };
  }

  /** What `handlePlan` does before the Workflow exists: reserve, and record where. */
  async function admit(
    b: ReturnType<typeof bindings>,
    runId: string,
    topup = 0,
    allowance = 10_000_000,
  ) {
    const reserved = await reserveBudget(
      b.env,
      ALICE,
      WORST,
      allowance,
      topup,
      NOW,
    );
    if (!reserved.ok) return reserved;
    b.progress.getByName(runId).hold({
      reservationId: reserved.layers.user.id!,
      topup: reserved.layers.userReservationKey === topupKeyFor(ALICE),
      accountReservationId: reserved.layers.account.id!,
    });
    return reserved;
  }

  /** The route, wired to the ledger the way `index.ts` wires it. */
  async function wired() {
    const w = await world();
    const b = bindings();
    w.settleStopped = async (runId, userId) => {
      await settleStopped(
        b.progress.getByName(runId),
        b.ledger as never,
        userId,
        runId,
      );
    };
    return { w, b };
  }

  it('leaves the account able to build again after two stops in a row', async () => {
    const { w, b } = await wired();
    for (const runId of [RUN, RUN_2]) {
      assert.equal((await admit(b, runId)).ok, true);
      await started(w, runId);
    }
    // Two in flight: a third is refused, which is the ceiling working.
    const third = await reserveBudget(b.env, ALICE, WORST, 10_000_000, 0, NOW);
    assert.ok(!third.ok);
    assert.equal(third.verdict.reason, 'too-many-in-flight');

    assert.equal((await w.run(ALICE, 'DELETE', RUN)).status, 200);
    assert.equal((await w.run(ALICE, 'DELETE', RUN_2)).status, 200);

    const again = await reserveBudget(b.env, ALICE, WORST, 10_000_000, 0, NOW);
    assert.equal(
      again.ok,
      true,
      'two stops still hold the account out of building',
    );
    assert.equal(b.ledger.getByName(ALICE).usageFor(MONTH).inFlight, 1);
  });

  it('charges what the abandoned-run reclaim would have, at both layers', async () => {
    // One ledger has its run stopped; the other has the same run left for
    // the reclaim to find. The two must end on the same figures.
    const { w, b } = await wired();
    await admit(b, RUN);
    await started(w, RUN);
    await w.run(ALICE, 'DELETE', RUN);

    const left = bindings();
    await admit(left, RUN);
    const clock = Date.now;
    Date.now = () => clock() + RUN_ABANDONED_AFTER_MS + 1000;
    try {
      // Any later reservation runs the reclaim, on both ledgers it asks.
      await reserveBudget(left.env, ALICE, 1, 10_000_000, 0, NOW);
    } finally {
      Date.now = clock;
    }
    const reclaimedOwn = left.ledger.getByName(ALICE).usageFor(MONTH);
    const reclaimedAccount = left.ledger
      .getByName(ACCOUNT_BUDGET_KEY)
      .usageFor(DAY);

    const stoppedOwn = b.ledger.getByName(ALICE).usageFor(MONTH);
    const stoppedAccount = b.ledger.getByName(ACCOUNT_BUDGET_KEY).usageFor(DAY);
    assert.equal(stoppedOwn.spentMicroUsd, WORST);
    assert.equal(stoppedOwn.inFlight, 0, 'the stop left the run in flight');
    assert.equal(stoppedAccount.inFlight, 0);
    // The reclaiming ledger also holds the one-micro-dollar run that ran
    // the reclaim, still in flight.
    assert.equal(reclaimedOwn.spentMicroUsd - 1, stoppedOwn.spentMicroUsd);
    assert.equal(
      reclaimedAccount.spentMicroUsd - 1,
      stoppedAccount.spentMicroUsd,
    );
  });

  it('settles once however many times it is stopped', async () => {
    const { w, b } = await wired();
    await admit(b, RUN);
    await started(w, RUN);

    const reclaims: number[] = [];
    const own = b.ledger.getByName(ALICE);
    const reclaim = own.reclaim.bind(own);
    own.reclaim = (id: number) => {
      const charged = reclaim(id);
      if (charged !== undefined) reclaims.push(charged);
      return charged;
    };

    await w.run(ALICE, 'DELETE', RUN);
    await w.run(ALICE, 'DELETE', RUN);
    assert.deepEqual(reclaims, [WORST], 'a second stop settled again');
    assert.equal(own.usageFor(MONTH).spentMicroUsd, WORST);
  });

  it('is not settled again by a Workflow that reaches its settle step anyway', async () => {
    const { w, b } = await wired();
    await admit(b, RUN);
    await started(w, RUN);
    await w.run(ALICE, 'DELETE', RUN);

    assert.equal(
      await stoppedFirst(b.progress.getByName(RUN)),
      true,
      'the settle step would close the stopped run a second time',
    );
  });

  it('leaves a run the Workflow settled first exactly as it settled it', async () => {
    // The settle step took the settlement and charged what it measured;
    // a Stop that lands afterwards has nothing of its own to close.
    const { w, b } = await wired();
    const reserved = await admit(b, RUN);
    assert.ok(reserved.ok);
    await started(w, RUN);
    assert.equal(await stoppedFirst(b.progress.getByName(RUN)), false);
    b.ledger.getByName(ALICE).settle(reserved.layers.user.id!, 700_000);
    b.ledger
      .getByName(ACCOUNT_BUDGET_KEY)
      .settle(reserved.layers.account.id!, 700_000);

    await w.run(ALICE, 'DELETE', RUN);
    assert.equal(
      b.ledger.getByName(ALICE).usageFor(MONTH).spentMicroUsd,
      700_000,
      'the stop replaced a measured charge with the worst case',
    );
  });

  it('closes a reservation drawn from top-up credit in the top-up ledger', async () => {
    const { w, b } = await wired();
    // No allowance left, so the run is held against top-up credit.
    assert.equal((await admit(b, RUN, 5_000_000, 0)).ok, true);
    await started(w, RUN);
    await w.run(ALICE, 'DELETE', RUN);
    const topup = b.ledger.getByName(topupKeyFor(ALICE)).usageFor('lifetime');
    assert.equal(topup.inFlight, 0);
    assert.equal(topup.spentMicroUsd, WORST);
  });

  it('answers the stop even when the ledger cannot be reached', async () => {
    const { w } = await wired();
    await started(w, RUN);
    w.settleStopped = async () => {
      throw new Error('ledger unreachable');
    };
    const stopped = await w.run(ALICE, 'DELETE', RUN);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.run.state, 'cancelled');
  });
});
