/**
 * The arithmetic behind the spend ceiling, with no storage and no runtime
 * behind it.
 *
 * It lives apart from the Durable Object that applies it so the part that
 * decides whether a run may start is testable without a Workers runtime. The
 * object owns durability and atomicity; this file owns the reasoning.
 */

export interface TokenPrices {
  /** Micro-USD per input token. 5 == $5.00 per million tokens. */
  inputMicroUsd: number;
  outputMicroUsd: number;
  /**
   * Micro-USD per input token the provider served from its cache.
   *
   * A tenth of the input rate at every provider Vibld talks to, and charged
   * separately because it is charged separately: pricing a cache read at the
   * full input rate takes ten times the allowance the run actually consumed.
   * That was happening before this existed, and not only in theory: OpenAI
   * and DeepSeek cache prompt prefixes automatically and both already report
   * the hit, so any run of theirs that matched a prefix was over-charged.
   */
  cachedInputMicroUsd: number;
  /**
   * Micro-USD per input token the provider wrote into its cache.
   *
   * Dearer than an ordinary input token, not cheaper, which is the half of
   * caching that is easy to forget and the reason a breakpoint on a prefix
   * that keeps changing costs money.
   */
  cacheWriteMicroUsd: number;
}

/**
 * List prices for the default model, in micro-USD per token.
 *
 * These are configuration rather than constants because they decide what the
 * ceiling *means*: a dollar figure computed from a stale price is a dollar
 * figure that is wrong, and VIBLD_MODEL can be pointed at a model priced
 * differently. Confirm against the provider's current pricing before relying
 * on the number this produces.
 */
export const DEFAULT_PRICES: TokenPrices = {
  inputMicroUsd: 5,
  outputMicroUsd: 25,
  cachedInputMicroUsd: 0.5,
  cacheWriteMicroUsd: 6.25,
};

/**
 * Per-provider list prices, in micro-USD per token, used when the deployment
 * does not set them explicitly.
 *
 * DeepSeek's are its **peak** rates for its more expensive model. Peak is
 * double off-peak and `v4-pro` is triple `v4-flash`, so one figure has to
 * cover four combinations, and this file's own rule decides which: a worst
 * case that under-estimates is not a worst case. The effect is a ceiling that
 * binds sooner than a flash run strictly needs -- the safe direction. Set
 * VIBLD_USD_MICRO_PER_* to the exact rate to reclaim it.
 */
export const PROVIDER_PRICES: Record<string, TokenPrices> = {
  anthropic: DEFAULT_PRICES,
  deepseek: {
    inputMicroUsd: 1.32,
    outputMicroUsd: 3.96,
    // A tenth, and no separate write charge: DeepSeek caches automatically.
    cachedInputMicroUsd: 0.132,
    cacheWriteMicroUsd: 1.32,
  },
};

