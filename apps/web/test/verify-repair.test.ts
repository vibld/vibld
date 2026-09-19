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
    /** What the build after the repair answers. Defaults to the first. */
    rebuild?: { ok: boolean; error?: string; reason?: string };
    /** Which call throws, counting from one. */
    buildThrowsOn?: number;
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
        return spy.builds === 1 ? build : (options.rebuild ?? build);
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
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const source = await readFile(
      join(import.meta.dirname, '..', 'worker', 'generation-workflow.ts'),
      'utf8',
    );
    assert.match(
      source,
      /return repair\.result \?\? generation\.result;/,
      'the Workflow returns the first attempt, so a repaired run shows the reader the broken files',
    );
  });
});
