import { derivePalette, seedFromHex } from '@vibld/ai';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { DurableGenerationResult } from '@vibld/core';
import { PlanProvider, RUN_STEP_TIMEOUT_MS, createPlanClient } from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';

import { D1GenerationStore } from './generation-store.ts';
import {
  SanitizingModelProvider,
  ceilingForRun,
  runGeneration,
  settleBudget,
  traceOf,
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
 *  - Character-by-character progress (`onProgress` in the old in-request
 *    call) has no equivalent yet -- there is no live channel between a
 *    Workflow step and the Worker polling it, only the step's return value
 *    once it finishes. The poll loop still emits keepalives, so a long run
 *    reads as "still going", just not as "how far along".
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
            ...(params.style ? { style: params.style } : {}),
            ...(params.styleDna && Object.keys(params.styleDna).length > 0
              ? { styleDna: params.styleDna }
              : {}),
            ...(params.knowledge ? { knowledge: params.knowledge } : {}),
            ...(params.referenceContext
              ? { referenceContext: params.referenceContext }
              : {}),
            ...(referencePalette ? { palette: referencePalette } : {}),
          }),
        );
        const outcome = await runGeneration(store, provider, params);
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

    return generation.result;
  }
}
