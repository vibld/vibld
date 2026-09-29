import {
  DurableGenerationRunner,
  type DurableGenerationResult,
  type GenerationPlan,
  type GenerationRequest,
  type GenerationStore,
  type ModelProvider,
  type ProjectFile,
  type ProjectSnapshot,
  type RunStepTrace,
  type RunTrace,
} from '@vibld/core';
import {
  BoundedBuildError,
  BoundedBuilder,
  DEFAULT_MAX_TOKENS,
  ProviderError,
  RUN_STEP_TIMEOUT_MS,
  applyBoundedPatch,
  checkDesign,
  findModel,
  keepingRecordOf,
  repairPromptFor,
  runBoundedBuild,
  stepOf,
  withRecordOf,
} from '@vibld/ai';
import {
  CHARS_PER_OUTPUT_TOKEN,
  MAX_BASE_CONTENT_CHARS,
  projectChars,
} from '@vibld/ai/limits';
import type {
  BoundedBuildResult,
  DerivedPalette,
  MediaManifestEntry,
  PlanClient,
  PlanUsage,
} from '@vibld/ai';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { StyleDna } from '@vibld/ai/style-dna';
import { createValidator } from '../src/generation/validator.ts';
import type { RunPhase } from '../src/generation/run-phase.ts';
import type { CheckVerdict } from '../src/generation/build-check.ts';
import type { CheckStageState } from './generation-store.ts';
import { ACCOUNT_BUDGET_KEY, microUsdOf, worstCaseMicroUsd } from './spend.ts';
import type { TokenPrices } from './spend.ts';
import type { UserBudget } from './budget.ts';
import type { HoldClaim, HoldSettler, RunProgress } from './run-progress.ts';
import type { ServiceBinding } from './publish-client.ts';
import {
  askWhileBusy,
  buildWithin,
  BUILD_CALL_TIMEOUT_MS,
} from './publish-client.ts';
import type { BuildFailureReason, buildProject } from './publish-client.ts';
import { LEDGER_CALL_TIMEOUT_MS } from './reserve.ts';
import type { reserveBudget } from './reserve.ts';
import { BUILD_INPUT_CHARS } from './run-ceiling.ts';
import { OUT_OF_TIME, retrying, sleep, withinDeadline } from '@vibld/core';

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
   * The project this run builds in, already established as the caller's by
   * `handlePlan` (`resolveRunProject`), which is why nothing here checks it
   * again. A UUID for a project made since an account could have several,
   * or the owner's Clerk user id for the one it had before.
   *
   * Everything else the run does stays per account and reads `userId`
   * instead: the spend ledger, the verification build's sandbox, and the
   * media library the build may place.
   */
  projectId: string;
  runId: string;
  prompt: string;
  /**
   * The revision the caller believed it was editing, or absent for a new
   * project. Not the project itself (internal issue 181): the files are read from storage
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
   * The caller's media library as the prompt describes it, read at request
   * time (`/api/media`). Carried rather than re-read in the Workflow so the
   * build, its checks and its repair all see the same list. Absent when
   * the library could not be read, or for a run from before media: the
   * build then has none to use, and the media check is skipped rather
   * than run against an empty list.
   */
  media?: MediaManifestEntry[];
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
  /**
   * The direction the caller chose from a mockup run (internal issue 185), as the
   * document rather than its name. Optional: most builds have never seen a
   * mockup, and a payload persisted before this field existed has none.
   */
  chosenMockup?: { label: string; html: string };
  worstCaseMicroUsd: number;
  prices: TokenPrices;
  /**
   * The output ceiling this run's reservation was computed against, captured
   * with the prices beside it rather than re-derived when the Workflow runs.
   * For a bounded build it is the whole run's output, summed across its
   * calls (`buildOutputBudgetFor`); each call is given what is left of it,
   * up to its own ceiling.
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
  /**
   * What every call of this run's bounded build may send together, in
   * characters: the input side of the reservation, captured with it for the
   * reason `maxTokens` is (`BOUNDED_BUILD_INPUT_CHARS`).
   *
   * Optional because a payload persisted before bounded builds has none,
   * and `inputBudgetForRun` holds such a run to the one call's worth it was
   * reserved for.
   */
  maxInputChars?: number;
  /**
   * What the caller was allowed to spend when this run was admitted, so a
   * repair turn can hold a reservation of its own without asking again
   * (internal issue 194).
   *
   * Carried rather than re-derived, for the reason `maxTokens` above gives
   * and one more. `spendableFor` needs a `Principal`, which a Workflow does
   * not have and would have to reconstruct from `userId` and an optional
   * `email`; a fabricated identity deciding what somebody may spend is a
   * worse failure than a figure that is a few minutes old. These are the
   * same two numbers the run was already admitted on, so the repair is
   * held against the allowance that let the run start rather than one that
   * moved underneath it.
   *
   * Being stale is not a way to overspend. They are ceiling *inputs*: the
   * ledger still measures real spend at the moment the repair asks, so a
   * caller who has spent more since is refused by `reserve` whatever these
   * say.
   *
   * Optional, and absent means no repair. A payload persisted before these
   * existed resumes without them, and a run that cannot say what its caller
   * may spend must not guess: it finishes with whatever the first attempt
   * produced, which is exactly what every run did before this shipped.
   */
  monthlyAllowance?: number;
  topupCeiling?: number;
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

/**
 * Whether a run was enqueued as a bounded build.
 *
 * Every run `handlePlan` has created since bounded builds shipped carries
 * `maxInputChars`, the input side of its reservation. A payload without it
 * was enqueued before, was reserved for one response, and may already hold
 * that response's result under the step name the old code used, so the
 * Workflow runs it the old way rather than paying for it twice.
 */
export function isBoundedRun(
  params: Pick<WorkflowParams, 'maxInputChars'>,
): boolean {
  return params.maxInputChars !== undefined;
}

/**
 * The input a run's calls may send together, in characters.
 *
 * What the reservation was priced for where the payload says, and
 * otherwise one single-call build's worth, `BUILD_INPUT_CHARS`: that is
 * what a payload persisted before bounded builds was reserved against, and
 * a run may not send more than it was funded for, whatever shape it now
 * runs in. Such a run fails with its budget named if it needs more, rather
 * than spending past its reservation.
 */
export function inputBudgetForRun(
  params: Pick<WorkflowParams, 'maxInputChars'>,
): number {
  const reserved = params.maxInputChars;
  return typeof reserved === 'number' &&
    Number.isFinite(reserved) &&
    reserved > 0
    ? reserved
    : BUILD_INPUT_CHARS;
}

/**
 * What a run has produced so far, as the model streams it.
 *
 * Two counts rather than one, because the production provider is a reasoning
 * model and they answer different questions. `characters` is the answer:
 * what `onProgress` has always meant, and what the meter displays.
 * `reasoningCharacters` is the thinking that precedes it, billed as output
 * and deliberately kept out of the meter (internal PR 190) -- but it is the difference
 * between "nothing has happened" and "the model has not started writing
 * yet", and on a measured mockup run it was between 57% and 68% of the
 * output tokens. A meter fed only by the answer would sit at zero for most
 * of the wait it exists to explain.
 */
export interface ProgressReport {
  characters: number;
  reasoningCharacters: number;
  /**
   * Which step of a bounded build is running, in the words the builder
   * shows: "Planning the project", "Writing 3 of 7: services page".
   * `characters` counts the whole run, not this step, so the meter does
   * not go back to zero each time a step starts.
   */
  step?: string;
  /**
   * Which part of its work the run is doing, as a word the builder can
   * act on rather than show (`run-phase.ts`): `outline` or `writing` from
   * the model steps. The rest are said by the Workflow as it moves on
   * (`RunProgress.enter`).
   */
  phase?: RunPhase;
}

/**
 * What the channel answers, which is more than the last report.
 *
 * A report is evidence of what a run produced, never of when. The model
 * call ends and the Workflow keeps reporting `running` through settlement
 * and the trace write, retries included, so the last report outlives the
 * work it described by up to a minute (internal PR 193 review, P2). Read on its own it
 * would say a model that had stopped was still thinking.
 *
 * So the step says when it is done, and the channel carries that beside the
 * numbers. Monotonic: a report that lands after the finish still lands, and
 * still does not make the run unfinished again.
 */
export interface RunProgressState {
  report?: ProgressReport;
  /** True once the generate step has left, however it left. */
  finished: boolean;
  /**
   * Which part of its work the run is doing (`run-phase.ts`), where it has
   * said; absent before it has, and after the object is evicted.
   */
  phase?: RunPhase;
}

/**
 * The floor on how often a run reports, in milliseconds.
 *
 * A stream calls back on every delta, several times a second; the poll loop
 * reads every 1.5 seconds (`POLL_INTERVAL_MS`). Reporting faster than it is
 * read spends requests to produce numbers nobody sees, so this is set just
 * under the read interval: fast enough that a poll rarely finds a stale
 * report, slow enough that most deltas cost nothing.
 */
export const PROGRESS_REPORT_INTERVAL_MS = 1_000;

/**
 * Wrap a reporter so a per-delta callback becomes an occasional one.
 *
 * Two things are dropped, and they are different. A report inside the
 * interval is dropped because it would arrive before anybody reads;
 * a report identical to the last is dropped whenever it arrives, because
 * sending it again cannot change what the reader sees. The second matters
 * most in the case the meter exists for: a model that thinks for minutes
 * streams nothing at all, and a reporter without that check would keep
 * paying for a request a second to say so.
 *
 * The first report is never dropped. A run that thinks before it writes has
 * no second delta for a while, so waiting out an interval would hold back
 * the one piece of news there is.
 *
 * `send` is called rather than awaited, so a slow or failed channel cannot
 * hold up the stream it is describing -- losing a progress report costs the
 * reader a stale number for a second, and blocking the model call to deliver
 * one would cost them the run.
 *
 * What makes the interval work at all is not visible from here. A Worker's
 * clock advances only when the Worker performs I/O, so a throttle measured
 * with `Date.now()` in a loop of pure computation would read the same
 * instant forever and let exactly one report through. This one is driven by
 * `readCompletionStream`, which awaits a read from the response body for
 * every chunk, so the clock moves between deltas. Anything that ever calls
 * this from a loop that does no I/O has to pass its own `now`.
 */
