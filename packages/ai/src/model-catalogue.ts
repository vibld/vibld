/**
 * The models a deployment may be asked to use.
 *
 * A closed set, for the same reason the style presets are one: the id crosses
 * the network from the browser and decides what an account spends. An open
 * field would let anyone with a session point a run at the most expensive
 * model a provider sells, or at a model that does not exist -- a 400 that
 * reads like an outage.
 *
 * Prices are list, in micro-USD per token, which is the same as dollars per
 * million tokens. DeepSeek's are its **peak** rates: peak is double off-peak,
 * and a ceiling computed from the cheaper number is not a ceiling.
 *
 * Every entry also carries the two numbers that decide whether a request is
 * even well-formed for that model, rather than leaving them implied:
 * `maxOutputTokens`, because a whole multi-file project needs a large output
 * ceiling and a model that cannot reach it truncates every run; and
 * `supportsEffort`, because `output_config.effort` is not accepted by every
 * model and sending it where it is not returns a 400. Those are per-model API
 * facts, so they live beside the model rather than in the client that has to
 * respect them.
 *
 * Every figure was read off the vendor's own pricing and model pages, not
 * recalled: Anthropic's pricing page, OpenAI's pricing and model pages, and
 * DeepSeek's pricing page. Last checked in full on 2026-09-26
 * (`CATALOGUE_VERIFIED_ON`).
 *
 * No model is left out for being older or superseded. Which model someone
 * wants is theirs to decide, and a model the provider still sells at a
 * published price is offered here at that price. An older Claude that costs
 * the same as a newer one, or more, is still somebody's specific choice.
 *
 * GPT-5.6 Terra and GPT-5.6 Luna were missing from the 2026-09-23 read of
 * OpenAI's pricing page, and the 2026-09-26 read found both listed at the
 * rates below. Had they gone, they would still stay: removing a model is not
 * a decision this file makes.
 */

import type { ProviderName } from './select-client.ts';

export interface ModelChoice {
  id: string;
  provider: ProviderName;
  /** Shown in the picker. */
  label: string;
  /** One short line under the label. Says what the trade is. */
  note: string;
  inputMicroUsd: number;
  outputMicroUsd: number;
  /** Total context window, in tokens. */
  contextWindow: number;
  /**
   * The largest response this model will produce. `DEFAULT_MAX_TOKENS` must
   * not exceed it: a whole project arrives cut off mid-file otherwise, which
   * is the failure `ProviderTruncationError` exists to name.
   */
  maxOutputTokens: number;
  /**
   * Whether `output_config.effort` is accepted. Haiku 4.5 rejects it with a
   * 400, so the client omits it there rather than sending a parameter the
   * model has no opinion about.
   */
  supportsEffort: boolean;
  /**
   * Output tokens a second, where that has been measured on this model
   * rather than assumed (#209).
   *
   * Optional, and absence means "not measured", not "fast". A model without
   * one is sized by `MEASURED_OUTPUT_TOKENS_PER_SECOND`, which was measured
   * on DeepSeek Flash and is the only other figure there is. That default is
   * optimistic for a slower model, and the way to correct it is a
   * measurement here, not a guess.
   *
   * It matters because a ceiling is a time budget as much as a money one. A
   * run may emit only what its model can produce inside
   * `RUN_WALL_CLOCK_BUDGET_MS`, and one global rate made that bound five and
   * a half times too generous for the slowest model offered.
   */
  outputTokensPerSecond?: number;
  /**
   * What a cached input token costs on this model, where it is not the
   * provider's usual fraction of the input rate.
   *
   * Optional, and absence means "the provider's ratio holds here". It does
   * not hold for Claude Opus 5.5 (a twentieth of input), Claude Fable 5.1 (a
   * fortieth) or either DeepSeek model (a fiftieth and a thirtieth at peak),
   * and priced by the provider-wide tenth each of them billed its cached
   * tokens at two to five times their cost.
   */
  cacheReadMicroUsd?: number;
}

/**
 * What a cached input token costs, as a multiple of the model's own input
 * rate (#166, #165).
 *
 * A multiple rather than a figure per model, because that is what it is: each
 * provider publishes one ratio that applies across its line-up, and writing
 * ten derived numbers into the catalogue would present arithmetic as ten
 * separately verified prices.
 *
 * **These ratios want confirming against each provider's current pricing
 * before the ledger is trusted to the last cent.** They are the published
 * ones, and a provider that changes them changes what every run costs here,
 * so a stale ratio is a bill that is quietly wrong rather than one that
 * fails loudly.
 *
 * `write` is the premium for putting a prefix into the cache, and it is only
 * ever charged where a provider bills separately for it. Anthropic does, and
 * OpenAI does from GPT-5.6 on. DeepSeek caches automatically and charges
 * nothing extra to write, so a token written into its cache is an ordinary
 * input token and the multiple is 1.
 */
