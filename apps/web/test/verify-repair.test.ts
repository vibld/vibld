import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyAndRepair } from '../worker/generation-run.ts';
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
    accepted?: boolean;
  } = {},
) {
  const spy: Spy = { builds: 0, reserves: 0, settles: [], generates: [] };
  return {
    spy,
    deps: {
      build: (async () => {
        spy.builds += 1;
        return build;
      }) as never,
      reserve: (async () => {
        spy.reserves += 1;
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
        return 0;
      }) as never,
      generate: (async (
        _provider: unknown,
        request: { runId: string; prompt: string; baseRevision?: string },
      ) => {
        spy.generates.push(request);
        if (options.generateThrows) throw new Error('provider exploded');
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
    const { spy, deps: d } = deps({
      ok: false,
      reason: 'build',
      error: 'src/App.tsx(3,10): error TS1484',
    });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, repaired: true });
    assert.equal(spy.generates.length, 1);
    assert.equal(spy.generates[0]!.runId, 'run_1:repair');
    assert.equal(spy.generates[0]!.baseRevision, 'rev-1');
    assert.ok(
      spy.generates[0]!.prompt.includes('src/App.tsx(3,10): error TS1484'),
      'the compiler output did not reach the model',
    );
  });

  it('holds a reservation before it spends, and settles it after', async () => {
    const { spy, deps: d } = deps({
      ok: false,
      reason: 'install',
      error: 'npm install failed',
    });
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
    const { spy, deps: d } = deps({
      ok: false,
      reason: 'busy',
      error: 'A preview is currently running for this project.',
    });
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, skipped: 'not-the-project' });
    assert.equal(spy.reserves, 0);
    assert.equal(spy.generates.length, 0);
  });

  it('says so when the repair itself did not produce a project', async () => {
    const { deps: d } = deps(
      { ok: false, reason: 'build', error: 'boom' },
      { accepted: false },
    );
    const outcome = await verifyAndRepair(ENV, PARAMS, ACCEPTED, d);
    assert.deepEqual(outcome, { built: false, repaired: false });
  });
});
