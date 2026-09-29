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
  GROUP_MAX_TOKENS,
  OUTLINE_MAX_TOKENS,
  buildOutputBudgetFor,
  cacheRatesFor,
  callCeilingFor,
  chatMaxTokensFor,
  findModel,
  mockupMaxTokensFor,
  providerForRequest,
} from '@vibld/ai';
import type { ProviderEnv } from '@vibld/ai';

import {
  MAX_CHAT_FIXED_PROMPT_CHARS,
  MAX_CHAT_SUMMARY_CHARS,
  MAX_CHAT_TOTAL_CHARS,
  MAX_CHAT_TOTAL_PATH_CHARS,
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

import { largestReservable } from './reserve.ts';
import type { ReserveOutcome } from './reserve.ts';
import { DEFAULT_LIMITS } from './request-guard.ts';
import { parsePrices, worstCaseMicroUsd } from './spend.ts';
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
 * three sketches (internal issue 185, `MOCKUP_OUTPUT_TOKENS`). The two answers differ by
 * more than an order of magnitude, and the dispatch lives here rather than
 * at the call sites for the reason this whole file exists: a second place
 * that decides a ceiling is a second place that can disagree with the
 * reservation.
 */
export type RunKind = 'build' | 'mockups' | 'chat';

/**
 * Every character a mockup run may send the model.
 *
 * Here rather than inline in the route for the reason this whole file
 * exists: a second place that decides what a run costs is a second place
 * that can disagree with the reservation. It was inline, and it was wrong
 * (internal PR 189 review) -- it counted the caller's prompt and the style direction
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
 * (internal PR 189 review). A bound that no test can see the caller use is a bound
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

/**
 * How many single-call builds' worth of input one bounded build may send,
 * across all its calls.
 *
 * A bounded build (`packages/ai/src/bounded-build.ts`) makes an outline call
 * and then one call per group of files, and each group call carries the
 * request, the spec, the manifest and the files it depends on. Estimated
 * offline for the prompt that failed on 2026-09-29, with the scripted client
 * and a six-route site of realistic size, that is ten calls and about
 * 460,000 characters, most of it the shared prefix the provider serves from
 * its cache; a real spec and manifest run longer than the script's, which
 * could take it past 600,000. Four builds' worth is 1,026,000 characters:
 * room for that with half again to spare. An estimate, not a measurement:
 * re-measure once a real run has been traced.
 *
 * It is enforced, not only reserved for. The run refuses to make a call
 * whose prompt would pass what is left of this, so the reservation below
 * is a bound on what the run sends and not an estimate of it.
 */
export const BOUNDED_INPUT_MULTIPLE = 4;

/**
 * Every character a bounded build may send the model, across every call it
 * makes. What `handlePlan` reserves for, and what the Workflow is told it
 * may spend (`WorkflowParams.maxInputChars`).
 */
export const BOUNDED_BUILD_INPUT_CHARS =
  BUILD_INPUT_CHARS * BOUNDED_INPUT_MULTIPLE;

export const MOCKUP_INPUT_CHARS =
  DEFAULT_LIMITS.maxPromptChars +
  MAX_MOCKUP_DIRECTION_CHARS +
  MAX_MOCKUP_FIXED_PROMPT_CHARS;

/**
 * Every character a chat turn may send the model (docs/decisions.md,
 * "Resolved 2026-09-28").
 *
 * What the caller may send, each term refused past its bound by
 * `parseChatRequest`, plus what this repository sends round it on every
 * turn. `chat-handler.test.ts` builds the largest prompt a turn can send and
 * fails if this does not cover it.
 */
export const CHAT_INPUT_CHARS =
  MAX_CHAT_TOTAL_CHARS +
  MAX_CHAT_SUMMARY_CHARS +
  MAX_CHAT_TOTAL_PATH_CHARS +
  MAX_CHAT_FIXED_PROMPT_CHARS;

/**
 * `carryTokens` is what a follow-up spends re-emitting the project it edits
 * (internal issue 209), from `carryTokensFor` below. A build gets the room a first run
 * would, plus that. A mockup run ignores it: three sketches carry nothing
 * back, and a mockup's ceiling is a runaway guard rather than a budget.
 *
 * A build's figure is the budget of the whole bounded build
 * (`buildOutputBudgetFor`), summed across its calls, rather than one
 * response's ceiling: each call is clamped on its own inside the run. So it
 * can exceed what the model writes in one response, and on the models the
 * money binds it does, which is the room a large site was missing.
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
        : kind === 'chat'
          ? chatMaxTokensFor(model, prices.outputMicroUsd)
          : buildOutputBudgetFor(model, prices.outputMicroUsd, carryTokens),
  };
}

/**
 * What a follow-up will spend carrying its project back out, for sizing the
 * run before it starts (internal issue 209).
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
    // Only a run that will actually rewrite this project carries it (internal PR 210
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

/**
 * A build's size: its output ceiling, the input it may send across all its
 * calls, and what the two cost together at worst. Always the three at once,
 * for the reason this file exists: the Workflow is told the budgets the
 * reservation was priced for, and a budget passed on without its price is
 * how a run comes to outspend what it holds.
 */
export interface BuildSize {
  ceiling: RunCeiling;
  inputChars: number;
  worstCase: number;
}

/**
 * The smallest build worth starting: room for the outline and for one group
 * of files, at the model's prices.
 *
 * Derived from the ceilings the run already holds each call to rather than
 * chosen. The output is the outline's ceiling plus one group's, as
 * `callCeilingFor` clamps them for this model, so both calls can be asked
 * for everything they are allowed. The input is two single-call builds'
 * worth (`BUILD_INPUT_CHARS`), one per call, the unit
 * `BOUNDED_INPUT_MULTIPLE` already counts in: every term of it is
 * something the request guard bounds, and it is what one call may carry of
 * the caller's request.
 *
 * Neither side is ever larger than the full size it is a floor under.
 */
export function buildFloorSize(full: BuildSize, model: string): BuildSize {
  const maxTokens = Math.min(
    full.ceiling.maxTokens,
    callCeilingFor(model, OUTLINE_MAX_TOKENS) +
      callCeilingFor(model, GROUP_MAX_TOKENS),
  );
  const inputChars = Math.min(full.inputChars, 2 * BUILD_INPUT_CHARS);
  return {
    ceiling: { prices: full.ceiling.prices, maxTokens },
    inputChars,
    worstCase: worstCaseMicroUsd(full.ceiling.prices, maxTokens, inputChars),
  };
}

/**
 * A build sized to what the caller has left, or nothing below the floor
 * (docs/decisions.md, "Resolved 2026-09-29").
 *
 * The whole-run reservation (internal PR 292) is the worst case of every call a bounded
 * build may make, about $3.20 on GPT-6 Sol, while a real build there costs
 * about seventy cents. So a Free account, a dollar a month, was refused the
 * default model outright with its whole dollar unspent. This is the smaller
 * reservation it gets instead, and the Workflow is told the smaller budgets
 * with it: the run refuses any call that would pass either, so it cannot
 * spend past what it holds, and one that runs out of room fails with the
 * file it had reached named.
 *
 * Between the floor and the full size, both budgets grow by the same share
 * of the distance between them, so a caller with nearly enough gets nearly
 * the full run and the input and output stay in the proportion the full
 * size has. The input is kept to whole tokens (`worstCaseMicroUsd` rounds
 * it up), and whatever rounding is left is taken off the output, so the
 * figure reserved is never more than `availableMicroUsd`.
 */
export function fittedBuildSize(
  full: BuildSize,
  model: string,
  availableMicroUsd: number,
): BuildSize | undefined {
  if (availableMicroUsd >= full.worstCase) return full;
  const floor = buildFloorSize(full, model);
  if (availableMicroUsd < floor.worstCase) return undefined;
  const share =
    full.worstCase > floor.worstCase
      ? (availableMicroUsd - floor.worstCase) /
        (full.worstCase - floor.worstCase)
      : 0;
  const prices = full.ceiling.prices;
  let maxTokens =
    floor.ceiling.maxTokens +
    Math.floor(share * (full.ceiling.maxTokens - floor.ceiling.maxTokens));
  const inputChars =
    floor.inputChars +
    Math.floor((share * (full.inputChars - floor.inputChars)) / 4) * 4;
  let worstCase = worstCaseMicroUsd(prices, maxTokens, inputChars);
  if (worstCase > availableMicroUsd) {
    maxTokens = Math.max(
      floor.ceiling.maxTokens,
      maxTokens -
        Math.ceil((worstCase - availableMicroUsd) / prices.outputMicroUsd),
    );
    worstCase = worstCaseMicroUsd(prices, maxTokens, inputChars);
  }
  if (worstCase > availableMicroUsd) return undefined;
  return { ceiling: { prices, maxTokens }, inputChars, worstCase };
}

/**
 * What `handlePlan` makes of a budget refusal of the ordinary size: a build
 * fitted to what the caller's own ledger has left, or nothing.
 *
 * Only the caller's own ledger is fitted to. A refusal by the deployment's
 * daily ceiling (L29) stands as it is: that money is not the caller's, and
 * squeezing a smaller run in under it is not something anybody decided.
 */
export function fitBuildToCaller(model: string) {
  return (
    refused: Extract<ReserveOutcome, { ok: false }>,
    ordinary: BuildSize,
  ): BuildSize | undefined =>
    refused.ceiling?.layer === 'user'
      ? fittedBuildSize(ordinary, model, largestReservable(refused.ceiling))
      : undefined;
}

/** What `sizedReservation` settled on, and the reservation it got for it. */
export type SizedReservation<Reserved, Sized> = Sized & { reserved: Reserved };

/**
 * Reserve for a follow-up at the size it needs, and at the size a first run
 * gets if the caller cannot cover that (internal PR 210 review).
 *
 * The larger room was approved as something a caller gets when they can
 * afford it. Refusing outright when they cannot would make a follow-up on a
 * large project strictly worse off than it was before internal issue 209, which reserved
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
 * And one step further down, where `fit` is given: a budget refusal of the
 * ordinary size is answered with whatever `fit` makes of the refusal, which
 * for a build is a smaller run sized to what the caller has left
 * (`fittedBuildSize`). `fit` saying nothing means there is nothing smaller
 * worth asking for, and the refusal stands.
 *
 * Only on a budget refusal. `too-many-in-flight` is a different fact, and
 * asking again for less would not change it.
 */
export async function sizedReservation<
  Sized extends { worstCase: number },
  Reserved extends
    | { ok: true }
    | {
        ok: false;
        verdict: { reason: 'period-ceiling' | 'too-many-in-flight' };
      },
>(
  carry: number,
  sizeFor: (carryTokens: number) => Sized,
  reserve: (worstCase: number) => Promise<Reserved>,
  fit?: (
    refused: Extract<Reserved, { ok: false }>,
    ordinary: Sized,
  ) => Sized | undefined,
): Promise<SizedReservation<Reserved, Sized>> {
  const refusedOnMoney = (
    reserved: Reserved,
  ): reserved is Extract<Reserved, { ok: false }> =>
    !reserved.ok && reserved.verdict.reason === 'period-ceiling';

  let sized = sizeFor(carry);
  let reserved = await reserve(sized.worstCase);
  if (refusedOnMoney(reserved) && carry > 0) {
    sized = sizeFor(0);
    reserved = await reserve(sized.worstCase);
  }
  if (refusedOnMoney(reserved) && fit) {
    const smaller = fit(reserved, sized);
    if (smaller && smaller.worstCase < sized.worstCase) {
      return { ...smaller, reserved: await reserve(smaller.worstCase) };
    }
  }
  return { ...sized, reserved };
}
