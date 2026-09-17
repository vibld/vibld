/**
 * The four outcomes a generation run can have, and what each says should
 * happen to the work (#158).
 *
 * Named for the disposition of the work rather than for the run, so it is
 * not mistaken for `run-outcome.ts` next door: that file says why a run was
 * refused or why it ended, this one says what to do with what it produced.
 * A run has exactly one of each, and they answer different questions. A run
 * that stopped because only the user can decide something and a run that
 * finished and wants review both end without applying anything, and before
 * this they were the same object.
 *
 * The four are deliberately exhaustive rather than open. A fifth case that
 * turns up wants a decision about which of these it really is, or an
 * argument for widening the set, not a caller quietly inventing a name.
 *
 * Continuation semantics live in `continuation.ts`: asking ends the run, and
 * the only way forward from an ask is a new run carrying the held work and
 * the answer. That separation is the point of the vocabulary. Answering is
 * not accepting.
 */

import { stopChangedTheProject } from './run-outcome.ts';
import type { RunStop } from './run-outcome.ts';
import type { GenerationResult, ProjectSnapshot } from './types.ts';

/** Something only the person can decide, asked once and answered once. */
export interface OpenQuestion {
  /**
   * Stable within the run that asked it, so an answer names the question it
   * answers. Without it, a second question arriving before the first is
   * answered has no way to tell the two replies apart.
   */
  id: string;
  /** What is being asked, in the words the person will read. */
  question: string;
  /**
   * The answers on offer, where the decision is a choice rather than free
   * text. Absent means free text; an empty list would be a question nobody
   * can answer, so it is not a representable state.
   */
  options?: readonly [string, ...string[]];
}

/**
 * What became of one run's work.
 *
 * A discriminated union rather than a string plus optional fields, because
 * the combinations that do not exist should not be writable: a `retain` has
 * no question (retaining work for review is not asking anything), an `ask`
 * has no finished work to apply, and a `discard` has nothing to keep.
 */
export type RunOutcome =
  | {
      readonly kind: 'ask';
      readonly question: OpenQuestion;
      /**
       * What the run had built when it stopped to ask, if anything. Held
       * rather than applied and held rather than thrown away: the answer is
       * about work that already exists, and making the person pay to
       * regenerate it is the thing this outcome is for.
       */
      readonly held: ProjectSnapshot | null;
    }
  | {
      readonly kind: 'retain';
      /** Complete and verified, and not applied until somebody says so. */
      readonly work: ProjectSnapshot;
    }
  | {
      readonly kind: 'apply';
      readonly work: ProjectSnapshot;
      /**
       * Whether applying it changes anything. A run that produced the
       * project it started from is still an apply, and it is not an edit.
       */
      readonly changed: boolean;
    }
  | {
      readonly kind: 'discard';
      /** Why nothing should be applied, from the one stop vocabulary. */
      readonly stop: RunStop;
    };

export const RUN_OUTCOME_KINDS = [
  'ask',
  'retain',
  'apply',
  'discard',
] as const satisfies readonly RunOutcome['kind'][];

export type RunOutcomeKind = (typeof RUN_OUTCOME_KINDS)[number];

export function isRunOutcomeKind(value: unknown): value is RunOutcomeKind {
  return (
    typeof value === 'string' &&
    (RUN_OUTCOME_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Whether this outcome puts a question to the person.
 *
 * True for exactly one of the four, which is the rule #158 states and the
 * one most easily lost: retaining work for review does not ask a question.
 * A reviewer looking at held work has nothing to answer, and a surface that
 * prompts them for one invents a decision nobody asked for.
 */
export function outcomeAsks(
  outcome: RunOutcome,
): outcome is Extract<RunOutcome, { kind: 'ask' }> {
  return outcome.kind === 'ask';
}

/**
 * The work this outcome keeps, if any.
 *
 * An `ask` may keep nothing (the run stopped before it built anything), and
 * a `discard` keeps nothing by definition. Both answer `null`, because the
 * caller's question is "is there work here", not "which of the four is it".
 */
export function workOf(outcome: RunOutcome): ProjectSnapshot | null {
  if (outcome.kind === 'apply' || outcome.kind === 'retain') {
    return outcome.work;
  }
  return outcome.kind === 'ask' ? outcome.held : null;
}

/** Whether this outcome is the one that promotes. Only `apply` is. */
export function outcomeApplies(outcome: RunOutcome): boolean {
  return outcome.kind === 'apply';
}

/**
 * Which stop this outcome records.
 *
 * Derived rather than stored beside it, so the trace of a run and the
 * decision about its work cannot disagree about what happened.
 */
export function stopForOutcome(outcome: RunOutcome): RunStop {
  switch (outcome.kind) {
    case 'ask':
      return 'awaiting-answer';
    case 'retain':
      return 'retained';
    case 'apply':
      return outcome.changed ? 'applied' : 'no-changes';
    case 'discard':
      return outcome.stop;
  }
}

/**
 * Whether a stop can honestly describe a discarded run.
 *
 * A stop that says the project changed cannot: "nothing should be applied"
 * and "this was applied" are opposite claims about the same run. A run that
 * finished and had nothing to do is an `apply` with `changed: false`, not a
 * discard, which is the case this most easily gets written as.
 */
export function canDiscardFor(stop: RunStop): boolean {
  return !stopChangedTheProject(stop) && stop !== 'no-changes';
}

/**
 * A discard for a stop that really is one.
 *
 * Throws rather than returning a result, because reaching it means a caller
 * has built a contradiction in code, not that something went wrong at
 * runtime. There is no user input on this path to fail gracefully for.
 */
export function discardFor(stop: RunStop): RunOutcome {
  if (!canDiscardFor(stop)) {
    throw new Error(`${stop} describes a run that applied its work`);
  }
  return { kind: 'discard', stop };
}

/**
 * A finished run's outcome, for a run that did not ask anything.
 *
 * The adapter that lets what the machine produces today speak this
 * vocabulary, so the four outcomes are something the system uses rather than
 * a set of names sitting beside it.
 *
 * An `ask` is deliberately not in the return type. A `GenerationResult` has
 * no channel to carry a question, and inferring one from a stop would invent
 * the question's text. The day a producer can ask something, it builds the
 * `ask` itself, with the question it actually asked and the work it was
 * holding, and hands it straight to `pendingFor`.
 *
 * Throws on a result that contradicts itself: a run that says it applied
 * something without a snapshot to apply, or one that claims to have asked
 * while carrying no question. Both mean a caller built something impossible,
 * and answering with a plausible outcome would bury it.
 */
export function settledOutcome(
  result: GenerationResult,
): Exclude<RunOutcome, { kind: 'ask' }> {
  const stop = result.stop;
  if (stop === 'awaiting-answer') {
    throw new Error(
      'a run that asked must build its own ask, with the question',
    );
  }

  if (stop === 'applied' || stop === 'no-changes') {
    // `accepted` first: after a promotion it is the snapshot the project
    // now has, and `staged` is the same content by a different route. A run
    // that says it applied something and carries neither is the
    // contradiction worth refusing.
    const work = result.accepted ?? result.staged;
    if (!work) throw new Error(`${stop} with no snapshot to apply`);
    return { kind: 'apply', work, changed: stop === 'applied' };
  }

  if (stop === 'retained') {
    const work = result.staged;
    if (!work) throw new Error('retained with no work to hold');
    return { kind: 'retain', work };
  }

  // Everything else is a run whose work must not be applied, which is what
  // `discard` means. The stop travels with it, so why is not lost in the
  // flattening: a validation failure and a model refusal are both discards
  // and are not the same news.
  return { kind: 'discard', stop };
}