export function throttleProgress(
  send: (report: ProgressReport) => void,
  intervalMs: number = PROGRESS_REPORT_INTERVAL_MS,
  now: () => number = Date.now,
): (progress: { characters: number; reasoningCharacters?: number }) => void {
  let sentAt = 0;
  let sent: ProgressReport | undefined;
  return (progress) => {
    // Normalised here rather than passed through. A provider that does not
    // stream reasoning omits the field, and "this provider does not say" is
    // a distinction the client keeps on purpose (internal PR 190) -- but the channel
    // reports a count, and a channel whose number is sometimes absent would
    // make the reader distinguish it from zero for no reason.
    const report: ProgressReport = {
      characters: progress.characters,
      reasoningCharacters: progress.reasoningCharacters ?? 0,
    };
    if (
      sent !== undefined &&
      sent.characters === report.characters &&
      sent.reasoningCharacters === report.reasoningCharacters
    ) {
      return;
    }
    const at = now();
    if (sent !== undefined && at - sentAt < intervalMs) return;
    sentAt = at;
    sent = report;
    send(report);
  };
}

/**
 * Which failures are statements about the project, one decision for both
 * questions this file asks about a build (internal PR 196 review).
 *
 * A record over the whole union rather than a pair of comparisons, because
 * a comparison does not notice a reason that did not exist when it was
 * written. `worthRepairing` and `judgedTheProject` both used
 * `reason === 'install' || reason === 'build'` against a `string`, so a
 * sixth reason added to `publish-client.ts` would have been classified by
 * both of them, silently, as not the project's. That is the safe direction
 * and it is still a decision nobody took: the new reason might be exactly
 * the evidence a repair turn acts on, and the feature would simply not fire
 * for it.
 *
 * Typed as `Record<BuildFailureReason, boolean>`, so adding a member to
 * that union and not classifying it here does not compile.
 *
 * `install` is usually a package the model invented or misspelled and
 * `build` is the compiler refusing what it was given. The rest are the
 * build service talking about itself: `busy` is a refusal issued before the
 * build starts, so the code was never looked at, `sandbox` is the container,
 * and `output` is a build that succeeded and could not be read back.
 */
const ABOUT_THE_PROJECT: Record<BuildFailureReason, boolean> = {
  install: true,
  build: true,
  busy: false,
  sandbox: false,
  output: false,
};

/**
 * The same question asked of a result rather than of a reason: `ok` is a
 * statement about the project too, and an absent reason is not.
 *
 * An absent reason is deliberately not one. `publish-client.ts` leaves it
 * absent when the build service sends something it does not recognise, and
 * "I could not read why this failed" is not evidence about the project.
 */
function aboutTheProject(reason: BuildFailureReason | undefined): boolean {
  return reason !== undefined && ABOUT_THE_PROJECT[reason];
}

/**
 * Whether a failed build is worth spending a second model call on (internal issue 194).
 *
 * Two questions, and they are separate on purpose. The first is whether the
 * failure says anything about the project, which is `ABOUT_THE_PROJECT`
 * above and is asked the same way by both builds in this file.
 *
 * The second is whether the run can pay for it. A payload persisted before
 * `monthlyAllowance` existed cannot say what its caller may spend, and a run
 * that cannot say that must not guess: no repair, and the reader keeps what
 * the first attempt produced, which is what every run did before this
 * shipped.
 */
export function worthRepairing(
  build: { ok: boolean; reason?: BuildFailureReason },
  params: Pick<WorkflowParams, 'monthlyAllowance' | 'topupCeiling'>,
): boolean {
  if (build.ok) return false;
  if (!aboutTheProject(build.reason)) return false;
  return canPayForRepair(params);
}

/**
 * The second of `worthRepairing`'s questions on its own, because a project
 * that builds and fails its own spec (`checkDesign`) asks it too.
 */
export function canPayForRepair(
  params: Pick<WorkflowParams, 'monthlyAllowance' | 'topupCeiling'>,
): boolean {
  return (
    typeof params.monthlyAllowance === 'number' &&
    typeof params.topupCeiling === 'number'
  );
}

/**
 * What the verify-and-repair step is given before it is considered hung.
 *
 * A build, a model call and a second build. The first version of this said
 * exactly that and then funded one build (internal PR 196 review): a slow first build
 * followed by a model call near its own limit would have timed out before
 * the second build, failing a Workflow whose project was already accepted,
 * promoted and billed.
 *
 * Two builds at `apps/preview`'s own bounds (five minutes installing and
 * five compiling, each) is twenty minutes, plus room for the work those
 * bounds do not cover: writing the project into the container and reading
 * the output back. `repair-timeout.test.ts` checks this against that
 * module's real numbers, because the two live in separate deployments that
 * share no build and can drift apart silently.
 *
 * Deliberately *not* added to anything the reclaim compares against, and
 * that still holds at the larger figure. This step runs after the run's own
 * settlement, so the only reservation alive while it works is the one it
 * makes; and that one is settled immediately after the model call, before
 * the second build, so its life is the model call rather than the step.
 * RUN_ABANDONED_AFTER_MS bounds the hold, not the step (internal issue 194).
 */
export const REPAIR_BUILD_ALLOWANCE_MS = 30 * 60_000;
export const REPAIR_STEP_TIMEOUT_MS =
  RUN_STEP_TIMEOUT_MS + REPAIR_BUILD_ALLOWANCE_MS;

/**
 * What the `assemble` step is given: applying the patch, validation, the
 * stage writes and the promotion, all D1 and R2 and no model. Five minutes
 * is generous for that, and short next to the reclaim window, which this
 * step's own heartbeat restarts as it begins.
 */
export const ASSEMBLE_STEP_TIMEOUT_MS = 5 * 60_000;

/**
 * How long the repair's second build waits out a busy workspace, and how
 * often it asks again (internal PR 196 review).
 *
 * The first build's container teardown holds that user's build lock until
 * the container is gone, and it no longer holds up the build it belongs to:
 * it runs on `ctx.waitUntil`, so a repair's model call and its predecessor's
 * teardown now overlap. Ordinarily the teardown is one `destroy()` and is
 * finished long before the model call is, but when it is not, the second
 * build met a `busy` refusal and the repair was returned unverified. The
 * caller had just paid for it, and checking whether it builds is the whole
 * point of paying.
 *
 * Bounded at half a minute rather than joined, because waiting out the
 * teardown's own ten-minute cap would put back on the caller's clock exactly
 * what moving it to `ctx.waitUntil` took off. Thirty seconds covers a slow
 * destroy; a teardown still holding the lock after that is the pathological
 * case, and giving up there reports the repair as unverified, which is what
 * the code already did and is honest.
 *
 * It is spent inside `REPAIR_BUILD_ALLOWANCE_MS` and `repair-timeout.test.ts`
 * checks that the allowance has room for it on top of the two builds. A wait
 * that fits only because nobody added it up is the defect that allowance has
 * had twice already.
 *
 * Counted in attempts rather than measured against the clock, and the budget
 * is derived from the two. A loop whose only bound is `Date.now()` moving
 * does not terminate when it does not move, which is not a hypothetical: the
 * first version of this hung the test suite, because the fake clock these
 * tests inject is a constant.
 *
 * The attempts bound the sleeping and a wall clock bounds the rest
 * (internal PR 196 review). Six retries of a thirteen-minute call is ninety-one
 * minutes of build, not one build and thirty seconds of waiting, and the
 * allowance above was sized for the second reading: a near-limit first
 * build, a near-limit model call and one near-limit busy retry already came
 * to about fifty-six minutes against a step funded for sixty. So `rebuild`
 * takes one budget of `BUILD_CALL_TIMEOUT_MS + REBUILD_WAIT_BUDGET_MS` for
 * the whole sequence, passes what is left of it to each call, and stops
 * asking when there is not enough left to wait and still build.
 * `repair-timeout.test.ts` adds that up against the allowance.
 */

export interface GenerationWorkflowEnv {
  DB: D1Database;
  PROJECT_CONTENT: R2Bucket;
  /**
   * `reserve` as well as `settle` since internal issue 194: the verify-and-repair step
   * holds a reservation of its own for the second model call. `touch`
   * since bounded builds: each model step keeps the run's reservation from
   * being taken for abandoned (`touchReservation`).
   */
  USER_BUDGET: DurableObjectNamespace<
    Pick<UserBudget, 'reserve' | 'settle' | 'touch'>
  >;
  /** Read by `reserveBudget` when the repair holds its own reservation. */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  VIBLD_MAX_IN_FLIGHT?: string;
  /**
   * The live progress channel (internal issue 183). Typed by the one method used rather
   * than by the class, the way `USER_BUDGET` is: the Workflow only reports
   * and the poll loop only reads.
   *
   * Optional, and the run does not report when it is absent. Progress is
   * decoration: a deployment missing the binding must still generate, and
   * the meter falls back to the clock alone, which is what it showed before
   * this channel existed.
   */
  RUN_PROGRESS?: DurableObjectNamespace<
    Pick<
      RunProgress,
      | 'report'
      | 'finish'
      | 'enter'
      | 'claimSettlement'
      | 'callStarted'
      | 'callFinished'
    >
  >;
  /**
   * `@vibld/preview`, for building the project the run just produced (internal issue 194).
   *
   * Only the build half of what `publish-client.ts` calls: publishing needs
   * `PUBLISH` too, and a deployment that can build but not publish must
   * still check its own output. Optional, and absent means the run finishes
   * unchecked, which is what every run did before this.
   */
  PREVIEW?: ServiceBinding;
  PREVIEW_INTERNAL_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VIBLD_PROVIDER?: string;
  VIBLD_MODEL?: string;
}

