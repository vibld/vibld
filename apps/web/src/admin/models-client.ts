import { getClerkToken } from '../auth/clerk-token.ts';
import type { AdminResult, Tier } from './admin-users-client.ts';

/**
 * Calls the Worker's model-access routes (docs/decisions.md D133, D135,
 * D136; `worker/model-grants.ts`): which models each plan includes, and the
 * extra models one account has on top of its plan's.
 *
 * JSX-free for the reason `admin-users-client.ts` gives. Nothing here is a
 * permission; the routes check the caller is a platform admin themselves.
 */

export interface CatalogModel {
  id: string;
  label: string;
  provider: string;
  /** Whether this deployment has a key for its provider. */
  deployable: boolean;
}

export type PlanModels = Record<Tier, string[]>;

export interface ModelAccess {
  catalog: CatalogModel[];
  /** As saved, else the starting setting (D66). */
  plans: PlanModels;
  /** Null until saved; `VIBLD_MODEL_POLICY` decides until then. */
  saved: { updatedAt: string; updatedBy: string } | null;
  policySet: boolean;
}

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);
const UNEXPECTED = 'The admin service returned an unexpected response.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readCatalog(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.label === 'string'
      ? [
          {
            id: entry.id,
            label: entry.label,
            provider: typeof entry.provider === 'string' ? entry.provider : '',
            deployable: entry.deployable === true,
          },
        ]
      : [],
  );
}

function readAccess(value: Record<string, unknown>): ModelAccess | null {
  const plans = value.plans;
  if (!isRecord(plans)) return null;
  const saved = isRecord(value.saved) ? value.saved : null;
  return {
    catalog: readCatalog(value.catalog),
    plans: {
      free: strings(plans.free),
      build: strings(plans.build),
      ship: strings(plans.ship),
    },
    saved: saved
      ? {
          updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : '',
          updatedBy: typeof saved.updatedBy === 'string' ? saved.updatedBy : '',
        }
      : null,
    policySet: value.policySet === true,
  };
}

async function call(
  path: string,
  body: Record<string, unknown> | null,
  fetchImpl: Fetch,
  getToken: GetToken,
): Promise<AdminResult<Record<string, unknown>>> {
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
  return isRecord(answer)
    ? { ok: true, value: answer }
    : { ok: false, error: UNEXPECTED };
}

async function accessCall(
  path: string,
  body: Record<string, unknown> | null,
  fetchImpl: Fetch,
  getToken: GetToken,
): Promise<AdminResult<ModelAccess & { audited: boolean }>> {
  const result = await call(path, body, fetchImpl, getToken);
  if (!result.ok) return result;
  const access = readAccess(result.value);
  return access
    ? {
        ok: true,
        value: { ...access, audited: result.value.audited !== false },
      }
    : { ok: false, error: UNEXPECTED };
}

export function fetchModelAccess(
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return accessCall('/api/admin/models', null, fetchImpl, getToken);
}

/** Save all three plans' models at once. */
export function saveModelAccess(
  plans: PlanModels,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return accessCall('/api/admin/models', { plans }, fetchImpl, getToken);
}

/** Go back to `VIBLD_MODEL_POLICY`. */
export function resetModelAccess(
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
) {
  return accessCall('/api/admin/models/reset', {}, fetchImpl, getToken);
}

/** `ids` with `id` added or taken out, in the catalog's order. */
export function toggled(
  catalog: readonly CatalogModel[],
  ids: readonly string[],
  id: string,
  on: boolean,
): string[] {
  const next = new Set(ids);
  if (on) next.add(id);
  else next.delete(id);
  return catalog.map((model) => model.id).filter((each) => next.has(each));
}

/** Labels for ids, in the order given; an id the catalog lacks as itself. */
export function labelsOf(
  catalog: readonly CatalogModel[],
  ids: readonly string[],
): string {
  if (ids.length === 0) return 'none';
  return ids
    .map((id) => catalog.find((model) => model.id === id)?.label ?? id)
    .join(', ');
}
