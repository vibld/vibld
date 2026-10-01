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
import { TIER_RANK } from './entitlement.ts';
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

/**
 * Model access saved in the admin panel (D133), as it applies to one
 * caller. `plans` is null until an admin saves it, and then
 * `VIBLD_MODEL_POLICY` and `TIER_MODELS` stop deciding. `extras` are the
 * models an admin granted this account on top of its plan's (D136), which
 * apply either way. Read by `modelGrantSource` in `model-grants.ts`.
 */
export interface ModelGrantSource {
  plans: Readonly<Record<Tier, readonly string[]>> | null;
  extras: readonly string[];
}

/** Nothing saved in the panel: the policy and D66 decide, as before it. */
export const NO_PANEL: ModelGrantSource = { plans: null, extras: [] };

/** What the deployment can serve at all: a model whose provider has a key. */
function deployable(env: ModelAccessEnv): ModelChoice[] {
  return availableModels(configuredProviders(env));
}

/** What the policy grants and the deployment can serve, before the tier. */
function policyGrantFor(env: ModelAccessEnv, principal: string): ModelChoice[] {
  return allowedModels(
    parseModelPolicy(env.VIBLD_MODEL_POLICY),
    principal,
    deployable(env),
  );
}

/** The models the plan's own list gives, before this account's extras. */
function planGrantFor(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
  source: ModelGrantSource,
): ModelChoice[] {
  if (source.plans) {
    // A deployment that sells no plans counts everybody as Free (D135).
    const listed = source.plans[tier ?? 'free'];
    return deployable(env).filter((model) => listed.includes(model.id));
  }
  const granted = policyGrantFor(env, principal);
  const held = tier ? TIER_MODELS[tier] : undefined;
  return held ? granted.filter((model) => held.includes(model.id)) : granted;
}

/** `models` with this account's extras added, in catalog order. */
function withExtras(
  env: ModelAccessEnv,
  models: readonly ModelChoice[],
  source: ModelGrantSource,
): ModelChoice[] {
  if (source.extras.length === 0) return [...models];
  const ids = new Set(models.map((model) => model.id));
  return deployable(env).filter(
    (model) => ids.has(model.id) || source.extras.includes(model.id),
  );
}

/** Everything this principal may use here, after every filter. */
export function grantedFor(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
  source: ModelGrantSource = NO_PANEL,
): ModelChoice[] {
  return withExtras(env, planGrantFor(env, principal, tier, source), source);
}

/**
 * What this caller would have on a better plan: under the policy, what it
 * grants them whatever the plan; under the panel, what any higher plan
 * includes. Their own grant is in it either way.
 */
function upgradeGrantFor(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
  source: ModelGrantSource,
): ModelChoice[] {
  if (!source.plans) {
    return withExtras(env, policyGrantFor(env, principal), source);
  }
  // No plans on sale, so none to move to.
  if (tier === null) return grantedFor(env, principal, tier, source);
  const plans = source.plans;
  const higher = (Object.keys(plans) as Tier[]).filter(
    (other) => TIER_RANK[other] > TIER_RANK[tier],
  );
  const ids = new Set([
    ...grantedFor(env, principal, tier, source).map((model) => model.id),
    ...higher.flatMap((other) => plans[other]),
  ]);
  return deployable(env).filter((model) => ids.has(model.id));
}

/**
 * Whether this caller's plan withholds a model they would have on a better
 * one, which is when the builder says what a paid plan unlocks. False for
 * a Free account the policy already holds to Luna: an upgrade would change
 * nothing there, and saying it would is a false promise.
 */
export function planWithholdsModels(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
  source: ModelGrantSource = NO_PANEL,
): boolean {
  return (
    grantedFor(env, principal, tier, source).length <
    upgradeGrantFor(env, principal, tier, source).length
  );
}