/**
 * What the verify-and-repair step is given to work with, and gives back.
 *
 * `built` is the question the step exists to answer, and it is deliberately
 * three-valued. True and false are a build that ran; `undefined` is a build
 * that never happened, because the binding is absent or the run produced no
 * files to build, and reporting that as false would say a project failed a
 * check nothing performed.
 */
export interface RepairOutcome {
  built?: boolean;
  /**
   * Whether the repaired project builds, asked the same way the first one
   * was (internal PR 196 review).
   *
   * Three-valued, and the middle case is the point. True and false are a
   * second build that ran. `undefined` is a repair that happened and whose
   * result could not be checked, because the build service went away
   * between the two calls. Reporting that as true would declare the exact
   * production failure this feature exists to catch fixed on the strength
   * of the model having answered.
   *
   * It is deliberately not "the generation was accepted". Acceptance is the
   * structural validator saying the files are well formed and inside the
   * project root; it says nothing about whether they compile, which is the
   * whole question.
   */
  repaired?: boolean;
  /**
   * The repaired project, when there is one, for the caller to return in
   * place of the attempt that did not build.
   *
   * Without this the repair was invisible where it mattered most: it
   * promotes a new accepted revision into the store, and the Workflow went
   * on returning the first attempt's files, so the reader was shown the
   * broken project while the store held the fixed one. Present only when
   * the repair was accepted -- a repair that itself failed leaves the
   * original result alone, because a project that does not build is still
   * more than an error message.
   */
  result?: DurableGenerationResult;
  /**
   * The first attempt put back after a repair broke it.
   *
   * A repair bought for the design checks alone starts from a project that
   * builds. If what comes back does not, the repair made things worse, and
   * the store is moved back to the attempt that built, by the same
   * compare-and-set every promotion uses, so an edit made in the meantime
   * is never overwritten. `result` is then absent, because the first
   * attempt is what the store holds again.
   */
  restored?: boolean;
  /**
   * Why no repair was attempted, when a failing build did not buy one.
   *
   * `unavailable` covers both services this step needs and says nothing
   * about the project itself. `built` tells the two apart: absent means the
   * build service could not be reached and nothing is known, false means the
   * project was built and does not build, and the ledger could not be asked
   * to pay for a repair.
   */
  skipped?:
    | 'not-configured'
    | 'not-the-project'
    | 'no-budget'
    | 'unavailable'
    | 'timed-out';
  /**
   * Why a repair that was paid for came back unbuilt (internal PR 196 review).
   *
   * `repaired` being absent already says that nothing was found out, and it
   * says nothing about which of the reasons it was. The one worth telling
   * apart from the rest is `busy`, because that is this step tripping over
   * its own predecessor's teardown rather than anything about the wider
   * world, and it is the residual the bounded wait in `rebuild` does not
   * cover. Without this the only sign of it is a repair that quietly never
   * reports `repaired`, which is indistinguishable from the build service
   * having been down.
   *
   * `unavailable` covers both a build that could not be asked at all and
   * one whose answer named a reason this deployment does not know: neither
   * came back with anything that says a thing about the files.
   */
  unverified?: BuildFailureReason | 'unavailable';
  /**
   * How many of `checkDesign`'s errors and warnings the first attempt had:
   * a spec colour, font or breakpoint the code dropped, a page with no
   * `lang`, an image without alt text, and so on. Absent when there were
   * none. Errors alone buy a repair of a project that builds.
   */
  designErrors?: number;
  designWarnings?: number;
  /** The errors left after a repair, counted the same way. */
  designErrorsAfter?: number;
  /** The repair's own reservation, settled by this step and not the run's. */
  repairCostMicroUsd?: number;
  /**
   * Whether that reservation was actually closed.
   *
   * Present and false only where every settlement attempt failed, which
   * leaves a hold open for `UserBudget`'s reclaim to charge at its full
   * worst case thirty-five minutes later. It is worth a field rather than a
   * silent catch: it is the one outcome here that costs the caller money
   * nobody measured, and the log line is where an operator would see it.
   */
  settled?: boolean;
  /**
   * How long this step took, the build and the checks and any repair,
   * measured by the Workflow around it and stored with its result.
   */
  elapsedMs?: number;
  /**
   * The repair's own row in the run record (internal PR 196 review).
   *
   * Its own row rather than an addition to the run's, because the repair is
   * its own run: its own id, its own model call, its own tokens. Folding
   * only its cost into the parent trace would have left that row's cost
   * describing two calls while its token counts described one, and
   * `contextPressure` and `cacheHitRate` read those counts. The run cost
   * the sum of the two rows, and both rows say what they are.
   */
  trace?: RunTrace;
}

export interface GenerationOutcome {
  result: DurableGenerationResult;
  /** For the settlement log line only -- not shown to any caller. */
  outcome: 'ok' | 'failed';
  /**
   * Whether the provider was actually asked for a plan.
   *
   * Settlement needs this because "no usage was reported" has two causes
   * that cost opposite amounts. A run that called the model and could not
   * measure what it spent must settle at its worst case, because failing
   * safe means over-counting. A run refused before the model was called
   * spent nothing, and charging it a worst case would bill a caller the
   * price of a full generation for being told no.
   *
   * False only where that is certain: the two preflight refusals below.
   * Everything else, including a store failure that could have happened on
   * either side of the call, says true and settles the cautious way.
   */
  providerRan: boolean;
}

/**
 * Never let a raw exception from the model client reach a caller.
 *
 * `GenerationMachine.run()`'s own catch puts `error.message` straight into
 * `result.errors` with no filtering -- correct for a client running its own
 * request, wrong here, where that message could carry an upstream response
 * body. A `ProviderError` is ours and says only what we wrote; anything
 * else is replaced, and the original goes to the log where an operator can
 * see it and a caller cannot.
 *
 * Shared by the build path and the mockup one (internal issue 185) rather than written
 * twice. This is the rule that decides what a stranger is allowed to read
 * when something breaks, and a second copy of it is how one of the two
 * would come to leak what the other does not.
 */
export function sanitizedProviderFailure(
  error: unknown,
  logLabel: string,
  visible: string,
): Error {
  if (error instanceof ProviderError) return error;
  console.error(logLabel, error);
  return new Error(visible);
}

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
      throw sanitizedProviderFailure(
        error,
        'plan generation failed',
        'Generation failed unexpectedly.',
      );
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
/**
 * The revision a run asserts it is editing, whichever shape said so.
 *
 * A Workflow's params are persisted JSON and do not change shape when an
 * interface does. One queued before internal issue 181 shipped carries the whole `base`
 * snapshot and no `baseRevision`, and reading only the new field would take
 * it for a run with nothing to assert -- which is precisely the lost update
 * this change exists to prevent, reintroduced for the runs that were already
 * in flight when it shipped. The old shape carried the same fact in
 * `base.revision`, so it is read rather than dropped.
 *
 * Declared loosely on purpose: `WorkflowParams` describes what new code
 * writes, and this function exists for what old payloads contain.
 */
export function assertedBaseRevision(
  params: Pick<WorkflowParams, 'baseRevision'>,
): string | undefined {
  if (params.baseRevision) return params.baseRevision;
  const legacy = (params as { base?: { revision?: unknown } }).base;
  return typeof legacy?.revision === 'string' && legacy.revision.length > 0
    ? legacy.revision
    : undefined;
}

/**
 * The checks a run makes before a token is spent, and the refusal when one
 * fails. Both are free: nothing has been asked of the model.
 *
 * Its own function because two places ask it. The Workflow's `prepare` step
 * asks before any model step runs, so a stale revision or an oversized
 * project costs nothing. `runGeneration` asks again when it stages the
 * result, because the project can move while the model steps run; there
 * the same answer is a conflict with the bill already run up, and the
 * caller settles what the steps spent.
 */
export async function preflightRun(
  store: GenerationStore,
  params: Pick<WorkflowParams, 'projectId' | 'baseRevision'>,
): Promise<{ refusal?: GenerationOutcome; base?: ProjectSnapshot }> {
  // The project, read here rather than received (internal issue 181). `loadAccepted` was
  // already the runner's fallback; now it is the only path, so the files
  // never make the round trip through the browser.
  const asserted = assertedBaseRevision(params);
  const base = asserted
    ? await store.loadAccepted(params.projectId)
    : undefined;

  // The assertion the caller made, checked before a token is spent. The
  // authoritative check is still the compare-and-set at promotion, which
  // catches a base that moves *during* the run; this catches one that had
  // already moved before it started, and refuses for free rather than
  // after paying for a generation that cannot be promoted.
  if (asserted && base?.revision !== asserted) {
    return {
      refusal: {
        result: {
          state: 'failed',
          stop: 'conflict',
          accepted: base,
          errors: ['Accepted revision changed before promotion'],
          conflict: true,
        },
        outcome: 'failed',
        providerRan: false,
      },
    };
  }

  // The project still goes into the prompt, so it still has to fit a
  // model's context. Reading it here rather than receiving it removed the
  // upload, not that budget, and the provider would refuse an oversized base
  // either way -- but by then the run is paid for. The guard used to refuse
  // this for free and cannot any more, because it no longer sees the files.
  // So the refusal moves here, and stays free.
  const baseChars = projectChars(base?.files ?? []);
  if (baseChars > MAX_BASE_CONTENT_CHARS) {
    return {
      refusal: {
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
        providerRan: false,
      },
    };
  }
  return base ? { base } : {};
}

