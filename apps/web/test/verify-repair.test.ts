import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PartialSettlement,
  verifyAndRepair,
} from '../worker/generation-run.ts';
import { REBUILD_WAIT_ATTEMPTS } from '../worker/publish-client.ts';
import type {
  GenerationWorkflowEnv,
  WorkflowParams,
} from '../worker/generation-run.ts';
import type {
  DurableGenerationResult,
  GenerationStageRecord,
  GenerationStore,
  ModelProvider,
  ProjectSnapshot,
} from '@vibld/core';
import { OUT_OF_TIME } from '@vibld/core';
import { renderDesignMd } from '@vibld/ai';

/**
 * Building what a run produced, and buying one repair when it will not
 * build (internal issue 194).
 *
 * The ordering this depends on is not visible from here and is the reason
 * the step sits where it does: `UserBudget.reserve` reclaims every
 * unsettled reservation older than RUN_ABANDONED_AFTER_MS before doing
 * anything else, charging each at its full worst case. This function
 * reserves against the same caller's ledger, so running it before the run's
 * own settlement would have let a long run's repair reclaim the run's
 * reservation and bill a worst case nobody spent.
 */

const ACCEPTED: DurableGenerationResult = {
  state: 'accepted',
  stop: 'ok',
  accepted: {
    revision: 'rev-1',
    files: [{ path: 'src/App.tsx', content: 'export const App = () => null;' }],
  },
  errors: [],
  conflict: false,
} as unknown as DurableGenerationResult;

const PARAMS = {
  projectId: 'proj_1',
  runId: 'run_1',
  prompt: 'a landing page',
  userId: 'user_1',
  model: 'deepseek-flash',
  worstCaseMicroUsd: 1_610_000,
  prices: { inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 1 },
  maxTokens: 64_000,
  monthlyAllowance: 5_000_000,
  topupCeiling: 0,
} as unknown as WorkflowParams;

const ENV = {
  PREVIEW: { fetch: async () => new Response('{}') },
  PREVIEW_INTERNAL_SECRET: 'shh',
  USER_BUDGET: {} as GenerationWorkflowEnv['USER_BUDGET'],
} as unknown as GenerationWorkflowEnv;

interface Spy {
  builds: number;
  reserves: number;
  settles: {
    usage: unknown;
    providerRan: boolean | undefined;
    /** What each layer was told to settle at, where they differ. */
    split?: { account: number | undefined; caller: number | undefined };
  }[];
  generates: {
    runId: string;
    prompt: string;
    baseRevision?: string;
    model: string;
    maxTokens: number;
  }[];
  /** How far the fake clock has been moved, in milliseconds. */
  elapsed: number;
}

function deps(
  build: { ok: boolean; error?: string; reason?: string },
  options: {
    reserveOk?: boolean;
    generateThrows?: boolean;
    /** A refusal `runGeneration` makes before calling anybody. */
    preflightRefusal?: boolean;
    accepted?: boolean;
    /** What the build after the repair answers. Defaults to the first. */
    rebuild?: { ok: boolean; error?: string; reason?: string };
    /**
     * How many of the builds after the repair answer `busy` before the one
     * above is given. A previous build's container teardown holds the
     * workspace lock until its container is gone, and since it moved off
     * that build's own clock it can still be holding it here.
     */
    busyRebuilds?: number;
    /** Which call throws, counting from one. */
    buildThrowsOn?: number;
    /**
     * How long each build takes on the fake clock.
     *
     * Zero by default, because every other test here wants a clock that
     * does not move: a loop bounded only by `Date.now()` does not
     * terminate when it does not move, and these fakes deliberately prove
     * the attempt counter on its own.
     */
    buildTakesMs?: number;
    /** The model call never answers, so its deadline gives up on it. */
    generateStalls?: boolean;
    /** The build service never answers, as against rejecting. */
    buildStallsOn?: number;
    /** The reservation could not be asked for at all, as against refused. */
    reserveThrows?: boolean;
    /** The ledger never answers the reservation, as against rejecting. */
    reserveStalls?: boolean;
    /** How many settlement attempts reject before one is allowed through. */
    settleRejects?: number;
    /**
     * Reject as `settleBudget` does when only the shared account layer is
     * left open: the caller's own hold closed, at this figure.
     */
    settleAccountOnly?: number;
    /**
     * That, but only on the first attempt: every later one fails before
     * reaching the caller's ledger at all, so it knows nothing.
     */
    settleAccountOnlyFirst?: number;
    /** What a settlement that succeeds says the repair cost. */
    settleCost?: number;
    /** What the repair produces, when not ACCEPTED. */
    repairResult?: DurableGenerationResult;
  } = {},
) {
  const spy: Spy = {
    builds: 0,
    reserves: 0,
    settles: [],
    generates: [],
    elapsed: 0,
  };
  const started = Date.UTC(2026, 8, 19, 5, 0, 0);
  return {
    spy,
    deps: {
      build: (async () => {
        spy.builds += 1;
        spy.elapsed += options.buildTakesMs ?? 0;
        if (spy.builds === options.buildThrowsOn) {
          throw new Error('the preview service is gone');
        }
        if (spy.builds === options.buildStallsOn) {
          // What `withinDeadline` does to a call that never answers. The
          // real bound is thirteen minutes, so the fake throws what the
          // deadline throws rather than making the test wait for one.
          throw new Error(OUT_OF_TIME);
        }
        if (spy.builds === 1) return build;
        if (spy.builds - 1 <= (options.busyRebuilds ?? 0)) {
          return {
            ok: false,
            reason: 'busy',
            error: 'Another build is already running for this project.',
          };
        }
        return options.rebuild ?? build;
      }) as never,
      reserve: (async () => {
        spy.reserves += 1;
        if (options.reserveStalls) {
          // What `withinDeadline` does to a ledger that never answers.
          throw new Error(OUT_OF_TIME);
        }
        if (options.reserveThrows) {
          throw new Error('the budget object is unreachable');
        }
        return options.reserveOk === false
          ? { ok: false, verdict: { allow: false, reason: 'period-ceiling' } }
          : {
              ok: true,
              layers: {
                account: { verdict: { allow: true }, id: 7, spentMicroUsd: 0 },
                user: { verdict: { allow: true }, id: 9, spentMicroUsd: 0 },
                userReservationKey: 'user_1',
              },
            };
      }) as never,
      settle: (async (
        _ledger: unknown,
        _params: unknown,
        usage: unknown,
        providerRan: boolean | undefined,
        accountMicroUsd?: number,
        callerMicroUsd?: number,
      ) => {
        spy.settles.push({
          usage,
          providerRan,
          ...(accountMicroUsd === undefined && callerMicroUsd === undefined
            ? {}
            : { split: { account: accountMicroUsd, caller: callerMicroUsd } }),
        });
        if (options.settleAccountOnly !== undefined) {
          throw new PartialSettlement(
            options.settleAccountOnly,
            new Error('the account object is unreachable'),
          );
        }
        if (options.settleAccountOnlyFirst !== undefined) {
          if (spy.settles.length === 1) {
            throw new PartialSettlement(
              options.settleAccountOnlyFirst,
              new Error('the account object is unreachable'),
            );
          }
          throw new Error('the user ledger is unreachable too now');
        }
        if (spy.settles.length <= (options.settleRejects ?? 0)) {
          throw new Error('the budget object is unreachable');
        }
        return options.settleCost ?? 0;
      }) as never,
      generate: (async (
        _provider: unknown,
        request: {
          runId: string;
          prompt: string;
          baseRevision?: string;
          model: string;
          maxTokens: number;
        },
      ) => {
        spy.generates.push(request);
        if (options.generateStalls) {
          // What `withinDeadline` does to a call that never returns. The
          // real bound is thirty minutes, so the fake throws what the
          // deadline throws rather than making the test wait for one.
          throw new Error(OUT_OF_TIME);
        }
        if (options.generateThrows) throw new Error('provider exploded');
        if (options.preflightRefusal) {
          return {
            result: {
              state: 'failed',
              stop: 'conflict',
              errors: [],
              conflict: true,
            },
            outcome: 'failed',
            providerRan: false,
          };
        }
        return {
          result:
            options.accepted === false
              ? {
                  state: 'failed',
                  stop: 'provider',
                  errors: [],
                  conflict: false,
                }
              : (options.repairResult ?? ACCEPTED),
          outcome: 'ok',
          providerRan: true,
        };
      }) as never,
      providerFor: (() => ({}) as never) as never,
      now: () => started + spy.elapsed,
      // So the settlement retries do not spend their real delay here. The
      // wait is charged to the fake clock rather than to the test, because
      // the rebuild's budget pays for the waiting as well as the building.
      wait: async (ms: number) => {
        if (options.buildTakesMs) spy.elapsed += ms;
      },
    },
  };
}

