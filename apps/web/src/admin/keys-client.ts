import { getClerkToken } from '../auth/clerk-token.ts';
import type { AdminResult } from './admin-users-client.ts';

/**
 * Calls the Worker's provider-key routes (docs/decisions.md D127, D131,
 * `worker/provider-keys.ts`). A key goes up once, in the body of the save,
 * and never comes back: every answer carries only its last four
 * characters.
 *
 * JSX-free for the reason `admin-users-client.ts` gives. Nothing here is a
 * permission; the routes check the caller is a platform admin themselves.
 */

export type KeyProvider = 'anthropic' | 'deepseek' | 'openai';

export interface ProviderKey {
  provider: KeyProvider;
  name: string;
  source: 'panel' | 'secret' | null;
  last4: string | null;
  /** Whether the panel holds a key, usable or not: what Remove removes. */
  stored: boolean;
  /** A stored key that does not open, so it is not the one in use. */
  unreadable: boolean;
  storedLast4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  secretSet: boolean;
}

export interface KeyList {
  keys: ProviderKey[];
  /** Whether this deployment can store a key (it has the encryption key). */
  canStore: boolean;
}

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);
const UNREACHABLE = 'The admin service could not be reached.';
const UNEXPECTED = 'The admin service returned an unexpected response.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

function readKey(value: unknown): ProviderKey | null {
  if (!isRecord(value)) return null;
  const provider = value.provider;
  if (
    provider !== 'anthropic' &&
    provider !== 'deepseek' &&
    provider !== 'openai'
  ) {
    return null;
  }
  const source = value.source;
  return {
    provider,
    name: str(value.name) ?? provider,
    source: source === 'panel' || source === 'secret' ? source : null,
    // Four characters at most, whatever the answer says.
    last4: str(value.last4)?.slice(-4) ?? null,
    stored: value.stored === true,
    unreadable: value.unreadable === true,
    storedLast4: str(value.storedLast4)?.slice(-4) ?? null,
    updatedAt: str(value.updatedAt),
    updatedBy: str(value.updatedBy),
    secretSet: value.secretSet === true,
  };
}

function readKeys(value: unknown): ProviderKey[] {
  return Array.isArray(value)
    ? value.map(readKey).filter((key): key is ProviderKey => key !== null)
    : [];
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
    return { ok: false, error: UNREACHABLE };
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

export async function fetchKeys(
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<KeyList>> {
  const result = await call('/api/admin/keys', null, fetchImpl, getToken);
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      keys: readKeys(result.value.keys),
      canStore: result.value.canStore === true,
    },
  };
}

export interface KeyChange {
  keys: ProviderKey[];
  audited: boolean;
}

export async function saveKey(
  provider: KeyProvider,
  key: string,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<KeyChange>> {
  const result = await call(
    '/api/admin/keys',
    { provider, key },
    fetchImpl,
    getToken,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      keys: readKeys(result.value.keys),
      audited: result.value.audited !== false,
    },
  };
}

export async function removeKey(
  provider: KeyProvider,
  fetchImpl: Fetch = defaultFetch,
  getToken: GetToken = getClerkToken,
): Promise<AdminResult<KeyChange>> {
  const result = await call(
    '/api/admin/keys/remove',
    { provider },
    fetchImpl,
    getToken,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: {
      keys: readKeys(result.value.keys),
      audited: result.value.audited !== false,
    },
  };
}

/** Where a provider's key comes from, as the panel says it. */
export function describeKey(key: ProviderKey): string {
  if (key.unreadable) {
    const fallback =
      key.source === 'secret'
        ? `The Worker secret, ending ${key.last4 ?? '????'}, is used instead.`
        : 'No key is in use for this provider.';
    return `A key ending ${key.storedLast4 ?? '????'} is stored here but cannot be opened with this deployment's encryption key, so it is not used. ${fallback} Set it again, or remove it.`;
  }
  if (key.source === 'panel') {
    return `Set here, ending ${key.last4 ?? '????'}${
      key.secretSet ? '. Used instead of the Worker secret.' : '.'
    }`;
  }
  if (key.source === 'secret') {
    return `From the Worker secret, ending ${key.last4 ?? '????'}.`;
  }
  return 'No key. Models from this provider are not offered.';
}
