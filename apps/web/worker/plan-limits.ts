/**
 * Plan limits set from the admin panel (docs/decisions.md D134):
 *
 *     GET  /api/admin/plans          each plan's limits: in code, saved,
 *                                    and in force
 *     POST /api/admin/plans          save one plan's limits
 *     POST /api/admin/plans/reset    put one plan back to the code's
 *
 * A plan an admin has not changed keeps the limits in `entitlement.ts`.
 * A per-account override (D73) still comes first. Every change is audited.
 *
 * vibld.com's pricing copy is not read from here and is updated by hand to
 * match (D134).
 *
 * The admin check runs before the handler (`requireAdmin` in index.ts).
 */

import type { AuditEntry } from './admin-store.ts';
import {
  ACTIVE_PROJECT_LIMIT,
  monthlyAllowanceMicroUsd,
  type Tier,
} from './entitlement.ts';

export const PLAN_TIERS: readonly Tier[] = ['free', 'build', 'ship'];

/** What a plan allows. */
export interface PlanLimits {
  /** Active projects at once, or null for no limit. */
  activeProjectLimit: number | null;
  monthlyAllowanceMicroUsd: number;
}

export interface SavedPlanLimits extends PlanLimits {
  updatedAt: string;
  updatedBy: string;
}

export type SavedPlans = Partial<Record<Tier, SavedPlanLimits>>;

/** The limits in code, with this deployment's Free allowance. */
export function codePlanLimits(
  tier: Tier,
  freeAllowanceMicroUsd: number,
): PlanLimits {
  return {
    activeProjectLimit: ACTIVE_PROJECT_LIMIT[tier],
    monthlyAllowanceMicroUsd: monthlyAllowanceMicroUsd(
      tier,
      freeAllowanceMicroUsd,
    ),
  };
}

/** The limits a plan has: what an admin saved, else the code's. */
export function planLimitsFor(
  tier: Tier,
  saved: SavedPlans,
  freeAllowanceMicroUsd: number,
): PlanLimits {
  const row = saved[tier];
  return row
    ? {
        activeProjectLimit: row.activeProjectLimit,
        monthlyAllowanceMicroUsd: row.monthlyAllowanceMicroUsd,
      }
    : codePlanLimits(tier, freeAllowanceMicroUsd);
}

// -------------------------------------------------------------------------
// Reading, once per isolate per window.
// -------------------------------------------------------------------------

/** How long an isolate keeps the saved limits before reading them again. */
export const PLAN_CACHE_MS = 30_000;

let cache: { db: D1Database; at: number; saved: Promise<SavedPlans> } | null =
  null;

/** Forget the limits this isolate read, after it changed them. */
export function forgetPlanLimits(): void {
  cache = null;
}

async function readSaved(db: D1Database): Promise<SavedPlans> {
  const result = await db.prepare(`SELECT * FROM plan_limits`).all<{
    tier: string;
    active_project_limit: number | null;
    monthly_allowance_micro_usd: number;
    updated_at: string;
    updated_by: string;
  }>();
  const saved: SavedPlans = {};
  for (const row of result.results ?? []) {
    if (!(PLAN_TIERS as readonly string[]).includes(row.tier)) continue;
    saved[row.tier as Tier] = {
      activeProjectLimit: row.active_project_limit,
      monthlyAllowanceMicroUsd: row.monthly_allowance_micro_usd,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }
  return saved;
}

/**
 * The plans an admin has changed. Read at most once per `PLAN_CACHE_MS`
 * per isolate, and once for any number of requests that arrive while that
 * read is in flight: a change is seen at once by the isolate that made it
 * and within that window by the rest.
 *
 * A read that fails throws, as every other read on the paths that ask
 * does: a limit that silently fell back to the code's could hand out more
 * than an admin set. It is not kept, so the next request reads again.
 */
export async function savedPlanLimits(
  db: D1Database,
  now: number = Date.now(),
): Promise<SavedPlans> {
  let entry = cache;
  if (!entry || entry.db !== db || now - entry.at >= PLAN_CACHE_MS) {
    const fresh = { db, at: now, saved: readSaved(db) };
    fresh.saved.catch(() => {
      if (cache === fresh) cache = null;
    });
    cache = fresh;
    entry = fresh;
  }
  return entry.saved;
}

// -------------------------------------------------------------------------
// The routes.
// -------------------------------------------------------------------------

export const PLAN_ROUTES = [
  '/api/admin/plans',
  '/api/admin/plans/reset',
] as const;

export function isPlanRoute(pathname: string): boolean {
  return (PLAN_ROUTES as readonly string[]).includes(pathname);
}

/** The most a plan's active-project limit may be set to. */
export const MAX_PLAN_PROJECT_LIMIT = 1_000;
/** The most a plan's monthly allowance may be set to: $10,000. */
export const MAX_PLAN_ALLOWANCE_USD_CENTS = 1_000_000;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface PlanView {
  tier: Tier;
  /** In force now. */
  limits: PlanLimits;
  /** In code, which a reset puts back. */
  code: PlanLimits;
  /** Saved by an admin, or null where the code's apply. */
  saved: SavedPlanLimits | null;
}

export interface PlanLimitDeps {
  adminEmail: string;
  audit: (entry: AuditEntry) => Promise<boolean>;
  freeAllowanceMicroUsd: number;
  now?: () => Date;
}

async function views(
  db: D1Database,
  freeAllowanceMicroUsd: number,
): Promise<PlanView[]> {
  const saved = await savedPlanLimits(db);
  return PLAN_TIERS.map((tier) => ({
    tier,
    limits: planLimitsFor(tier, saved, freeAllowanceMicroUsd),
    code: codePlanLimits(tier, freeAllowanceMicroUsd),
    saved: saved[tier] ?? null,
  }));
}

function isTier(value: unknown): value is Tier {
  return (PLAN_TIERS as readonly unknown[]).includes(value);
}

/** A whole number from 0 to `most`, or null where `nullable`. */
function bounded(
  value: unknown,
  name: string,
  most: number,
  nullable: boolean,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null && nullable) return { ok: true, value: null };
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > most
  ) {
    return {
      ok: false,
      error: `"${name}" must be a whole number from 0 to ${most}${
        nullable ? ', or null for no limit' : ''
      }.`,
    };
  }
  return { ok: true, value };
}

