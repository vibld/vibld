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
/**
 * What Clerk said when this deployment tried to approve them there too.
 *
 * Null means the response carried no answer this could read, which is a gap
 * rather than a silence, and the panel says so rather than staying quiet.
 *
 * Read strictly, and unreadable means null rather than a guess. "Approved in
 * Clerk" is the strongest claim this panel makes and the one that decides
 * whether somebody can actually sign in, so it is made only when Clerk's own
 * answer says so.
 */
export type ClerkOutcome =
  | { admitted: true }
  | { admitted: false; reason: 'unconfigured' }
  | {
      admitted: false;
      reason: 'still-waiting';
      status: string;
      invited: boolean;
    }
  | { admitted: false; reason: 'error'; error: string };

export function readClerkOutcome(value: unknown): ClerkOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as {
    admitted?: unknown;
    reason?: unknown;
    status?: unknown;
    invited?: unknown;
    error?: unknown;
  };
  if (row.admitted === true) return { admitted: true };
  if (row.admitted !== false) return null;
  if (row.reason === 'unconfigured')
    return { admitted: false, reason: 'unconfigured' };
  if (row.reason === 'still-waiting') {
    return {
      admitted: false,
      reason: 'still-waiting',
      status: typeof row.status === 'string' ? row.status : 'waiting',
      // Whether Clerk took the invitation, which decides whether this is
      // "they cannot sign in" or "nobody here can tell".
      invited: row.invited === true,
    };
  }
  if (row.reason === 'error') {
    return {
      admitted: false,
      reason: 'error',
      error:
        typeof row.error === 'string' && row.error.trim() !== ''
          ? row.error
          : 'Clerk could not be reached.',
    };
  }
  return null;
}

/**
 * What the invite route said about putting a scheduled cancellation back.
 *
 * Parsed as strictly as the others: an unreadable answer about somebody's
 * subscription is not the same as a good one.
 */
export type RestoreOutcome =
  | { restored: true; renewsOn: string | null }
  | {
      restored: false;
      reason:
        | 'unconfigured'
        | 'no-invite'
        | 'never-signed-in'
        | 'nothing-to-restore'
        | 'not-ours'
        | 'error';
      error?: string;
    };

const NOT_RESTORED = new Set([
  'unconfigured',
  'no-invite',
  'never-signed-in',
  'nothing-to-restore',
  'not-ours',
  'error',
]);

export function readRestoreOutcome(value: unknown): RestoreOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as {
    restored?: unknown;
    reason?: unknown;
    renewsOn?: unknown;
    error?: unknown;
  };
  if (row.restored === true) {
    return {
      restored: true,
      renewsOn: typeof row.renewsOn === 'string' ? row.renewsOn : null,
    };
  }
  if (row.restored !== false) return null;
  if (typeof row.reason !== 'string' || !NOT_RESTORED.has(row.reason)) {
    return null;
  }
  return {
    restored: false,
    reason: row.reason as Exclude<RestoreOutcome, { restored: true }>['reason'],
    error:
      typeof row.error === 'string' && row.error.trim() !== ''
        ? row.error
        : undefined,
  };
}

export type IssueResult =
  | {
      ok: true;
      email: string;
      created: boolean;
      reinstated: boolean;
      clerk: ClerkOutcome | null;
      billing: RestoreOutcome | null;
    }
  | { ok: false; error: string };

/**
 * What the route said about this person's billing, parsed strictly.
 *
 * `scheduled` rather than `cancelled`: the subscription runs to `endsAt` and
 * stops there, so saying it is cancelled would tell an operator the charging
 * has stopped when the next invoice may still be weeks away.
 */
export type BillingOutcome =
  | { scheduled: true; endsAt: string | null; restorable: boolean }
  | {
      scheduled: false;
      reason:
        | 'unconfigured'
        | 'no-invite'
        | 'never-signed-in'
        | 'nothing-to-stop'
        | 'already-ending'
        | 'error';
      endsAt?: string | null;
      error?: string;
    };

const NOT_SCHEDULED = new Set([
  'unconfigured',
  'no-invite',
  'never-signed-in',
  'nothing-to-stop',
  'already-ending',
  'error',
]);

/**
 * Null for anything this cannot read, rather than a cheerful default. An
 * unreadable answer about somebody's money is not the same as a good one,
 * and the panel says which it got.
 */
export function readBillingOutcome(value: unknown): BillingOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as {
    scheduled?: unknown;
    reason?: unknown;
    endsAt?: unknown;
    error?: unknown;
    restorable?: unknown;
  };
  const endsAt = typeof row.endsAt === 'string' ? row.endsAt : null;
  if (row.scheduled === true) {
    // Absent reads as restorable, which is what every route before this
    // field existed meant. The flag says a cancellation cannot be undone,
    // and a missing field is not evidence of that.
    return { scheduled: true, endsAt, restorable: row.restorable !== false };
  }
  if (row.scheduled !== false) return null;
  if (typeof row.reason !== 'string' || !NOT_SCHEDULED.has(row.reason)) {
    return null;
  }
  return {
    scheduled: false,
    reason: row.reason as Exclude<
      BillingOutcome,
      { scheduled: true }
    >['reason'],
    endsAt,
    error:
      typeof row.error === 'string' && row.error.trim() !== ''
        ? row.error
        : undefined,
  };
}

/**
 * `revoked` is false when the row did not change: no such invite, or one
 * already withdrawn. Reported rather than smoothed over, because "their
 * access is gone" is a claim, and the only thing that establishes it here
 * is a row that moved.
 *
 * `billing` is the other half of the same act. Withdrawing access used to
 * leave a subscriber being charged every month for a product they could no
 * longer sign in to, so what happened to their money is reported next to
 * what happened to their access.
 */
export type RevokeResult =
  | {
      ok: true;
      email: string;
      revoked: boolean;
      billing: BillingOutcome | null;
    }
  | { ok: false; error: string };

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
      clerk: readClerkOutcome(body.clerk),
      billing: readRestoreOutcome(body.billing),
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
    return {
      ok: true,
      email: body.email,
      revoked: body.revoked === true,
      billing: readBillingOutcome(body.billing),
    };
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