/** "A", "A and B", "A, B and C", or "N models" past three. */
function namesOf(models: readonly ModelChoice[]): string {
  if (models.length > 3) return `${models.length} models`;
  const labels = models.map((model) => model.label);
  return labels.length <= 1
    ? (labels[0] ?? '')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * The sentence the builder shows where the picker is when the plan holds
 * this caller back, and the refusal of a model the plan does not include;
 * null when it does not. `FREE_PLAN_MODELS_NOTE` until a panel policy is
 * saved, then one that names what the plan includes.
 */
export function planModelsNote(
  env: ModelAccessEnv,
  principal: string,
  tier: Tier | null,
  source: ModelGrantSource = NO_PANEL,
): string | null {
  if (!planWithholdsModels(env, principal, tier, source)) return null;
  // The D66 sentence only while it is true: no panel lists, and no extra
  // models an admin gave this account (Codex review of internal PR 344).
  if (!source.plans && source.extras.length === 0) {
    return FREE_PLAN_MODELS_NOTE;
  }
  const granted = grantedFor(env, principal, tier, source);
  const has =
    granted.length === 0
      ? 'Your plan includes no model this deployment can run.'
      : source.extras.length > 0
        ? `You build with ${namesOf(granted)}.`
        : `Your plan builds with ${namesOf(granted)}.`;
  return `${has} ${
    tier === 'free' ? 'Paid plans unlock' : 'The Ship plan unlocks'
  } more models.`;
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
  source: ModelGrantSource = NO_PANEL,
): ModelDecision {
  const upgradeGrant = upgradeGrantFor(env, principal, tier, source);
  const granted = grantedFor(env, principal, tier, source);
  const withheld = granted.length < upgradeGrant.length;

  if (granted.length === 0) {
    // The plan's own model is not deployable here (no OpenAI key, for
    // Free), which no edit to the policy would fix.
    if (withheld && !source.plans) {
      const names = (tier ? (TIER_MODELS[tier] ?? []) : [])
        .map((id) => findModel(id)?.label ?? id)
        .join(', ');
      return {
        ok: false,
        status: 403,
        error: `This plan builds with ${names}, which this deployment cannot serve.`,
      };
    }
    if (withheld) {
      return {
        ok: false,
        status: 403,
        error: planModelsNote(env, principal, tier, source)!,
      };
    }
    if (source.plans) {
      return {
        ok: false,
        status: 403,
        error: `No model is available to ${principal} on this deployment. A platform admin can change which models each plan includes in the admin panel.`,
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
        withheld && upgradeGrant.some((model) => model.id === wanted);
      return {
        ok: false,
        status: 403,
        error: byPlan
          ? planModelsNote(env, principal, tier, source)!
          : `That model is not available to ${principal}.`,
      };
    }
    return { ok: true, model: wanted, granted };
  }

  // A deployment that names its model and cannot serve it is misconfigured,
  // and says so (D91, Chris, 2026-09-30). It used to fall through to the
  // first granted model in catalogue order: a copy that kept the shipped
  // `gpt-6-sol` with only an Anthropic key ran on Claude Fable 5.1, the
  // dearest model it had, with nothing to say why.
  const unservable = unservableConfiguredModel(env);
  if (unservable) return { ok: false, status: 503, error: unservable };

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
  source: ModelGrantSource = NO_PANEL,
): string | null {
  return grantedFor(env, principal, tier, source).some(
    (model) => model.id === DRAFT_MODEL,
  )
    ? DRAFT_MODEL
    : null;
}

/** The environment variable that holds each provider's key. */
const KEY_NAME = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
} as const;

/**
 * Why the model `VIBLD_MODEL` names cannot run on this deployment, or null
 * when it can or none is named. Two ways it cannot: the catalogue does not
 * know it, or no key for its provider is set.
 */
export function unservableConfiguredModel(env: ModelAccessEnv): string | null {
  const named = env.VIBLD_MODEL?.trim();
  if (!named) return null;
  const model = findModel(canonicalModelId(named));
  if (!model) {
    return `VIBLD_MODEL is ${named}, which is not a model vibld knows. Set it to one from the model catalog, or leave it unset for the default of the provider whose key is set.`;
  }
  if (configuredProviders(env)[model.provider]) return null;
  return `VIBLD_MODEL is ${model.label}, and this deployment has no ${KEY_NAME[model.provider]}. Set VIBLD_MODEL to a model your keys serve, or leave it unset for the default of the provider whose key is set.`;
}