export async function handlePlanLimits(
  request: Request,
  db: D1Database,
  deps: PlanLimitDeps,
): Promise<Response> {
  const route = new URL(request.url).pathname;
  if (route === '/api/admin/plans' && request.method === 'GET') {
    return json({ plans: await views(db, deps.freeAllowanceMicroUsd) });
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return json({ error: 'Body must be a JSON object.' }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be a JSON object.' }, 400);
  }
  const tier = body.tier;
  if (!isTier(tier)) {
    return json({ error: '"tier" must be one of free, build, ship.' }, 400);
  }
  const at = (deps.now ?? (() => new Date()))().toISOString();

  if (route === '/api/admin/plans/reset') {
    const removed = await db
      .prepare(`DELETE FROM plan_limits WHERE tier = ?1 RETURNING tier`)
      .bind(tier)
      .first<{ tier: string }>();
    if (!removed) {
      return json({ error: 'That plan already has the limits in code.' }, 409);
    }
    forgetPlanLimits();
    const audited = await deps.audit({
      at,
      adminEmail: deps.adminEmail,
      action: 'plan-limits-reset',
      targetUserId: null,
      target: tier,
      reason: null,
      detail: { ...codePlanLimits(tier, deps.freeAllowanceMicroUsd) },
    });
    return json({
      ok: true,
      tier,
      audited,
      plans: await views(db, deps.freeAllowanceMicroUsd),
    });
  }

  const limit = bounded(
    body.activeProjectLimit,
    'activeProjectLimit',
    MAX_PLAN_PROJECT_LIMIT,
    true,
  );
  if (!limit.ok) return json({ error: limit.error }, 400);
  const cents = bounded(
    body.monthlyAllowanceUsdCents,
    'monthlyAllowanceUsdCents',
    MAX_PLAN_ALLOWANCE_USD_CENTS,
    false,
  );
  if (!cents.ok) return json({ error: cents.error }, 400);
  const limits: PlanLimits = {
    activeProjectLimit: limit.value,
    monthlyAllowanceMicroUsd: cents.value! * 10_000,
  };
  await db
    .prepare(
      `INSERT INTO plan_limits
         (tier, active_project_limit, monthly_allowance_micro_usd,
          updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(tier) DO UPDATE SET
         active_project_limit = excluded.active_project_limit,
         monthly_allowance_micro_usd = excluded.monthly_allowance_micro_usd,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(
      tier,
      limits.activeProjectLimit,
      limits.monthlyAllowanceMicroUsd,
      at,
      deps.adminEmail,
    )
    .run();
  forgetPlanLimits();
  const audited = await deps.audit({
    at,
    adminEmail: deps.adminEmail,
    action: 'plan-limits',
    targetUserId: null,
    target: tier,
    reason: null,
    detail: { ...limits },
  });
  return json({
    ok: true,
    tier,
    audited,
    plans: await views(db, deps.freeAllowanceMicroUsd),
  });
}
