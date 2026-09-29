import {
  allowedModels,
  availableModels,
  canonicalModelId,
  configuredProviders,
  familyOf,
  findModel,
  groupByFamily,
  parseModelPolicy,
} from '@vibld/ai';
import type { ModelChoice } from '@vibld/ai';
import type { Tier } from './entitlement.ts';

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
  OPENAI_API_KEY?: string | undefined;
  VIBLD_PROVIDER?: string | undefined;
  VIBLD_MODEL?: string | undefined;
  VIBLD_MODEL_POLICY?: string | undefined;
}

export type ModelDecision =
  | { ok: true; model: string; granted: ModelChoice[] }
  | { ok: false; status: number; error: string };

/**
 * The models a tier is held to, whatever the policy grants (D66, Chris,
 * 2026-09-29): a Free account builds, chats and mocks up with GPT-6 Luna
 * only. A tier not named here is held to nothing beyond the policy, which
 * is every paid tier, so they keep every model they had.
 *
 * In code rather than in `VIBLD_MODEL_POLICY`, and applied after it: the
 * policy is a secret nobody can read in review, and a limit that depends on
 * what somebody pasted into it is one a stale policy quietly lifts. The
 * policy can still narrow a Free account further; it cannot widen one.
 *
 * The tier passed in is null on a deployment that sells no plans (billing
 * not configured, `tierOf`): everybody there is Free with no paid plan to
 * move to, so nobody is held to a tier and the policy alone decides, as it
 * did before D66. A self-hosted deployment with no OpenAI key would
 * otherwise generate nothing at all.
 */
export const TIER_MODELS: Readonly<Partial<Record<Tier, readonly string[]>>> = {
  free: ['gpt-6-luna'],
};

/**
 * The sentence a Free account is shown where the picker would be
 * (`/api/config` sends it), and the refusal of a model the plan does not
 * include. One copy, in the Worker, so the builder cannot say one thing
 * while the endpoint enforces another.
 */
export const FREE_PLAN_MODELS_NOTE =
  'Free builds use GPT-6 Luna. Paid plans unlock the other models.';

/** What the policy grants and the deployment can serve, before the tier. */
function policyGrantFor(env: ModelAccessEnv, principal: string): ModelChoice[] {
  return allowedModels(
    parseModelPolicy(env.VIBLD_MODEL_POLICY),
    principal,
    availableModels(configuredProviders(env)),
  );
}

/** Everything this principal may use here, after all three filters. */
export function grantedFor(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
): ModelChoice[] {
  const granted = policyGrantFor(env, principal);
  const held = tier ? TIER_MODELS[tier] : undefined;
  return held ? granted.filter((model) => held.includes(model.id)) : granted;
}

/**
 * Whether this caller's plan withholds a model the policy would otherwise
 * give them, which is when the builder says what a paid plan unlocks.
 * False for a Free account the policy already holds to Luna: an upgrade
 * would change nothing there, and saying it would is a false promise.
 */
export function planWithholdsModels(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
): boolean {
  return (
    grantedFor(env, principal, tier).length <
    policyGrantFor(env, principal).length
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
  tier: Tier | null,
  chosen: string | null,
  fallback: string,
): ModelDecision {
  const policyGrant = policyGrantFor(env, principal);
  const granted = grantedFor(env, principal, tier);
  const withheld = granted.length < policyGrant.length;

  if (granted.length === 0) {
    // The plan's own model is not deployable here (no OpenAI key, for
    // Free), which no edit to the policy would fix.
    if (withheld) {
      const names = (tier ? (TIER_MODELS[tier] ?? []) : [])
        .map((id) => findModel(id)?.label ?? id)
        .join(', ');
      return {
        ok: false,
        status: 403,
        error: `This plan builds with ${names}, which this deployment cannot serve.`,
      };
    }
    // Names the identity it matched on. A policy keyed on the wrong address
    // is the likeliest way to be locked out of your own deployment, and
    // "no model is available to you" gives no way to find out which "you"
    // was meant. Disclosing a caller their own identity costs nothing.
    return {
      ok: false,
      status: 403,
      error: `No model is available to ${principal} on this deployment. Check the policy grants something to that identity.`,
    };
  }

  if (chosen) {
    // Canonicalised before it is checked or returned, so a saved request or a
    // stale client naming a renamed model still runs, and so the id that
    // reaches the provider is one the provider actually has.
    const wanted = canonicalModelId(chosen);
    // A hidden option is still a reachable one: the picker not offering it
    // is not what stops it being used.
    //
    // Refused rather than swapped for Luna when the plan is what withholds
    // it, as every ungranted model is: a run on a model nobody asked for
    // reads as the choice being honoured. The builder never sends one it
    // was not offered (`chooseModel`), so this is a stale tab or a hand-
    // made request, and the sentence says what the plan includes.
    if (!granted.some((model) => model.id === wanted)) {
      const byPlan =
        withheld && policyGrant.some((model) => model.id === wanted);
      return {
        ok: false,
        status: 403,
        error: byPlan
          ? FREE_PLAN_MODELS_NOTE
          : `That model is not available to ${principal}.`,
      };
    }
    return { ok: true, model: wanted, granted };
  }

  const wanted = canonicalModelId(fallback);
  const preferred =
    granted.find((model) => model.id === wanted)?.id ??
    // Not granted the default itself, then the newest version of its family
    // that is (internal PR 214 review). A policy written when Opus 5 was the default
    // grants Opus 5 and not 5.5; falling straight to the first grant would
    // hand that person whatever the catalogue lists first, which may be a
    // different model at twice the price.
    groupByFamily(granted).find(
      (group) =>
        group.family.key === familyOf({ id: wanted, label: wanted }).key,
    )?.defaultId;
  return { ok: true, model: preferred ?? granted[0]!.id, granted };
}

/**
 * The model that draws a build's draft (Chris, 2026-09-28): the cheapest
 * model in the catalogue that still writes a whole page, at about a cent or
 * two a draft, whatever model the build itself runs on.
 */
export const DRAFT_MODEL = 'deepseek-flash';

/**
 * `DRAFT_MODEL` where this principal may use it, else null, so the draft
 * falls back to the model they chose rather than being refused. A draft is
 * a placeholder; the policy still decides, as it does for every run.
 */
export function draftModelFor(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
): string | null {
  return grantedFor(env, principal, tier).some(
    (model) => model.id === DRAFT_MODEL,
  )
    ? DRAFT_MODEL
    : null;
}
