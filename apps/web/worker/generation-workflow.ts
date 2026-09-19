import { derivePalette, seedFromHex } from '@vibld/ai';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { DurableGenerationResult } from '@vibld/core';
import { PlanProvider, RUN_STEP_TIMEOUT_MS, createPlanClient } from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { D1GenerationStore } from './generation-store.ts';
import { buildProject } from './publish-client.ts';
import { reserveBudget } from './reserve.ts';
import {
  REPAIR_STEP_TIMEOUT_MS,
  SanitizingModelProvider,
  ceilingForRun,
  runGeneration,
  settleBudget,
  throttleProgress,
  traceOf,
  verifyAndRepair,
} from './generation-run.ts';
import type {
  GenerationWorkflowEnv,
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
 * Two client-visible things this move costs, both accepted deliberately:
 *  - Character-by-character progress used to be lost here, and is not any
 *    more (#183). A Workflow step still has no channel of its own -- its
 *    return value arrives once, at the end -- so the generate step reports
 *    through a named Durable Object (`run-progress.ts`) that the poll loop
 *    reads, throttled to about a report a second and never awaited.
 *  - Cancelling now means `WorkflowInstance.terminate()`, not dropping a
 *    fetch. `index.ts` calls it on disconnect, but termination lands at the
 *    next step boundary, not mid-step -- a cancel that arrives while the
 *    model call itself is in flight cannot stop that one call from finishing
 *    (and being billed for). The budget ledger's own abandoned-reservation
 *    reclaim (`budget.ts`, `ABANDONED_AFTER_MS`) is the backstop either way.
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

    const generation = await step.do(
      'generate',
      {
        // The model call is paid and not idempotent, so a retried step would
        // risk billing twice for one run rather than recovering a free D1
        // write -- better to surface the one failure than to double-spend
        // chasing it.
        retries: { limit: 0, delay: '10 seconds' },
        // Derived, not chosen: a ceiling is a time budget too, and 10
        // minutes was calibrated when every run stopped at 64000 tokens.
        // See RUN_WALL_CLOCK_BUDGET_MS for the ordering this belongs to.
        timeout: RUN_STEP_TIMEOUT_MS,
      },
      async () => {
        const startedAt = Date.now();
        let usage: PlanUsage | undefined;
        const store = new D1GenerationStore(
          this.env.DB,
          this.env.PROJECT_CONTENT,
        );
        // Re-derived here rather than carried through the params. The
        // source is one hex; the solver turns it back into the same fifteen
        // tokens it produced when the page was fetched, and a value that no
        // longer derives is simply dropped rather than trusted.
        //
        // The mode travels alongside it because the hex cannot carry it: the
        // colour a page is seeded from is an accent, so re-reading a mode
        // off its lightness here would undo what the page itself said. It is
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

        // The live channel #183 was missing. The provider has always called
        // back on every delta; what there was no way to do was say so
        // outside this step, which returns once and at the end.
        // `throttleProgress` turns the per-delta callback into about one
        // report a second and drops a report that would repeat the last.
        //
        // Built before the provider and only where the binding exists, so a
        // deployment without it passes no callback at all rather than
        // throwing from inside the stream. The report is not awaited: a
        // channel that is slow or gone must cost the reader a stale number,
        // never the run.
        // One stub for the run rather than one per report: the name never
        // changes, and resolving it again several hundred times says
        // nothing that resolving it once did not.
        const channel = this.env.RUN_PROGRESS?.getByName(params.runId);
        const onProgress = channel
          ? throttleProgress((report) => {
              void channel.report(report).catch(() => {
                // A run that cannot describe itself still finishes, and
                // the meter falls back to the clock alone.
              });
            })
          : undefined;

        const provider = new SanitizingModelProvider(
          new PlanProvider(createPlanClient(this.env, params.model), {
            model: params.model,
            // The ceiling `handlePlan` reserved against, carried in the
            // params beside the prices settlement uses. Read rather than
            // re-derived: this Workflow is durable and may start long after
            // the reservation, so a fresh derivation here could price the
            // request off a newer override than the run is holding. Through
            // `ceilingForRun` because a payload persisted before that field
            // existed has no ceiling to read, and must not inherit a derived
            // one it was never funded for.
            maxTokens: ceilingForRun(params),
            onUsage: (reported) => {
              usage = reported;
            },
            ...(onProgress ? { onProgress } : {}),
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
            ...(referencePalette ? { palette: referencePalette } : {}),
          }),
        );
        let outcome;
        try {
          outcome = await runGeneration(store, provider, params);
        } finally {
          // In a finally, and awaited, unlike the reports. The instance goes
          // on reporting `running` through settlement and the trace write,
          // so a run that ended having streamed reasoning and no answer --
          // refused, emptied, cut off -- would keep the meter saying the
          // model was thinking for as long as those took (#193 review, P2).
          // The step is the only thing that knows it has left, and it knows
          // it on the failing path too.
          await channel?.finish().catch(() => {
            // Same as a lost report: the meter falls back to what the
            // Workflow itself says, which is the broader true word.
          });
        }
        // Measured inside the step and returned with the outcome, so it is
        // the model call that was timed and not the settlement that follows
        // it. A step's return value is durable, so a later step reads the
        // same numbers however long it waits or however often it retries.
        return {
          ...outcome,
          usage,
          elapsedMs: Date.now() - startedAt,
          endedAt: new Date().toISOString(),
        };
      },
    );

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
            inputTokens: generation.usage?.inputTokens ?? 0,
            outputTokens: generation.usage?.outputTokens ?? 0,
            microUsd: actual,
          }),
        );
        return actual;
      },
    );

    // After settlement, and that ordering is the whole reason this is safe
    // rather than a convenience (#194).
    //
    // `UserBudget.reserve` reclaims every unsettled reservation older than
    // RUN_ABANDONED_AFTER_MS before it does anything else, charging each one
    // at its full worst case, and `settle` writes only where `settled IS
    // NULL`. A repair reserves against the same caller's ledger. Put this
    // step before settlement and a run that had been going long enough
    // would have had its own in-flight reservation reclaimed by the repair
    // it was about to ask for, billing the caller a worst case they never
    // spent and discarding the figure actually measured. Settling first
    // means the only reservation this step can touch is the one it makes.
    //
    // The generate step's own timeout is what keeps the first reservation
    // inside that window; nothing here may be allowed to grow it.
    const repair = await step.do(
      'verify-and-repair',
      {
        // Paid and not idempotent, exactly like `generate`: a retried step
        // would ask the model a second time for the same repair.
        retries: { limit: 0, delay: '10 seconds' },
        // A build, a model call and a second build. Its own budget rather
        // than the generate step's, because the reservation this step makes
        // is its own and is settled inside it.
        timeout: REPAIR_STEP_TIMEOUT_MS,
      },
      () =>
        verifyAndRepair(this.env, params, generation.result, {
          build: buildProject,
          reserve: reserveBudget,
          settle: settleBudget,
          generate: (provider, request) =>
            runGeneration(
              new D1GenerationStore(this.env.DB, this.env.PROJECT_CONTENT),
              provider,
              request,
            ),
          // A provider of its own, with its own usage capture: the run's
          // was closed over by the generate step and settled with it.
          // No progress channel, deliberately. The meter's clock stopped
          // when the generate step finished, and reopening it here would
          // show a run that had already reported its result still writing.
          providerFor: (onUsage) =>
            new SanitizingModelProvider(
              new PlanProvider(createPlanClient(this.env, params.model), {
                model: params.model,
                maxTokens: ceilingForRun(params),
                onUsage,
                ...(params.style ? { style: params.style } : {}),
                ...(params.knowledge ? { knowledge: params.knowledge } : {}),
              }),
            ),
        }),
    );

    console.log(
      JSON.stringify({
        event: 'generation.verified',
        userId: params.userId,
        runId: params.runId,
        ...repair,
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
        const store = new D1GenerationStore(
          this.env.DB,
          this.env.PROJECT_CONTENT,
        );
        await store.saveTrace(
          traceOf(params, generation.result, generation.usage, {
            costMicroUsd,
            elapsedMs: generation.elapsedMs,
            endedAt: generation.endedAt,
          }),
        );
      },
    );

    // The repaired project where there is one. The repair promoted its own
    // accepted revision, so returning the first attempt here would show the
    // reader the broken files while the store held the fixed ones (#194).
    return repair.result ?? generation.result;
  }
}
