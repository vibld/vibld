import { getClerkToken } from '../auth/clerk-token.ts';
import type {
  ParkedPayment,
  ParkedQueue,
} from '../components/parked-queue-view.ts';

/**
 * Calls the Worker's `/api/admin/*` (docs/decisions.md L4).
 *
 * JSX-free for the same reason `preview-client.ts`, `publish-client.ts` and
 * `billing-client.ts` are (see the latter's own doc comment): this
 * project's test runner strips TypeScript types only and errors on JSX.
 * `AdminPanel.tsx` is the JSX half that calls this from React.
 */

/**
 * One past grant, with an amount and somebody who made it.
 *
 * Both are required on purpose. This list is what an admin reads before
 * granting again, and a row that cannot say how much or by whom is not a
 * grant they can reason about: rendered anyway it became "$NaN by
 * undefined", which reads as a bug in the page rather than as a gap in the
 * record, so the natural response is to ignore it and grant again.
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
      /**
       * Rows the route returned that could not be read as a grant.
       *
       * Counted rather than dropped. A silently shorter history is the one
       * failure this panel must not have: it is read to decide whether an
       * earlier grant already landed, and a missing row is how the same
       * person gets paid twice.
       */
      unreadable: number;
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

/** A row the route sent, or null when it is not a grant this can show. */
function readGrant(value: unknown): AdminGrant | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.creditUsdCents !== 'number' ||
    !Number.isFinite(row.creditUsdCents) ||
    typeof row.grantedByEmail !== 'string' ||
    row.grantedByEmail.trim() === ''
  ) {
    return null;
  }
  return {
    creditUsdCents: row.creditUsdCents,
    grantedByEmail: row.grantedByEmail,
    note: typeof row.note === 'string' ? row.note : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
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
    // Every field is checked, the same discipline the rest of this file
    // follows. The cast this replaces let a row with no amount and no actor
    // through untouched.
    //
    // A `grants` that is not an array is a failed lookup, not an empty
    // history. Defaulting to `[]` was the row-level fault one level up:
    // the panel would show "no past grants" for an answer it could not
    // read, which is the silently shortened history this whole change
    // exists to prevent, at its worst.
    if (!Array.isArray(record.grants)) {
      return {
        ok: false,
        error: 'The admin service returned an unexpected response.',
      };
    }
    const rows = record.grants.map(readGrant);
    return {
      ok: true,
      userId: record.userId,
      spendableCreditMicroUsd: record.spendableCreditMicroUsd,
      grants: rows.filter((row): row is AdminGrant => row !== null),
      unreadable: rows.filter((row) => row === null).length,
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

/**
 * A parked payment as the route sends it, or null when it is not one this
 * can show.
 *
 * The same discipline the rest of this file follows, and it matters more
 * here than usual: every field on the wire came out of a stored Stripe event
 * rather than out of this deployment's own tables, so "the route sent it"
 * is not the same as "we wrote it".
 */
function readParked(value: unknown): ParkedPayment | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.stripeEventId !== 'string' ||
    typeof row.type !== 'string' ||
    typeof row.created !== 'number' ||
    typeof row.firstSeenAt !== 'string' ||
    typeof row.attempts !== 'number'
  ) {
    return null;
  }
  return {
    stripeEventId: row.stripeEventId,
    type: row.type,
    created: row.created,
    firstSeenAt: row.firstSeenAt,
    attempts: row.attempts,
    ...(typeof row.customerId === 'string'
      ? { customerId: row.customerId }
      : {}),
    ...(typeof row.amountCents === 'number'
      ? { amountCents: row.amountCents }
      : {}),
    ...(typeof row.currency === 'string' ? { currency: row.currency } : {}),
  };
}

export type ParkedQueueResult =
  { ok: true; queue: ParkedQueue } | { ok: false; error: string };

/**
 * Payments Stripe says moved that this deployment cannot yet name (#46).
 *
 * Read-only: the nightly retry is what resolves these. This exists so that
 * it stopping resolving them is something somebody can see.
 */
export async function fetchParkedQueue(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<ParkedQueueResult> {
  const response = await fetchImpl('/api/admin/unattributed', {
    headers: await authHeaders(getToken),
  });
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body = ((await response.json()) ?? {}) as Record<string, unknown>;
    if (typeof body.parked !== 'number') {
      return {
        ok: false,
        error: 'The admin service returned an unexpected response.',
      };
    }
    const events = Array.isArray(body.events)
      ? body.events
          .map(readParked)
          .filter((row): row is ParkedPayment => row !== null)
      : [];
    return {
      ok: true,
      queue: {
        parked: body.parked,
        oldestFirstSeenAt:
          typeof body.oldestFirstSeenAt === 'string'
            ? body.oldestFirstSeenAt
            : null,
        oldestCreated:
          typeof body.oldestCreated === 'number' ? body.oldestCreated : null,
        events,
      },
    };
  } catch {
    return {
      ok: false,
      error: 'The admin service returned an unexpected response.',
    };
  }
}
