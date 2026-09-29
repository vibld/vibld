import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REQUIRED_PROJECT_FILES, createScriptedBuildClient } from '@vibld/ai';
import type { PlanClient, ScriptedBuild } from '@vibld/ai';

import { UserBudget } from '../worker/budget.ts';
import {
  buildInSteps,
  callWorstCaseMicroUsd,
  settleBudget,
  stoppedFirst,
} from '../worker/generation-run.ts';
import type {
  CallMeter,
  StepRunner,
  WorkflowParams,
} from '../worker/generation-run.ts';
import { reserveBudget } from '../worker/reserve.ts';
import type { ReserveEnv } from '../worker/reserve.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  runCeilingFor,
} from '../worker/run-ceiling.ts';
import { settleStopped } from '../worker/run-control.ts';
import { RunProgress } from '../worker/run-progress.ts';
import {
  ACCOUNT_BUDGET_KEY,
  microUsdOf,
  worstCaseMicroUsd,
} from '../worker/spend.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * What a stopped build is charged (docs/decisions.md, "Resolved 2026-09-29
 * (later)", D65): what its finished model steps cost, plus the step that
 * was running at the most it could cost, and never more than was reserved.
 *
 * The real ledger, the real per-run record and the real model steps
 * (`buildInSteps`, over a scripted model), with a step runner that stops
 * where a terminated Workflow would: at a step boundary, or with a call in
 * flight that goes on to finish after the Stop has settled.
 */

const ALICE = 'user_alice00000000000000000001';
const RUN = 'run-stop-0000-4000-8000-000000000001';
const MONTH = '2026-09';
const DAY = '2026-09-29';
const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);
const MODEL = 'claude-opus-5-5';
const CEILING = runCeilingFor({ VIBLD_PROVIDER: 'anthropic' }, MODEL);
const WORST = worstCaseMicroUsd(
  CEILING.prices,
  CEILING.maxTokens,
  BOUNDED_BUILD_INPUT_CHARS,
);

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

type Bindings = ReturnType<typeof bindings>;

/** What `handlePlan` does: reserve, and record where, as a metered run. */
async function admit(b: Bindings, worst = WORST, metered = true) {
  const reserved = await reserveBudget(b.env, ALICE, worst, 10_000_000, 0, NOW);
  assert.ok(reserved.ok);
  b.progress.getByName(RUN).hold({
    reservationId: reserved.layers.user.id!,
    topup: false,
    accountReservationId: reserved.layers.account.id!,
    ...(metered ? { metered: true } : {}),
  });
  return reserved;
}

function params(reserved: Awaited<ReturnType<typeof admit>>): WorkflowParams {
  assert.ok(reserved.ok);
  return {
    projectId: ALICE,
    runId: RUN,
    prompt: 'A three-page site for a bakery.',
    model: MODEL,
    userId: ALICE,
    reservationId: reserved.layers.user.id!,
    reservationKey: ALICE,
    accountReservationId: reserved.layers.account.id!,
    worstCaseMicroUsd: WORST,
    prices: CEILING.prices,
    maxTokens: CEILING.maxTokens,
    maxInputChars: BOUNDED_BUILD_INPUT_CHARS,
  };
}

function site(): ScriptedBuild {
  return {
    summary: 'A three-page site for a bakery.',
    files: [
      ...REQUIRED_PROJECT_FILES.filter((path) => path !== 'src/App.tsx').map(
        (path) => ({ path, content: `// ${path}\n`, size: 'small' as const }),
      ),
      ...['Home', 'Menu', 'Visit'].map((name) => ({
        path: `src/pages/${name}Page.tsx`,
        content: `// ${name}\n${'x'.repeat(40_000)}`,
        size: 'large' as const,
      })),
      { path: 'src/App.tsx', content: '// app\n', size: 'medium' as const },
    ],
  };
}

/** Where a terminated Workflow stops: nothing past a step boundary runs. */
class Terminated extends Error {}

/**
 * A runner that runs steps as a Workflow does until it is told to stop,
 * after which every later step is refused at its boundary.
 */
function stoppable() {
  const names: string[] = [];
  let stopped = false;
  const step: StepRunner = async <T>(
    name: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (stopped) throw new Terminated(name);
    names.push(name);
    return run();
  };
  return {
    names,
    step,
    stop() {
      stopped = true;
    },
  };
}

