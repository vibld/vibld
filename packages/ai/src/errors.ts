/** Base for every failure this adapter reports. Callers can catch one class. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The model declined the request. Not retryable with the same prompt. */
export class ProviderRefusalError extends ProviderError {
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
 * Generation stopped at the output ceiling, so the last file is almost
 * certainly cut off mid-token.
 *
 * This is called out as its own error because a silently truncated project is
 * the worst failure mode available here: it looks like a successful
 * generation, then fails at install or build time with a syntax error far from
 * the real cause. Fail loudly instead.
 */
export class ProviderTruncationError extends ProviderError {
  constructor(maxTokens: number) {
    super(
      `The model hit the ${maxTokens}-token output limit, so the generated project is incomplete. ` +
        'Raise maxTokens or ask for a smaller project.',
    );
    this.name = 'ProviderTruncationError';
  }
}

/** The response did not match the plan schema. */
export class ProviderShapeError extends ProviderError {
  constructor(detail: string) {
    super(
      `The model returned a plan that does not match the expected shape: ${detail}`,
    );
    this.name = 'ProviderShapeError';
  }
}