export async function runGeneration(
  store: GenerationStore,
  provider: ModelProvider,
  params: Pick<
    WorkflowParams,
    'projectId' | 'runId' | 'prompt' | 'baseRevision' | 'model' | 'maxTokens'
  >,
): Promise<GenerationOutcome> {
  const runner = new DurableGenerationRunner(store);

  try {
    const checked = await preflightRun(store, params);
    if (checked.refusal) return checked.refusal;
    const base = checked.base;

    // What this deliberately does *not* do: refuse a follow-up because its
    // project looks too large for the room the run has (internal PR 208 review). A
    // follow-up may shrink a project, and both terms of any such estimate
    // are estimates. It is also moot now: a follow-up is a patch
    // (`bounded-build.ts`) and writes only the files it changes, each group
    // in a response of its own.
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
    return {
      result,
      outcome: result.state === 'accepted' ? 'ok' : 'failed',
      providerRan: true,
    };
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
      // D1 or R2 failing says nothing about whether the model was already
      // asked, so this settles the cautious way rather than the cheap one.
      providerRan: true,
    };
  }
}

/**
 * A bounded build that has already run, behind the `ModelProvider` the
 * staging and promotion path takes.
 *
 * The Workflow runs the model steps first, each durable on its own, and then
 * hands their result to `runGeneration`, so a bounded build is validated,
 * staged and promoted by exactly the code every run always went through.
 * `generate` asks no model: it applies the patch to the project the runner
 * read, or raises the failure the steps ended on, with its stop, so the run
 * record says why.
 */
export class PreparedPlanProvider implements ModelProvider {
  readonly id: string;
  readonly #built: BoundedBuildResult;

  constructor(id: string, built: BoundedBuildResult) {
    this.id = id;
    this.#built = built;
  }

  async generate(request: GenerationRequest): Promise<GenerationPlan> {
    const built = this.#built;
    if (!built.ok || !built.patch) {
      throw new BoundedBuildError(
        built.failure?.stop ?? 'provider-error',
        built.failure?.message ?? 'Generation failed unexpectedly.',
      );
    }
    return applyBoundedPatch(built.patch, request.base);
  }
}

/**
 * What a run came to once its model steps are over: the refusal the free
 * checks made, or the steps' result staged, validated and promoted by
 * `runGeneration`, with what the steps spent.
 *
 * Whether the model was asked is the steps' to say, not the staging's:
 * every model call of the run was made by a step. A project that moved
 * while the steps ran is refused by `runGeneration` as though nothing had
 * been spent, and the steps did spend; a run whose steps stopped before any
 * call spent nothing, however the staging then reads it. `usage` is absent
 * only when no call was made, which `settleBudget` reads with `providerRan`
 * to decide between nothing and the worst case.
 */
export async function assembleRun(
  store: GenerationStore,
  params: WorkflowParams,
  prepared: { refusal?: GenerationOutcome },
  built: BoundedBuildResult | undefined,
): Promise<GenerationOutcome & { usage?: PlanUsage; calls: number }> {
  if (prepared.refusal || !built) {
    return {
      ...(prepared.refusal ?? {
        result: {
          state: 'failed',
          stop: 'provider-error',
          errors: ['Generation failed unexpectedly.'],
          conflict: false,
        },
        outcome: 'failed',
        providerRan: false,
      }),
      calls: 0,
    };
  }
  const staged = await runGeneration(
    store,
    new SanitizingModelProvider(new PreparedPlanProvider(params.model, built)),
    params,
  );
  return {
    ...staged,
    providerRan: built.calls > 0,
    ...(built.calls > 0 ? { usage: built.usage } : {}),
    calls: built.calls,
  };
}

/**
 * Tell both ledger layers the run is still alive (`UserBudget.touch`).
 *
 * Best effort, and never a reason to stop: a heartbeat that fails leaves
 * the reservation to be reclaimed at its worst case if the run then outlives
 * the window, which is the outcome every run had before this existed, and
 * failing the run instead would cost the caller the files as well.
 */
