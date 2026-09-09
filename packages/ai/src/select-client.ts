import { createAnthropicPlanClient } from './anthropic-client.ts';
import { createDeepseekPlanClient } from './deepseek-client.ts';
import { findModel } from './model-catalogue.ts';
import type { PlanClient } from './client.ts';

/**
 * Choose which model service a deployment talks to.
 *
 * ADR-0007 asks for the intended provider to be configured rather than
 * resolved by an implicit default, so an explicit `VIBLD_PROVIDER` wins over
 * anything inferred. Inference from which key is present exists only so a
 * local run or a CI job that sets one key does the obvious thing; when both
 * keys are set and nothing says which, Anthropic stays the default rather
 * than the cheaper option quietly taking over a run someone is measuring.
 */
export type ProviderName = 'anthropic' | 'deepseek';

/** Defaults per provider. Each is that provider's own current fast model. */
export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-opus-5',
  deepseek: 'deepseek-v4-flash',
};

export interface ProviderEnv {
  VIBLD_PROVIDER?: string | undefined;
  VIBLD_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  DEEPSEEK_API_KEY?: string | undefined;
}

export function selectProvider(env: ProviderEnv): ProviderName {
  const named = env.VIBLD_PROVIDER?.trim().toLowerCase();
  if (named === 'deepseek' || named === 'anthropic') return named;
  if (named) {
    throw new Error(
      `VIBLD_PROVIDER must be "anthropic" or "deepseek", not "${named}".`,
    );
  }
  if (!env.ANTHROPIC_API_KEY && env.DEEPSEEK_API_KEY) return 'deepseek';
  return 'anthropic';
}

/** The model a provider uses when the deployment does not name one. */
export function defaultModelFor(provider: ProviderName): string {
  return DEFAULT_MODELS[provider];
}

/**
 * The model to ask for, honouring an override only when there is one.
 *
 * An empty `VIBLD_MODEL` has to mean "unset". A blank optional input in a
 * workflow arrives as `""`, not as an absent variable, so `??` keeps it and
 * the request goes out with `model: ""` -- a 400 that reads like an outage,
 * discovered only once real money is on the line.
 */
export function resolveModel(env: ProviderEnv): string {
  const named = env.VIBLD_MODEL?.trim();
  return named && named.length > 0
    ? named
    : defaultModelFor(selectProvider(env));
}

/** Which providers this deployment holds a key for. */
export function configuredProviders(env: ProviderEnv): {
  anthropic: boolean;
  deepseek: boolean;
} {
  return {
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
  };
}

/**
 * The provider a request will actually use.
 *
 * A chosen model decides it -- a run asking for `deepseek-v4-pro` must not be
 * answered by Anthropic because that is what the deployment defaults to.
 * Falls back to the deployment's own selection when no model was chosen.
 */
export function providerForRequest(
  env: ProviderEnv,
  modelId?: string | null,
): ProviderName {
  const chosen = modelId ? findModel(modelId) : null;
  return chosen ? chosen.provider : selectProvider(env);
}

export function createPlanClient(
  env: ProviderEnv,
  modelId?: string | null,
): PlanClient {
  const provider = providerForRequest(env, modelId);
  if (provider === 'deepseek') {
    return createDeepseekPlanClient(
      env.DEEPSEEK_API_KEY ? { apiKey: env.DEEPSEEK_API_KEY } : {},
    );
  }
  return createAnthropicPlanClient(
    env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {},
  );
}