function parsePrice(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  // A misconfigured price would silently move the ceiling, so an unusable
  // value falls back to the default rather than to zero -- a zero price makes
  // every run free and the ceiling unreachable.
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parsePrices(
  env: {
    VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
    VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
  },
  provider = 'anthropic',
  modelPrices?: TokenPrices,
): TokenPrices {
  // The fallback follows the selected provider. Without that, switching to
  // DeepSeek would price its runs at Anthropic's rates -- an over-estimate,
  // so safe, but a dollar figure that is wrong by forty times is not a
  // ceiling anyone can reason about.
  // A chosen model's own rate is the most precise figure available and wins
  // over the provider default: a run on Opus must not be ceilinged at
  // DeepSeek's rate because the deployment happens to default to DeepSeek.
  // An operator's explicit VIBLD_USD_MICRO_PER_* still overrides both.
  const fallback = modelPrices ?? PROVIDER_PRICES[provider] ?? DEFAULT_PRICES;
  const inputMicroUsd = parsePrice(
    env.VIBLD_USD_MICRO_PER_INPUT_TOKEN,
    fallback.inputMicroUsd,
  );
  return {
    inputMicroUsd,
    outputMicroUsd: parsePrice(
      env.VIBLD_USD_MICRO_PER_OUTPUT_TOKEN,
      fallback.outputMicroUsd,
    ),
    // Derived from whatever the input rate ended up being, including an
    // operator's override. There is no VIBLD_USD_MICRO_PER_CACHED_TOKEN and
    // there should not be: an operator who sets the input rate and forgets
    // the cached one would leave the two describing different models, and a
    // ratio that holds across a provider's line-up is not worth a knob.
    cachedInputMicroUsd:
      inputMicroUsd * (fallback.cachedInputMicroUsd / fallback.inputMicroUsd),
    cacheWriteMicroUsd:
      inputMicroUsd * (fallback.cacheWriteMicroUsd / fallback.inputMicroUsd),
  };
}

export interface TokenUsage {
  /**
   * Every prompt token, including the cached ones. The two fields below are
   * subsets of this, never additions to it: see `PlanUsage` in
   * `packages/ai/src/client.ts`, which normalises three providers that do
   * not agree about what their own input count includes.
   */
  inputTokens: number;
  outputTokens: number;
  /** Optional so the reservation, which knows neither, can share this shape. */
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

/**
 * Reserved key for the account-wide ledger, sharing `USER_BUDGET`'s namespace
 * with every per-user key rather than needing a second binding. Safe as long
 * as it can never collide with a real identity: per-user keys are Clerk user
 * ids (docs/decisions.md L3), which are always prefixed "user_", and this is
 * not one. Shared between `index.ts` (which reserves against it) and
 * `generation-workflow.ts` (which settles it), so the two cannot drift onto
 * different keys for the same ledger.
 */
export const ACCOUNT_BUDGET_KEY = '__account__';

/**
 * What a run cost, with the cached tokens priced as cached.
 *
 * The three input rates are applied to three disjoint counts. `inputTokens`
 * is the whole prompt, so the part charged at the full rate is what is left
 * after the cached read and the cache write are taken out of it, and a
 * reservation that reports neither is priced exactly as it was before.
 *
 * Clamped at zero rather than trusted: a provider that reported more cached
 * tokens than input tokens would otherwise produce a negative charge, which
 * would credit somebody's allowance for a run that cost money. A figure that
 * cannot be read is not a refund.
 */
export function microUsdOf(usage: TokenUsage, prices: TokenPrices): number {
  const cached = usage.cacheReadInputTokens ?? 0;
  const written = usage.cacheWriteInputTokens ?? 0;
  const full = Math.max(0, usage.inputTokens - cached - written);
  return Math.ceil(
    full * prices.inputMicroUsd +
      cached * prices.cachedInputMicroUsd +
      written * prices.cacheWriteMicroUsd +
      usage.outputTokens * prices.outputMicroUsd,
  );
}

/**
 * The most a single run can cost.
 *
 * Both halves are already bounded by the endpoint: `maxOutputTokens` is the
 * provider's own cap, and the request guard rejects anything larger than
 * `maxInputChars`. Four characters per token is the same rough estimate the
 * shell's ledger uses; it is deliberately generous, because a worst case that
 * under-estimates is not a worst case.
 *
 * `maxInputChars` is the prompt *and* the base project sent with it. It used
 * to be the prompt alone, which was right while only file paths went to the
 * model; once contents did, the same call would have under-counted the input
 * side of a run by roughly forty times -- and this file's own rule is that a
 * worst case which under-estimates is not one.
 */
export function worstCaseMicroUsd(
  prices: TokenPrices,
  maxOutputTokens: number,
  maxInputChars: number,
): number {
  return microUsdOf(
    {
      inputTokens: Math.ceil(maxInputChars / 4),
      outputTokens: maxOutputTokens,
    },
    prices,
  );
}

/**
 * What a run the caller stopped should be charged (#189 review).
 *
 * Aborting the model call makes it reject, so the provider never reports
 * usage, and `settleBudget`'s middle case then charges the full worst-case
 * reservation. For a build that is right: the run happened somewhere this
 * Worker cannot see, and over-counting is the safe direction when the cause
 * is unknown. For a cancellation it is not, because the cause is known and
 * the number is wrong by an order of magnitude in the direction that
 * punishes the reader: pressing Cancel one second into a mockup run would
 * cost more than letting it finish, which makes the button a trap.
 *
 * So a stopped run is settled from what was actually measured. Two halves:
 *
 * - The input is the prompt that was really sent, measured by the caller
 *   and passed in. An earlier version passed the reservation's *bound*
 *   here, on the reasoning that "the input was sent in full before a token
 *   came back" -- which is true, and does not make the bound the right
 *   number (#189 review). The whole input being sent is not the whole
 *   allowance being used: a ten-character unstyled prompt was settled as
 *   though it were four thousand characters plus a style direction that
 *   was never chosen, about five times over.
 * - The output is estimated from the characters the model streamed, at the
 *   four-characters-per-token figure `worstCaseMicroUsd` above already
 *   uses. That is a rough number, and HTML can run denser than four, so it
 *   can under-count.
 *
 * Under-counting a cancelled run is the direction to err in. The upstream
 * cost stops when the connection drops, so the real bill is small; and a
 * cancellation that over-charges deters the one behaviour that saves money.
 * Clamped at `maxOutputTokens` regardless, so a settlement can never exceed
 * the reservation it is closing.
 */
export function cancelledUsage(
  streamedCharacters: number,
  maxOutputTokens: number,
  /** Characters the caller really sent, not the bound they were allowed. */
  inputChars: number,
): Required<TokenUsage> {
  return {
    inputTokens: Math.ceil(Math.max(0, inputChars) / 4),
    outputTokens: Math.min(
      maxOutputTokens,
      Math.ceil(Math.max(0, streamedCharacters) / 4),
    ),
    // Explicit zeroes rather than omitted, and `Required` rather than
    // `TokenUsage`, because this is handed to `settleBudget`, which takes
    // the provider's own `PlanUsage` where both fields are mandatory. The
    // value is honest either way: nothing reported cache activity, and
    // `microUsdOf` prices a zero exactly as it prices an absence.
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}

export type SpendVerdict =
  | { allow: true }
  | { allow: false; reason: 'period-ceiling' | 'too-many-in-flight' };

export interface SpendQuestion {
  /** Already spent or reserved in the current period, in micro-USD. */
  spentMicroUsd: number;
  /** Runs started and not yet settled. */
  inFlight: number;
  worstCaseMicroUsd: number;
  ceilingMicroUsd: number;
  maxInFlight: number;
}

/**
 * Decide whether one more run may start.
 *
 * The worst case is charged *before* the run, not after. Accounting after the
 * fact produces an accurate ledger and a useless ceiling: every one of N
 * concurrent requests reads the same pre-flight balance, every one sees
 * headroom, and every one proceeds. Reserving pessimistically and reconciling
 * afterwards is what makes the limit hold when requests arrive together.
 */
export function decide(question: SpendQuestion): SpendVerdict {
  if (question.inFlight >= question.maxInFlight) {
    return { allow: false, reason: 'too-many-in-flight' };
  }
  if (
    question.spentMicroUsd + question.worstCaseMicroUsd >
    question.ceilingMicroUsd
  ) {
    return { allow: false, reason: 'period-ceiling' };
  }
  return { allow: true };
}

/**
 * The UTC day a run belongs to. `budget.ts`'s `UserBudget` groups spend by
 * whatever key it is given; this is the account-wide ceiling's key
 * (docs/decisions.md L29, genuinely daily) -- `monthKey` below is the
 * per-user one (L35-L39, a monthly tier allowance).
 */
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The UTC calendar month a run belongs to, e.g. "2026-09". */
export function monthKey(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}
