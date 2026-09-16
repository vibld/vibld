import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/admin/invite*` endpoints: the list an operator
 * reads, and the two acts that change it.
 *
 * JSX-free for the same reason `admin-client.ts` and `billing-client.ts`
 * are (see the latter's own doc comment): this project's test runner strips
 * TypeScript types only and errors on JSX. `InvitePanel.tsx` is the JSX half
 * that calls these from React.
 */

/** One row of the list, as `AccessStore.list` returns it. */
export interface InviteRecord {
  email: string;
  invitedByEmail: string;
  invitedAt: string;
  redeemedByUserId: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
}

/**
 * What issuing an invite actually did.
 *
 * Three outcomes, kept apart because they are three different facts and an
 * operator acts differently on each. `created` is a new invite. `reinstated`
 * is a withdrawn one put back, which is a decision somebody should see they
 * made. Neither means the address was already invited and nothing happened,
 * and reporting that as success is how somebody concludes they have let
 * a person in when the list has said so since last week.
 */
export type IssueResult =
  | { ok: true; email: string; created: boolean; reinstated: boolean }
  | { ok: false; error: string };

/**
 * `revoked` is false when the row did not change: no such invite, or one
 * already withdrawn. Reported rather than smoothed over, because "their
 * access is gone" is a claim, and the only thing that establishes it here
 * is a row that moved.
 */
export type RevokeResult =
  { ok: true; email: string; revoked: boolean } | { ok: false; error: string };

/**
 * `truncated` is the route saying there are more rows than it returned.
 *
 * Carried rather than dropped: the panel's per-row controls are the only way
 * to act on a row, so an invite past the cap has none, and a capped list
 * that presents itself as the whole one is what makes that invisible.
 */
export type ListResult =
  | { ok: true; invites: InviteRecord[]; truncated: boolean }
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
    : `The invite request failed (${response.status}).`;
}

function readRecord(value: unknown): InviteRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.email !== 'string') return null;
  return {
    email: row.email,
    invitedByEmail:
      typeof row.invitedByEmail === 'string' ? row.invitedByEmail : '',
    invitedAt: typeof row.invitedAt === 'string' ? row.invitedAt : '',
    redeemedByUserId:
      typeof row.redeemedByUserId === 'string' ? row.redeemedByUserId : null,
    redeemedAt: typeof row.redeemedAt === 'string' ? row.redeemedAt : null,
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
  };
}

/** The whole list: who was invited, who came in, what was withdrawn. */
export async function listInvites(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<ListResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/admin/invites', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: 'The invite list could not be reached.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body: unknown = await response.json();
    const rows =
      typeof body === 'object' && body !== null
        ? (body as { invites?: unknown }).invites
        : undefined;
    if (!Array.isArray(rows)) {
      return {
        ok: false,
        error: 'The invite service returned an unexpected response.',
      };
    }
    // A row that cannot be read is dropped rather than faked into shape: a
    // list of invites with an invented address in it is worse than a
    // shorter list.
    //
    // `truncated` only when the route says so. A route that does not say is
    // not evidence of a complete list, but it is not evidence of a capped
    // one either, and warning on every answer sends an operator looking for
    // rows that are not there.
    return {
      ok: true,
      invites: rows
        .map(readRecord)
        .filter((row): row is InviteRecord => row !== null),
      truncated: (body as { truncated?: unknown }).truncated === true,
    };
  } catch {
    return {
      ok: false,
      error: 'The invite service returned an unreadable response.',
    };
  }
}

/** Invite an address, or put a withdrawn invite back. */
export async function issueInvite(
  email: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<IssueResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/admin/invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, error: 'The invite could not be sent.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.email !== 'string') {
      return {
        ok: false,
        error: 'The invite service returned an unexpected response.',
      };
    }
    return {
      ok: true,
      email: body.email,
      created: body.created === true,
      reinstated: body.reinstated === true,
    };
  } catch {
    return {
      ok: false,
      error: 'The invite service returned an unreadable response.',
    };
  }
}

/** Withdraw an invite. The row stays, so the record stays readable. */
export async function revokeInvite(
  email: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<RevokeResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/admin/invite/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, error: 'The invite could not be withdrawn.' };
  }
  if (!response.ok) return { ok: false, error: await errorMessage(response) };
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.email !== 'string') {
      return {
        ok: false,
        error: 'The invite service returned an unexpected response.',
      };
    }
    return { ok: true, email: body.email, revoked: body.revoked === true };
  } catch {
    return {
      ok: false,
      error: 'The invite service returned an unreadable response.',
    };
  }
}

/** What a row is, as a person reading the list would say it. */
export type InviteState = 'in' | 'withdrawn' | 'waiting';

export function inviteState(record: InviteRecord): InviteState {
  // Revoked first. A withdrawn invite that was once redeemed is withdrawn,
  // and calling it "in" would describe an account that no longer has access.
  if (record.revokedAt !== null) return 'withdrawn';
  return record.redeemedByUserId !== null ? 'in' : 'waiting';
}