describe('building what a run produced', () => {
  it('reports a clean build and asks for nothing more', async () => {
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: true });
    assert.equal(spy.reserves, 0, 'a passing build reserved money');
    assert.equal(spy.generates.length, 0);
  });

  it('builds nothing when the run produced nothing', async () => {
    // A refused or failed run has no files. Reporting `built: false` would
    // say a project failed a check that never ran.
    const { spy, deps: d } = deps({ ok: true });
    const failed = { state: 'failed', stop: 'refusal' } as never;
    assert.deepEqual(await verifyAndRepair(ENV, PARAMS, failed, d), {});
    assert.equal(spy.builds, 0);
  });

  it('builds nothing when the build service is not wired up', async () => {
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(
      { ...ENV, PREVIEW: undefined } as GenerationWorkflowEnv,
      PARAMS,
      ACCEPTED,
      d,
    );
    assert.deepEqual(outcome, { skipped: 'not-configured' });
    assert.equal(spy.builds, 0);
  });
});

describe('buying one repair', () => {
  it('asks the model again, under its own run id and base', async () => {
    // Its own id because `promote` and `saveStage` are both keyed on it:
    // reusing the run's would overwrite the record of the very attempt
    // this one is repairing.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'src/App.tsx(3,10): error TS1484' },
      // The happy path: the repair compiles. `repaired` comes from this
      // second build and not from the model having answered.
      { rebuild: { ok: true } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.built, false);
    assert.equal(outcome.repaired, true);
    assert.equal(spy.generates.length, 1);
    assert.equal(spy.generates[0]!.runId, 'run_1:repair');
    assert.equal(spy.generates[0]!.baseRevision, 'rev-1');
    // The repair is a follow-up like any other, so it carries the run's own
    // model and ceiling. Without them it would be held to whatever a
    // default said, and the truncation it reports would be measured against
    // a ceiling no run actually had.
    assert.equal(spy.generates[0]!.model, PARAMS.model);
    assert.equal(spy.generates[0]!.maxTokens, PARAMS.maxTokens);
    assert.ok(
      spy.generates[0]!.prompt.includes('src/App.tsx(3,10): error TS1484'),
      'the compiler output did not reach the model',
    );
  });

  it('says when it moves from checking the project to repairing it', async () => {
    const phases: string[] = [];
    const clean = deps({ ok: true });
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, {
      ...clean.deps,
      onPhase: (phase) => {
        phases.push(phase);
      },
    });
    assert.deepEqual(phases, ['validating']);

    phases.length = 0;
    const broken = deps(
      { ok: false, reason: 'build', error: 'src/App.tsx(3,10): error TS1484' },
      { rebuild: { ok: true } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, {
      ...broken.deps,
      onPhase: (phase) => {
        phases.push(phase);
        // Never a reason to fail the step.
        if (phase === 'repairing') throw new Error('channel gone');
      },
    });
    assert.deepEqual(phases, ['validating', 'repairing']);
    assert.equal(outcome.repaired, true);
  });

  it('holds a reservation before it spends, and settles it after', async () => {
    const { spy, deps: d } = deps(
      { ok: false, reason: 'install', error: 'npm install failed' },
      { rebuild: { ok: true } },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.reserves, 1);
    assert.equal(spy.settles.length, 1, 'the repair hold was left open');
  });

  it('settles its hold even when the model call throws', async () => {
    // The one outcome that costs the caller their worst case rather than
    // what they spent: a hold this function makes and does not close is
    // charged in full by the reclaim thirty-five minutes later.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { generateThrows: true },
    );
    await assert.rejects(() => verifyAndRepair(ENV, PARAMS, ACCEPTED, d));
    assert.equal(spy.settles.length, 1, 'the hold was left open on a throw');
    assert.equal(
      spy.settles[0]!.providerRan,
      true,
      'a throw after the model was asked must not settle at nothing',
    );
  });

  it('spends nothing when the caller has no budget left', async () => {
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { reserveOk: false },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, skipped: 'no-budget' });
    assert.equal(spy.generates.length, 0, 'the model was asked without a hold');
    assert.equal(spy.settles.length, 0, 'a refused reservation was settled');
  });

  it('spends nothing on a sandbox that was merely busy', async () => {
    // And claims nothing either. A refusal issued before any work happened
    // is not a project that failed to build, so `built` is absent rather
    // than false: the same rule as an unreachable build service, one line
    // up. Saying false would put "this project does not build" in the log
    // for a project nothing ever compiled.
    const { spy, deps: d } = deps({
      ok: false,
      reason: 'busy',
      error: 'Another build is already running for this project.',
    });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { skipped: 'not-the-project' });
    assert.equal(spy.reserves, 0);
    assert.equal(spy.generates.length, 0);
  });

  it('says so when the repair itself did not produce a project', async () => {
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { accepted: false },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.built, false);
    assert.equal(outcome.repaired, false);
    // Asserted field by field rather than with `deepEqual`: its type
    // parameter is inferred from the expected literal, which narrows
    // `outcome` to that shape and makes reading `result` a compile error
    // even though the value is there.
    assert.equal(
      outcome.result,
      undefined,
      'a failed repair replaced a project that at least existed',
    );
  });

  it('builds the repaired project rather than believing the model', async () => {
    // internal PR 196 review, P1. Acceptance is the structural validator saying the
    // files are well formed and inside the project root. It says nothing
    // about whether they compile, and compiling is the entire question:
    // this feature exists because output that passes every structural
    // check still fails `npm run build`.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: false, reason: 'build', error: 'TS1484 again' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.builds, 2, 'the repaired files were never built');
    assert.equal(
      outcome.repaired,
      false,
      'a repair that still does not build was reported as fixed',
    );
    assert.ok(outcome.result, 'the promoted revision was not handed back');
  });

  it('says it does not know when the second build cannot run', async () => {
    // A repair whose result is unknown is not a repair that failed, and it
    // is certainly not one that worked.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { buildThrowsOn: 2 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.repaired, undefined);
    assert.ok(outcome.result, 'the promoted revision was thrown away');
  });

  it('keeps the project when the build service is unreachable', async () => {
    // internal PR 196 review, P2. The project has already been accepted, promoted and
    // billed. Letting the binding's rejection out of here fails the whole
    // Workflow, so the caller is sent an error instead of the files they
    // paid for, and preview-service availability quietly becomes a hard
    // dependency of every generation.
    const { spy, deps: d } = deps({ ok: true }, { buildThrowsOn: 1 });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { skipped: 'unavailable' });
    assert.equal(spy.reserves, 0, 'an unreachable service bought a repair');
    assert.equal(spy.generates.length, 0);
  });

  it('hands back the repaired project, not the one that would not build', async () => {
    // The bug this exists to stop, found by re-reading the diff rather
    // than by a test failing. The repair promotes its own accepted
    // revision into the store; returning the first attempt would show the
    // reader the broken files while the store held the fixed ones, and the
    // two would disagree with nothing to say which was right.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'src/App.tsx(3,10): error TS1484' },
      { rebuild: { ok: true } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.ok(outcome.result, 'the repaired project was thrown away');
    assert.equal(outcome.result.state, 'accepted');
  });
});

