import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/projects/:id/domain` (docs/decisions.md D189):
 * a published site on its owner's own domain.
 *
 * JSX-free for the reason `publish-client.ts` is. `CustomDomain.tsx` is
 * the half that calls this from React.
 */

export interface DnsRecord {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
}

export interface ProjectDomain {
  hostname: string;
  status: 'active' | 'pending' | 'failed';
  records: DnsRecord[];
  errors: string[];
}

export type DomainState =
  /** This deployment has no custom domains. Nothing is offered. */
  | { configured: false }
  | {
      configured: true;
      /** False on the Free plan: the builder says which plans have it. */
      eligible: boolean;
      domain: ProjectDomain | null;
    };

export type DomainResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      code?: string;
      /** With `verify-ownership`: the TXT record that proves the domain. */
      record?: DnsRecord;
    };

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readRecord(raw: unknown): DnsRecord | null {
  const record = (raw ?? {}) as Record<string, unknown>;
  return (record.type === 'CNAME' || record.type === 'TXT') &&
    typeof record.name === 'string' &&
    typeof record.value === 'string'
    ? { type: record.type, name: record.name, value: record.value }
    : null;
}

function readDomain(raw: unknown): ProjectDomain | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const domain = raw as Record<string, unknown>;
  if (
    typeof domain.hostname !== 'string' ||
    (domain.status !== 'active' &&
      domain.status !== 'pending' &&
      domain.status !== 'failed')
  ) {
    return null;
  }
  return {
    hostname: domain.hostname,
    status: domain.status,
    records: Array.isArray(domain.records)
      ? domain.records
          .map(readRecord)
          .filter((record): record is DnsRecord => record !== null)
      : [],
    errors: Array.isArray(domain.errors)
      ? domain.errors.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  };
}

/** The Worker's answer, read defensively. */
export function readDomainState(raw: unknown): DomainState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (body.configured === false) return { configured: false };
  if (body.configured !== true) return null;
  const domain = body.domain === null ? null : readDomain(body.domain);
  if (body.domain !== null && domain === null) return null;
  return { configured: true, eligible: body.eligible === true, domain };
}

async function failure(response: Response): Promise<{
  ok: false;
  error: string;
  code?: string;
  record?: DnsRecord;
}> {
  const problem = (await response.json().catch(() => null)) as {
    error?: unknown;
    code?: unknown;
    record?: unknown;
  } | null;
  const record = readRecord(problem?.record);
  return {
    ok: false,
    error:
      typeof problem?.error === 'string'
        ? problem.error
        : 'The domain request failed. Try again shortly.',
    ...(typeof problem?.code === 'string' ? { code: problem.code } : {}),
    ...(record ? { record } : {}),
  };
}

function path(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/domain`;
}

async function stateFrom(
  response: Response,
): Promise<DomainResult<DomainState>> {
  if (!response.ok) return failure(response);
  const state = readDomainState(await response.json().catch(() => null));
  return state
    ? { ok: true, value: state }
    : {
        ok: false,
        error: 'The domain service returned an unexpected response.',
      };
}

export async function fetchDomain(
  projectId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DomainResult<DomainState>> {
  return stateFrom(
    await fetchImpl(path(projectId), { headers: await authHeaders(getToken) }),
  );
}

/**
 * The domain's state after asking Cloudflare to validate a pending one
 * again, for "Check again".
 */
export async function recheckDomain(
  projectId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DomainResult<DomainState>> {
  return stateFrom(
    await fetchImpl(`${path(projectId)}?recheck=1`, {
      headers: await authHeaders(getToken),
    }),
  );
}

export async function connectDomain(
  projectId: string,
  hostname: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DomainResult<DomainState>> {
  return stateFrom(
    await fetchImpl(path(projectId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({ hostname }),
    }),
  );
}

export async function disconnectDomain(
  projectId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DomainResult<null>> {
  const response = await fetchImpl(path(projectId), {
    method: 'DELETE',
    headers: await authHeaders(getToken),
  });
  return response.ok ? { ok: true, value: null } : failure(response);
}
