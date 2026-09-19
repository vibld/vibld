import {
  DurableGenerationRunner,
  type DurableGenerationResult,
  type GenerationPlan,
  type GenerationRequest,
  type GenerationStore,
  type ModelProvider,
  type ProjectFile,
  type RunTrace,
} from '@vibld/core';
import {
  DEFAULT_MAX_TOKENS,
  ProviderError,
  RUN_STEP_TIMEOUT_MS,
  findModel,
} from '@vibld/ai';
import { MAX_BASE_CONTENT_CHARS } from '@vibld/ai/limits';
import type { PlanUsage } from '@vibld/ai';
import type { StylePresetId } from '@vibld/ai/style-presets';
import type { StyleDna } from '@vibld/ai/style-dna';
import { createValidator } from '../src/generation/validator.ts';
import { ACCOUNT_BUDGET_KEY, microUsdOf } from './spend.ts';
import type { TokenPrices } from './spend.ts';
import type { UserBudget } from './budget.ts';
import type { RunProgress } from './run-progress.ts';
import type { ServiceBinding } from './publish-client.ts';
import type { buildProject } from './publish-client.ts';
import type { reserveBudget } from './reserve.ts';

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
  /**
   * The direction the caller chose from a mockup run (#185), as the
   * document rather than its name. Optional: most builds have never seen a
   * mockup, and a payload persisted before this field existed has none.
   */
  chosenMockup?: { label: string; html: string };
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
  /**
   * What the caller was allowed to spend when this run was admitted, so a
   * repair turn can hold a reservation of its own without asking again
   * (#194).
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
 * What a run has produced so far, as the model streams it.
 *
 * Two counts rather than one, because the production provider is a reasoning
 * model and they answer different questions. `characters` is the answer:
 * what `onProgress` has always meant, and what the meter displays.
 * `reasoningCharacters` is the thinking that precedes it, billed as output
 * and deliberately kept out of the meter (#190) -- but it is the difference
 * between "nothing has happened" and "the model has not started writing
 * yet", and on a measured mockup run it was between 57% and 68% of the
 * output tokens. A meter fed only by the answer would sit at zero for most
 * of the wait it exists to explain.
 */
export interface ProgressReport {
  characters: number;
  reasoningCharacters: number;
}

/**
 * What the channel answers, which is more than the last report.
 *
 * A report is evidence of what a run produced, never of when. The model
 * call ends and the Workflow keeps reporting `running` through settlement
 * and the trace write, retries included, so the last report outlives the
 * work it described by up to a minute (#193 review, P2). Read on its own it
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
    // a distinction the client keeps on purpose (#190) -- but the channel
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
 * Whether a failed build is worth spending a second model call on (#194).
 *
 * Two questions, and they are separate on purpose. The first is whether the
 * failure says anything about the project: `install` is usually a package
 * the model invented, `build` is the compiler refusing what it was given,
 * and the other reasons are this deployment having a bad day. A `busy`
 * refusal in particular is issued before the build starts, so the code was
 * never even looked at.
 *
 * The second is whether the run can pay for it. A payload persisted before
 * `monthlyAllowance` existed cannot say what its caller may spend, and a run
 * that cannot say that must not guess: no repair, and the reader keeps what
 * the first attempt produced, which is what every run did before this
 * shipped.
 *
 * An absent reason is deliberately not repairable. `publish-client.ts`
 * leaves it absent when the build service sends something it does not
 * recognise, and "I could not read why this failed" is not evidence that
 * the project is broken.
 */
export function worthRepairing(
  build: { ok: boolean; reason?: string },
  params: Pick<WorkflowParams, 'monthlyAllowance' | 'topupCeiling'>,
): boolean {
  if (build.ok) return false;
  if (build.reason !== 'install' && build.reason !== 'build') return false;
  return (
    typeof params.monthlyAllowance === 'number' &&
    typeof params.topupCeiling === 'number'
  );
}

/**
 * What to ask the model for, when its own project will not build.
 *
 * The compiler's words verbatim and nothing paraphrased: the whole reason
 * this is worth a second call is that the error names the file and the line,
 * and a summary would throw away the part that makes it fixable.
 *
 * Says what not to do as well as what to do. Left to itself a model asked to
 * "fix the build" will happily rewrite the project, and the reader asked for
 * the project, not for a second draft of it.
 */