describe('what the repair is charged for', () => {
  it('settles a refusal that never reached the model at nothing', async () => {
    // internal PR 196 review, P1. `runGeneration` returns normally with
    // `providerRan: false` for the refusals it makes before calling
    // anybody: a base over MAX_BASE_CONTENT_CHARS, or a base revision that
    // moved. Both are reachable here -- the repair carries the whole
    // accepted project as its base, and another run can promote between
    // the first build and this call. Settling those at the worst case
    // bills somebody a full generation for being told no.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { preflightRefusal: true },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles.length, 1);
    assert.equal(
      spy.settles[0]!.providerRan,
      false,
      'a repair the model never saw was charged its worst case',
    );
  });

  it('still settles the cautious way when the call threw', async () => {
    // No outcome to read, so nothing says the model was not reached. The
    // cautious direction is the expensive one on purpose: over-counting a
    // call that may have gone out beats under-counting one that did.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { generateThrows: true },
    );
    await assert.rejects(() => verifyAndRepair(ENV, PARAMS, ACCEPTED, d));
    assert.equal(spy.settles[0]!.providerRan, true);
  });

  it('charges a repair that did reach the model', async () => {
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true } },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles[0]!.providerRan, true);
  });
});

describe('which ledger layer was left open', () => {
  it('records what the caller was billed when only the account hold is open', async () => {
    // internal PR 196 review, P2. `settleBudget` writes the caller's layer before the
    // account's, so the two fail apart. A caller whose own hold closed at
    // the figure their usage came to has been billed correctly and is done;
    // only the shared daily ceiling is still holding a worst case. Recording
    // the worst case for both overstates a bill that is already right, on
    // the record the reader is shown.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleAccountOnly: 6_400 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.repairCostMicroUsd, 6_400);
    assert.notEqual(
      outcome.repairCostMicroUsd,
      PARAMS.worstCaseMicroUsd,
      'a caller already billed correctly was recorded at the worst case',
    );
    assert.equal(outcome.trace?.costMicroUsd, 6_400);
  });

  it('keeps what an earlier attempt established when a later one knows less', async () => {
    // internal PR 196 review, P2. `retrying` reports the last failure, and the
    // informative one need not be last: a first attempt that closed the
    // caller's layer and failed on the account's knows exactly what they
    // were charged, while a second that cannot reach the caller's ledger at
    // all knows nothing. Reading only the final error threw away the figure
    // the first attempt had already established, and fell back to the worst
    // case for a caller who had been billed correctly minutes earlier.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleAccountOnlyFirst: 7_700 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.ok(spy.settles.length > 1, 'the settlement was not retried');
    assert.equal(
      outcome.repairCostMicroUsd,
      7_700,
      'a later, less informed failure erased what the first attempt knew',
    );
    assert.equal(outcome.settled, false);
  });

  it('still says the settlement did not finish', async () => {
    // The caller's figure being known does not mean the ledger is closed.
    // The account hold is real money against a shared ceiling, and the log
    // line is the only place anybody learns it is still open.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleAccountOnly: 6_400 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.settled, false);
  });

  it("falls back to the worst case when the caller's own hold is open", async () => {
    // Nothing is known about what they were charged, and the reclaim will
    // take the worst case, so that is the honest figure.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleRejects: 99 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.repairCostMicroUsd, PARAMS.worstCaseMicroUsd);
    assert.equal(outcome.settled, false);
  });
});