/** The meter, forwarded to the run's record, with every write kept. */
function spied(channel: RunProgress) {
  const started = new Map<string, number>();
  const finished = new Map<string, number>();
  const meter: CallMeter = {
    callStarted(name, worst) {
      started.set(name, worst);
      channel.callStarted(name, worst);
    },
    callFinished(name, actual) {
      finished.set(name, actual);
      channel.callFinished(name, actual);
    },
  };
  return { meter, started, finished };
}

const sum = (values: Iterable<number>) =>
  [...values].reduce((total, value) => total + value, 0);

function charged(b: Bindings) {
  return {
    own: b.ledger.getByName(ALICE).usageFor(MONTH),
    account: b.ledger.getByName(ACCOUNT_BUDGET_KEY).usageFor(DAY),
  };
}

async function stop(b: Bindings) {
  return settleStopped(
    b.progress.getByName(RUN),
    b.ledger as never,
    ALICE,
    RUN,
  );
}

describe('what a stopped build is charged (D65)', () => {
  it('charges nothing for a build stopped before its first model step', async () => {
    const b = bindings();
    await admit(b);
    assert.equal(await stop(b), 0);
    const after = charged(b);
    assert.equal(after.own.spentMicroUsd, 0);
    assert.equal(after.own.inFlight, 0);
    assert.equal(after.account.spentMicroUsd, 0);
  });

  it('charges only the outline when it is stopped after the outline', async () => {
    const b = bindings();
    const run = params(await admit(b));
    const steps = stoppable();
    const spy = spied(b.progress.getByName(RUN));
    const client = createScriptedBuildClient(site());
    const going = buildInSteps(
      {
        client: {
          id: client.id,
          createPlan: async (request) => {
            const completion = await client.createPlan(request);
            // The outline has come back: Stop lands before the next step.
            steps.stop();
            return completion;
          },
        },
        store: () => ({ loadAccepted: async () => undefined }),
        meter: spy.meter,
      },
      run,
      steps.step,
    );
    await assert.rejects(going, Terminated);
    assert.deepEqual(steps.names, ['outline']);

    const outline = spy.finished.get('outline')!;
    assert.ok(outline > 0);
    assert.equal(await stop(b), outline);
    const after = charged(b);
    assert.equal(after.own.spentMicroUsd, outline);
    assert.equal(after.account.spentMicroUsd, outline);
    assert.equal(after.own.inFlight, 0);
    assert.equal(after.account.inFlight, 0);
    assert.ok(outline < WORST);
  });

  it('charges the finished steps and the one in flight at its worst case', async () => {
    const b = bindings();
    const run = params(await admit(b));
    const steps = stoppable();
    const spy = spied(b.progress.getByName(RUN));
    const scripted = createScriptedBuildClient(site());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inFlight!: () => void;
    const reached = new Promise<void>((resolve) => {
      inFlight = resolve;
    });
    const client: PlanClient = {
      id: scripted.id,
      async createPlan(request) {
        // The second group's call is the one Stop lands during.
        if (scripted.requests.length === 2) {
          inFlight();
          await held;
        }
        return scripted.createPlan(request);
      },
    };
    const going = buildInSteps(
      {
        client,
        store: () => ({ loadAccepted: async () => undefined }),
        meter: spy.meter,
      },
      run,
      steps.step,
    );
    await reached;
    steps.stop();
    const running = steps.names.at(-1)!;
    assert.ok(running.startsWith('write-'), running);

    const finished = sum(spy.finished.values());
    const worst = spy.started.get(running)!;
    const expected = Math.min(WORST, finished + worst);
    assert.equal(spy.finished.has(running), false);
    assert.equal(await stop(b), expected);
    assert.ok(expected > finished, 'the step in flight was not charged');

    // The call in flight finishes after the Stop, as a terminated
    // Workflow's does, and records what it cost: nothing is charged again.
    release();
    await assert.rejects(going, Terminated);
    assert.ok(spy.finished.has(running));
    assert.equal(charged(b).own.spentMicroUsd, expected);
    assert.equal(charged(b).account.spentMicroUsd, expected);
  });

  it('prices a step in flight at its ceilings, the way the reservation is priced', () => {
    const prices = CEILING.prices;
    assert.equal(
      callWorstCaseMicroUsd(prices, {
        maxTokens: 32_000,
        maxInputTokens: 50_000,
      }),
      worstCaseMicroUsd(prices, 32_000, 200_000),
    );
  });

  it('records, for a whole build, what the settle step would charge', async () => {
    const b = bindings();
    const run = params(await admit(b));
    const spy = spied(b.progress.getByName(RUN));
    const built = await buildInSteps(
      {
        client: createScriptedBuildClient(site()),
        store: () => ({ loadAccepted: async () => undefined }),
        meter: spy.meter,
      },
      run,
      (_name, go) => go(),
    );
    assert.ok(built.ok);
    assert.deepEqual([...spy.started.keys()], [...spy.finished.keys()]);
    const settled = microUsdOf(built.usage, run.prices);
    const recorded = b.progress.getByName(RUN).spentByCalls()!;
    // Each call is rounded up on its own, so the two may differ by at most
    // a micro-dollar a call.
    assert.ok(recorded >= settled && recorded - settled <= built.calls);
    // A Stop after the last model step charges that, not the reservation.
    assert.equal(await stop(b), recorded);
  });

  it('never charges more than was reserved', async () => {
    const b = bindings();
    // A small, fitted reservation, and a call in flight that could cost
    // more than all of it.
    const small = 400_000;
    await admit(b, small);
    const channel = b.progress.getByName(RUN);
    channel.callFinished('outline', 150_000);
    channel.callStarted('write-1', 3_000_000);
    assert.equal(await stop(b), small);
    const after = charged(b);
    assert.equal(after.own.spentMicroUsd, small);
    assert.equal(after.account.spentMicroUsd, small);
  });

  it('settles once, whoever asks and however often', async () => {
    const b = bindings();
    await admit(b);
    const channel = b.progress.getByName(RUN);
    channel.callFinished('outline', 120_000);

    const reclaims: number[] = [];
    for (const key of [ALICE, ACCOUNT_BUDGET_KEY]) {
      const ledger = b.ledger.getByName(key);
      const reclaim = ledger.reclaim.bind(ledger);
      ledger.reclaim = (id: number, atMost?: number) => {
        const done = reclaim(id, atMost);
        if (done !== undefined) reclaims.push(done);
        return done;
      };
    }
    assert.equal(await stop(b), 120_000);
    // A call that finishes after the Stop does not reopen it.
    channel.callFinished('write-1', 90_000);
    assert.equal(await stop(b), undefined);
    assert.deepEqual(reclaims, [120_000, 120_000]);
    assert.equal(charged(b).own.spentMicroUsd, 120_000);

    // The Workflow's settle step, if it runs after all, finds the Stop's
    // settlement and its figure, and settles nothing.
    assert.deepEqual(await stoppedFirst(channel), { charged: 120_000 });
  });

  it('leaves a run the settle step took first to the settle step', async () => {
    const b = bindings();
    const reserved = await admit(b);
    const run = params(reserved);
    b.progress.getByName(RUN).callFinished('outline', 120_000);
    assert.equal(await stoppedFirst(b.progress.getByName(RUN)), false);
    await settleBudget(
      b.ledger as never,
      run,
      {
        inputTokens: 1_000,
        outputTokens: 1_000,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      true,
    );
    const settled = charged(b).own.spentMicroUsd;
    assert.equal(await stop(b), undefined);
    assert.equal(charged(b).own.spentMicroUsd, settled);
  });

  it('charges the whole reservation when the record cannot be read', async () => {
    const b = bindings();
    await admit(b);
    const channel = b.progress.getByName(RUN);
    channel.callFinished('outline', 120_000);
    const unreadable = {
      claimSettlement: channel.claimSettlement.bind(channel),
      spentByCalls: () => {
        throw new Error('storage unavailable');
      },
      stopCharged: channel.stopCharged.bind(channel),
    };
    assert.equal(
      await settleStopped(unreadable, b.ledger as never, ALICE, RUN),
      WORST,
    );
    assert.equal(charged(b).own.spentMicroUsd, WORST);
    assert.equal(charged(b).account.spentMicroUsd, WORST);
  });

  it('charges the whole reservation for a run that never recorded its calls', async () => {
    const b = bindings();
    // A hold written before D65: nothing says the calls are recorded.
    await admit(b, WORST, false);
    assert.equal(b.progress.getByName(RUN).spentByCalls(), undefined);
    assert.equal(await stop(b), WORST);
    assert.equal(charged(b).account.spentMicroUsd, WORST);
  });
});
