/**
 * Which models a given person may use.
 *
 * ADR-0006 asks for grants represented outside model context, with a
 * principal and actions, checked at each trusted boundary. This is that, at
 * its smallest useful size: a principal is an Access identity, and the action
 * is "spend this deployment's budget on this model".
 *
 * The policy is a **secret**, never a `vars` entry: it contains email
 * addresses and this repository is public.
 *
 * It is applied in two places for two different reasons. `/api/config` filters
 * the picker, so a model someone may not use is not offered. `/api/plan`
 * refuses it, because the picker is a convenience and the endpoint is the
 * boundary -- a hidden option is still a reachable one.
 */

import type { ModelChoice } from './model-catalogue.ts';

export interface ModelPolicy {
  /** Models for anyone the rules below do not name. */
  default: string[];
  /** Exact Access identity, lower-cased. Wins over a domain rule. */
  users?: Record<string, string[]>;
  /** Domain, with or without the leading "@". Applied when no user matches. */
  domains?: Record<string, string[]>;
}

export type PolicyParse =
  { ok: true; policy: ModelPolicy } | { ok: false; reason: string };

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : null;
}

function ruleTable(value: unknown, label: string): Record<string, string[]> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`"${label}" must be an object of lists`);
  }
  const table: Record<string, string[]> = {};
  for (const [key, models] of Object.entries(value)) {
    const list = stringList(models);
    if (!list) throw new Error(`"${label}.${key}" must be a list of model ids`);
    table[key.trim().toLowerCase()] = list;
  }
  return table;
}

/** Parse the configured policy. Absent is not an error; malformed is. */
export function parseModelPolicy(
  raw: string | undefined | null,
): PolicyParse | null {
  if (raw === undefined || raw === null || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, reason: 'the policy must be a JSON object' };
    }
    const source = parsed as Record<string, unknown>;
    const fallback = stringList(source.default);
    if (!fallback) {
      return {
        ok: false,
        reason: '"default" is required and must be a list of model ids',
      };
    }
    return {
      ok: true,
      policy: {
        default: fallback,
        users: ruleTable(source.users, 'users'),
        domains: ruleTable(source.domains, 'domains'),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'unreadable policy',
    };
  }
}

/** The ids a principal is granted, before checking what is deployable. */
export function grantedIds(policy: ModelPolicy, principal: string): string[] {
  const identity = principal.trim().toLowerCase();
  const exact = policy.users?.[identity];
  if (exact) return exact;

  const at = identity.lastIndexOf('@');
  if (at !== -1 && policy.domains) {
    const domain = identity.slice(at + 1);
    const byDomain = policy.domains[domain] ?? policy.domains[`@${domain}`];
    if (byDomain) return byDomain;
  }
  return policy.default;
}

/**
 * The models this principal may actually use.
 *
 * The intersection matters in both directions: a policy naming a model the
 * deployment holds no key for must not surface it, and a deployable model
 * nobody granted must not appear either.
 *
 * A malformed policy resolves to the cheapest deployable model rather than to
 * everything or to nothing. Escalating on a typo would hand an expensive
 * model to everyone; failing to nothing would take a working product down.
 * Degrading to the cheapest does neither, and it is the same "safe direction"
 * rule the spend ceiling follows.
 */
export function allowedModels(
  parsed: PolicyParse | null,
  principal: string,
  deployable: readonly ModelChoice[],
): ModelChoice[] {
  if (parsed === null) return [...deployable];

  if (!parsed.ok) {
    // Output price first, then input as a tie-break. Without the tie-break
    // two models at the same output rate leave the winner to catalogue order,
    // so adding a provider could silently change which model a malformed
    // policy degrades everyone to. Ties are not hypothetical: DeepSeek Flash
    // and GPT-5.6 Luna both output at 1.2.
    const cheapest = [...deployable].sort(
      (a, b) =>
        a.outputMicroUsd - b.outputMicroUsd ||
        a.inputMicroUsd - b.inputMicroUsd,
    )[0];
    return cheapest ? [cheapest] : [];
  }

  const granted = new Set(grantedIds(parsed.policy, principal));
  return deployable.filter((model) => granted.has(model.id));
}
