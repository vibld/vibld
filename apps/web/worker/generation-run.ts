import {
  DurableGenerationRunner,
  type DurableGenerationResult,
  type GenerationPlan,
  type GenerationRequest,
  type GenerationStore,
  type ModelProvider,
  type ProjectSnapshot,
} from '@vibld/core';
import { ProviderError } from '@vibld/ai';
import type { PlanUsage } from '@vibld/ai';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { StyleDna } from '@vibld/ai/style-dna';
import { createValidator } from '../src/generation/validator.ts';
import { ACCOUNT_BUDGET_KEY, microUsdOf } from './spend.ts';
import type { TokenPrices } from './spend.ts';
import type { UserBudget } from './budget.ts';

/**
 * The pure half of durable generation (docs/decisions.md L26):
 * `generation-workflow.ts`'s `GenerationWorkflow` class is a thin
 * `WorkflowEntrypoint` wrapper around what is defined here. Kept separate
 * because `WorkflowEntrypoint` comes from the `cloudflare:workers` module
 * specifier, which only resolves inside the Workers runtime -- importing it
 * at all makes a file impossible to load under plain `node --test`, the way
 * `preview-fleet.ts`/`fleet.ts` already split for the same reason. Nothing
 * here imports `cloudflare:workers`, so `generation-run.test.ts` can
 * exercise every real decision without a Workflow runtime to run it in.
 */

export interface WorkflowParams {
  /**
   * One project per Clerk user (`index.ts` sets this to `principal.userId`)
   * -- there is no multi-project UI yet, so this is the whole of "which
   * project" for now. Revisit this the day that changes.
   */
  projectId: string;
  runId: string;
  prompt: string;
  base?: ProjectSnapshot;
  style?: StylePresetId;
  /** Standing visual preferences, already sanitized against the catalogue. */
  styleDna?: StyleDna;
  knowledge?: string;
  /**
   * Already-fetched, already-truncated text from a reference URL (L52-style
   * feature request: "a URL to copy from or emulate") -- see
   * `reference-fetch.ts`. The raw URL itself is not carried through: fetching
   * it is `handlePlan`'s job, before this Workflow instance is even created,
   * the same reason `knowledge` here is standing-instruction text and not
   * something this Workflow goes and looks up itself.
   */
  referenceContext?: string;
  model: string;
  userId: string;
  /** Display only (L3) -- never a ledger key. Carried through to the log line. */
  email?: string;
  /** Absent only if the reservation call itself failed to return an id. */
  reservationId?: number;
  /**
   * The `USER_BUDGET` instance `reservationId` was reserved against --
   * `userId` for the caller's monthly tier allowance, `"<userId>:topup"` if
   * the reservation was drawn from top-up credit instead (L37; see
   * `index.ts`'s `reserveBudget`). Settlement has to target the same
   * instance the reservation was made against, or it reconciles a balance
   * the run never actually drew from.
   */
  reservationKey?: string;
  accountReservationId?: number;
  worstCaseMicroUsd: number;
  prices: TokenPrices;
}

export interface GenerationWorkflowEnv {
  DB: D1Database;
  PROJECT_CONTENT: R2Bucket;
  USER_BUDGET: DurableObjectNamespace<Pick<UserBudget, 'settle'>>;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  VIBLD_PROVIDER?: string;
  VIBLD_MODEL?: string;
}

export interface GenerationOutcome {
  result: DurableGenerationResult;
  /** For the settlement log line only -- not shown to any caller. */
  outcome: 'ok' | 'failed';
}

/**
 * Never let a raw exception from the model client reach the generation
 * result. `GenerationMachine.run()`'s own catch puts `error.message`
 * straight into `result.errors` with no filtering -- correct for a client
 * running its own request, wrong here, where that message could carry an
 * upstream response body. `handlePlan` used to sit between the two for
 * exactly this reason; now that the model call happens inside the run
 * instead of beside it, the sanitising has to move to the same place.
 */
export class SanitizingModelProvider implements ModelProvider {
  readonly id: string;
  readonly #inner: ModelProvider;

  constructor(inner: ModelProvider) {
    this.id = inner.id;
    this.#inner = inner;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    try {
      return await this.#inner.generate(request);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      console.error('plan generation failed', error);
      throw new Error('Generation failed unexpectedly.');
    }
  }
}

/**
 * The staging, validation and promotion around one call to `provider`.
 *
 * Takes an already-built `store`/`provider` rather than an `Env`, so it is
 * testable with `@vibld/core`'s own fakes and this repo's D1/R2 test doubles
 * (`generation-store.test.ts`'s `SqliteD1Database`/`InMemoryR2Bucket`) --
 * there is no need for a real `PlanProvider` to exercise it.
 */
export async function runGeneration(
  store: GenerationStore,
  provider: ModelProvider,
  params: Pick<WorkflowParams, 'projectId' | 'runId' | 'prompt' | 'base'>,
): Promise<GenerationOutcome> {
  const runner = new DurableGenerationRunner(store);

  try {
    const result = await runner.run(
      {
        prompt: params.prompt,
        projectId: params.projectId,
        runId: params.runId,
        base: params.base,
      },
      provider,
      createValidator(),
    );
    return { result, outcome: result.state === 'accepted' ? 'ok' : 'failed' };
  } catch (error) {
    // Only D1/R2 can throw past this point -- `runner.run()` and
    // `GenerationMachine.run()` both already catch a provider failure and
    // return a `'failed'` result rather than reject.
    console.error('generation store unavailable', error);
    return {
      result: {
        state: 'failed',
        errors: ['Generation failed unexpectedly.'],
        conflict: false,
      },
      outcome: 'failed',
    };
  }
}

/**
 * Reconcile the pessimistic debit both ledger layers took before the run
 * started down to what it actually cost -- the same reconciliation
 * `handlePlan` used to do in its own `finally` block. Returns the settled
 * amount so the caller can log it.
 */
export async function settleBudget(
  ledger: DurableObjectNamespace<Pick<UserBudget, 'settle'>>,
  params: Pick<
    WorkflowParams,
    | 'userId'
    | 'reservationId'
    | 'reservationKey'
    | 'accountReservationId'
    | 'worstCaseMicroUsd'
    | 'prices'
  >,
  usage: PlanUsage | undefined,
): Promise<number> {
  // A run that never reported usage settles at the full reservation rather
  // than at zero: failing safe means over-counting, not under.
  const actual = usage
    ? microUsdOf(usage, params.prices)
    : params.worstCaseMicroUsd;

  if (params.reservationId !== undefined) {
    // `reservationKey` is always set alongside `reservationId` by index.ts's
    // `reserveBudget`; falling back to `userId` is only a safety net for a
    // caller that predates the top-up bucket, not a real expected path.
    await ledger
      .getByName(params.reservationKey ?? params.userId)
      .settle(params.reservationId, actual);
  }
  // Both layers were reserved together (index.ts's `reserveBudget`), so both
  // settle together -- the account-wide ledger must reflect the same run at
  // the same cost, or its ceiling stops meaning what it says.
  if (params.accountReservationId !== undefined) {
    await ledger
      .getByName(ACCOUNT_BUDGET_KEY)
      .settle(params.accountReservationId, actual);
  }
  return actual;
}
