import {
  DurableGenerationRunner,
  type DurableGenerationResult,
  type GenerationPlan,
  type GenerationRequest,
  type GenerationStore,
  type ModelProvider,
  type RunTrace,
} from '@vibld/core';
import { DEFAULT_MAX_TOKENS, ProviderError, findModel } from '@vibld/ai';
import { MAX_BASE_CONTENT_CHARS } from '@vibld/ai/limits';
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
  /**
   * The revision the caller believed it was editing, or absent for a new
   * project. Not the project itself (#181): the files are read from storage
   * by `runGeneration` below, so a follow-up is no longer bounded by what a
   * browser can upload or by a model's context window.
   *
   * Still carried, because dropping it would be a lost update. A second tab
   * that promoted while this one sat open moves the accepted revision, and
   * without this assertion the run would silently build on the newer project
   * and the user would get an edit of something they never saw.
   */
  baseRevision?: string;
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
  /**
   * The dominant colour of the reference page, as a six-digit hex. The
   * palette is re-derived from it where it is used rather than carried
   * whole, so the contrast guarantee is re-established on arrival.
   */
  referencePaletteSource?: string;
  /**
   * Whether that page was a light page or a dark one, as read from its own
   * `color-scheme` or its own background declarations. Carried separately
   * because the hex cannot say it: the dominant colour of a page is an
   * accent, and an accent's lightness does not describe the ground behind
   * it. Validated as one of two literals on arrival, same as the hex is
   * validated by being re-parsed.
   */
  referencePaletteMode?: 'light' | 'dark';
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
  /**
   * The output ceiling this run's reservation was computed against, captured
   * with the prices beside it rather than re-derived when the Workflow runs.
   *
   * A Workflow is durable: it can start minutes after `handlePlan` reserved
   * for it, and `VIBLD_USD_MICRO_PER_OUTPUT_TOKEN` can move in between.
   * Deriving the ceiling again on arrival would price the request off a
   * newer number than the one settlement still uses, which is the same
   * reservation-and-request mismatch this field exists to prevent, only
   * separated by time rather than by call site.
   *
   * Required, so the compiler refuses a params object that omits it. That
   * covers new runs; it says nothing about payloads already persisted when
   * this field shipped, which is what `ceilingForRun` exists to handle.
   */
  maxTokens: number;
}

/**
 * The output ceiling a run may actually ask for.
 *
 * A Workflow's params are persisted JSON, so the type describes what new
 * code must write and not what an in-flight payload contains. A run enqueued
 * before `maxTokens` existed resumes without it, and the fallback is
 * `DEFAULT_MAX_TOKENS` specifically, not the provider's own: that run's
 * reservation was computed against the flat 64000 the old code used, so
 * letting it reach a derived ceiling would let a queued DeepSeek Flash run
 * emit 384000 tokens against a 64000 reservation and outspend it sixfold.
 * The one case where the old constant is still the right answer is a run
 * that was priced by the old constant.
 */
export function ceilingForRun(
  params: Pick<WorkflowParams, 'maxTokens'>,
): number {
  return params.maxTokens ?? DEFAULT_MAX_TOKENS;
}

export interface GenerationWorkflowEnv {
  DB: D1Database;
  PROJECT_CONTENT: R2Bucket;
  USER_BUDGET: DurableObjectNamespace<Pick<UserBudget, 'settle'>>;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
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
  params: Pick<
    WorkflowParams,
    'projectId' | 'runId' | 'prompt' | 'baseRevision'
  >,
): Promise<GenerationOutcome> {
  const runner = new DurableGenerationRunner(store);

  try {
    // The project, read here rather than received (#181). `loadAccepted`
    // was already the runner's fallback; now it is the only path, so the
    // files never make the round trip through the browser.
    const base = params.baseRevision
      ? await store.loadAccepted(params.projectId)
      : undefined;

    // The assertion the caller made, checked before a token is spent. The
    // authoritative check is still the compare-and-set at promotion, which
    // catches a base that moves *during* the run; this catches one that had
    // already moved before it started, and refuses for free rather than
    // after paying for a generation that cannot be promoted.
    if (params.baseRevision && base?.revision !== params.baseRevision) {
      return {
        result: {
          state: 'failed',
          stop: 'conflict',
          accepted: base,
          errors: ['Accepted revision changed before promotion'],
          conflict: true,
        },
        outcome: 'failed',
      };
    }

    // The project still goes into the prompt, so it still has to fit a
    // model's context. Reading it here rather than receiving it removed the
    // upload, not that budget, and the provider would throw on an oversized
    // base either way -- but by then the run is paid for. The guard used to
    // refuse this for free and cannot any more, because it no longer sees
    // the files. So the refusal moves here, and stays free.
    const baseChars = (base?.files ?? []).reduce(
      (sum, file) => sum + file.path.length + file.content.length,
      0,
    );
    if (baseChars > MAX_BASE_CONTENT_CHARS) {
      return {
        result: {
          state: 'failed',
          stop: 'context-exceeded',
          accepted: base,
          errors: [
            `This project is ${baseChars} characters and ${MAX_BASE_CONTENT_CHARS} is the most that can be sent with a follow-up. Ask for a smaller change on a smaller project, or start a new one.`,
          ],
          conflict: false,
        },
        outcome: 'failed',
      };
    }

    const result = await runner.run(
      {
        prompt: params.prompt,
        projectId: params.projectId,
        runId: params.runId,
        ...(base ? { base } : {}),
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
        // D1 or R2, not the model: `runner.run()` and `GenerationMachine`
        // both catch a provider failure and return rather than throw, so
        // anything reaching here is this service's own storage.
        stop: 'store-unavailable',
        errors: ['Generation failed unexpectedly.'],
        conflict: false,
      },
      outcome: 'failed',
    };
  }
}

/**
 * What this run is worth recording (#167).
 *
 * Pure, and built from values the workflow already had in hand at
 * settlement: the same model, tokens and cost its `generation.settled` log
 * line has always carried, shaped into the record `RunTrace` describes so
 * they reach the person whose run it was rather than only the server output.
 *
 * Nothing is derived here that the caller could get wrong later: the window
 * is read from the catalogue at the moment of the run, because a model's
 * window changes and the one this run actually had is the one worth seeing.
 * An unknown model yields zero, which `contextPressure` already treats as
 * "no window known" rather than dividing by it.
 */
export function traceOf(
  params: Pick<WorkflowParams, 'projectId' | 'runId' | 'model'>,
  result: Pick<DurableGenerationResult, 'stop'>,
  usage: PlanUsage | undefined,
  timing: { costMicroUsd: number; elapsedMs: number; endedAt: string },
): RunTrace {
  return {
    runId: params.runId,
    projectId: params.projectId,
    stop: result.stop,
    model: params.model,
    // Zero where the provider reported nothing, which is the honest figure
    // for "not reported". The cost beside it is not zero in that case: an
    // unreported run settles at its full reservation (`settleBudget`), so a
    // row with no tokens and a real cost is exactly what happened, and
    // inventing token counts to match the money would be the lie.
    inputTokens: usage?.inputTokens ?? 0,
    cachedInputTokens: usage?.cacheReadInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    contextWindow: findModel(params.model)?.contextWindow ?? 0,
    costMicroUsd: timing.costMicroUsd,
    elapsedMs: timing.elapsedMs,
    endedAt: timing.endedAt,
  };
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
