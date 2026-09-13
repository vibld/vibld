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
 * Anthropic and OpenAI figures were taken from each vendor's own reference on
 * 2026-09-13, not recalled. The rest of the Claude line-up is deliberately absent: Opus 4.8,
 * 4.7 and 4.6 all cost exactly what Opus 5 costs and are older, and Sonnet 4.6
 * costs more than Sonnet 5 and is older, so offering them is offering someone
 * a worse run at the same price or a dearer one. Mythos 5.1 is access-gated.
 *
 * OpenAI's line-up is filtered the same way. The current generation is GPT-6
 * Astra and the three GPT-5.6 tiers, all of which hold 1.05M of context and
 * write up to 128K. The GPT-5.5, 5.4, 5.2, 5.1 and 5 families, the o-series
 * and everything GPT-4 are all superseded by something at or below their own
 * price. The `-pro` variants are left out for a different reason: at $30/$180
 * a single generation could cost more than a month of the Build tier, which
 * is not a choice to put behind a chip someone might tap out of curiosity.
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
  },
  {
    id: 'gpt-5.6-sol',
    provider: 'openai',
    label: 'GPT-5.6 Sol',
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
