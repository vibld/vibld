/**
 * Why nothing happened, and why a run ended, as identifiers rather than
 * sentences.
 *
 * One vocabulary, used unchanged by the API, the builder, the stored run
 * record and anything scripting against this service. The prose a person
 * reads is chosen at the surface that renders it; the identifier is what
 * travels, so a caller can branch on it and two surfaces cannot drift into
 * describing the same stop differently.
 *
 * These strings are a contract. Renaming one breaks a stored record and any
 * caller matching on it, so a reason that stops being produced is retired by
 * leaving it here rather than by deleting it.
 *
 * The split between the two unions is the load-bearing part, not a
 * tidiness preference. A refusal happens before a run exists and must leave
 * no run record behind: a user who was told "not now" has not had a failed
 * generation, and a list that shows them one is lying about their history. A
 * stop belongs to a run that really started and is recorded exactly once.
 */

/**
 * Why a run was refused before it started. No run record is written for any
 * of these.
 *
 * Every one of these is already a distinct branch in `handlePlan`; what was
 * missing is that they all arrived at the caller as an English sentence and
 * an HTTP status, so "you are out of budget this month" and "a generation is
 * already running" were both 429 with different prose.
 */
export type RunRefusal =
  /** Generation is not configured for this deployment at all. */
  | 'not-configured'
  /**
   * No usable identity on the request.
   *
   * One reason for both "no token" and "the token did not verify", matching
   * the deliberate opacity in `resolvePrincipal`: telling a caller which
   * check failed tells an attacker which half to work on.
   */
  | 'not-signed-in'
  /**
   * A verified identity this deployment will not admit.
   *
   * Deliberately coarse, and it must stay that way. `access.ts` already
   * separates `not-invited` from `unverified-identity` internally, and
   * `access-handlers.ts` refuses to report which, because an endpoint that
   * distinguishes them lets anybody test whether an address has been
   * invited. Naming the two here would move that disclosure onto the wire.
   */
  | 'access-refused'
  /** A burst or sustained gate rejected this caller. */
  | 'rate-limited'
  /** The model policy does not offer this model to this identity. */
  | 'model-not-allowed'
  /** The request itself could not be read or exceeded a documented limit. */
  | 'request-invalid'
  /** This account's own spend ceiling for the period is used up. */
  | 'account-ceiling'
  /** This account already has a run in flight and may not start another. */
  | 'already-running'
  /**
   * The spend ledger could not be read, so the run is refused rather than
   * allowed. Distinct from `account-ceiling` on purpose: one is the user
   * having spent their allowance, the other is this service being unable to
   * tell, and telling somebody they are out of budget when we do not know is
   * a lie that costs them a support conversation.
   */
  | 'accounting-unavailable';

/**
 * Why a started run ended. Exactly one is recorded per run.
 *
 * Only reasons this system can actually produce today. A vocabulary that
 * names stops no code emits reads as capability that is not there, and the
 * first person to match on one gets a branch that never fires.
 */
export type RunStop =
  /** Finished, validated and promoted to the accepted revision. */
  | 'applied'
  /** Finished having produced no file this project did not already have. */
  | 'no-changes'
  /** Ended because it was explicitly cancelled. */
  | 'cancelled'
  /** Produced a project, and validation rejected it. */
  | 'validation-failed'
  /** The model declined the request. */
  | 'model-refused'
  /** The model hit its output ceiling, so the project arrived cut off. */
  | 'model-truncated'
  /** The model's structured output did not match the schema. */
  | 'model-shape'
  /** The request did not fit the model's context window. */
  | 'context-exceeded'
  /** The run's own spend ceiling was reached while it ran. */
  | 'run-budget-exceeded'
  /** Anything else the provider did that this service could not classify. */
  | 'provider-error';

/** Every refusal, so a check over all of them cannot miss a new one. */
export const RUN_REFUSALS = [
  'not-configured',
  'not-signed-in',
  'access-refused',
  'rate-limited',
  'model-not-allowed',
  'request-invalid',
  'account-ceiling',
  'already-running',
  'accounting-unavailable',
] as const satisfies readonly RunRefusal[];

