import {
  allowedModels,
  availableModels,
  configuredProviders,
  parseModelPolicy,
} from '@vibld/ai';
import type { ModelChoice } from '@vibld/ai';

/**
 * Decide which model a request may run on.
 *
 * Pure, and separate from the Worker that applies it, for the same reason
 * `spend.ts` is: this is the rule about who may spend what, and a rule that
 * can only be exercised by deploying is a rule nobody checks. The object owns
 * the request; this file owns the reasoning.
 *
 * ADR-0006 asks for grants to be checked at the trusted boundary and on each
 * action rather than once at sign-in, which is why the endpoint re-decides
 * this per request instead of trusting what the picker offered.
 */

export interface ModelAccessEnv {
  ANTHROPIC_API_KEY?: string | undefined;
  DEEPSEEK_API_KEY?: string | undefined;
  VIBLD_PROVIDER?: string | undefined;
  VIBLD_MODEL?: string | undefined;
  VIBLD_MODEL_POLICY?: string | undefined;
}

export type ModelDecision =
  | { ok: true; model: string; granted: ModelChoice[] }
  | { ok: false; status: number; error: string };

/** Everything this principal may use here, after both filters. */
export function grantedFor(
  env: ModelAccessEnv,
  principal: string,
): ModelChoice[] {
  return allowedModels(
    parseModelPolicy(env.VIBLD_MODEL_POLICY),
    principal,
    availableModels(configuredProviders(env)),
  );
}

/**
 * Resolve the model a run will use, or refuse.
 *
 * `fallback` is the deployment's configured default. It is only used when
 * this principal is granted it -- otherwise the default would quietly hand
 * someone a model the policy withheld, which is the whole failure this
 * exists to prevent.
 */
export function decideModel(
  env: ModelAccessEnv,
  principal: string,
  chosen: string | null,
  fallback: string,
): ModelDecision {
  const granted = grantedFor(env, principal);

  if (granted.length === 0) {
    return {
      ok: false,
      status: 403,
      error: 'No model is available to you on this deployment.',
    };
  }

  if (chosen) {
    // A hidden option is still a reachable one: the picker not offering it
    // is not what stops it being used.
    if (!granted.some((model) => model.id === chosen)) {
      return {
        ok: false,
        status: 403,
        error: 'That model is not available to you.',
      };
    }
    return { ok: true, model: chosen, granted };
  }

  const preferred = granted.find((model) => model.id === fallback);
  return { ok: true, model: (preferred ?? granted[0]!).id, granted };
}