describe('what the second build is allowed to claim', () => {
  it('says nothing when the rebuild was a refusal, not a judgement', async () => {
    // internal PR 196 review, P2. Another build can take the workspace lock between
    // the model call and this one, and `busy` says as little about the
    // repaired files as it did about the originals. `built` already
    // answered "unknown" there; `repaired` answered false, which claims a
    // repair failed a check nothing performed.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { busyRebuilds: Number.MAX_SAFE_INTEGER },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(
      spy.builds,
      2 + REBUILD_WAIT_ATTEMPTS,
      'the rebuild gave up on a busy workspace at a different count',
    );
    assert.equal(
      outcome.repaired,
      undefined,
      'a rebuild that never judged the project reported it as failed',
    );
    assert.equal(
      outcome.unverified,
      'busy',
      'a repair nobody could build says nothing about why',
    );
    assert.ok(outcome.result, 'the promoted revision was thrown away');
  });

  it('waits out a workspace the previous build is still tearing down', async () => {
    // internal PR 196 review. The teardown holds the lock until its container is gone
    // and no longer holds up the build it belongs to, so it overlaps the
    // repair's model call. Refusing there costs the caller the one thing
    // they just paid for: finding out whether the repair builds. Ordinarily
    // the teardown is one `destroy()` and is long finished, which is why
    // this waits rather than treating the refusal as an answer.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { busyRebuilds: 2, rebuild: { ok: true } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.builds, 4, 'the rebuild did not ask again');
    assert.equal(
      outcome.repaired,
      true,
      'a repair that builds was reported as unverified',
    );
    assert.equal(outcome.unverified, undefined);
  });

  it('stops asking when the budget for asking is spent', async () => {
    // internal PR 196 review, and the fourth instance of this pull request's own
    // shape: a bound per call is not a bound on a sequence of calls. Six
    // retries of a thirteen-minute build is ninety-one minutes, not the
    // one build and thirty seconds of waiting the allowance above was
    // sized for, and a near-limit first build plus a near-limit model call
    // plus one near-limit retry already came to about fifty-six minutes
    // against a step funded for sixty.
    //
    // A build that eats six minutes of the clock each time, against a
    // budget of one build plus the waiting. The attempt counter would
    // allow six retries; the budget stops it well before that, and the
    // count is what says which of the two did the stopping.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { busyRebuilds: Number.MAX_SAFE_INTEGER, buildTakesMs: 6 * 60_000 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    const rebuilds = spy.builds - 1;
    assert.ok(
      rebuilds < 1 + REBUILD_WAIT_ATTEMPTS,
      `the sequence ran its full ${REBUILD_WAIT_ATTEMPTS} retries regardless of the clock`,
    );
    // How much of the budget one call may take is `askWhileBusy`'s own
    // test, where the fake can see the cap it is given; this fake cannot,
    // so what it shows is that the clock ends the sequence at all.
    //
    // The `busy` in hand is still the answer. Giving up on the clock is
    // not a different verdict from giving up on the count.
    assert.equal(outcome.unverified, 'busy');
    assert.ok(outcome.result, 'the promoted revision was thrown away');
  });

  it('still asks again while there is budget to ask with', async () => {
    // The other direction, so the bound above cannot be satisfied by never
    // retrying at all. A build that costs a second leaves the whole budget
    // intact, and the attempt counter is what ends it.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { busyRebuilds: Number.MAX_SAFE_INTEGER, buildTakesMs: 1_000 },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(
      spy.builds,
      2 + REBUILD_WAIT_ATTEMPTS,
      'a rebuild with its budget intact stopped early',
    );
  });

  it('does not wait out a refusal about this build rather than the last', async () => {
    // Only `busy` is somebody else holding the workspace. `sandbox` is this
    // build's own container, and asking again spends the caller's clock on
    // an answer that will not change.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: false, reason: 'sandbox', error: 'container gone' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.builds, 2, 'a refusal that will not change was retried');
    assert.equal(outcome.repaired, undefined);
    assert.equal(outcome.unverified, 'sandbox');
  });

  it('gives the model call a bound of its own', async () => {
    // internal PR 196 review, and a source read because the bound is thirty minutes
    // and no test is going to wait for it. What can be checked here is
    // that the call goes through one: `repair-timeout.test.ts` holds the
    // arithmetic that makes the number the right one.
    const source = await workflowSource('generation-run.ts');
    const at = source.indexOf('outcome = await');
    assert.ok(at > 0, 'the repair no longer calls the model here');
    assert.match(
      source.slice(at, at + 200),
      /withinDeadline\(/,
      'a stalled provider holds the repair reservation past the reclaim',
    );
    assert.match(
      source.slice(at, source.indexOf('} finally {', at)),
      /RUN_STEP_TIMEOUT_MS,/,
      'the model call is bounded by something other than the run step',
    );
  });

  it('still says false when the rebuild did judge the project', async () => {
    // The distinction has to cut both ways or it is just a way of never
    // reporting a failure.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: false, reason: 'build', error: 'TS1484 again' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.repaired, false);
  });
});

