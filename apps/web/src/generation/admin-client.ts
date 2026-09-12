import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/admin/*` (docs/decisions.md L4).
 *
 * JSX-free for the same reason `preview-client.ts`, `publish-client.ts` and
 * `billing-client.ts` are (see the latter's own doc comment): this
 * project's test runner strips TypeScript types only and errors on JSX.
 * `AdminPanel.tsx` is the JSX half that calls this from React.
 */

export interface AdminGrant {
  creditUsdCents: number;
  grantedByEmail: string;
  note: string | null;
  createdAt: string;
}

export type AdminUserResult =
  | {
      ok: true;
      userId: string;
      spendableCreditMicroUsd: number;
      grants: AdminGrant[];
    }
  | { ok: false; error: string };

export type AdminTopupResult =
  | { ok: true; userId: string; creditUsdCents: number }
  | { ok: false; error: string };

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : `The admin request failed (${response.status}).`;
}

/** Look up a user's current spendable credit and admin-grant history by email. */
export async function lookupAdminUser(
  email: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<AdminUserResult> {
  const response = await fetchImpl(
    `/api/admin/user?email=${encodeURIComponent(email)}`,
    { headers: await authHeaders(getToken) },
  );
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body: unknown = await response.json();
    const record = (body ?? {}) as {
      userId?: unknown;
      spendableCreditMicroUsd?: unknown;
      grants?: unknown;
    };
    if (
      typeof record.userId !== 'string' ||
      typeof record.spendableCreditMicroUsd !== 'number'
    ) {
      return {
        ok: false,
        error: 'The admin service returned an unexpected response.',
      };
    }
    return {
      ok: true,
      userId: record.userId,
      spendableCreditMicroUsd: record.spendableCreditMicroUsd,
      grants: Array.isArray(record.grants)
        ? (record.grants as AdminGrant[])
        : [],
    };
  } catch {
    return {
      ok: false,
      error: 'The admin service returned an unreadable response.',
    };
  }
}

/**
 * Grant a user manual spend credit. Always the direct result of something an
 * admin just clicked, so this throws on failure rather than swallowing it,
 * the same as `publishProject`.
 */
export async function grantAdminCredit(
  email: string,
  amountUsdCents: number,
  note: string | null,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<AdminTopupResult> {
  const response = await fetchImpl('/api/admin/topup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({ email, amountUsdCents, note }),
  });
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body: unknown = await response.json();
    const record = (body ?? {}) as {
      userId?: unknown;
      creditUsdCents?: unknown;
    };
    if (
      typeof record.userId !== 'string' ||
      typeof record.creditUsdCents !== 'number'
    ) {
      return {
        ok: false,
        error: 'The admin service returned an unexpected response.',
      };
    }
    return {
      ok: true,
      userId: record.userId,
      creditUsdCents: record.creditUsdCents,
    };
  } catch {
    return {
      ok: false,
      error: 'The admin service returned an unreadable response.',
    };
  }
}
