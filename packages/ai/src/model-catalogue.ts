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
}

export const MODEL_CATALOGUE: readonly ModelChoice[] = [
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    label: 'Claude Opus 5',
    note: 'Best quality. Schema-enforced output.',
    inputMicroUsd: 5,
    outputMicroUsd: 25,
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    label: 'DeepSeek V4 Flash',
    note: 'Cheapest. JSON mode, so the shape is checked rather than enforced.',
    inputMicroUsd: 0.44,
    outputMicroUsd: 1.32,
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    label: 'DeepSeek V4 Pro',
    note: 'Stronger than Flash, still far cheaper than Opus.',
    inputMicroUsd: 1.32,
    outputMicroUsd: 3.96,
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
