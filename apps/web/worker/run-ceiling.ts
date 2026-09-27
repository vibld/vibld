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
  MAX_BUILD_FIXED_PROMPT_CHARS,
  MAX_MEDIA_SECTION_CHARS,
  MAX_MOCKUP_DIRECTION_CHARS,
  MAX_MOCKUP_FIXED_PROMPT_CHARS,
  MAX_BASE_CONTENT_CHARS,
  MAX_REFERENCE_CHARS,
  outputTokensToCarry,
  projectChars,
} from '@vibld/ai/limits';
import type { GenerationStore } from '@vibld/core';

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
 * except the last two. One is what this repository wraps round a chosen
 * direction: the label, the framing that names the document as data, and
 * the values measured from it. The other is what every build sends whoever
 * asked: the system prompt and the retrieved guidance, which were never
 * counted at all until the spec made the system prompt longer. The last is
 * the caller's media library, listed so the build uses real files.
 */
export const BUILD_INPUT_CHARS =
  DEFAULT_LIMITS.maxPromptChars +
  DEFAULT_LIMITS.maxTotalContentChars +
  DEFAULT_LIMITS.maxKnowledgeChars +
  MAX_REFERENCE_CHARS +
  MAX_CHOSEN_MOCKUP_SECTION_CHARS +
  MAX_BUILD_FIXED_PROMPT_CHARS +
  MAX_MEDIA_SECTION_CHARS;

export const MOCKUP_INPUT_CHARS =
  DEFAULT_LIMITS.maxPromptChars +
  MAX_MOCKUP_DIRECTION_CHARS +
  MAX_MOCKUP_FIXED_PROMPT_CHARS;

/**
 * `carryTokens` is what a follow-up spends re-emitting the project it edits
 * (#209), from `carryTokensFor` below. A build gets the room a first run
 * would, plus that. A mockup run ignores it: three sketches carry nothing
 * back, and a mockup's ceiling is a runaway guard rather than a budget.
 */
export function runCeilingFor(
  env: RunCeilingEnv,
  model: string,
  kind: RunKind = 'build',
  carryTokens = 0,
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
        : maxTokensFor(model, prices.outputMicroUsd, carryTokens),
  };
}

/**
 * What a follow-up will spend carrying its project back out, for sizing the
 * run before it starts (#209).
 *
 * Read here, in the request, because the reservation is made here: the
 * Workflow reads the ceiling from its params and never derives one, so this
 * is the only place a larger ceiling can come from. The project is loaded
 * only for a follow-up, which is the only kind of run that carries one,
 * and measured in the same unit `runGeneration` measures it in so the two
 * cannot disagree about how large it is.
 *
 * A failure to read it sizes the run as a first run would be sized, and
 * says so in the log. The run's own read of the project is authoritative
 * and fails the run properly if storage is really gone; this one only
 * decides how much room to reserve, and refusing the request over it would
 * turn a sizing hint into an outage.
 */
export async function carryTokensFor(
  store: Pick<GenerationStore, 'loadAccepted'>,
  projectId: string,
  baseRevision: string | undefined,
): Promise<number> {
  if (!baseRevision) return 0;
  try {
    const base = await store.loadAccepted(projectId);
    if (!base) return 0;
    // Only a run that will actually rewrite this project carries it (#210
    // review). `runGeneration` refuses two follow-ups for free before the
    // model is called: one whose revision has moved on, and one whose
    // project is too large to send. Both still reserve first, and the
    // ordinary reservation is one the caller can already cover. Sizing
    // either one up could make `reserve` refuse it instead, and the person
    // would be told they are out of budget when the truth is a conflict,
    // or a project past the size limit: the wrong problem, sent to the
    // wrong place.
    if (base.revision !== baseRevision) return 0;
    const chars = projectChars(base.files);
    if (chars > MAX_BASE_CONTENT_CHARS) return 0;
    return outputTokensToCarry(chars);
  } catch (error) {
    console.error('could not size the follow-up; reserving as a first run', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/** What `sizedReservation` settled on, and the reservation it got for it. */
export interface SizedReservation<Reserved> {
  reserved: Reserved;
  ceiling: RunCeiling;
  worstCase: number;
}

/**
 * Reserve for a follow-up at the size it needs, and at the size a first run
 * gets if the caller cannot cover that (#210 review).
 *
 * The larger room was approved as something a caller gets when they can
 * afford it. Refusing outright when they cannot would make a follow-up on a
 * large project strictly worse off than it was before #209, which reserved
 * the ordinary amount and let the run try. So a budget refusal of the larger
 * amount is answered by asking for the ordinary one, and only a refusal of
 * *that* reaches the caller.
 *
 * It also closes the race the carry opened. The project is read before the
 * reservation, so another tab can promote in between, and the run then
 * refuses the stale revision as a conflict for free. With the larger amount
 * refused and nothing to fall back to, that person would have been told they
 * were out of budget instead of that their project had moved. Falling back
 * lets the run start and say the true thing.
 *
 * Only on a budget refusal. `too-many-in-flight` is a different fact, and
 * asking again for less would not change it.
 */
export async function sizedReservation<
  Reserved extends
    | { ok: true }
    | {
        ok: false;
        verdict: { reason: 'period-ceiling' | 'too-many-in-flight' };
      },
>(
  carry: number,
  sizeFor: (carryTokens: number) => { ceiling: RunCeiling; worstCase: number },
  reserve: (worstCase: number) => Promise<Reserved>,
): Promise<SizedReservation<Reserved>> {
  const sized = sizeFor(carry);
  const reserved = await reserve(sized.worstCase);
  if (
    reserved.ok ||
    reserved.verdict.reason !== 'period-ceiling' ||
    carry <= 0
  ) {
    return { reserved, ...sized };
  }
  const ordinary = sizeFor(0);
  return { reserved: await reserve(ordinary.worstCase), ...ordinary };
}