describe('a ledger that never answers', () => {
  it('reads as unavailable when the reservation stays pending', async () => {
    // internal PR 196 review. A ledger that rejects is caught; one that never answers
    // is not, because a pending promise reaches no catch. The step then
    // runs out and fails a Workflow whose project was already accepted,
    // promoted, settled and billed.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { reserveStalls: true },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, skipped: 'unavailable' });
    assert.equal(spy.generates.length, 0, 'a repair went out unfunded');
  });

  it('bounds the reservation and every settlement attempt', async () => {
    // The behavioural half above cannot see the bound: the fake throws
    // what the deadline throws, so it proves the catch and nothing about
    // whether a deadline exists. Twice now a fake that produced the
    // symptom has tested the handler rather than the mechanism, so the
    // wiring gets its own assertion, and `repair-timeout.test.ts` holds
    // the arithmetic that makes the number the right one.
    const source = await workflowSource('generation-run.ts');
    for (const call of ['deps.reserve(', 'deps.settle(']) {
      const at = source.indexOf(call);
      assert.ok(at > 0, `${call} is no longer where this expected it`);
      assert.match(
        source.slice(Math.max(0, at - 200), at),
        /withinDeadline\(\s*$/,
        `${call} can stay pending until the step dies`,
      );
    }
    // The third is the heartbeat each model step sends (`touchReservation`),
    // which waits on the same ledger and so is held to the same bound.
    const touch = source.indexOf('.touch(id)');
    assert.ok(touch > 0, 'the heartbeat is no longer where this expected it');
    assert.match(
      source.slice(Math.max(0, touch - 200), touch),
      /withinDeadline\(\s*Promise\.resolve\(ledger\.getByName\(key\)$/,
      'a heartbeat can stay pending until the step dies',
    );
    assert.equal(
      source.match(/LEDGER_CALL_TIMEOUT_MS,/g)?.length,
      3,
      'one of the three ledger calls is bounded by something else',
    );
  });
});

describe('a build service that never answers', () => {
  it('reads as unavailable, exactly like one that rejects', async () => {
    // internal PR 196 review. The catch was the right answer to the wrong half: a
    // call that rejects reaches it, a call that stays pending does not.
    // The enclosing step then times out and fails a run that was already
    // accepted, promoted, settled and billed, over a build nobody asked
    // for.
    const { spy, deps: d } = deps({ ok: true }, { buildStallsOn: 1 });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { skipped: 'unavailable' });
    assert.equal(spy.reserves, 0, 'a stalled build service bought a repair');
  });

  it('gives every build call a bound of its own', async () => {
    // The half the fake above cannot reach. It throws what the deadline
    // throws, so it proves the catch maps that to `unavailable` and says
    // nothing about whether a bound exists: a mutation that removed
    // `withinDeadline` entirely passed it.
    //
    // That bound is now `buildWithin`, which `rebuild-budget.test.ts`
    // calls with a promise that really never settles. What is left here is
    // the wiring: that this step's build goes through it, and hands on the
    // budget it was given rather than starting a fresh one. Two lines of
    // source, because the call closes over a service binding and there is
    // nothing else to read them from.
    const source = await workflowSource('generation-run.ts');
    const at = source.indexOf('const build = (');
    assert.ok(at > 0, 'the build wrapper is no longer where this expected it');
    // One match over both, rather than a region whose end has to be
    // guessed at: the call and the argument it is given are the property,
    // and every version of this test that sliced on a nearby landmark
    // broke when the code around it moved.
    assert.match(
      source.slice(at),
      /buildWithin\([\s\S]{0,400}?\n\s+within,/,
      'the build is not bounded by what is left of the sequence budget',
    );
  });

  it('claims nothing about the project when the rebuild stalls', async () => {
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { buildStallsOn: 2 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.repaired, undefined);
    assert.equal(outcome.unverified, 'unavailable');
    assert.ok(outcome.result, 'the promoted repair was thrown away');
  });
});

describe('a repair whose model call never answered', () => {
  it('keeps the run rather than failing it', async () => {
    // internal PR 196 review. The step has no retries and `handlePlan` reports an
    // errored workflow as a failed generation, so letting the deadline
    // escape would discard the response for a project already accepted,
    // promoted, settled and billed. The repair is an extra this service
    // attempts on the caller's behalf; it may not cost them the run.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { generateStalls: true },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(outcome.skipped, 'timed-out');
    assert.equal(outcome.built, false, 'the first build did run and did fail');
    assert.equal(
      outcome.result,
      undefined,
      'a repair that never answered handed back a project of its own',
    );
  });

  it('charges the caller nothing and the deployment the worst case', async () => {
    // The split `accountMicroUsd` exists for: the caller pays for the
    // attempt they got, the account ceiling holds the attempt that was
    // made. A repair nobody answered is one the caller never received, and
    // it is something this service chose to attempt for them; the model
    // was still asked, so the deployment may well have spent it.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { generateStalls: true },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles.length, 1, 'the repair hold was left open');
    assert.deepEqual(
      spy.settles[0]?.split,
      { account: PARAMS.worstCaseMicroUsd, caller: 0 },
      'the caller was billed for a repair that never arrived',
    );
  });

  it('still settles the hold rather than leaving it for the reclaim', async () => {
    // Leaving it open is the one outcome that costs the caller their worst
    // case: `UserBudget.reserve` reclaims and charges it in full.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { generateStalls: true },
    );
    await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles.length, 1);
  });
});

async function workflowSource(
  file = 'generation-workflow.ts',
): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  return readFile(join(import.meta.dirname, '..', 'worker', file), 'utf8');
}

describe('settling the repair, and what it costs to fail at it', () => {
  it('keeps the project when the ledger cannot be asked for a hold', async () => {
    // internal PR 196 review, P2. `reserve` rejects, rather than denying, when the
    // budget Durable Object is unreachable. The project has already been
    // accepted, promoted and settled by then, so letting that rejection
    // out of a step with no retries sends the caller an error instead of
    // the files they paid for. A ledger that could not be asked has not
    // said no; it has said nothing.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { reserveThrows: true },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, skipped: 'unavailable' });
    assert.equal(spy.generates.length, 0, 'the model was asked without a hold');
    assert.equal(spy.settles.length, 0, 'a hold that was never taken settled');
  });

  it('retries a settlement that rejects rather than losing the repair', async () => {
    // internal PR 196 review, P1. A Durable Object that blinks is over in seconds,
    // and the enclosing step has no retries of its own -- so a bare await
    // here put the ledger's transient failure in front of a repair that
    // had already been promoted.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleRejects: 1, settleCost: 4_200 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles.length, 2, 'the settlement was not retried');
    assert.equal(outcome.repaired, true);
    assert.equal(
      outcome.settled,
      undefined,
      'a settled hold was reported open',
    );
    assert.equal(outcome.repairCostMicroUsd, 4_200);
  });

  it('hands back the repair even when nothing can settle its hold', async () => {
    // Throwing does not close the hold either, so it would have cost the
    // caller both the files and the money. Recorded as unsettled instead,
    // and priced at what the reclaim will actually charge.
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleRejects: 99 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.equal(spy.settles.length, 3, 'the settlement gave up too early');
    assert.equal(outcome.repaired, true, 'the repair was lost with the hold');
    assert.equal(outcome.settled, false);
    assert.equal(
      outcome.repairCostMicroUsd,
      PARAMS.worstCaseMicroUsd,
      'an unsettled hold is reclaimed at its worst case, and must be recorded at it',
    );
  });

  it('records the repair as its own run, with its own tokens', async () => {
    // internal PR 196 review, P2. The repair is settled against the same ledger, so a
    // record that counts only the first call reports a lower cost than
    // billing charged. Its own row rather than a larger number on the
    // run's: the repair has its own tokens, and one row cannot honestly
    // carry two calls' cost against one call's counts.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS1484' },
      { rebuild: { ok: true }, settleCost: 9_100 },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.ok(outcome.trace, 'the repair was charged for and never recorded');
    assert.equal(outcome.trace.runId, 'run_1:repair');
    assert.equal(outcome.trace.projectId, 'proj_1');
    assert.equal(outcome.trace.costMicroUsd, 9_100);
  });

  it('records nothing for a repair whose model call never returned', async () => {
    // There is no stop, no usage and no result to describe. A row of zeroes
    // would read as a run that cost nothing rather than one that is not
    // known to have happened.
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { generateThrows: true },
    );
    await assert.rejects(() => verifyAndRepair(ENV, PARAMS, ACCEPTED, d));
  });
});