/**
 * When the rates and limits in this file were last checked against each
 * vendor's own reference.
 *
 * Data rather than the sentence in the comment above, because the sentence
 * cannot fail. Every figure here is a fact about somebody else's product:
 * they reprice, they raise a context window, they retire a model, and
 * nothing in this repository finds out. `model-catalogue.test.ts` fails once
 * this date is older than `MAX_CATALOGUE_AGE_DAYS`, which is a deliberate
 * tripwire and not an accident: the alternative is a bill computed from a
 * price nobody has looked at since it was typed.
 *
 * Re-checking means opening each vendor's pricing and model reference,
 * correcting anything that moved, and moving this date. Moving the date
 * without re-checking defeats the only mechanism there is.
 *
 * This is also the honest answer to "source the facts from the provider's
 * catalogue at runtime" (#165): no provider serves prices. OpenAI's and
 * DeepSeek's models endpoints list ids and little else, and Anthropic's adds
 * each model's context window, output ceiling and effort support; prices
 * and cache rates live on a pricing page meant for people. What the
 * endpoints do serve is checked daily by `served-check.ts`, off the request
 * path rather than in front of every run, and prices by `price-check.ts`.
 */
export const CATALOGUE_VERIFIED_ON = '2026-09-26';

/** How long the figures above may go unchecked before the tests say so. */
export const MAX_CATALOGUE_AGE_DAYS = 180;

/** Whole days since the catalogue's figures were last verified. */
export function catalogueAgeDays(now: Date = new Date()): number {
  const verified = Date.parse(`${CATALOGUE_VERIFIED_ON}T00:00:00Z`);
  return Math.floor((now.getTime() - verified) / 86_400_000);
}

export interface CacheRates {
  read: number;
  write: number;
}

export const PROVIDER_CACHE_RATES: Readonly<Record<ProviderName, CacheRates>> =
  {
    // Anthropic: a cache read is a tenth of the input rate, and a five-minute
    // cache write is a quarter more than one. The write premium is why a
    // breakpoint on a prefix that changes between requests costs money rather
    // than saving it.
    anthropic: { read: 0.1, write: 1.25 },
    // OpenAI: GPT-5.6 and later charge a cache write at a quarter more than
    // an input token, and every OpenAI model offered here is 5.6 or later.
    // The usage reports the written tokens separately
    // (`input_tokens_details.cache_write_tokens`), so they are billed at
    // this rate only when a write actually happened.
    openai: { read: 0.1, write: 1.25 },
    deepseek: { read: 0.1, write: 1 },
  };

/** This model's cache rates, in micro-USD per token. */
export function cacheRatesFor(model: ModelChoice): {
  cachedInputMicroUsd: number;
  cacheWriteMicroUsd: number;
} {
  const rates = PROVIDER_CACHE_RATES[model.provider];
  return {
    cachedInputMicroUsd:
      model.cacheReadMicroUsd ?? model.inputMicroUsd * rates.read,
    cacheWriteMicroUsd: model.inputMicroUsd * rates.write,
  };
}

