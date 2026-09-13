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
 * Anthropic figures were taken from the model reference on 2026-09-13, not
 * recalled. The rest of the Claude line-up is deliberately absent: Opus 4.8,
 * 4.7 and 4.6 all cost exactly what Opus 5 costs and are older, and Sonnet 4.6
 * costs more than Sonnet 5 and is older, so offering them is offering someone
 * a worse run at the same price or a dearer one. Mythos 5.1 is access-gated.
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
export function availableModels(configured: {
  anthropic: boolean;
  deepseek: boolean;
}): ModelChoice[] {
  return MODEL_CATALOGUE.filter((model) => configured[model.provider]);
}
