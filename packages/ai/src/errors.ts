import type { RunStop } from '@vibld/core';

/**
 * Base for every failure this adapter reports. Callers can catch one class.
 *
 * Each subclass names the stop it is, from the one vocabulary in
 * `@vibld/core`. Before this, every provider failure reached the run record
 * as a string in an `errors` array and a boolean outcome, so "the model
 * declined" and "the project does not fit" were the same fact to anything
 * reading a finished run.
 *
 * The identifier lives on the error rather than in a classifier somewhere
 * else because the error is the thing that knows which kind it is. A
 * `switch` over class names in another module is the same knowledge written
 * down twice, and the copy goes stale the first time a subclass is added.
 */
export class ProviderError extends Error {
  /** Which stop this failure is, for the run record and the API. */
  readonly stop: RunStop = 'provider-error';

  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The model declined the request. Not retryable with the same prompt. */
export class ProviderRefusalError extends ProviderError {
  override readonly stop: RunStop = 'model-refused';

  readonly category: string | null;

  constructor(category: string | null, explanation: string | null) {
    super(
      explanation
        ? `The model declined this request (${category ?? 'unspecified'}): ${explanation}`
        : `The model declined this request (${category ?? 'unspecified'})`,
    );
    this.name = 'ProviderRefusalError';
    this.category = category;
  }
}

/**
 * What a run was asked to produce, so every failure can name it.
 *
 * This started as a truncation-only fix and was wrong for the same reason
 * twice (#190). The truncation message was written for a build and shown on
 * a mockup run, telling somebody who asked for three sketches that their
 * *project* was incomplete. I gave truncation a vocabulary and stopped
 * there, and the next real run failed on `ProviderShapeError`, which still
 * said "the model returned a plan". Fixing the case in front of me and not
 * the one beside it, one commit after writing that sentence in a commit
 * message.
 *
 * So it covers every failure `readCompletion` can raise about the artefact,
 * rather than the one that happened to be reported.
 */
export interface OutputSubject {
  /** What was asked for: "a plan", "a set of three directions". */
  noun: string;
  /** What is incomplete when a run hits the ceiling. */
  truncated: string;
  /** What the reader can do about a truncation. */
  advice: string;
}

export const PLAN_SUBJECT: OutputSubject = {
  noun: 'a plan',
  truncated: 'the generated project is incomplete',
  advice: 'Ask for a smaller project, or build it a few pages at a time.',
};

export const MOCKUP_SUBJECT: OutputSubject = {
  noun: 'a set of three directions',
  truncated: 'the last of the three directions is incomplete',
  advice:
    'Try a shorter description, or ask for the build directly and skip the sketches.',
};

/**
 * Generation stopped at the output ceiling, so the last file is almost
 * certainly cut off mid-token.
 *
 * This is called out as its own error because a silently truncated project is
 * the worst failure mode available here: it looks like a successful
 * generation, then fails at install or build time with a syntax error far from
 * the real cause. Fail loudly instead.
 */
export class ProviderTruncationError extends ProviderError {
  override readonly stop: RunStop = 'model-truncated';

  constructor(maxTokens: number, subject: OutputSubject = PLAN_SUBJECT) {
    super(
      `The model hit its ${maxTokens}-token output limit, so ${subject.truncated}. ` +
        subject.advice,
    );
    this.name = 'ProviderTruncationError';
  }
}

/** The response did not match the plan schema. */
export class ProviderShapeError extends ProviderError {
  override readonly stop: RunStop = 'model-shape';

  constructor(detail: string, subject: OutputSubject = PLAN_SUBJECT) {
    super(
      `The model returned ${subject.noun} that does not match the expected shape: ${detail}`,
    );
    this.name = 'ProviderShapeError';
  }
}

/**
 * The existing project is too large to send with a follow-up request.
 *
 * Raised instead of truncating. A partial project would be returned as if it
 * were the whole one, and every file that did not fit would be deleted when
 * the result was promoted -- losing the user's work in order to save tokens,
 * which is not a trade anyone would choose.
 */
export class ProviderContextError extends ProviderError {
  override readonly stop: RunStop = 'context-exceeded';

  readonly chars: number;
  readonly limit: number;

  constructor(chars: number, limit: number) {
    super(
      `This project is ${chars} characters, over the ${limit} that can be sent with a follow-up request. Start a new project, or ask for a change that reduces its size.`,
    );
    this.name = 'ProviderContextError';
    this.chars = chars;
    this.limit = limit;
  }
}
