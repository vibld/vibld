/**
 * What one run may ask its model for, and what that will cost if it uses all
 * of it.
 *
 * These are one question, and the bug this file exists to prevent is asking
 * it twice. For a while the reservation priced a flat 64000 while the
 * provider was free to emit whatever its own constant said, which is a run
 * permitted to outspend its own reservation. Deriving both from one call
 * means a caller cannot take one without the other.
 *
 * Asked once per run, by `handlePlan`, and the answer travels with the run:
 * both numbers go into `WorkflowParams`, and `GenerationWorkflow` reads the
 * ceiling from there rather than calling this again. That is deliberate. A
 * Workflow is durable and may start long after the reservation, so a second
 * call there would answer from a newer environment than the one settlement
 * is still using, which is the same drift measured in time instead of in
 * call sites.
 *
 * The price is the one actually in force, not the catalogue's. An operator
 * may correct a stale rate with `VIBLD_USD_MICRO_PER_OUTPUT_TOKEN`, and a
 * ceiling derived from the catalogue while the reservation charges the
 * override is the same divergence wearing different clothes.
 */

import {
  cacheRatesFor,
  findModel,
  maxTokensFor,
  mockupMaxTokensFor,
  providerForRequest,
} from '@vibld/ai';
import type { ProviderEnv } from '@vibld/ai';

import {
  MAX_CHOSEN_MOCKUP_SECTION_CHARS,
  MAX_MOCKUP_DIRECTION_CHARS,
  MAX_MOCKUP_FIXED_PROMPT_CHARS,
  MAX_REFERENCE_CHARS,
} from '@vibld/ai/limits';

import { DEFAULT_LIMITS } from './request-guard.ts';
import { parsePrices } from './spend.ts';
import type { TokenPrices } from './spend.ts';

export interface RunCeilingEnv extends ProviderEnv {
  VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
  VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
}

export interface RunCeiling {
  /** What a token costs, after any operator override. */
  prices: TokenPrices;
  /** The output ceiling to reserve against and to ask the model for. */
  maxTokens: number;
}

/**
 * What a run is for, which is what decides how much it may ask for.
 *
 * A build is as large as the project needs; three mockups are as large as
 * three sketches (#185, `MOCKUP_OUTPUT_TOKENS`). The two answers differ by
 * more than an order of magnitude, and the dispatch lives here rather than
 * at the call sites for the reason this whole file exists: a second place
 * that decides a ceiling is a second place that can disagree with the
 * reservation.
 */
export type RunKind = 'build' | 'mockups';

/**
 * Every character a mockup run may send the model.
 *
 * Here rather than inline in the route for the reason this whole file
 * exists: a second place that decides what a run costs is a second place
 * that can disagree with the reservation. It was inline, and it was wrong
 * (#189 review) -- it counted the caller's prompt and the style direction
 * and stopped, while every run also sends `MOCKUP_SYSTEM_PROMPT` and a
 * styled one sends the preamble too. About 1,600 characters reserved for
 * nobody, so an account with exactly the computed reservation left was
 * admitted for a run that settled past it.
 *
 * Three terms, and they are three different kinds of thing, which is how
 * one came to be forgotten: what a caller may type, what this repository
 * adds because they chose a preset, and what this repository adds
 * regardless. `mockup-reservation.test.ts` measures the real artefacts and
 * fails if their sum ever exceeds this.
 */
/**
 * Every character a build may send the model.
 *
 * Extracted for the same reason `MOCKUP_INPUT_CHARS` below was, and after
 * the same mutation result: the fix for the chosen-mockup term lived in
 * `packages/ai`, so removing it from the Worker's own sum broke nothing
 * (#189 review). A bound that no test can see the caller use is a bound
 * that can be quietly dropped.
 *
 * Every term is something the request guard has already refused to exceed,
 * except the last, which is what this repository wraps round a chosen
 * direction: the label and the framing that names the document as data.
 */
export const BUILD_INPUT_CHARS =
  DEFAULT_LIMITS.maxPromptChars +
  DEFAULT_LIMITS.maxTotalContentChars +
  DEFAULT_LIMITS.maxKnowledgeChars +
  MAX_REFERENCE_CHARS +
  MAX_CHOSEN_MOCKUP_SECTION_CHARS;

export const MOCKUP_INPUT_CHARS =
  DEFAULT_LIMITS.maxPromptChars +
  MAX_MOCKUP_DIRECTION_CHARS +
  MAX_MOCKUP_FIXED_PROMPT_CHARS;

export function runCeilingFor(
  env: RunCeilingEnv,
  model: string,
  kind: RunKind = 'build',
): RunCeiling {
  const chosen = findModel(model);
  const prices = parsePrices(
    env,
    providerForRequest(env, model),
    chosen
      ? {
          inputMicroUsd: chosen.inputMicroUsd,
          outputMicroUsd: chosen.outputMicroUsd,
          // The cached rates follow the model rather than the provider
          // default, for the same reason the input rate does: a run on Opus
          // must not be priced at DeepSeek's rate because the deployment
          // happens to default to DeepSeek.
          ...cacheRatesFor(chosen),
        }
      : undefined,
  );
  return {
    prices,
    maxTokens:
      kind === 'mockups'
        ? mockupMaxTokensFor(model, prices.outputMicroUsd)
        : maxTokensFor(model, prices.outputMicroUsd),
  };
}
