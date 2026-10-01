import { getClerkToken } from '../auth/clerk-token.ts';
import type { AdminResult, Tier } from './admin-users-client.ts';

/**
 * Calls the Worker's plan-limit routes (docs/decisions.md D134,
 * `worker/plan-limits.ts`), and the helpers the panel renders with.
 *
 * JSX-free for the reason `admin-users-client.ts` gives. Nothing here is a
 * permission; the routes check the caller is a platform admin themselves.
 */

export interface PlanLimits {
  activeProjectLimit: number | null;
  monthlyAllowanceMicroUsd: number;
}

export interface PlanView {
  tier: Tier;
  limits: PlanLimits;
  code: PlanLimits;
  saved: (PlanLimits & { updatedAt: string; updatedBy: string }) | null;
}

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readLimits(value: unknown): PlanLimits | null {
  if (!isRecord(value)) return null;
  const limit = value.activeProjectLimit;
  const allowance = value.monthlyAllowanceMicroUsd;
  if (
    !(
      limit === null ||
      (typeof limit === 'number' && Number.isFinite(limit))
    ) ||
    typeof allowance !== 'number' ||
    !Number.isFinite(allowance)
  ) {
    return null;
  }
  return { activeProjectLimit: limit, monthlyAllowanceMicroUsd: allowance };
}

function readPlan(value: unknown): PlanView | null {
  if (!isRecord(value)) return null;
  const tier = value.tier;
  if (tier !== 'free' && tier !== 'build' && tier !== 'ship') return null;
  const limits = readLimits(value.limits);
  const code = readLimits(value.code);
  if (!limits || !code) return null;
  const saved = isRecord(value.saved) ? value.saved : null;
  const savedLimits = saved ? readLimits(saved) : null;
  return {
    tier,
    limits,
    code,
    saved:
      saved && savedLimits
        ? {
            ...savedLimits,
            updatedAt:
              typeof saved.updatedAt === 'string' ? saved.updatedAt : '',
            updatedBy:
              typeof saved.updatedBy === 'string' ? saved.updatedBy : '',
          }
        : null,
  };
}

function readPlans(value: unknown): PlanView[] {
  return Array.isArray(value)
    ? value.map(readPlan).filter((plan): plan is PlanView => plan !== null)
    : [];
}

async function call(
  path: string,
  body: Record<string, unknown> | null,
  fetchImpl: Fetch,
  getToken: GetToken,
): Promise<AdminResult<{ plans: PlanView[]; audited: boolean }>> {
  let response: Response;
  try {
    const token = await getToken();
    response = await fetchImpl(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, error: 'The admin service could not be reached.' };
  }
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error:
        isRecord(answer) && typeof answer.error === 'string'
          ? answer.error
          : `The admin request failed (${response.status}).`,
    };
  }
  if (!isRecord(answer) || !Array.isArray(answer.plans)) {
    return {
      ok: false,
      error: 'The admin service returned an unexpected response.',
    };
  }
  return {
    ok: true,
    value: {
      plans: readPlans(answer.plans),
      audited: answer.audited !== false,
    },
  };
}

export function fetchPlans(
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return call('/api/admin/plans', null, fetchImpl, getToken);
}

export function savePlan(
  tier: Tier,
  activeProjectLimit: number | null,
  monthlyAllowanceUsdCents: number,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return call(
    '/api/admin/plans',
    { tier, activeProjectLimit, monthlyAllowanceUsdCents },
    fetchImpl,
    getToken,
  );
}

export function resetPlan(
  tier: Tier,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return call('/api/admin/plans/reset', { tier }, fetchImpl, getToken);
}

/**
 * What an admin typed for a plan: the project limit (blank is no limit, a
 * whole number from 0 to 1000 is the limit) and the allowance in dollars
 * (0 to 10,000, to the cent). Refused before it is sent otherwise.
 */
export function parsePlanFields(
  limit: string,
  dollars: string,
):
  | {
      ok: true;
      activeProjectLimit: number | null;
      monthlyAllowanceUsdCents: number;
    }
  | { ok: false; error: string } {
  const typedLimit = limit.trim();
  let activeProjectLimit: number | null = null;
  if (typedLimit !== '') {
    const value = Number(typedLimit);
    if (!Number.isInteger(value) || value < 0 || value > 1_000) {
      return {
        ok: false,
        error:
          'Active projects is a whole number from 0 to 1000, or blank for no limit.',
      };
    }
    activeProjectLimit = value;
  }
  const amount = Number(dollars.trim().replace(/^\$/, ''));
  if (
    dollars.trim() === '' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 10_000
  ) {
    return {
      ok: false,
      error: 'The monthly allowance is an amount from $0 to $10,000.',
    };
  }
  return {
    ok: true,
    activeProjectLimit,
    monthlyAllowanceUsdCents: Math.round(amount * 100),
  };
}

/** "3 active projects" or "No project limit". */
export function describeProjectLimit(limit: number | null): string {
  if (limit === null) return 'No project limit';
  return `${limit} active project${limit === 1 ? '' : 's'}`;
}
