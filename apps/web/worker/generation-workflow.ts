import { derivePalette, seedFromHex } from '@vibld/ai';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { DurableGenerationResult } from '@vibld/core';
import {
  BoundedPlanProvider,
  PlanProvider,
  RUN_STEP_TIMEOUT_MS,
  createPlanClient,
} from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { D1GenerationStore } from './generation-store.ts';
import { buildProject } from './publish-client.ts';
import { reserveBudget } from './reserve.ts';
import {
  ASSEMBLE_STEP_TIMEOUT_MS,
  REPAIR_STEP_TIMEOUT_MS,
  SanitizingModelProvider,
  assembleRun,
  buildInSteps,
  ceilingForRun,
  inputBudgetForRun,
  isBoundedRun,
  preflightRun,
  runGeneration,
  settleBudget,
  touchReservation,
  traceOf,
  verifyAndRepair,
} from './generation-run.ts';
import type {
  GenerationOutcome,
  GenerationWorkflowEnv,
  ProgressReport,
  WorkflowParams,
} from './generation-run.ts';

export type { WorkflowParams } from './generation-run.ts';

/**
 * Durable generation (docs/decisions.md L26), the part of `/api/plan` that
 * actually calls the model and promotes the result.
 *
 * Why a Workflow rather than the request handler that used to do this
 * in-line: a plan can take minutes, and a Worker request has no guarantee of
 * outliving the client's connection -- `ctx.waitUntil` bought some slack, but
 * none of it survived a Worker eviction, and none of it was resumable. A
 * Workflow instance is its own durable execution: `index.ts`'s `handlePlan`
 * creates one and returns, then polls `WorkflowInstance.status()` to relay
 * progress back over the SSE connection it already holds open, the same
 * client contract `remote-provider.ts` has always seen.
 *
 * A build is bounded steps (docs/decisions.md, "Resolved 2026-09-29";
 * `packages/ai/src/bounded-build.ts`), and each model call is a durable step
 * of its own:
 *
 *   prepare       the free checks: a stale revision, an oversized project
 *   outline       the spec and the manifest of files
 *   write-1 ...   one group of files each; a group that runs out of room
 *                 is split into write-N.1 and write-N.2, and so on
 *   assemble      the patch applied, validated, staged and promoted
 *   settle-budget, verify-and-repair, record-trace, as before
 *
 * A step that has finished is never run again: when the instance resumes,
 * `run` replays from the top and every finished step returns its stored
 * result instead of calling the model, so a group written before an
 * eviction is not paid for twice.
 *
 * Two client-visible things this move costs, both accepted deliberately:
 *  - Character-by-character progress used to be lost here, and is not any
 *    more (internal issue 183). A Workflow step still has no channel of its own -- its
 *    return value arrives once, at the end -- so each model step reports
 *    through a named Durable Object (`run-progress.ts`) that the poll loop
 *    reads, throttled to about a report a second and never awaited.
 *  - Cancelling now means `WorkflowInstance.terminate()`, not dropping a
 *    fetch. Only Stop calls it (`run-control.ts`, `DELETE /api/runs/:id`):
 *    a page going away no longer cancels a build, which runs on and saves
 *    to the project (docs/decisions.md, "Resolved 2026-09-29", keep
 *    building). Termination lands at the next step boundary, not mid-step
 *    -- a Stop that arrives while a model call is in flight cannot stop
 *    that one call from finishing (and being billed for). With bounded
 *    steps the next boundary is at most one group away. The budget
 *    ledger's own abandoned-reservation reclaim (`budget.ts`,
 *    `ABANDONED_AFTER_MS`) is the backstop either way.
 *
 * This file only glues `step.do` to `generation-run.ts`'s pure functions --
 * see that file's own comment for why the split exists and where the tests
 * live.
 */
export class GenerationWorkflow extends WorkflowEntrypoint<
  GenerationWorkflowEnv,
  WorkflowParams
