import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PartialSettlement,
  REBUILD_WAIT_ATTEMPTS,
  verifyAndRepair,
} from '../worker/generation-run.ts';
import type {
  GenerationWorkflowEnv,
  WorkflowParams,
} from '../worker/generation-run.ts';
import type { DurableGenerationResult } from '@vibld/core';

/**
 * Building what a run produced, and buying one repair when it will not
 * build (#194).
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
  settles: { usage: unknown; providerRan: boolean | undefined }[];
  generates: { runId: string; prompt: string; baseRevision?: string }[];
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
    /** The reservation could not be asked for at all, as against refused. */
    reserveThrows?: boolean;
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
  } = {},
) {
  const spy: Spy = { builds: 0, reserves: 0, settles: [], generates: [] };
  return {
    spy,
    deps: {
      build: (async () => {
        spy.builds += 1;
        if (spy.builds === options.buildThrowsOn) {
          throw new Error('the preview service is gone');
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
      ) => {
        spy.settles.push({ usage, providerRan });
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
        request: { runId: string; prompt: string; baseRevision?: string },
      ) => {
        spy.generates.push(request);
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
              : ACCEPTED,
          outcome: 'ok',
          providerRan: true,
        };
      }) as never,
      providerFor: (() => ({}) as never) as never,
      now: () => Date.UTC(2026, 8, 19, 5, 0, 0),
      // So the settlement retries do not spend their real delay here.
      wait: async () => {},
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
    assert.ok(
      spy.generates[0]!.prompt.includes('src/App.tsx(3,10): error TS1484'),
      'the compiler output did not reach the model',
    );
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
    // #196 review, P1. Acceptance is the structural validator saying the
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
    // #196 review, P2. The project has already been accepted, promoted and
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
    // #196 review, P1. `runGeneration` returns normally with
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
    // #196 review, P2. `settleBudget` writes the caller's layer before the
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
    // #196 review, P2. `retrying` reports the last failure, and the
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
    // #196 review, P2. Another build can take the workspace lock between
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
    // #196 review. The teardown holds the lock until its container is gone
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
    // #196 review, and a source read because the bound is thirty minutes
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

async function workflowSource(
  file = 'generation-workflow.ts',
): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  return readFile(join(import.meta.dirname, '..', 'worker', file), 'utf8');
}

describe('settling the repair, and what it costs to fail at it', () => {
  it('keeps the project when the ledger cannot be asked for a hold', async () => {
    // #196 review, P2. `reserve` rejects, rather than denying, when the
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
    // #196 review, P1. A Durable Object that blinks is over in seconds,
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
    // #196 review, P2. The repair is settled against the same ledger, so a
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
      /return repair\.result \?\? generation\.result;/,
      'the Workflow returns the first attempt, so a repaired run shows the reader the broken files',
    );
  });

  it('keeps the whole project out of the log line', async () => {
    // #196 review, P1. `RepairOutcome.result` carries every generated file.
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
