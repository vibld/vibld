/**
 * Model access set from the admin panel (docs/decisions.md D133, D135,
 * D136):
 *
 *     GET  /api/admin/models          the catalog, what this deployment
 *                                     can serve, and each plan's models:
 *                                     saved, or the starting setting
 *     POST /api/admin/models          save all three plans' models
 *     POST /api/admin/models/reset    go back to `VIBLD_MODEL_POLICY`
 *
 * Until an admin saves here, `VIBLD_MODEL_POLICY` and D66 (`TIER_MODELS`)
 * decide, as they did before the panel. Once saved, the panel alone
 * decides which models each plan includes; a deployment that sells no
 * plans uses the Free row (D135). An account's extra models (D136) are set
 * from its page (`/api/admin/user/models` in `admin-users.ts`) and apply
 * either way. Every change is audited.
 *
 * The three plans are saved together, so the panel's policy is never half
 * one thing and half the other.
 *
 * The admin check runs before the handler (`requireAdmin` in index.ts).
 */

import { MODEL_CATALOGUE, canonicalModelId, isKnownModel } from '@vibld/ai';
import type { ModelChoice } from '@vibld/ai';

import { AdminStore, modelIdsOf } from './admin-store.ts';
import type { AuditEntry } from './admin-store.ts';
import type { Tier } from './entitlement.ts';
import { TIER_MODELS } from './model-access.ts';
import type { ModelGrantSource } from './model-access.ts';
import { PLAN_TIERS } from './plan-limits.ts';

export type PlanModels = Record<Tier, string[]>;

export interface SavedPlanModels {
  plans: PlanModels;
  updatedAt: string;
  updatedBy: string;
}

/**
 * What the panel offers before anything is saved: D66, where Free builds
 * with GPT-6 Luna and the paid plans have every model in the catalog.
 */
export function startingPlanModels(): PlanModels {
  const every = MODEL_CATALOGUE.map((model) => model.id);
  return {
    free: [...(TIER_MODELS.free ?? every)],
    build: [...(TIER_MODELS.build ?? every)],
    ship: [...(TIER_MODELS.ship ?? every)],
  };
}

// -------------------------------------------------------------------------
// Reading, once per isolate per window.
// -------------------------------------------------------------------------

/** How long an isolate keeps the saved plans before reading them again. */
export const PLAN_MODELS_CACHE_MS = 30_000;

let cache: {
  db: D1Database;
  at: number;
  saved: Promise<SavedPlanModels | null>;
} | null = null;

/** Forget the plans this isolate read, after it changed them. */
export function forgetPlanModels(): void {
  cache = null;
}

async function readSaved(db: D1Database): Promise<SavedPlanModels | null> {
  const result = await db.prepare(`SELECT * FROM plan_models`).all<{
    tier: string;
    models: string;
    updated_at: string;
    updated_by: string;
  }>();
  const rows = (result.results ?? []).filter((row) =>
    (PLAN_TIERS as readonly string[]).includes(row.tier),
  );
  if (rows.length === 0) return null;
  // Saved as a whole, so a plan with no row is one nobody wrote by hand
  // away: it keeps the starting setting rather than losing every model.
  const plans = startingPlanModels();
  let latest = rows[0]!;
  for (const row of rows) {
    plans[row.tier as Tier] = modelIdsOf(row.models).map(canonicalModelId);
    if (row.updated_at > latest.updated_at) latest = row;
  }
  return { plans, updatedAt: latest.updated_at, updatedBy: latest.updated_by };
}

/**
 * The plans' models as an admin saved them, or null where none are and the
 * policy decides. Read at most once per `PLAN_MODELS_CACHE_MS` per isolate,
 * and once for any number of requests that arrive while that read is in
 * flight: a change is seen at once by the isolate that made it and within
 * that window by the rest.
 *
 * A read that fails throws, and is not kept: a grant that silently fell
 * back to the policy could hand somebody a model an admin took away.
 */
export async function savedPlanModels(
  db: D1Database,
  now: number = Date.now(),
): Promise<SavedPlanModels | null> {
  let entry = cache;
  if (!entry || entry.db !== db || now - entry.at >= PLAN_MODELS_CACHE_MS) {
    const fresh = { db, at: now, saved: readSaved(db) };
    fresh.saved.catch(() => {
      if (cache === fresh) cache = null;
    });
    cache = fresh;
    entry = fresh;
  }
  return entry.saved;
}

/**
 * Everything the panel says about one account's models, for
 * `decideModel`. The account's extras are read on every call; they change
 * one account at a time and an admin expects the change at once.
 */
export async function modelGrantSource(
  db: D1Database,
  userId: string,
): Promise<ModelGrantSource> {
  const [saved, person] = await Promise.all([
    savedPlanModels(db),
    new AdminStore(db).personModels(userId),
  ]);
  return {
    plans: saved?.plans ?? null,
    extras: (person?.models ?? []).map(canonicalModelId),
  };
}