> {
  async run(
    event: WorkflowEvent<WorkflowParams>,
    step: WorkflowStep,
  ): Promise<DurableGenerationResult> {
    const params = event.payload;
    const openStore = () =>
      new D1GenerationStore(this.env.DB, this.env.PROJECT_CONTENT);

    // Re-derived here rather than carried through the params. The source is
    // one hex; the solver turns it back into the same fifteen tokens it
    // produced when the page was fetched, and a value that no longer derives
    // is simply dropped rather than trusted.
    //
    // The mode travels alongside it because the hex cannot carry it: the
    // colour a page is seeded from is an accent, so re-reading a mode off
    // its lightness here would undo what the page itself said. It is
    // accepted only as one of the two literals it can be.
    const referencePalette = params.referencePaletteSource
      ? (() => {
          const seed = seedFromHex(
            params.referencePaletteSource,
            'reference',
            'From the reference site',
            `Derived from ${params.referencePaletteSource}, the dominant colour of the page you pointed at.`,
          );
          if (!seed) return null;
          const mode = params.referencePaletteMode;
          return derivePalette(
            mode === 'light' || mode === 'dark' ? { ...seed, mode } : seed,
          );
        })()
      : null;

    // The live channel internal issue 183 was missing, one stub for the run. Only where
    // the binding exists, so a deployment without it passes no reporter at
    // all rather than throwing from inside a stream. A report is not
    // awaited: a channel that is slow or gone must cost the reader a stale
    // number, never the run.
    const channel = this.env.RUN_PROGRESS?.getByName(params.runId);
    const report = channel
      ? (progress: ProgressReport) => {
          void channel.report(progress).catch(() => {
            // A run that cannot describe itself still finishes, and the
            // meter falls back to the clock alone.
          });
        }
      : undefined;
    // Said once the model calls are over, however they ended, and awaited,
    // unlike the reports: the instance goes on reporting `running` through
    // staging, settlement and the trace write, and without this the meter
    // would keep naming the last step for as long as those take (internal PR 193
    // review, P2).
    const finished = () =>
      channel?.finish().catch(() => {
        // Same as a lost report: the meter falls back to what the Workflow
        // itself says, which is the broader true word.
      });

    const bounded = async () => {
      // The checks that cost nothing, before any model step. A refusal here
      // is the run's result, and nothing is spent on it.
      const prepared = await step.do(
        'prepare',
        {
          // Reads only, so a retry after a transient D1 or R2 failure lands
          // on the same answer.
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        },
        async (): Promise<{
          startedAt: number;
          refusal?: GenerationOutcome;
        }> => {
          const startedAt = Date.now();
          const checked = await preflightRun(openStore(), params);
          return checked.refusal
            ? { startedAt, refusal: checked.refusal }
            : { startedAt };
        },
      );

      // The model steps. Each is its own durable step with its own timeout,
      // sized so one call fits inside it at the model's own speed
      // (`callCeilingFor`), and none is retried: a model call is paid and
      // not idempotent, so a retried step would risk billing twice for one
      // call rather than recovering a free D1 write. A failure comes back
      // as data instead, with what it spent, so the run settles it below.
      const built = prepared.refusal
        ? undefined
        : await buildInSteps(
            {
              client: createPlanClient(this.env, params.model),
              store: openStore,
              ledger: this.env.USER_BUDGET,
              ...(report ? { report } : {}),
              palette: referencePalette,
            },
            params,
            (name, call) =>
              step.do(
                name,
                {
                  retries: { limit: 0, delay: '10 seconds' },
                  // Derived, not chosen: see RUN_WALL_CLOCK_BUDGET_MS for
                  // the ordering this belongs to. It bounds one call, which
                  // is what it was always sized for.
                  timeout: RUN_STEP_TIMEOUT_MS,
                },
                call,
              ),
          );

      return step.do(
        'assemble',
        {
          // Not retried, for the reason the model steps are not: this
          // stages and promotes, and a promotion that landed before a
          // failure would be read on a retry as the project having moved.
          retries: { limit: 0, delay: '10 seconds' },
          timeout: ASSEMBLE_STEP_TIMEOUT_MS,
        },
        async () => {
          await finished();
          // Kept alive until it is settled: this step can follow a long run
          // of model steps, and the reclaim counts from the last heartbeat.
          if (built) await touchReservation(this.env.USER_BUDGET, params);
          const outcome = await assembleRun(
            openStore(),
            params,
            prepared,
            built,
          );
          return {
            // Its usage summed across every call, failed ones included.
            ...outcome,
            // The run, from the first check to the promotion: the time the
            // caller waited, not only the time the model spent writing.
            elapsedMs: Date.now() - prepared.startedAt,
            endedAt: new Date().toISOString(),
          };
        },
      );
    };

    // A run enqueued before bounded builds shipped, and resumed by this
    // code. Its payload has no `maxInputChars`, it was reserved for one
    // response, and it may already have finished that response in a step
    // named `generate`: run under the new step names it would be written
    // again, and the first answer, already promoted, paid for twice. So it
    // takes the path it was enqueued for, under the step name it may
    // already hold a result for, and a finished one is read back rather
    // than asked again. New runs never come here.
    const legacy = () =>
      step.do(
        'generate',
        {
          retries: { limit: 0, delay: '10 seconds' },
          timeout: RUN_STEP_TIMEOUT_MS,
        },
        async () => {
          const startedAt = Date.now();
          let usage: PlanUsage | undefined;
          let outcome: GenerationOutcome;
          try {
            outcome = await runGeneration(
              openStore(),
              new SanitizingModelProvider(
                new PlanProvider(createPlanClient(this.env, params.model), {
                  model: params.model,
                  maxTokens: ceilingForRun(params),
                  onUsage: (reported) => {
                    usage = reported;
                  },
                  ...(params.style ? { style: params.style } : {}),
                  ...(params.styleDna && Object.keys(params.styleDna).length > 0
                    ? { styleDna: params.styleDna }
                    : {}),
                  ...(params.knowledge ? { knowledge: params.knowledge } : {}),
                  ...(params.chosenMockup
                    ? { chosenMockup: params.chosenMockup }
                    : {}),
                  ...(params.referenceContext
                    ? { referenceContext: params.referenceContext }
                    : {}),
                  ...(params.media ? { media: params.media } : {}),
                  ...(referencePalette ? { palette: referencePalette } : {}),
                }),
              ),
              params,
            );
          } finally {
            await finished();
          }
          return {
            ...outcome,
            ...(usage ? { usage } : {}),
            calls: outcome.providerRan ? 1 : 0,
            elapsedMs: Date.now() - startedAt,
            endedAt: new Date().toISOString(),
          };
        },
      );

    const generation = isBoundedRun(params) ? await bounded() : await legacy();

    const costMicroUsd = await step.do(
      'settle-budget',
      // Idempotent: `UserBudget.settle` writes the same id and the same
      // figure each time, so retrying it after a transient Durable Object
      // failure lands on the same values. It no longer refuses a row the
      // reclaim has already closed, which is deliberate -- see its own
      // comment: a run that finishes after being presumed abandoned is
      // charged what it measured rather than what it reserved.
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const actual = await settleBudget(
          this.env.USER_BUDGET,
          params,
          generation.usage,
          generation.providerRan,
        );
        // Spend is recorded even when the run failed: a refusal or a
        // conflict still consumed tokens, and a record that counts only
        // successes under-reports the bill.
        console.log(
          JSON.stringify({
            event: 'generation.settled',
            userId: params.userId,
            ...(params.email ? { email: params.email } : {}),
            model: params.model,
            outcome: generation.outcome,
            calls: generation.calls,
            inputTokens: generation.usage?.inputTokens ?? 0,
            outputTokens: generation.usage?.outputTokens ?? 0,
            microUsd: actual,
          }),
        );
        return actual;
      },
    );

    // After settlement, and that ordering is the whole reason this is safe
    // rather than a convenience (internal issue 194).
    //
    // `UserBudget.reserve` reclaims every unsettled reservation older than
    // RUN_ABANDONED_AFTER_MS before it does anything else, charging each one
    // at its full worst case. A repair reserves against the same caller's
    // ledger. Put this step before settlement and a run that had been going
    // long enough would have had its own in-flight reservation reclaimed by
    // the repair it was about to ask for, billing the caller a worst case
    // they never spent and discarding the figure actually measured.
    // Settling first means the only reservation this step can touch is the
    // one it makes.
    //
    // The heartbeat each model step sends is what keeps the first
    // reservation inside that window; nothing here may be allowed to stop
    // it.
    const repair = await step.do(
      'verify-and-repair',
      {
        // Paid and not idempotent, exactly like the model steps: a retried
        // step would ask the model a second time for the same repair.
        retries: { limit: 0, delay: '10 seconds' },
        // A build, a model call and a second build. Its own budget rather
        // than a model step's, because the reservation this step makes is
        // its own and is settled inside it.
        timeout: REPAIR_STEP_TIMEOUT_MS,
      },
      () =>
        verifyAndRepair(this.env, params, generation.result, {
          build: buildProject,
          reserve: reserveBudget,
          settle: settleBudget,
          store: openStore(),
          generate: (provider, request) =>
            runGeneration(openStore(), provider, request),
          // A provider of its own, with its own usage capture: the run's
          // was settled above. A repair is a follow-up, so it is a patch in
          // bounded steps like any other, made in this step rather than as
          // steps of its own, and held to the run's own budgets.
          // No progress channel, deliberately. The meter's clock stopped
          // when the model steps finished, and reopening it here would show
          // a run that had already reported its result still writing.
          providerFor: (onUsage) =>
            new SanitizingModelProvider(
              new BoundedPlanProvider(
                createPlanClient(this.env, params.model),
                {
                  model: params.model,
                  maxTokens: ceilingForRun(params),
                  maxInputChars: inputBudgetForRun(params),
                  onUsage: (usage: PlanUsage) => onUsage(usage),
                  ...(params.style ? { style: params.style } : {}),
                  ...(params.knowledge ? { knowledge: params.knowledge } : {}),
                  ...(params.media ? { media: params.media } : {}),
                  onUnexpectedError: (error) => {
                    console.error('repair generation failed', error);
                  },
                },
              ),
            ),
        }),
    );

    // Field by field, never a spread of `repair` (internal PR 196 review). That object
    // carries `result`, and `result.accepted.files` is the whole project:
    // spreading it wrote every generated file into the Worker log on each
    // successful repair, which puts a tenant's own copy, and whatever
    // knowledge was incorporated into it, in front of every log reader and
    // outside the access and retention boundaries the storage path has.
    // Only the scalars that say what happened belong here.
    console.log(
      JSON.stringify({
        event: 'generation.verified',
        userId: params.userId,
        runId: params.runId,
        ...(repair.built === undefined ? {} : { built: repair.built }),
        ...(repair.repaired === undefined ? {} : { repaired: repair.repaired }),
        ...(repair.restored ? { restored: true } : {}),
        ...(repair.skipped ? { skipped: repair.skipped } : {}),
        ...(repair.unverified ? { unverified: repair.unverified } : {}),
        ...(repair.designErrors ? { designErrors: repair.designErrors } : {}),
        ...(repair.designWarnings
          ? { designWarnings: repair.designWarnings }
          : {}),
        ...(repair.designErrorsAfter === undefined
          ? {}
          : { designErrorsAfter: repair.designErrorsAfter }),
        ...(repair.repairCostMicroUsd === undefined
          ? {}
          : { repairMicroUsd: repair.repairCostMicroUsd }),
        ...(repair.settled === false ? { settled: false } : {}),
      }),
    );

    await step.do(
      'record-trace',
      // Its own step rather than a tail on settlement: a trace that fails to
      // write must not drag the ledger through another settle attempt, and
      // the two answer different questions. Retrying is safe on its own
      // terms -- `saveTrace` keeps the first row for a run id and writes
      // nothing for a stop that did not describe a run.
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const store = openStore();
        // One row for the run, its tokens and cost summed across every
        // model step, because that is what billing charged: a row per step
        // would make the Runs view show one build as a dozen.
        await store.saveTrace(
          traceOf(params, generation.result, generation.usage, {
            costMicroUsd,
            elapsedMs: generation.elapsedMs,
            endedAt: generation.endedAt,
            calls: generation.calls,
          }),
        );
        // The repair's own row, under its own run id (internal PR 196 review). Without
        // it the Runs view reported the first call's cost as what the run
        // cost, while billing had charged for two. Its own row rather than a
        // larger number on this one: the repair has its own tokens, and a
        // row whose cost counts two calls and whose token counts describe
        // one is a row that misreads either way you read it.
        //
        // In the same step, and after: `saveTrace` keeps the first row for a
        // run id, so a retry of this step writes neither twice.
        if (repair.trace) await store.saveTrace(repair.trace);
      },
    );

    // The repaired project where there is one. The repair promoted its own
    // accepted revision, so returning the first attempt here would show the
    // reader the broken files while the store held the fixed ones (internal issue 194).
    return repair.result ?? generation.result;
  }
}