/**
 * That the Workflow hands the repaired project back to the caller.
 *
 * `generation-workflow.ts` imports `cloudflare:workers` and cannot be
 * loaded under `node --test`, so its one line is read as source. The line
 * matters more than most: `verifyAndRepair` can return the repaired project
 * perfectly well and the Workflow can still return the broken one, and
 * nothing above would notice, because the store would hold the fixed files
 * either way.
 */
describe('what the run finally answers with', () => {
  it('prefers the repaired project over the attempt that failed', async () => {
    const source = await workflowSource();
    assert.match(
      source,
      /const final = repair\.result \?\? generation\.result;/,
      'the Workflow returns the first attempt, so a repaired run shows the reader the broken files',
    );
    // Both ways out return it: as it is, or with what its check found
    // (D69).
    assert.match(source, /if \(!checking\) return final;/);
    assert.match(source, /return \{ \.\.\.final, check \};/);
  });

  it('keeps the whole project out of the log line', async () => {
    // internal PR 196 review, P1. `RepairOutcome.result` carries every generated file.
    // Spreading the outcome into `generation.verified` wrote a tenant's own
    // project, and whatever knowledge was incorporated into it, into the
    // Worker log on each successful repair -- outside every access and
    // retention boundary the storage path has.
    const source = await workflowSource();
    const log = source.slice(
      source.indexOf("event: 'generation.verified'"),
      source.indexOf("await step.do(\n      'record-trace'"),
    );
    assert.ok(log.length > 0, 'the verified log line moved');
    assert.doesNotMatch(
      log,
      /\.\.\.repair\b/,
      'the whole repair outcome, project files and all, is spread into the log',
    );
    assert.doesNotMatch(log, /\brepair\.result\b/);
  });

  it('records the repair against the run it repaired', async () => {
    const source = await workflowSource();
    assert.match(
      source,
      /if \(repair\.trace\) await store\.saveTrace\(repair\.trace\);/,
      'the repair was billed for and never written to the run record',
    );
  });
});

/**
 * A project that builds and still is not the page its spec describes.
 *
 * `checkDesign` reads the finished files against the spec in DESIGN.md and
 * the rules every page must hold. Only its errors (what it is sure of) buy
 * a repair of a project that builds; warnings travel with a repair that is
 * happening anyway.
 */
