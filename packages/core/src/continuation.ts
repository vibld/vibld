/**
 * What happens after a run stops to ask something (#158).
 *
 * Asking ends the invocation. There is no paused run to resume: the run that
 * asked is over and recorded, and the way forward is a new run carrying the
 * work the first one held plus the answer. That is what a continuation is,
 * and saying it in types is the point of this file.
 *
 * Two rules it exists to keep, both of which are easy to lose once a UI is
 * wired to them:
 *
 *  - **Answering is not accepting.** An answer starts work; it does not
 *    promote anything. Nothing here touches a store, and a `Continuation`
 *    carries the held work as the *base* for the next run, never as
 *    something already applied. The continuation's own outcome decides
 *    that, the same way any other run's does.
 *  - **One answer starts one continuation.** A reply delivered twice, by a
 *    double click or a retried request, must not start two runs against the
 *    same held work and bill for both. The record of the answer is what
 *    makes the second call a no-op, so that decision cannot live in
 *    whichever caller remembered to check.
 *
 * Pure and serializable on purpose: this has to survive a Worker eviction
 * between the question and the answer, which a class holding the state in
 * memory would not.
 */

import { outcomeAsks } from './run-disposition.ts';
import type { OpenQuestion, RunOutcome } from './run-disposition.ts';
import type { GenerationRequest, ProjectSnapshot } from './types.ts';

/** A question a finished run asked, and what has become of it since. */
export interface PendingQuestion {
  /** The run that asked. It is finished; this is not a handle to resume it. */
  runId: string;
  /** What that run was asked to do, carried so the continuation can say it again. */
  prompt: string;
  question: OpenQuestion;
  /** What the asking run had built, if anything. */
  held: ProjectSnapshot | null;
  /** The answer, once there is one. `null` while the question is open. */
  answer: string | null;
  /**
   * The run the answer started. Recorded rather than inferred from `answer`
   * being set, because the pair is what makes a repeated answer a no-op and
   * names the one run that already exists.
   */
  continuationRunId: string | null;
}

/** The next run, carrying what was held and what was answered. */
export interface Continuation {
  /** The new run's id. Never the asking run's: that run has its own record. */
  runId: string;
  answeredRunId: string;
  /** What the asking run was asked to do, carried so it can be said again. */
  prompt: string;
  question: OpenQuestion;
  answer: string;
  /**
   * The held work, as the base the next run edits. A base, emphatically not
   * an acceptance: it is where this run starts, not something the project
   * has adopted.
   */
  base: ProjectSnapshot | null;
}

export interface AnswerResult {
  /** The pending record as it now stands, to store in place of the old one. */
  pending: PendingQuestion;
  /** The run to start, or `null` when this answer started nothing. */
  continuation: Continuation | null;
  /** Whether this call is the one that started it. */
  started: boolean;
}

/**
 * The pending record for a run that asked, or `null` for one that did not.
 *
 * Takes the outcome rather than a question, so a caller cannot open a
 * question for a run that retained, applied or discarded its work. Those
 * three have nothing to answer.
 */
export function pendingFor(
  runId: string,
  prompt: string,
  outcome: RunOutcome,
): PendingQuestion | null {
  if (!outcomeAsks(outcome)) return null;
  return {
    runId,
    prompt,
    question: outcome.question,
    held: outcome.held,
    answer: null,
    continuationRunId: null,
  };
}

/** Whether this question is still waiting on somebody. */
export function isOpen(pending: PendingQuestion): boolean {
  return pending.continuationRunId === null;
}

/**
 * Answer an open question, starting exactly one continuation.
 *
 * A second answer to a question that already has one changes nothing and
 * starts nothing: `started` is false and the stored record comes back
 * untouched, still naming the single run the first answer began. An empty
 * answer is treated the same way rather than being stored, because a
 * continuation carrying no answer is a paid run that knows nothing the
 * asking run did not.
 *
 * Throws only for the two cases that are a caller's mistake rather than a
 * person's: a continuation with no id, and a continuation reusing the
 * asking run's id, which would overwrite that run's own record with this
 * one's.
 */
export function answerQuestion(
  pending: PendingQuestion,
  answer: string,
  continuationRunId: string,
): AnswerResult {
  if (continuationRunId === '') {
    throw new Error('a continuation needs a run id of its own');
  }
  if (continuationRunId === pending.runId) {
    throw new Error('a continuation cannot reuse the asking run id');
  }

  const given = answer.trim();
  if (given === '' || !isOpen(pending)) {
    return { pending, continuation: null, started: false };
  }

  return {
    pending: { ...pending, answer: given, continuationRunId },
    continuation: {
      runId: continuationRunId,
      answeredRunId: pending.runId,
      prompt: pending.prompt,
      question: pending.question,
      answer: given,
      base: pending.held,
    },
    started: true,
  };
}

/**
 * The request the continuation run makes.
 *
 * The original prompt is repeated rather than replaced by the answer: the
 * answer settles one point, and dropping what was originally asked for would
 * lose the rest of it. The question is repeated alongside it because an
 * answer on its own ("the second one") means nothing without it.
 */
export function continuationRequest(
  continuation: Continuation,
): GenerationRequest {
  return {
    prompt: [
      continuation.prompt,
      '',
      `You asked: ${continuation.question.question}`,
      `The answer is: ${continuation.answer}`,
    ].join('\n'),
    ...(continuation.base ? { base: continuation.base } : {}),
  };
}