export const MODEL_CATALOGUE: readonly ModelChoice[] = [
  {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    label: 'Claude Fable 5.1',
    note: 'Most capable, and the dearest. Schema-enforced output.',
    inputMicroUsd: 10,
    outputMicroUsd: 50,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
    // A fortieth of its input rate, not the provider's usual tenth. Priced
    // by the ratio, every cached token was billed at four times its cost.
    cacheReadMicroUsd: 0.25,
  },
  {
    id: 'claude-fable-5',
    provider: 'anthropic',
    label: 'Claude Fable 5',
    note: 'The previous Fable, at the same price as Fable 5.1.',
    inputMicroUsd: 10,
    outputMicroUsd: 50,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Claude Opus 5.5',
    note: 'Newer than Opus 5 and a fifth cheaper. Schema-enforced output.',
    inputMicroUsd: 4,
    outputMicroUsd: 20,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
    cacheReadMicroUsd: 0.2,
  },
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    label: 'Claude Opus 5',
    note: 'Best quality for the price. Schema-enforced output.',
    inputMicroUsd: 5,
    outputMicroUsd: 25,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    label: 'Claude Opus 4.8',
    note: 'An earlier Opus, at the Opus 5 price.',
    inputMicroUsd: 5,
    outputMicroUsd: 25,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-7',
    provider: 'anthropic',
    label: 'Claude Opus 4.7',
    note: 'An earlier Opus, at the Opus 5 price.',
    inputMicroUsd: 5,
    outputMicroUsd: 25,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    label: 'Claude Opus 4.6',
    note: 'An earlier Opus, at the Opus 5 price.',
    inputMicroUsd: 5,
    outputMicroUsd: 25,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5',
    note: 'Around half the price of Opus, same schema-enforced output.',
    inputMicroUsd: 2,
    outputMicroUsd: 10,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    label: 'Claude Sonnet 4.6',
    note: 'The previous Sonnet. Dearer per token than Sonnet 5.',
    inputMicroUsd: 3,
    outputMicroUsd: 15,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    note: 'Fastest and cheapest Claude. Smaller context, no effort control.',
    inputMicroUsd: 1,
    outputMicroUsd: 5,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsEffort: false,
  },
  {
    id: 'gpt-6-astra',
    provider: 'openai',
    label: 'GPT-6 Astra',
    note: "OpenAI's flagship. Schema-enforced output.",
    inputMicroUsd: 10,
    outputMicroUsd: 50,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
    // One production run, 2026-09-23: 32,000 output tokens in 624 seconds,
    // reasoning included, from step start to the ceiling. 51.3 a second,
    // rounded down.
    outputTokensPerSecond: 51,
  },
  {
    id: 'gpt-6-sol',
    provider: 'openai',
    label: 'GPT-6 Sol',
    note: 'The GPT-6 middle tier, at half the price of GPT-5.6 Sol.',
    inputMicroUsd: 2,
    outputMicroUsd: 10,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    note: 'The cheapest GPT-6, still schema-enforced.',
    inputMicroUsd: 0.1,
    outputMicroUsd: 0.5,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-5.6-sol',
    provider: 'openai',
    label: 'GPT-5.6 Sol',
    // OpenAI calls this promotional pricing, "available at least through
    // November 21, 2026". The pricing routine is what notices when it ends.
    note: 'Strong and mid-priced. Schema-enforced output.',
    inputMicroUsd: 4,
    outputMicroUsd: 20,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-5.6-terra',
    provider: 'openai',
    label: 'GPT-5.6 Terra',
    note: 'The balanced OpenAI option. Schema-enforced output.',
    inputMicroUsd: 2,
    outputMicroUsd: 12,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'gpt-5.6-luna',
    provider: 'openai',
    label: 'GPT-5.6 Luna',
    note: 'Cheap, and still schema-enforced unlike the DeepSeek options.',
    inputMicroUsd: 0.2,
    outputMicroUsd: 1.2,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsEffort: true,
  },
  {
    id: 'deepseek-flash',
    provider: 'deepseek',
    label: 'DeepSeek Flash',
    note: 'Cheapest of all. JSON mode, so the shape is checked rather than enforced.',
    inputMicroUsd: 0.3,
    outputMicroUsd: 1.2,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    supportsEffort: false,
    // Peak, like the other two rates: a fiftieth of input, not a tenth.
    cacheReadMicroUsd: 0.006,
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    label: 'DeepSeek V4 Pro',
    note: 'Stronger than Flash, still far cheaper than any Claude.',
    inputMicroUsd: 1.32,
    outputMicroUsd: 3.96,
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    supportsEffort: false,
    // Peak: $0.044 a million, a thirtieth of input rather than a tenth.
    cacheReadMicroUsd: 0.044,
  },
] as const;

const BY_ID = new Map(MODEL_CATALOGUE.map((model) => [model.id, model]));

/**
 * Model ids that were once real and are no longer in the catalogue, mapped to
 * what replaced them.
 *
 * This exists because a grant lives outside this repository. `VIBLD_MODEL_POLICY`
 * is a deployment secret naming model ids, so removing an id from the catalogue
 * does not remove it from the policies already deployed. A policy granting only
 * a removed id still parses as valid, intersects the catalogue to nothing, and
 * `decideModel` turns an empty grant into a 403 on every request: the whole
 * deployment stops generating, at deploy time, for the principals that policy
 * covers.
 *
 * `deepseek-v4-flash` is the case that forced this. It was the production
 * default under VIBLD_PROVIDER=deepseek and does not appear in DeepSeek's
 * pricing reference, so it was replaced by `deepseek-flash`.
 *
 * An alias is deliberately not a catalogue entry. A removed id must never be
 * sent to a provider (that is a 400 from a model that does not exist), so this
 * resolves to the canonical id at the policy boundary and everything
 * downstream, including the request itself, only ever sees the canonical one.
 */
export const LEGACY_MODEL_IDS: Readonly<Record<string, string>> = {
  'deepseek-v4-flash': 'deepseek-flash',
};

/**
 * The current id for a model id, following one legacy alias if there is one.
 *
 * Unknown ids pass through unchanged rather than throwing: this is used on
 * caller-supplied and policy-supplied strings, and rejecting an unknown model
 * is `decideModel`'s job, not this function's.
 */
export function canonicalModelId(id: string): string {
  return LEGACY_MODEL_IDS[id] ?? id;
}

export function findModel(id: string): ModelChoice | null {
  return BY_ID.get(id) ?? null;
}

export function isKnownModel(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/**
 * The models a deployment can actually serve.
 *
 * Offering a model whose provider has no key configured produces a run that
 * fails after the user has waited for it, so the picker is built from what
 * the deployment holds rather than from the whole catalogue.
 */
export function availableModels(
  configured: Record<ProviderName, boolean>,
): ModelChoice[] {
  return MODEL_CATALOGUE.filter((model) => configured[model.provider]);
}