describe('a project that builds but fails its own checks', () => {
  /** Builds fine, and has no lang and no viewport: two sure errors. */
  const UNCHECKED: DurableGenerationResult = {
    ...ACCEPTED,
    accepted: {
      revision: 'rev-1',
      files: [
        {
          path: 'index.html',
          content: '<!doctype html><html><head></head><body></body></html>',
        },
        { path: 'src/App.tsx', content: 'export const App = () => null;' },
      ],
    },
  } as unknown as DurableGenerationResult;

  it('buys one repair, and tells the model exactly what failed', async () => {
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(ENV, PARAMS, UNCHECKED, d);
    assert.equal(outcome.built, true);
    assert.equal(outcome.designErrors, 2);
    assert.equal(spy.reserves, 1);
    assert.equal(spy.generates.length, 1);
    const prompt = spy.generates[0]!.prompt;
    assert.match(prompt, /builds, but it does not match its own spec/);
    assert.match(prompt, /\[lang\]/);
    assert.match(prompt, /\[viewport\]/);
    assert.doesNotMatch(prompt, /does not build\. This is the exact output/);
    // The repaired project is checked the same way; the fake repair here
    // returns ACCEPTED, which has neither error.
    assert.equal(outcome.designErrorsAfter, 0);
    assert.equal(outcome.repaired, true);
  });

  it('buys nothing for warnings alone', async () => {
    const warnedOnly = {
      ...ACCEPTED,
      accepted: {
        revision: 'rev-1',
        files: [
          {
            path: 'src/App.tsx',
            content: 'export const App = () => <input placeholder="Email" />;',
          },
        ],
      },
    } as unknown as DurableGenerationResult;
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(ENV, PARAMS, warnedOnly, d);
    assert.deepEqual(outcome, { built: true, designWarnings: 1 });
    assert.equal(spy.reserves, 0);
    assert.equal(spy.generates.length, 0);
  });

  it('spends nothing when the caller cannot pay, and says so', async () => {
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(
      ENV,
      { ...PARAMS, monthlyAllowance: undefined } as unknown as WorkflowParams,
      UNCHECKED,
      d,
    );
    assert.deepEqual(outcome, {
      built: true,
      designErrors: 2,
      skipped: 'no-budget',
    });
    assert.equal(spy.reserves, 0);
  });

  it('tells a repair bought by a failed build about the failed checks too', async () => {
    const { spy, deps: d } = deps(
      { ok: false, reason: 'build', error: 'src/App.tsx(1,1): error TS2304' },
      { rebuild: { ok: true } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, UNCHECKED, d);
    assert.equal(outcome.built, false);
    assert.equal(outcome.designErrors, 2);
    const prompt = spy.generates[0]!.prompt;
    assert.match(prompt, /error TS2304/);
    assert.match(prompt, /It also does not match its own spec/);
    assert.match(prompt, /\[lang\]/);
  });

  it('keeps the project it built when the repair is refused', async () => {
    const { deps: d } = deps({ ok: true }, { reserveOk: false });
    const outcome = await verifyAndRepair(ENV, PARAMS, UNCHECKED, d);
    assert.equal(outcome.built, true);
    assert.equal(outcome.skipped, 'no-budget');
    assert.equal(outcome.result, undefined);
  });
});

describe('a design repair that breaks a project that built', () => {
  /** Builds, with two sure errors, at a revision of its own. */
  const BUILT: DurableGenerationResult = {
    ...ACCEPTED,
    accepted: {
      revision: 'rev-0',
      files: [
        {
          path: 'index.html',
          content: '<!doctype html><html><head></head><body></body></html>',
        },
      ],
    },
  } as unknown as DurableGenerationResult;

  /**
   * The store as the repair left it: `runGeneration` has already promoted
   * the repair (ACCEPTED, rev-1) by the time the rebuild runs.
   */
  function store(current = 'rev-1') {
    const state = { current, stages: [] as GenerationStageRecord[] };
    const fake: GenerationStore = {
      saveStage: async (record) => {
        state.stages.push(record);
      },
      loadStage: async () => undefined,
      loadAccepted: async () =>
        ({ revision: state.current, files: [] }) as ProjectSnapshot,
      promote: async (
        _projectId,
        runId,
        expected,
        snapshot: ProjectSnapshot,
      ) => {
        const staged = state.stages.some((stage) => stage.runId === runId);
        if (!staged || state.current !== expected) return { promoted: false };
        state.current = snapshot.revision;
        return { promoted: true, current: snapshot };
      },
    };
    return { state, fake };
  }

  it('puts the attempt that built back, and says so', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'build', error: 'TS2304' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(state.current, 'rev-0');
    assert.equal(outcome.restored, true);
    assert.equal(outcome.repaired, false);
    assert.equal(outcome.built, true);
    // The first attempt is what the store holds, so there is no other
    // result to hand back in its place.
    assert.equal(outcome.result, undefined);
    assert.equal(state.stages[0]!.runId, 'run_1:restore');
    assert.equal(state.stages[0]!.baseRevision, 'rev-1');
  });

  it('hands back an edit accepted right after the restore', async () => {
    // Another tab began an edit from rev-0 and it was accepted (rev-10)
    // as soon as the restore put rev-0 back.
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'build', error: 'TS2304' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: {
        ...fake,
        promote: async (...args) => {
          const promoted = await fake.promote(...args);
          state.current = 'rev-10';
          return promoted;
        },
      },
    });
    assert.equal(outcome.restored, true);
    assert.equal(outcome.result?.accepted?.revision, 'rev-10');
    assert.equal(outcome.result?.state, BUILT.state);
  });

  it('reports the restore that happened when the promotion errors after moving the pointer', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'build', error: 'TS2304' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: {
        ...fake,
        promote: async (...args) => {
          await fake.promote(...args);
          throw new Error('stage update failed after the pointer moved');
        },
        loadAccepted: async () =>
          ({ revision: state.current, files: [] }) as ProjectSnapshot,
      },
    });
    assert.equal(state.current, 'rev-0');
    assert.equal(outcome.restored, true);
    assert.equal(outcome.result, undefined);
  });

  it('keeps reporting the repair when the promotion errors before moving anything', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'build', error: 'TS2304' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: {
        ...fake,
        promote: async () => {
          throw new Error('D1 unavailable');
        },
        loadAccepted: async () =>
          ({ revision: state.current, files: [] }) as ProjectSnapshot,
      },
    });
    assert.equal(state.current, 'rev-1');
    assert.equal(outcome.restored, undefined);
    assert.equal(outcome.result, ACCEPTED);
  });

  it('leaves an edit made since alone, and hands back that edit, which is what the store holds', async () => {
    const { state, fake } = store('rev-9');
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'build', error: 'TS2304' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(state.current, 'rev-9');
    assert.equal(outcome.restored, undefined);
    assert.equal(outcome.repaired, false);
    // Not the repair: the reader's next edit must start from what is there.
    assert.equal(outcome.result?.accepted?.revision, 'rev-9');
  });

  it('hands back an edit accepted since a repair that stands', async () => {
    // The repair fixed the design and builds, so it stands. Another tab
    // accepted an edit of it while the second build ran (rev-9).
    const { state, fake } = store('rev-9');
    const { deps: d } = deps({ ok: true }, { rebuild: { ok: true } });
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(outcome.repaired, true);
    assert.equal(outcome.restored, undefined);
    assert.equal(state.current, 'rev-9');
    assert.equal(outcome.result?.accepted?.revision, 'rev-9');
    // Nothing overtook it: the repair is what is handed back.
    const { fake: still } = store();
    const kept = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: still,
    });
    assert.equal(kept.result, ACCEPTED);
  });

  it('hands back an edit accepted before a repair that was refused for it', async () => {
    // Another tab accepted rev-9 after the first build, so the repair's
    // base no longer matched and it was refused with what the store held.
    const conflict = {
      state: 'failed',
      stop: 'conflict',
      accepted: { revision: 'rev-9', files: [] },
      errors: ['Accepted revision changed before promotion'],
      conflict: true,
    } as unknown as DurableGenerationResult;
    const { deps: d } = deps({ ok: true }, { repairResult: conflict });
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, d);
    assert.equal(outcome.repaired, false);
    assert.equal(outcome.result?.accepted?.revision, 'rev-9');
    assert.equal(outcome.result?.state, BUILT.state);
    // A repair that failed on its own asks the store what it holds.
    const { fake } = store('rev-9');
    const failed = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...deps({ ok: true }, { accepted: false }).deps,
      store: fake,
    });
    assert.equal(failed.result?.accepted?.revision, 'rev-9');
    // And nothing moved: there is no other result to hand back.
    const { fake: unmoved } = store('rev-0');
    const kept = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...deps({ ok: true }, { accepted: false }).deps,
      store: unmoved,
    });
    assert.equal(kept.result, undefined);
  });

  it('keeps a repair nothing judged, since that says nothing about it', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      { rebuild: { ok: false, reason: 'sandbox', error: 'gone' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(state.current, 'rev-1');
    assert.equal(outcome.restored, undefined);
    assert.equal(state.stages.length, 0);
  });

  /** A repair at rev-1 whose index.html is `html`, as the store holds it. */
  const repairWith = (html: string) =>
    ({
      ...ACCEPTED,
      accepted: {
        revision: 'rev-1',
        files: [{ path: 'index.html', content: html }],
      },
    }) as unknown as DurableGenerationResult;

  it('puts the attempt that built back when the repair fixed nothing', async () => {
    // It builds, and it still has both errors it was bought to fix.
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      {
        repairResult: repairWith(
          '<!doctype html><html><head></head><body></body></html>',
        ),
      },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(outcome.designErrors, 2);
    assert.equal(outcome.designErrorsAfter, 2);
    assert.equal(state.current, 'rev-0');
    assert.equal(outcome.restored, true);
    assert.equal(outcome.result, undefined);
  });

  it('keeps a repair that builds and leaves fewer errors', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: true },
      {
        repairResult: repairWith(
          '<!doctype html><html lang="en"><head></head><body></body></html>',
        ),
      },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(outcome.designErrorsAfter, 1);
    assert.equal(state.current, 'rev-1');
    assert.equal(outcome.restored, undefined);
    assert.equal(outcome.repaired, true);
  });

  it('keeps a repair of a project that never built, which was no worse', async () => {
    const { state, fake } = store();
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'TS2304' },
      { rebuild: { ok: false, reason: 'build', error: 'TS2305' } },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, BUILT, {
      ...d,
      store: fake,
    });
    assert.equal(state.current, 'rev-1');
    assert.equal(outcome.restored, undefined);
    assert.equal(outcome.result, ACCEPTED);
  });
});

