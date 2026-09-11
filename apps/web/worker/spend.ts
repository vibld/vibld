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
  deepseek: { inputMicroUsd: 1.32, outputMicroUsd: 3.96 },
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
  return {
    inputMicroUsd: parsePrice(
      env.VIBLD_USD_MICRO_PER_INPUT_TOKEN,
      fallback.inputMicroUsd,
    ),
    outputMicroUsd: parsePrice(
      env.VIBLD_USD_MICRO_PER_OUTPUT_TOKEN,
      fallback.outputMicroUsd,
    ),
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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

export function microUsdOf(usage: TokenUsage, prices: TokenPrices): number {
  return Math.ceil(
    usage.inputTokens * prices.inputMicroUsd +
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

export type SpendVerdict =
  | { allow: true }
  | { allow: false; reason: 'daily-ceiling' | 'too-many-in-flight' };

export interface SpendQuestion {
  /** Already spent or reserved today, in micro-USD. */
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
    return { allow: false, reason: 'daily-ceiling' };
  }
  return { allow: true };
}

/** The UTC day a run belongs to. Ceilings reset at 00:00 UTC. */
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}