/**
 * What the verify-and-repair step is given before it is considered hung.
 *
 * A build, a model call and a second build, so it is sized as the generate
 * step's own timeout plus room for two builds rather than picked. It is
 * deliberately *not* added to anything the reclaim compares against: this
 * step runs after settlement, so the only reservation alive while it works
 * is the one it makes and closes itself (#194).
 */
export const REPAIR_BUILD_ALLOWANCE_MS = 10 * 60_000;
export const REPAIR_STEP_TIMEOUT_MS =
  RUN_STEP_TIMEOUT_MS + REPAIR_BUILD_ALLOWANCE_MS;

export function repairPromptFor(error: string): string {
  return `The project you just wrote does not build. This is the exact output:

${error}

Fix it, and change nothing else. Keep every file that is not implicated, keep
the design, the copy and the structure exactly as they are, and do not rename
or reorganise anything. Return the complete set of files for the project as
it should now be.`;
}

export interface GenerationWorkflowEnv {
  DB: D1Database;
  PROJECT_CONTENT: R2Bucket;
  /**
   * `reserve` as well as `settle` since #194: the verify-and-repair step
   * holds a reservation of its own for the second model call.
   */
  USER_BUDGET: DurableObjectNamespace<Pick<UserBudget, 'reserve' | 'settle'>>;
  /** Read by `reserveBudget` when the repair holds its own reservation. */
  VIBLD_ACCOUNT_DAILY_MICRO_USD?: string;
  VIBLD_MAX_IN_FLIGHT?: string;
  /**
   * The live progress channel (#183). Typed by the one method used rather
   * than by the class, the way `USER_BUDGET` is: the Workflow only reports
   * and the poll loop only reads.
   *
   * Optional, and the run does not report when it is absent. Progress is
   * decoration: a deployment missing the binding must still generate, and
   * the meter falls back to the clock alone, which is what it showed before
   * this channel existed.
   */
  RUN_PROGRESS?: DurableObjectNamespace<Pick<RunProgress, 'report' | 'finish'>>;
  /**
   * `@vibld/preview`, for building the project the run just produced (#194).
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
   * was (#196 review).
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
  /** Why no repair was attempted, when a failing build did not buy one. */
  skipped?: 'not-configured' | 'not-the-project' | 'no-budget' | 'unavailable';
  /** The repair's own reservation, settled by this step and not the run's. */
  repairCostMicroUsd?: number;
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
 * Shared by the build path and the mockup one (#185) rather than written
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
 * interface does. One queued before #181 shipped carries the whole `base`
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
        result: {
          state: 'failed',
          stop: 'conflict',
          accepted: base,
          errors: ['Accepted revision changed before promotion'],
          conflict: true,
        },
        outcome: 'failed',
        providerRan: false,
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
        providerRan: false,
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
 * Build what the run produced, and buy one repair if it does not build.
 *
 * #194: two of six real generations against the production provider
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
        'projectId' | 'runId' | 'prompt' | 'baseRevision'
      >,
    ) => Promise<GenerationOutcome>;
    providerFor: (onUsage: (usage: PlanUsage) => void) => ModelProvider;
    now?: () => number;
  },
): Promise<RepairOutcome> {
  // Nothing to build. A refused or failed run has no files, and a build
  // that never happened must not be reported as one that failed.
  if (result.state !== 'accepted' || !result.accepted) return {};
  if (!env.PREVIEW || !env.PREVIEW_INTERNAL_SECRET) {
    return { skipped: 'not-configured' };
  }

  /**
   * A build that reports a failure instead of throwing one.
   *
   * The service binding can reject: a preview-worker deploy, a Durable
   * Object outage, anything. Letting that propagate would fail the whole
   * Workflow *after* the project had been accepted, promoted and billed,
   * so the caller would be sent an error instead of the files they paid
   * for, and preview-service availability would quietly become a hard
   * dependency of every generation (#196 review). Every other non-project
   * build failure is already treated as "not the project's fault"; an
   * unreachable service is the same fact arriving differently.
   */
  const build = async (
    files: ProjectFile[],
  ): Promise<
    { ok: true } | { ok: false; error: string; reason?: string } | undefined
  > => {
    try {
      return await deps.build(
        {
          PREVIEW: env.PREVIEW,
          PREVIEW_INTERNAL_SECRET: env.PREVIEW_INTERNAL_SECRET,
        },
        params.userId,
        files,
      );
    } catch {
      return undefined;
    }
  };

  const first = await build(result.accepted.files);
  // Unreachable, not failed. Nothing is known about the project, so nothing
  // is claimed and no money is spent.
  if (!first) return { skipped: 'unavailable' };
  if (first.ok) return { built: true };
  if (!worthRepairing(first, params)) {
    return {
      built: false,
      skipped:
        first.reason === 'install' || first.reason === 'build'
          ? 'no-budget'
          : 'not-the-project',
    };
  }

  const now = deps.now ?? Date.now;
  const held = await deps.reserve(
    env,
    params.userId,
    params.worstCaseMicroUsd,
    params.monthlyAllowance!,
    params.topupCeiling!,
    now(),
  );
  // Out of budget is not a failure of this step. The reader keeps the
  // project the first attempt produced, which is what they would have had
  // before any of this existed.
  if (!held.ok) return { built: false, skipped: 'no-budget' };

  let usage: PlanUsage | undefined;
  let outcome: GenerationOutcome | undefined;
  try {
    outcome = await deps.generate(
      deps.providerFor((reported) => {
        usage = reported;
      }),
      {
        projectId: params.projectId,
        // Its own id. `promote` and `saveStage` are both keyed on it, so
        // reusing the run's would overwrite the record of the attempt this
        // one is repairing.
        runId: `${params.runId}:repair`,
        prompt: repairPromptFor(first.error),
        baseRevision: result.accepted.revision,
      },
    );
  } finally {
    // In a `finally`, because a repair that threw still asked the model and
    // still holds a reservation. Leaving it open is the one outcome that
    // costs the caller their worst case rather than what they spent.
    await deps.settle(
      env.USER_BUDGET,
      {
        userId: params.userId,
        reservationId: held.ok ? held.layers.user.id : undefined,
        reservationKey: held.ok ? held.layers.userReservationKey : undefined,
        accountReservationId: held.ok ? held.layers.account.id : undefined,
        worstCaseMicroUsd: params.worstCaseMicroUsd,
        prices: params.prices,
      },
      usage,
      // The model was asked the moment `generate` was entered, so a throw
      // from inside it settles at the worst case rather than at nothing.
      true,
    );
  }

  // Accepted is not built (#196 review). The validator says the files are
  // well formed and inside the project root; it says nothing about whether
  // they compile, and compiling is the entire question. This feature exists
  // because a model's output passes every structural check and still fails
  // `npm run build`, so believing acceptance here would declare that exact
  // failure fixed without looking.
  const promoted =
    outcome?.result.state === 'accepted' && Boolean(outcome.result.accepted);
  if (!promoted || !outcome?.result.accepted) {
    return { built: false, repaired: false };
  }

  const second = await build(outcome.result.accepted.files);
  return {
    built: false,
    // Undefined rather than false when the second build could not run: a
    // repair whose result is unknown is not a repair that failed.
    ...(second ? { repaired: second.ok } : {}),
    // Returned whether or not it builds, because it is what the store now
    // holds. Handing back the first attempt would put the reader's copy and
    // the accepted revision out of step, which is the other finding on this
    // round.
    result: outcome.result,
  };
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
function usageOrWorstCase(
  usage: PlanUsage | undefined,
  params: Pick<WorkflowParams, 'worstCaseMicroUsd' | 'prices'>,
): number {
  return usage ? microUsdOf(usage, params.prices) : params.worstCaseMicroUsd;
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
   * the caller is charged (#191 review).
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
    !usage && providerRan === false ? 0 : usageOrWorstCase(usage, params);

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
    await ledger
      .getByName(ACCOUNT_BUDGET_KEY)
      .settle(params.accountReservationId, accountMicroUsd ?? actual);
  }
  // The caller's figure, which is what every caller logs and shows. The
  // absorbed part is deliberately not in it: it is not theirs.
  return actual;
}
