import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { DurableGenerationResult } from '@vibld/core';
import { PlanProvider, createPlanClient } from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';
import { D1GenerationStore } from './generation-store.ts';
import {
  SanitizingModelProvider,
  runGeneration,
  settleBudget,
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
        timeout: '10 minutes',
      },
      async () => {
        let usage: PlanUsage | undefined;
        const store = new D1GenerationStore(
          this.env.DB,
          this.env.PROJECT_CONTENT,
        );
        const provider = new SanitizingModelProvider(
          new PlanProvider(createPlanClient(this.env, params.model), {
            model: params.model,
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
          }),
        );
        const outcome = await runGeneration(store, provider, params);
        return { ...outcome, usage };
      },
    );

    await step.do(
      'settle-budget',
      // Idempotent: `UserBudget.settle` only writes a reservation that is
      // still open (`WHERE settled IS NULL`), so retrying it after a
      // transient Durable Object failure is safe.
      {
        retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const actual = await settleBudget(
          this.env.USER_BUDGET,
          params,
          generation.usage,
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
      },
    );

    return generation.result;
  }
}