// -------------------------------------------------------------------------
// Model lists from a request.
// -------------------------------------------------------------------------

/**
 * A list of model ids from a request: known to the catalog, each once, in
 * catalog order. Old ids are read as the model they were renamed to.
 */
export function parseModelIds(
  value: unknown,
  name: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((id) => typeof id === 'string')
  ) {
    return { ok: false, error: `"${name}" must be a list of model ids.` };
  }
  const wanted = new Set<string>();
  for (const raw of value as string[]) {
    const id = canonicalModelId(raw.trim());
    if (!isKnownModel(id)) {
      return {
        ok: false,
        error: `"${name}" names ${JSON.stringify(raw.slice(0, 60))}, which is not a model vibld knows.`,
      };
    }
    wanted.add(id);
  }
  return {
    ok: true,
    value: MODEL_CATALOGUE.filter((model) => wanted.has(model.id)).map(
      (model) => model.id,
    ),
  };
}

// -------------------------------------------------------------------------
// The routes.
// -------------------------------------------------------------------------

export const MODEL_ROUTES = [
  '/api/admin/models',
  '/api/admin/models/reset',
] as const;

export function isModelRoute(pathname: string): boolean {
  return (MODEL_ROUTES as readonly string[]).includes(pathname);
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface CatalogEntry {
  id: string;
  label: string;
  provider: ModelChoice['provider'];
  /** Whether this deployment has a key for its provider. */
  deployable: boolean;
}

export interface ModelAccessView {
  catalog: CatalogEntry[];
  /** Each plan's models as saved, else the starting setting (D66). */
  plans: PlanModels;
  /** Null until an admin saves; the policy decides until then. */
  saved: { updatedAt: string; updatedBy: string } | null;
  /** Whether `VIBLD_MODEL_POLICY` is set, which saving stops using. */
  policySet: boolean;
}

export interface ModelAccessDeps {
  adminEmail: string;
  audit: (entry: AuditEntry) => Promise<boolean>;
  /** The models this deployment has a key for, panel keys included. */
  deployable: readonly ModelChoice[];
  policySet: boolean;
  now?: () => Date;
}

async function view(
  db: D1Database,
  deps: ModelAccessDeps,
): Promise<ModelAccessView> {
  const saved = await savedPlanModels(db);
  const served = new Set(deps.deployable.map((model) => model.id));
  return {
    catalog: MODEL_CATALOGUE.map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      deployable: served.has(model.id),
    })),
    plans: saved?.plans ?? startingPlanModels(),
    saved: saved
      ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }
      : null,
    policySet: deps.policySet,
  };
}

export async function handleModelAccess(
  request: Request,
  db: D1Database,
  deps: ModelAccessDeps,
): Promise<Response> {
  const route = new URL(request.url).pathname;
  if (route === '/api/admin/models' && request.method === 'GET') {
    return json(await view(db, deps));
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const at = (deps.now ?? (() => new Date()))().toISOString();

  if (route === '/api/admin/models/reset') {
    const removed = await db
      .prepare(`DELETE FROM plan_models RETURNING tier`)
      .all<{ tier: string }>();
    if ((removed.results ?? []).length === 0) {
      return json(
        { error: 'No model access is saved; the policy already decides.' },
        409,
      );
    }
    forgetPlanModels();
    const audited = await deps.audit({
      at,
      adminEmail: deps.adminEmail,
      action: 'model-access-reset',
      targetUserId: null,
      target: null,
      reason: null,
      detail: null,
    });
    return json({ ok: true, audited, ...(await view(db, deps)) });
  }

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
  const given = body.plans;
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return json(
      { error: '"plans" must give the models for free, build and ship.' },
      400,
    );
  }
  const plans = {} as PlanModels;
  for (const tier of PLAN_TIERS) {
    const list = parseModelIds(
      (given as Record<string, unknown>)[tier],
      `plans.${tier}`,
    );
    if (!list.ok) return json({ error: list.error }, 400);
    plans[tier] = list.value;
  }
  await db.batch(
    PLAN_TIERS.map((tier) =>
      db
        .prepare(
          `INSERT INTO plan_models (tier, models, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(tier) DO UPDATE SET
             models = excluded.models,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
        )
        .bind(tier, JSON.stringify(plans[tier]), at, deps.adminEmail),
    ),
  );
  forgetPlanModels();
  const audited = await deps.audit({
    at,
    adminEmail: deps.adminEmail,
    action: 'model-access',
    targetUserId: null,
    target: null,
    reason: null,
    detail: { ...plans },
  });
  return json({ ok: true, audited, ...(await view(db, deps)) });
}