export async function touchReservation(
  ledger: DurableObjectNamespace<Pick<UserBudget, 'touch'>>,
  params: Pick<
    WorkflowParams,
    'userId' | 'reservationId' | 'reservationKey' | 'accountReservationId'
  >,
): Promise<void> {
  const layers: [string, number | undefined][] = [
    [params.reservationKey ?? params.userId, params.reservationId],
    [ACCOUNT_BUDGET_KEY, params.accountReservationId],
  ];
  await Promise.all(
    layers.map(async ([key, id]) => {
      if (id === undefined) return;
      try {
        await withinDeadline(
          Promise.resolve(ledger.getByName(key).touch(id)),
          LEDGER_CALL_TIMEOUT_MS,
        );
      } catch (error) {
        console.error('could not keep a reservation alive', {
          key: key === ACCOUNT_BUDGET_KEY ? key : 'user',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

/**
 * Whether Stop has already closed this run's reservation, asked by the
 * settle step before it settles (D60), and what Stop charged the caller for
 * it where Stop could say (D65).
 *
 * Stop terminates the Workflow and then closes the reservation itself, so
 * a run that reaches its settle step all the same must not close it a
 * second time. Asking is also what takes the settlement for the step, so a
 * Stop that arrives after this finds it taken and leaves it to the step.
 *
 * `false` for everything but a Stop that got there first: no channel, a run
 * with no hold recorded, and a channel that could not be asked. The last is
 * the conservative reading, not a careless one. The ledger's `settle`
 * overwrites rather than adds, so settling after a Stop that did close it
 * replaces Stop's figure with the one measured, and never charges twice.
 */
export async function stoppedFirst(
  channel:
    | { claimSettlement(by: HoldSettler): HoldClaim | Promise<HoldClaim> }
    | undefined,
): Promise<false | { charged?: number }> {
  if (!channel) return false;
  try {
    const claim = await channel.claimSettlement('workflow');
    if (claim.claimed !== 'taken') return false;
    return claim.charged !== undefined ? { charged: claim.charged } : {};
  } catch (error) {
    console.error('could not ask whether a run was stopped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Where a run's model calls say what they risk and what they spent, so a
 * Stop can charge that rather than the whole reservation (D65): the run's
 * own `RunProgress`.
 */
export interface CallMeter {
  callStarted(name: string, worstCaseMicroUsd: number): Promise<void> | void;
  callFinished(name: string, actualMicroUsd: number): Promise<void> | void;
}

/**
 * The most one call can cost at the run's prices: its output ceiling, and
 * every token of what is left of the run's input budget at the dearest
 * input rate, the way the reservation itself is priced (`worstCaseMicroUsd`).
 */
export function callWorstCaseMicroUsd(
  prices: TokenPrices,
  call: { maxTokens: number; maxInputTokens: number },
): number {
  return worstCaseMicroUsd(
    prices,
    Math.max(0, call.maxTokens),
    Math.max(0, call.maxInputTokens) * CHARS_PER_OUTPUT_TOKEN,
  );
}

/**
 * Write one call's record to the meter, and never fail the call doing it.
 *
 * A record that could not be written costs only the accuracy of a Stop
 * that lands while that call is running: its start unrecorded, the Stop
 * charges the calls that finished and not this one. A finish unrecorded
 * leaves the call at its worst case. Failing the step instead would cost
 * the caller the build, and a call already made is paid for either way.
 */
async function meterCall(
  write: () => Promise<void> | void,
  what: 'started' | 'finished',
): Promise<void> {
  try {
    await withinDeadline(Promise.resolve(write()), LEDGER_CALL_TIMEOUT_MS);
  } catch (error) {
    console.error(`could not record a model call as ${what}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** What the model steps of a run need beyond its params. */
export interface BuildStepDeps {
  client: PlanClient;
  /** Opened inside each step, where the project a follow-up edits is read. */
  store: () => Pick<GenerationStore, 'loadAccepted'>;
  /** The run's ledger, for the heartbeat. Absent: no heartbeat is sent. */
  ledger?: DurableObjectNamespace<Pick<UserBudget, 'touch'>>;
  /** Where progress goes, never awaited. Absent: nothing is reported. */
  report?: (report: ProgressReport) => void;
  /**
   * Where each call records its start and its cost (D65). Absent: nothing
   * is recorded, and a Stop charges the whole reservation.
   */
  meter?: CallMeter;
  /** The palette derived from the reference page, when there is one. */
  palette?: DerivedPalette | null;
}

/**
 * Where each model call of a bounded build is run: a Workflow's `step.do`,
 * or a stand-in that caches by name in a test.
 */
export type StepRunner = <T>(name: string, run: () => Promise<T>) => Promise<T>;

/**
 * The model steps of one run: the outline, then each group of files, each
 * made through `step` so the Workflow runs it as its own durable step.
 *
 * Returns what the steps came to, success or not, with the usage of every
 * call summed; it never throws for anything a call did. On a replay the
 * steps already done return their stored results and the model is not
 * asked again, so this comes to the same answer however often the Workflow
 * is resumed.
 *
 * Inside each step, before the call: the run's reservation is kept alive
 * (`touchReservation`), because the steps together can outlast the
 * reclaim window that one step fits inside; the step's words are
 * reported, so the builder can say what is being written; and the call is
 * recorded as started, at the most it can cost. After it, still inside the
 * step, what it cost is recorded, so a Stop can charge the run what it
 * spent (D65, `settleStopped`).
 */
export async function buildInSteps(
  deps: BuildStepDeps,
  params: WorkflowParams,
  step: StepRunner,
): Promise<BoundedBuildResult> {
  const builder = new BoundedBuilder(deps.client, {
    model: params.model,
    ...(params.style ? { style: params.style } : {}),
    ...(params.styleDna && Object.keys(params.styleDna).length > 0
      ? { styleDna: params.styleDna }
      : {}),
    ...(params.knowledge ? { knowledge: params.knowledge } : {}),
    ...(params.chosenMockup ? { chosenMockup: params.chosenMockup } : {}),
    ...(params.referenceContext
      ? { referenceContext: params.referenceContext }
      : {}),
    // Empty is passed too: the build is told there are no files.
    ...(params.media ? { media: params.media } : {}),
    ...(deps.palette ? { palette: deps.palette } : {}),
    onUnexpectedError: (error) => {
      console.error('plan generation failed', error);
    },
  });
  const asserted = assertedBaseRevision(params);
  const report = deps.report;
  return runBoundedBuild(
    builder,
    {
      prompt: params.prompt,
      ...(asserted
        ? {
            baseRevision: asserted,
            loadBase: () => deps.store().loadAccepted(params.projectId),
          }
        : {}),
      budget: {
        outputTokens: ceilingForRun(params),
        inputChars: inputBudgetForRun(params),
      },
    },
    {
      step,
      beforeCall: async (label, before, call) => {
        report?.({
          characters: before,
          reasoningCharacters: 0,
          step: label,
          // The outline's step, and its one retry, are `outline*`; every
          // other model step writes files.
          phase: call.name.startsWith('outline') ? 'outline' : 'writing',
        });
        if (deps.ledger) await touchReservation(deps.ledger, params);
        // Before the call, so a Stop that lands while it runs charges it
        // at the most it can cost rather than at nothing.
        const meter = deps.meter;
        if (meter) {
          const worst = callWorstCaseMicroUsd(params.prices, call);
          await meterCall(() => meter.callStarted(call.name, worst), 'started');
        }
      },
      afterCall: async (name, record) => {
        // One line per model call as it finishes, so a slow step can be
        // found while the run is still going, not only in its trace:
        // metadata only (D20), the step's name and its numbers.
        if (record.called) {
          console.log(
            JSON.stringify({
              event: 'generation.step',
              runId: params.runId,
              model: params.model,
              ...stepOf(name, record),
            }),
          );
        }
        const meter = deps.meter;
        if (!meter) return;
        // Priced as the settle step prices the run: an unmeasured call's
        // usage is already its worst case (`CallRecord.usage`).
        const actual = microUsdOf(record.usage, params.prices);
        await meterCall(() => meter.callFinished(name, actual), 'finished');
      },
      ...(report
        ? {
            progress: (label: string, before: number) => {
              const throttled = throttleProgress((progress) =>
                report({ ...progress, step: label }),
              );
              return (progress: {
                characters: number;
                reasoningCharacters?: number;
              }) =>
                throttled({
                  characters: before + progress.characters,
                  reasoningCharacters: progress.reasoningCharacters ?? 0,
                });
            },
          }
        : {}),
    },
  );
}

interface SettlementOutcome {
  /** What was settled, absent when nothing was. */
  cost?: number;
  settled: boolean;
}

/**
 * Close the repair's own reservation, and never fail the run doing it.
 *
 * The distinction this keeps is between money and files. The reservation is
 * this step's to close and closing it matters, but the caller's project
 * exists whether or not the ledger answered, and it is already promoted by
 * the time this runs. So settlement is retried while there is reason to
 * think it might work, and then recorded as not having happened rather than
 * thrown (internal PR 196 review).
 */
async function settleRepairHold(
  deps: {
    settle: typeof settleBudget;
    wait?: (ms: number) => Promise<void>;
  },
  env: GenerationWorkflowEnv,
  params: WorkflowParams,
  held: Awaited<ReturnType<typeof reserveBudget>>,
  usage: PlanUsage | undefined,
  /**
   * Whether the repair's model call actually went out (internal PR 196 review).
   *
   * Not a hard-coded `true`, though it was. `runGeneration` returns
   * normally with `providerRan: false` for the two refusals it makes before
   * calling anybody: a base snapshot over `MAX_BASE_CONTENT_CHARS`, and a
   * base revision that moved. Both are reachable here -- the repair carries
   * the whole accepted project as its base, and another run can promote
   * between the first build and this call -- and settling either at the
   * worst case bills somebody the price of a full generation for being told
   * no. True remains the answer when there is no outcome to read, which is
   * a throw, because then the call may well have gone out.
   */
  providerRan: boolean,
  /**
   * Whether this repair was given up on rather than answered (internal PR 196 review).
   *
   * The caller is charged nothing for it and the account ledger still
   * carries the worst case. The model was asked, so the deployment may well
   * have spent that money, and the account ceiling exists to bound what
   * this deployment spends; but the caller never received the repair, and
   * the repair is something this service decided to attempt on their
   * behalf rather than something they asked for.
   *
   * The same split `accountMicroUsd` was added for: the caller pays for the
   * attempt they got, the ceiling holds the attempt that was made.
   */
  abandoned = false,
): Promise<SettlementOutcome> {
  // Remembered across attempts, because `retrying` reports the last failure
  // and the informative one may not be last (internal PR 196 review). A first attempt
  // that closed the caller's layer and failed on the account's knows what
  // they were charged; a second attempt that cannot reach the caller's
  // ledger at all does not, and reading only the final error erased the
  // figure the first one had already established.
  let charged: number | undefined;
  const attempted = await retrying(async () => {
    try {
      return await withinDeadline(
        deps.settle(
          env.USER_BUDGET,
          {
            userId: params.userId,
            reservationId: held.ok ? held.layers.user.id : undefined,
            reservationKey: held.ok
              ? held.layers.userReservationKey
              : undefined,
            accountReservationId: held.ok ? held.layers.account.id : undefined,
            worstCaseMicroUsd: params.worstCaseMicroUsd,
            prices: params.prices,
          },
          usage,
          providerRan,
          abandoned ? params.worstCaseMicroUsd : undefined,
          abandoned ? 0 : undefined,
        ),
        LEDGER_CALL_TIMEOUT_MS,
      );
    } catch (error) {
      // The `instanceof` is the whole guard, and it is enough. Every
      // attempt recomputes the same figure from the same usage and prices,
      // so which attempt is remembered cannot matter; what matters is that
      // a later failure of a *different* kind, one that never reached the
      // caller's ledger and so knows nothing, leaves this alone.
      if (error instanceof PartialSettlement) charged = error.charged;
      throw error;
    }
  }, deps.wait);
  if (attempted.ok) return { cost: attempted.value, settled: true };
  // Worth a line of its own: this is a hold the reclaim will charge at full
  // worst case, and nothing else in the system will say so until then.
  console.error('repair settlement failed', attempted.error);
  // What the caller was actually billed, where that is known (internal PR 196 review).
  // `settleBudget` writes the caller's layer before the account's, so the
  // two can fail apart: a caller whose own hold closed at the figure their
  // usage came to has been billed correctly, and only the shared ceiling is
  // still holding a worst case. Reporting the worst case for both would
  // overstate a bill that is already right, on the record the reader sees.
  if (charged !== undefined) return { cost: charged, settled: false };
  return { settled: false };
}

/**
 * Build what the run produced, and buy one repair if it does not build.
 *
 * Internal issue 194: two of six real generations against the production provider
 * produced a project that fails `npm run build`, for two unrelated reasons,
 * with the same prompt passing on one run and failing on another. Publish
 * was the only gate on that, and it is the last of three exits.
 *
 * Everything this decides is decided elsewhere and tested there:
 * `worthRepairing` says whether a failure is the project's and whether the
 * run can pay, `repairPromptFor` says what to ask. What is here is the
 * order, the reservation, and the settlement of that reservation.
 *
 * The repair is a second run in its own right, under its own run id, so it
 * promotes its own revision rather than overwriting the stage record and
 * promotion the first one already wrote. It settles its own reservation
 * before returning, whatever happened: a hold this function makes and does
 * not close is one the reclaim charges in full thirty-five minutes later.
 */
/**
 * Whether a build result is a statement about the project, or about the
 * service that was asked (internal PR 196 review).
 *
 * `ok` is one, and so is a failure `ABOUT_THE_PROJECT` names as the
 * project's. Both builds in this file ask the same question of their own
 * result, so they ask it the same way: one of them used to answer `false`
 * where the other answered "unknown", which is the difference between
 * "this does not compile" and "nobody compiled it".
 */
function judgedTheProject(result: {
  ok: boolean;
  reason?: BuildFailureReason;
}): boolean {
  return result.ok || aboutTheProject(result.reason);
}

export async function verifyAndRepair(
  env: GenerationWorkflowEnv,
  params: WorkflowParams,
  result: DurableGenerationResult,
  deps: {
    build: typeof buildProject;
    reserve: typeof reserveBudget;
    settle: typeof settleBudget;
    generate: (
      provider: ModelProvider,
      request: Pick<
        WorkflowParams,
        | 'projectId'
        | 'runId'
        | 'prompt'
        | 'baseRevision'
        | 'model'
        | 'maxTokens'
      >,
    ) => Promise<GenerationOutcome>;
    /**
     * The repair's provider. `onUsage` is told what its calls spent, and
     * `onSteps`, where the provider says, what each call took, for the
     * repair's own row in the trace.
     */
    providerFor: (
      onUsage: (usage: PlanUsage) => void,
      onSteps?: (steps: RunStepTrace[]) => void,
    ) => ModelProvider;
    /**
     * Where the first attempt is put back if a design-only repair breaks
     * the build (`restored`). Without one, the repair stands as it is.
     */
    store?: GenerationStore;
    now?: () => number;
    /** Only so a test does not spend the settlement retry delay. */
    wait?: (ms: number) => Promise<void>;
    /**
     * Told as the step moves from checking the project to repairing it, so
     * the builder can say which (`run-phase.ts`). Never awaited for long
     * and never a reason to fail: it is what the lifecycle bar shows.
     */
    onPhase?: (phase: 'validating' | 'repairing') => Promise<void> | void;
  },
): Promise<RepairOutcome> {
  // Nothing to build. A refused or failed run has no files, and a build
  // that never happened must not be reported as one that failed.
  if (result.state !== 'accepted' || !result.accepted) return {};
  const say = async (phase: 'validating' | 'repairing') => {
    try {
      await deps.onPhase?.(phase);
    } catch {
      // The bar keeps the phase before, which is still the right step.
    }
  };
  await say('validating');
  // No build service here (a self-hosted or partial deployment). The
  // design checks need none, so they still run, and the build is one
  // nothing judged, as when the service cannot be reached.
  const buildService =
    env.PREVIEW && env.PREVIEW_INTERNAL_SECRET
      ? {
          PREVIEW: env.PREVIEW,
          PREVIEW_INTERNAL_SECRET: env.PREVIEW_INTERNAL_SECRET,
        }
      : undefined;

  /**
   * A build that reports a failure instead of throwing one.
   *
   * The service binding can reject: a preview-worker deploy, a Durable
   * Object outage, anything. Letting that propagate would fail the whole
   * Workflow *after* the project had been accepted, promoted and billed,
   * so the caller would be sent an error instead of the files they paid
   * for, and preview-service availability would quietly become a hard
   * dependency of every generation (internal PR 196 review). Every other non-project
   * build failure is already treated as "not the project's fault"; an
   * unreachable service is the same fact arriving differently.
   */
  const build = (
    files: ProjectFile[],
    within = BUILD_CALL_TIMEOUT_MS,
  ): Promise<
    | { ok: true }
    | { ok: false; error: string; reason?: BuildFailureReason }
    | undefined
  > =>
    buildService
      ? buildWithin(
          () => deps.build(buildService, params.userId, files),
          within,
        )
      : Promise.resolve(undefined);

  /**
   * The same build, given a bounded wait when the workspace is busy
   * (internal PR 196 review).
   *
   * Only the repair's second build uses this, and only because of what runs
   * beside it: the first build's teardown holds that user's build lock until
   * its container is gone, and since it moved to `ctx.waitUntil` it can still
   * be holding it while the model call runs. A `busy` refusal there is this
   * step tripping over its own predecessor, and it costs the thing the
   * caller just paid for: the repair is returned without anybody finding out
   * whether it builds.
   *
   * Asking again rather than joining the teardown. There is nothing to join:
   * the lock is the only signal the two share, and waiting on it for the
   * teardown's full cap would put ten minutes back on the caller's clock,
   * which is what moving the teardown off it was for.
   *
   * `busy` and nothing else. Every other refusal is about this build rather
   * than about a previous one, and asking again would spend the caller's
   * clock on an answer that will not change.
   */
  const rebuild = (files: ProjectFile[]) =>
    askWhileBusy(
      (within) => build(files, within),
      (answer) => Boolean(answer && !answer.ok && answer.reason === 'busy'),
      { wait: deps.wait ?? sleep, now: deps.now ?? Date.now },
    );

  const reached = await build(result.accepted.files);

  // The project against its own spec, and the rules every page must hold.
  // Free (it reads the files), so it runs whether or not the build passed,
  // or could be asked at all, and a repair that is bought for either reason
  // is told about both.
  const design = checkDesign(result.accepted.files, {
    ...(params.media
      ? { mediaPaths: params.media.map((entry) => entry.path) }
      : {}),
  });
  const designCounts = {
    ...(design.errors.length > 0 ? { designErrors: design.errors.length } : {}),
    ...(design.warnings.length > 0
      ? { designWarnings: design.warnings.length }
      : {}),
  };

  // Unreachable, not failed. Nothing is known about the build, so nothing
  // is claimed about it; with no design errors nothing is spent either.
  // With them, the build is treated as one nothing judged, and the design
  // errors buy a design repair as they would after a refusal.
  if (!reached && design.errors.length === 0) {
    return {
      ...designCounts,
      skipped: buildService ? 'unavailable' : 'not-configured',
    };
  }
  const first = reached ?? {
    ok: false as const,
    error: buildService
      ? 'The build service could not be reached.'
      : 'No build service is configured.',
  };

  if (first.ok) {
    // Only errors buy a repair: they are what the checker is sure of, and a
    // repair rewrites the whole project at the price of the build.
    if (design.errors.length === 0) return { built: true, ...designCounts };
    if (!canPayForRepair(params)) {
      return { built: true, ...designCounts, skipped: 'no-budget' };
    }
  } else {
    const judged = judgedTheProject(first);
    // A build service that could not judge the project says nothing about
    // it, but the design checks read the files and did: their errors buy a
    // design repair here as they would for a project that built.
    const designRepair =
      !judged && design.errors.length > 0 && canPayForRepair(params);
    if (!worthRepairing(first, params) && !designRepair) {
      return {
        ...(judged ? { built: false } : {}),
        ...designCounts,
        skipped: judged ? 'no-budget' : 'not-the-project',
      };
    }
  }
  // The repair is for the design alone when the first attempt built, or
  // when nothing judged whether it did.
  const designOnly = first.ok || !judgedTheProject(first);
  // What is known about the first attempt's build, and nothing more.
  const builtField = first.ok
    ? { built: true }
    : judgedTheProject(first)
      ? { built: false }
      : {};
  const repairPrompt = repairPromptFor(
    designOnly ? undefined : first.error,
    design,
    first.ok,
  );

  const now = deps.now ?? Date.now;
  // Asked for in a `try` for the same reason the build is (internal PR 196 review).
  // `reserve` rejects, rather than denying, when the budget Durable Object
  // is unreachable, and that rejection would escape a step with no retries
  // and fail the Workflow after the project had been accepted, promoted and
  // settled. A ledger that cannot be asked has not said no; it has said
  // nothing, and nothing is not a reason to throw away the caller's files.
  let held: Awaited<ReturnType<typeof reserveBudget>>;
  try {
    held = await withinDeadline(
      deps.reserve(
        env,
        params.userId,
        params.worstCaseMicroUsd,
        params.monthlyAllowance!,
        params.topupCeiling!,
        now(),
      ),
      LEDGER_CALL_TIMEOUT_MS,
    );
  } catch {
    // Including the deadline (internal PR 196 review). A ledger that never answers
    // has said exactly as much as one that rejects, which is nothing.
    //
    // What giving up cannot do is call back a reservation that lands
    // afterwards. There is no `waitUntil` inside a Workflow step, so a
    // hold made after this gave up waiting is one nobody settles, and
    // `UserBudget.reserve` charges it at its worst case when the reclaim
    // reaches it. That is the same bounded outcome this step already
    // records when a settlement cannot be made at all, and it is the
    // cheaper side of the trade: the alternative is waiting on a ledger
    // that is not answering until the step dies, which loses the caller
    // the project as well as the money.
    return { ...builtField, ...designCounts, skipped: 'unavailable' };
  }
  // Out of budget is not a failure of this step. The reader keeps the
  // project the first attempt produced, which is what they would have had
  // before any of this existed.
  if (!held.ok) {
    return { ...builtField, ...designCounts, skipped: 'no-budget' };
  }
  await say('repairing');

  const startedAt = now();
  let usage: PlanUsage | undefined;
  let repairSteps: RunStepTrace[] | undefined;
  let outcome: GenerationOutcome | undefined;
  let settlement: SettlementOutcome | undefined;
  /** Set when the model call was given up on rather than answered. */
  let abandoned = false;
  try {
    // Bounded on its own, not only by the step around it (internal PR 196 review).
    //
    // The hold this call sits inside is settled immediately after it, so
    // the hold's life *is* this call, and `UserBudget.reserve` reclaims any
    // hold older than `RUN_ABANDONED_AFTER_MS` and charges it at its full
    // worst case. The enclosing step is `REPAIR_STEP_TIMEOUT_MS`, which is
    // longer than that on purpose, because it also has to cover two builds.
    // So a provider that stalled could hold this open past the reclaim and
    // the caller would be billed a worst case they never spent, which is
    // the exact failure that decided where this step sits in the workflow.
    // I wrote that invariant into the module comment above and then left
    // the one call it depends on unbounded.
    //
    // Giving up does not stop the provider, and `settleRepairHold` in the
    // `finally` below already handles a call that threw: it settles with
    // whatever usage was reported before the deadline, which is the honest
    // figure rather than a worst case nobody spent.
    outcome = await withinDeadline(
      deps.generate(
        // A repair fixes the project against the spec it was built to; it
        // does not get to write a new one. Its DESIGN.md is replaced by
        // the first attempt's before anything is validated or promoted, so
        // a repair cannot drop a requirement from the record that every
        // later edit and check reads.
        keepingRecordOf(
          result.accepted.files,
          deps.providerFor(
            (reported) => {
              usage = reported;
            },
            (steps) => {
              repairSteps = steps;
            },
          ),
        ),
        {
          projectId: params.projectId,
          // Its own id. `promote` and `saveStage` are both keyed on it, so
          // reusing the run's would overwrite the record of the attempt
          // this one is repairing.
          runId: `${params.runId}:repair`,
          prompt: repairPrompt,
          baseRevision: result.accepted.revision,
          // The repair is itself a follow-up, so it is held to the same
          // arithmetic: it rewrites the project it just built, and a
          // ceiling that cannot carry that is refused here for free
          // rather than spent finding out.
          model: params.model,
          maxTokens: params.maxTokens,
        },
      ),
      RUN_STEP_TIMEOUT_MS,
    );
  } catch (error) {
    // Never out of this function (internal PR 196 review). The `verify-and-repair`
    // step has no retries and `handlePlan` reports an errored Workflow as
    // a failed generation, so a rejection here discards the response for a
    // project that was already accepted, promoted, settled and billed. The
    // repair is an extra this service attempts on the caller's behalf, and
    // nothing it does may cost them the run it is trying to improve.
    //
    // That was true of a throwing `deps.generate` before this bound
    // existed, and it never fired: `runGeneration` catches the provider and
    // the store itself, so an escape was something nobody had accounted
    // for. The deadline made it a path that really happens, and turned a
    // deliberate fail-closed into a routine way to lose somebody's work.
    if (!(error instanceof Error) || error.message !== OUT_OF_TIME) throw error;
    abandoned = true;
    // What giving up does not do, written here because "we looked at this
    // and accepted it" is worth nothing if the reasoning lives in a
    // resolved review thread (internal PR 196 review).
    //
    // The call is not cancelled; nothing here can cancel it. So a provider
    // that answers after the deadline runs on inside `runGeneration`, and
    // if the accepted revision has not moved in the meantime its promotion
    // succeeds. The caller then holds the project this function returned
    // while the store holds a repair they never saw.
    //
    // The cost of that is one refused request, not lost work or a wrong
    // charge. `runGeneration` checks the asserted base revision before it
    // spends anything, so the caller's next edit is refused for free with
    // "The project moved on before this could apply", and reloading the
    // project recovers it with the repair in hand.
    //
    // Every fix I can reach is worse than that. There is no cancellation to
    // call. Promoting something of our own to invalidate the late one hands
    // the caller a revision they did not ask for, to fix a revision they
    // did not ask for. Moving promotion out of `runGeneration` and into
    // this function would close it properly and is a change to the path
    // every generation takes, which is not a thing to do at the end of a
    // review of something else. Recorded as its own issue instead.
    //
    // What would change this: promotion becoming this function's act, or
    // the provider client gaining a cancel. Either makes the residual go
    // away rather than shrink.
  } finally {
    // In a `finally`, because a repair that threw still asked the model and
    // still holds a reservation. Leaving it open is the one outcome that
    // costs the caller their worst case rather than what they spent.
    //
    // Retried and then swallowed rather than awaited bare (internal PR 196 review). A
    // bare await put the settlement's own rejection in the way of
    // everything after it: the enclosing step has no retries, so a Durable
    // Object that blinked would have failed the Workflow and sent an error
    // to a caller whose repair had already been promoted. Throwing does not
    // close the hold either, so it loses the files and leaves the money.
    settlement = await settleRepairHold(
      deps,
      env,
      params,
      held,
      usage,
      outcome?.providerRan ?? true,
      abandoned,
    );
  }

  const settled = settlement?.settled !== false;
  // What the ledger will charge, which is not always what was measured. A
  // hold nothing could close is charged at its worst case by the reclaim,
  // so that is the figure the record carries rather than a zero that would
  // under-report a bill the caller is about to see.
  const repairCostMicroUsd =
    settlement?.cost ?? (settled ? undefined : params.worstCaseMicroUsd);
  const money = {
    ...(repairCostMicroUsd === undefined ? {} : { repairCostMicroUsd }),
    ...(settled ? {} : { settled: false }),
    ...(outcome
      ? {
          trace: traceOf(
            { ...params, runId: `${params.runId}:repair` },
            outcome.result,
            usage,
            {
              costMicroUsd: repairCostMicroUsd ?? 0,
              elapsedMs: now() - startedAt,
              endedAt: new Date(now()).toISOString(),
              ...(repairSteps ? { steps: repairSteps } : {}),
            },
          ),
        }
      : {}),
  };

  // A repair nobody answered leaves the caller exactly where they were,
  // with the project the first attempt produced: this hands back no result
  // of its own, so the workflow returns the one it already had. `built` is
  // false because the first build ran and said so, which is what bought
  // the repair in the first place.
  if (abandoned) {
    return { ...builtField, ...designCounts, skipped: 'timed-out', ...money };
  }

  // Accepted is not built (internal PR 196 review). The validator says the files are
  // well formed and inside the project root; it says nothing about whether
  // they compile, and compiling is the entire question. This feature exists
  // because a model's output passes every structural check and still fails
  // `npm run build`, so believing acceptance here would declare that exact
  // failure fixed without looking.
  const promoted =
    outcome?.result.state === 'accepted' && Boolean(outcome.result.accepted);
  if (!promoted || !outcome?.result.accepted) {
    // Not promoted is not proof that nothing was. Another tab can accept an
    // edit between the first build and the repair, and the repair's own
    // conflict carries what the store then held; without one, the store is
    // asked. The reader is handed that, or their next edit starts from a
    // revision that is gone.
    let current = outcome?.result.conflict
      ? outcome.result.accepted
      : undefined;
    if (!current && deps.store) {
      try {
        current = await deps.store.loadAccepted(params.projectId);
      } catch {
        // Not knowing leaves the first attempt, as before.
      }
    }
    return {
      ...builtField,
      ...designCounts,
      repaired: false,
      ...money,
      ...(current && current.revision !== result.accepted?.revision
        ? { result: { ...result, accepted: current } }
        : {}),
    };
  }

  const second = await rebuild(outcome.result.accepted.files);
  // Against the spec the first attempt was held to, not the repair's own:
  // a repair returns a new spec and DESIGN.md is rewritten from it, so a
  // model could satisfy the check by dropping the colour it was asked to
  // use from the spec instead of using it.
  const after = checkDesign(
    withRecordOf(result.accepted.files, outcome.result.accepted.files),
    params.media ? { mediaPaths: params.media.map((entry) => entry.path) } : {},
  );

  // A repair bought for the design alone, of a project that built, that is
  // no better: the first attempt goes back. No better is either of two
  // things. It no longer builds, judged by a build that ran (an unreachable
  // build service says nothing about it). Or it did not reduce the design
  // errors it was bought for, measured against the same spec: a repair
  // that fixes nothing, or trades one error for another, has only put a
  // known-good project at risk.
  const brokeTheBuild = Boolean(
    second && judgedTheProject(second) && !second.ok,
  );
  const noBetterDesign = after.errors.length >= design.errors.length;
  // What the store holds when a restore was refused because something else
  // was accepted in the meantime: that, not the repair, is what the reader
  // must be handed, or their next edit starts from a revision that is gone.
  let heldInstead: ProjectSnapshot | undefined;
  if (designOnly && deps.store && (brokeTheBuild || noBetterDesign)) {
    const restore = await restoreFirstAttempt(
      deps.store,
      params,
      outcome.result.accepted,
      result.accepted,
    );
    if (
      !restore.restored &&
      restore.current &&
      restore.current.revision !== outcome.result.accepted.revision
    ) {
      heldInstead = restore.current;
    }
    if (restore.restored) {
      // The restore puts back a revision other tabs already had, so an
      // edit begun from it can be accepted the moment it is back. The
      // reader is handed what the store then holds.
      let current: ProjectSnapshot | undefined;
      try {
        current = await deps.store.loadAccepted(params.projectId);
      } catch {
        // Not knowing leaves the first attempt, which was just restored.
      }
      return {
        ...builtField,
        ...designCounts,
        designErrorsAfter: after.errors.length,
        ...money,
        repaired: false,
        restored: true,
        ...(current && current.revision !== result.accepted?.revision
          ? { result: { ...result, accepted: current } }
          : {}),
      };
    }
  }
  // A repair that stands can still have been overtaken: another tab can
  // accept an edit of it while the second build runs. What the reader is
  // handed has to be what the store holds, or their next edit starts from
  // a revision that is no longer current.
  if (!heldInstead && deps.store) {
    try {
      const current = await deps.store.loadAccepted(params.projectId);
      if (current && current.revision !== outcome.result.accepted.revision) {
        heldInstead = current;
      }
    } catch {
      // Not knowing is not a reason to fail a run that has been paid for:
      // the repair is handed back as it was promoted.
    }
  }
  return {
    ...builtField,
    ...designCounts,
    designErrorsAfter: after.errors.length,
    ...money,
    // Undefined rather than false whenever the second build did not judge
    // the project: one that could not run at all, and one that came back a
    // refusal (internal PR 196 review). Another build can take the workspace lock
    // between the model call and this, and `busy`, `sandbox` and `output`
    // say as little about repaired files as they do about the originals.
    // Reporting false there would be the same claim `built` used to make:
    // that a project failed a check nothing performed.
    ...(second && judgedTheProject(second)
      ? { repaired: second.ok }
      : {
          unverified:
            second && !second.ok
              ? (second.reason ?? 'unavailable')
              : 'unavailable',
        }),
    // Returned whether or not it builds, because it is what the store now
    // holds. Handing back the first attempt would put the reader's copy and
    // the accepted revision out of step, which is the other finding on this
    // round.
    result: heldInstead
      ? { ...outcome.result, accepted: heldInstead }
      : outcome.result,
  };
}

/**
 * Whether this deployment checks what a run builds: whether there is a
 * build service to ask. Without one nothing is built, the run ends as it
 * always did, and nothing is shown before it ends (D69).
 */
export function checksBuilds(
  env: Pick<GenerationWorkflowEnv, 'PREVIEW' | 'PREVIEW_INTERNAL_SECRET'>,
): boolean {
  return Boolean(env.PREVIEW && env.PREVIEW_INTERNAL_SECRET);
}

/**
 * Show a run's revision before it is checked (D69, "show early, badge
 * it"): record that the run has promoted `result`'s revision and is
 * checking it, which is what the builder reads it from, streamed or asked
 * (`checkingOf` in `run-control.ts`).
 *
 * Only for a run whose result was accepted, on a deployment that checks
 * builds. False when nothing was opened, and the run then ends as it
 * always did, its result shown when it ends.
 *
 * The accepted revision itself is not touched: it was promoted in
 * `assemble`, before any of this, and stays what it was. What changes is
 * only when the builder is told about it.
 */
export async function openBuildCheck(
  store: {
    openCheck(record: {
      runId: string;
      projectId: string;
      baseRevision: string | null;
      revision: string;
    }): Promise<void>;
  },
  env: Pick<GenerationWorkflowEnv, 'PREVIEW' | 'PREVIEW_INTERNAL_SECRET'>,
  params: Pick<WorkflowParams, 'runId' | 'projectId' | 'baseRevision'>,
  result: DurableGenerationResult,
): Promise<boolean> {
  if (!checksBuilds(env)) return false;
  if (result.state !== 'accepted' || !result.accepted) return false;
  await store.openCheck({
    runId: params.runId,
    projectId: params.projectId,
    baseRevision: assertedBaseRevision(params) ?? null,
    revision: result.accepted.revision,
  });
  return true;
}

/**
 * What a run's check came to, for the revision the run ended at (D69).
 *
 *   passed      that revision was built and builds: the first attempt, a
 *               repair that builds, or the first attempt put back after a
 *               design repair that was no better
 *   failed      it was built and does not: the first attempt with no
 *               repair (none affordable, or one that timed out or was not
 *               promoted), or a repair that does not build either
 *   unchecked   nothing judged it: the build service could not be reached
 *               or refused for reasons of its own, or a repair was
 *               promoted and its build could not be asked
 *
 * Design errors are not part of it. They buy a repair when the project
 * builds, and a project left with some still builds; what the person is
 * told is whether the code on screen builds.
 */
export function checkVerdictOf(outcome: RepairOutcome): CheckVerdict {
  if (outcome.repaired === true) return 'passed';
  if (outcome.unverified) return 'unchecked';
  if (outcome.built === true) return 'passed';
  if (outcome.built === false) return 'failed';
  return 'unchecked';
}

/** The state a run's check row ends at, for each verdict. */
export const CHECK_STAGE: Record<CheckVerdict, CheckStageState> = {
  passed: 'accepted',
  failed: 'failed',
  unchecked: 'idle',
};

/**
 * Make `original` the accepted revision again, in place of `repaired`.
 *
 * A promotion like any other: its own stage row, under its own run id, and
 * a compare-and-set against the repair's revision, so if anything has been
 * accepted since, that stands and this changes nothing. The revision keeps
 * its first id, because it is the same project the caller was first shown.
 * `restored: false` when it did not happen, with what the store holds
 * instead when that can be read: the repair, or an edit accepted since.
 */
async function restoreFirstAttempt(
  store: GenerationStore,
  params: Pick<WorkflowParams, 'projectId' | 'runId'>,
  repaired: ProjectSnapshot,
  original: ProjectSnapshot,
): Promise<{ restored: boolean; current?: ProjectSnapshot }> {
  const runId = `${params.runId}:restore`;
  // What the store holds, asked for only when the promotion's own answer
  // does not say. Never throws: not knowing is `undefined`.
  const holds = async (): Promise<ProjectSnapshot | undefined> => {
    try {
      return await store.loadAccepted(params.projectId);
    } catch {
      return undefined;
    }
  };
  try {
    await store.saveStage({
      runId,
      projectId: params.projectId,
      baseRevision: repaired.revision,
      state: 'validating',
      snapshot: original,
    });
    const promotion = await store.promote(
      params.projectId,
      runId,
      repaired.revision,
      original,
    );
    if (promotion.promoted) return { restored: true };
    const current = promotion.current ?? (await holds());
    return {
      restored: current?.revision === original.revision,
      ...(current ? { current } : {}),
    };
  } catch (error) {
    console.error('could not restore the first attempt', error);
    // The promotion is not one statement: the accepted pointer can move and
    // a later write then fail. So an error is a question, not an answer:
    // what the store holds now is what the caller must report.
    const current = await holds();
    return {
      restored: current?.revision === original.revision,
      ...(current ? { current } : {}),
    };
  }
}

/**
 * What this run is worth recording (internal issue 167).
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
  timing: {
    costMicroUsd: number;
    elapsedMs: number;
    endedAt: string;
    /** Where the run's time went, step by step (`RunStepTrace`). */
    steps?: readonly RunStepTrace[];
    /**
     * How many model calls the tokens above were spent across. A bounded
     * build is one row for the whole run, its tokens and cost summed, so
     * the row says what the run cost as billing charged it. Its context
     * figure is then the window once per call, which makes "of context"
     * the average share of the window each call used, rather than a sum of
     * several calls' tokens read against one call's window. One when
     * absent, which is what every run was before.
     */
    calls?: number;
  },
): RunTrace {
  const calls =
    typeof timing.calls === 'number' && timing.calls > 1
      ? Math.floor(timing.calls)
      : 1;
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
    // Absent, not zero, where no call reported it.
    ...(usage?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.reasoningTokens }),
    contextWindow: (findModel(params.model)?.contextWindow ?? 0) * calls,
    costMicroUsd: timing.costMicroUsd,
    elapsedMs: timing.elapsedMs,
    endedAt: timing.endedAt,
    ...(timing.steps && timing.steps.length > 0
      ? { steps: timing.steps.map((step) => ({ ...step })) }
      : {}),
  };
}

/**
 * Reconcile the pessimistic debit both ledger layers took before the run
 * started down to what it actually cost -- the same reconciliation
 * `handlePlan` used to do in its own `finally` block. Returns the settled
 * amount so the caller can log it.
 */
function usageOrWorstCase(
  usage: PlanUsage | undefined,
  params: Pick<WorkflowParams, 'worstCaseMicroUsd' | 'prices'>,
): number {
  return usage ? microUsdOf(usage, params.prices) : params.worstCaseMicroUsd;
}

/**
 * A settlement that closed one ledger layer and not the other.
 *
 * Thrown rather than returned so that every existing caller keeps the
 * behaviour it was written for: `settleBudget` still rejects when the
 * ledger did not fully close, and the Workflow's own settle step still
 * retries it. What this adds is that a caller who wants to know *what* was
 * charged before the failure can ask, instead of assuming the worst
 * (internal PR 196 review).
 *
 * Raising this *is* the statement that the caller's own layer closed: the
 * write that closes it comes first and propagates its own failure directly,
 * so the account layer is only ever reached once the caller's has landed.
 * That is why there is no flag saying so, and why a test asserts a
 * user-layer failure does not arrive as one of these. `charged` is the
 * figure that layer was settled at, which is what makes a repair's recorded
 * cost honest when only the shared account hold is left open.
 */
export class PartialSettlement extends Error {
  /** What the caller's own layer was settled at, before this happened. */
  readonly charged: number;

  // Fields and assignments rather than parameter properties: this module is
  // loaded under `node --test --experimental-strip-types`, which strips
  // types without compiling them and rejects that shorthand outright.
  constructor(charged: number, cause: unknown) {
    super('the account ledger did not settle', { cause });
    this.name = 'PartialSettlement';
    this.charged = charged;
  }
}

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
  // Not `boolean`: a durable step result cached before this field existed
  // resumes without it, and the type would be lying about that. Only an
  // explicit false is evidence.
  providerRan: boolean | undefined,
  /**
   * What the account-wide reservation settles at, where that is not what
   * the caller is charged (internal PR 191 review).
   *
   * The two layers answer different questions, and a mockup run that
   * absorbs a discarded empty reply is where they part company. The
   * caller pays for the attempt they got. The account ledger bounds what
   * this deployment spends in a day, so it must hold the attempt that was
   * absorbed too, or the ceiling drifts by one whole attempt every time
   * the provider defect fires.
   *
   * What this reservation covers, rather than the run's whole cost, and
   * the difference is not pedantry. A caller holding a second reservation
   * for a retry settles that one itself, and an empty reply whose retry
   * crosses UTC midnight puts the two on different days: each has to
   * carry the attempt it actually admitted, or one day's ledger forgets a
   * real request while another is pushed past a ceiling it never spent.
   */
  accountMicroUsd?: number,
  /**
   * What the *caller's* reservation settles at, where that is not what the
   * three cases below would work out (internal PR 196 review).
   *
   * The mirror of `accountMicroUsd` and used for the same reason: the two
   * layers answer to different people. A repair whose model call stalled
   * and was abandoned is an attempt the caller never received, so they are
   * not billed for it, while the deployment's daily ceiling still has to
   * hold what may well have been spent on their behalf.
   *
   * Kept as an explicit argument rather than folded into `providerRan`.
   * Saying "the provider never ran" to get a zero would be a lie in the
   * one field that decides this, and the next reader would find a repair
   * recorded as never asked for.
   */
  callerMicroUsd?: number,
): Promise<number> {
  // Three cases, not two, and the third used to be charged as if it were
  // the second.
  //
  // Usage reported: charge it. No usage but the model was asked: charge the
  // worst case, because failing safe means over-counting and we cannot know
  // what that call cost. No usage because the model was never asked: charge
  // nothing, because nothing was spent and we know it.
  //
  // Folding the third into the second billed a caller a full generation for
  // being told their revision was stale, which is the opposite of the
  // refusal being free.
  // `=== false` rather than falsy: a step result persisted before this
  // field existed arrives undefined, and reading that as "never ran" would
  // settle a real generation at zero -- the fail-safe inverted.
  const actual =
    callerMicroUsd ??
    (!usage && providerRan === false ? 0 : usageOrWorstCase(usage, params));

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
  //
  // The same cost unless the caller says otherwise, which is the one way
  // the two layers may differ: the caller's allowance is what they owe,
  // the account ceiling is what this deployment spent.
  if (params.accountReservationId !== undefined) {
    try {
      await ledger
        .getByName(ACCOUNT_BUDGET_KEY)
        .settle(params.accountReservationId, accountMicroUsd ?? actual);
    } catch (error) {
      // Which layer stayed open is not a detail (internal PR 196 review). The two are
      // settled together and can fail apart, and they answer to different
      // people: the caller's hold decides what the caller is billed, the
      // account hold decides what this deployment has spent today. A
      // failure here with the caller's layer already closed means the
      // caller was charged exactly what they used, and reporting that run
      // at its worst case -- as a caller who could only see "settlement
      // failed" had to -- overstates a bill that is already correct.
      throw new PartialSettlement(actual, error);
    }
  }
  // The caller's figure, which is what every caller logs and shows. The
  // absorbed part is deliberately not in it: it is not theirs.
  return actual;
}