describe('judging a design repair', () => {
  const withSpec = {
    ...ACCEPTED,
    accepted: {
      revision: 'rev-1',
      files: [
        {
          path: 'index.html',
          content:
            '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body></body></html>',
        },
        { path: 'src/App.tsx', content: 'export const App = () => null;' },
        {
          path: 'DESIGN.md',
          content: renderDesignMd({
            intent: 'A quiet page.',
            tokens: {
              colors: [{ name: 'navy', value: '#071722', use: 'ground' }],
              fonts: [
                {
                  role: 'body',
                  family: 'system-ui',
                  fallback: 'sans-serif',
                  weights: [400],
                },
              ],
              type: [
                {
                  name: 'body',
                  size: '1rem',
                  lineHeight: '1.5',
                  letterSpacing: '0',
                },
              ],
              space: [],
              radii: [],
              effects: [],
            },
            sections: [{ id: 'hero', purpose: 'p', layout: 'l', copy: [] }],
            breakpoints: [],
            do: [],
            avoid: [],
            checks: [],
          }),
        },
      ],
    },
  } as unknown as DurableGenerationResult;

  it("holds the repair to the first attempt's spec, not the one it wrote", async () => {
    // The fake repair returns ACCEPTED, which carries no DESIGN.md: a
    // repair that rewrote its spec without the colour it was asked to use.
    // Judged by its own record it would have nothing left to fail.
    const { deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(ENV, PARAMS, withSpec, d);
    assert.ok((outcome.designErrors ?? 0) > 0, 'the first attempt failed');
    assert.ok(
      (outcome.designErrorsAfter ?? 0) > 0,
      'the repair is still missing what the spec named',
    );
  });

  it('repairs the design when the build service could not judge the project', async () => {
    // A busy sandbox says nothing about the files; the design checks read
    // them and found errors, and those buy a repair on their own.
    const { spy, deps: d } = deps({
      ok: false,
      reason: 'busy',
      error: 'Another build is already running for this project.',
    });
    const outcome = await verifyAndRepair(ENV, PARAMS, withSpec, d);
    assert.equal(spy.generates.length, 1);
    const prompt = spy.generates[0]!.prompt;
    assert.doesNotMatch(prompt, /does not build|Another build/);
    assert.doesNotMatch(prompt, /builds, but/);
    assert.match(prompt, /does not match its own spec/);
    // Nothing judged the first build, so nothing is claimed about it.
    assert.equal(outcome.built, undefined);
  });

  it('repairs the design when the build service cannot be reached at all', async () => {
    // The design checks read the files and need no build service.
    const { spy, deps: d } = deps({ ok: true }, { buildThrowsOn: 1 });
    const outcome = await verifyAndRepair(ENV, PARAMS, withSpec, d);
    assert.equal(spy.generates.length, 1);
    assert.doesNotMatch(
      spy.generates[0]!.prompt,
      /could not be reached|does not build/,
    );
    assert.equal(outcome.built, undefined);
  });

  it('repairs the design where no build service is configured', async () => {
    // A self-hosted or partial deployment: the checks still read the files,
    // and nothing is claimed about a build that never ran.
    const { spy, deps: d } = deps({ ok: true });
    const outcome = await verifyAndRepair(
      { ...ENV, PREVIEW: undefined } as GenerationWorkflowEnv,
      PARAMS,
      withSpec,
      d,
    );
    assert.equal(spy.builds, 0);
    assert.equal(spy.generates.length, 1);
    assert.doesNotMatch(spy.generates[0]!.prompt, /configured|does not build/);
    assert.equal(outcome.built, undefined);
    assert.ok((outcome.designErrors ?? 0) > 0);
  });

  it("keeps the first attempt's design record in what the repair promotes", async () => {
    // The repair's model writes a spec of its own; the plan that reaches
    // validation and promotion carries the original record instead.
    const original = withSpec.accepted!.files.find(
      (file) => file.path === 'DESIGN.md',
    )!;
    let planned: { path: string; content: string }[] = [];
    const { deps: d } = deps({ ok: true });
    await verifyAndRepair(ENV, PARAMS, withSpec, {
      ...d,
      providerFor: (() => ({
        id: 'fake',
        generate: async () => ({
          summary: 'repaired',
          files: [
            { path: 'DESIGN.md', content: '---\n{}\n---\nA weaker spec.' },
            { path: 'src/App.tsx', content: 'export const App = () => null;' },
          ],
        }),
      })) as never,
      generate: (async (provider: ModelProvider, request: never) => {
        const plan = await provider.generate(request);
        planned = plan.files;
        return {
          result: {
            ...ACCEPTED,
            accepted: { revision: 'rev-1', files: plan.files },
          },
          outcome: 'ok',
          providerRan: true,
        };
      }) as never,
    });
    const record = planned.filter((file) => file.path === 'DESIGN.md');
    assert.equal(record.length, 1);
    assert.equal(record[0]!.content, original.content);
  });
});