/** Every stop, for the same reason. */
export const RUN_STOPS = [
  'applied',
  'no-changes',
  'cancelled',
  'validation-failed',
  'model-refused',
  'model-truncated',
  'model-shape',
  'context-exceeded',
  'run-budget-exceeded',
  'provider-error',
] as const satisfies readonly RunStop[];

export function isRunRefusal(value: unknown): value is RunRefusal {
  return (
    typeof value === 'string' &&
    (RUN_REFUSALS as readonly string[]).includes(value)
  );
}

export function isRunStop(value: unknown): value is RunStop {
  return (
    typeof value === 'string' &&
    (RUN_STOPS as readonly string[]).includes(value)
  );
}

/**
 * Whether a stop means the run produced something the project kept.
 *
 * Asked as a property of the reason rather than tracked separately, so the
 * two can never disagree. `no-changes` is deliberately on the false side: it
 * is a run that worked and had nothing to do, which is a different thing
 * from one that applied an edit and a different thing again from one that
 * failed.
 */
export function stopChangedTheProject(stop: RunStop): boolean {
  return stop === 'applied';
}

/**
 * Whether a stop is the run's own fault rather than the request's.
 *
 * Used to decide what a surface offers next: retrying a `provider-error` is
 * reasonable, retrying a `validation-failed` without changing anything is
 * asking for the same answer twice.
 */
export function stopIsRetryable(stop: RunStop): boolean {
  return stop === 'provider-error' || stop === 'run-budget-exceeded';
}

/**
 * What a finished run is worth recording, and nothing more.
 *
 * **Metadata only, per D20.** No prompt, no generated source, no file path,
 * no secret, and no raw provider error text. `stop` is an identifier from
 * the union above precisely so that a provider's message, which can quote
 * the request back, never becomes the thing that gets stored. This record
 * must not turn into a second channel carrying what the telemetry decision
 * keeps out of the first.
 *
 * Deliberately absent, because this system has no such mechanism and a
 * column that is always the same number is a claim about machinery that is
 * not there: a round count (generation is one call, not a tool loop), failed
 * tool attempts (there are no tools), stream retries (a failed stream fails
 * the run) and a structured-output repair count (the provider enforces the
 * schema and a mismatch throws). Each becomes worth adding on the day the
 * mechanism it describes exists.
 */
export interface RunTrace {
  runId: string;
  projectId: string;
  stop: RunStop;
  /** Which model ran it, so a comparison between two runs has a subject. */
  model: string;
  inputTokens: number;
  /**
   * The part of `inputTokens` the provider served from its cache. Split out
   * rather than netted off, because the cached fraction is the measurement
   * that says whether a caching scheme is working at all.
   */
  cachedInputTokens: number;
  outputTokens: number;
  /**
   * The window this run was working inside. Stored with the run rather than
   * looked up later: a model's window changes, and a run near the limit of
   * the window it actually had is the thing worth seeing.
   */
  contextWindow: number;
  costMicroUsd: number;
  elapsedMs: number;
  endedAt: string;
}

/**
 * How close this run came to the context window it had, as a fraction.
 *
 * Zero when the window is unknown rather than a division by zero, and it is
 * knowingly an underestimate: `inputTokens` is what the request carried, and
 * the output shares the same window.
 */
export function contextPressure(trace: RunTrace): number {
  if (trace.contextWindow <= 0) return 0;
  return (trace.inputTokens + trace.outputTokens) / trace.contextWindow;
}

/**
 * The fraction of input this run did not pay full price for.
 *
 * Zero rather than NaN for a run that sent no input, which is a run that did
 * not happen rather than one that cached perfectly.
 */
export function cachedFraction(trace: RunTrace): number {
  if (trace.inputTokens <= 0) return 0;
  return trace.cachedInputTokens / trace.inputTokens;
}
