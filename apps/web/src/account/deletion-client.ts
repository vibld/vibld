import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Deleting an account, from the browser (docs/decisions.md L32).
 *
 * JSX-free for the reason `takedown-client.ts` gives: this project's test
 * runner strips TypeScript types only and errors on JSX.
 * `AccountDeletion.tsx` and `AccessGate.tsx` are the halves that call this
 * from React.
 */

/**
 * What a person types to confirm. The Worker checks the same string
 * (`worker/account-deletion.ts`), and `account-deletion.test.ts` holds the
 * two equal, so the page cannot ask for a phrase the server then refuses.
 */
export const CONFIRMATION_PHRASE = 'delete my account';

/** Whether what somebody typed is the phrase. Case and outer spaces aside. */
export function phraseMatches(typed: string): boolean {
  return typed.trim().toLowerCase() === CONFIRMATION_PHRASE;
}

export type ImmediateStep =
  'subscription' | 'preview' | 'sites' | 'github' | 'referrals';

export interface DeletionSchedule {
  requestedAt: string;
  purgeAfter: string;
  /** Which of the immediate steps are done. */
  steps: Record<ImmediateStep, boolean>;
  /** What did not happen yet, in words for the person reading. */
  errors: string[];
  /** Whether keeping the account is still possible. */
  cancellable: boolean;
}

export type DeletionResult =
  { ok: true; schedule: DeletionSchedule } | { ok: false; error: string };

/**
 * What the page says will happen, in the order it happens. One list, so the
 * confirmation and the refusal screen cannot disagree.
 */
export const WHAT_STOPS_NOW = [
  'You can no longer use the builder: every request from this account is refused.',
  'Any subscription is cancelled straight away. The rest of a period already paid for is not refunded or prorated.',
  'A running preview is stopped, and share links to it stop working.',
  'Your published site goes offline, and its address is not given to anyone else.',
  'The GitHub connection is removed. The vibld app stays installed on your GitHub account until you remove it there.',
  'Referral rewards not yet paid are cancelled, and your referral code stops working.',
] as const;

export const WHAT_IS_DELETED_LATER = [
  'Your project, its history and snapshots, and your uploaded media.',
  "Your published site's files, your GitHub connection history and your invitation.",
  'Your usage records and your sign-in account.',
] as const;

export const WHAT_IS_KEPT = [
  'Payment, subscription, credit and referral payout records, because they are accounting records we have to keep. They are kept without your name, email address or account id.',
  'A record that this account was deleted and when, without your account id, for 12 months.',
  'Stripe keeps its own records of payments you made, under its own obligations.',
] as const;

/** A date as a person reads it, in their own locale. */
export function formatPurgeDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
}

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response, fallback: string) {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : `${fallback} (${response.status}).`;
}

/** Parsed rather than trusted, like every other answer from the Worker. */
export function readSchedule(value: unknown): DeletionSchedule | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.scheduled !== true ||
    typeof record.requestedAt !== 'string' ||
    typeof record.purgeAfter !== 'string' ||
    typeof record.steps !== 'object' ||
    record.steps === null
  ) {
    return null;
  }
  const steps = record.steps as Record<string, unknown>;
  return {
    requestedAt: record.requestedAt,
    purgeAfter: record.purgeAfter,
    steps: {
      subscription: steps.subscription === true,
      preview: steps.preview === true,
      sites: steps.sites === true,
      github: steps.github === true,
      referrals: steps.referrals === true,
    },
    errors: Array.isArray(record.errors)
      ? record.errors.filter((e): e is string => typeof e === 'string')
      : [],
    cancellable: record.cancellable === true,
  };
}

/**
 * Ask for the account to be deleted, or ask again for one already asked
 * for, which finishes whatever did not happen the first time.
 */
export async function requestAccountDeletion(
  confirm: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DeletionResult> {
  const response = await fetchImpl('/api/account/delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({ confirm }),
  });
  if (!response.ok) {
    return {
      ok: false,
      error: await errorMessage(response, 'The request could not be made'),
    };
  }
  const schedule = readSchedule(await response.json().catch(() => null));
  // Saying an account is scheduled for deletion when the server did not
  // confirm it is the one outcome worth refusing to guess at.
  return schedule
    ? { ok: true, schedule }
    : { ok: false, error: 'The server returned an unexpected response.' };
}

/** Where a request stands, or null when there is none. */
export async function fetchDeletionSchedule(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<DeletionSchedule | null> {
  const response = await fetchImpl('/api/account/delete', {
    headers: await authHeaders(getToken),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, 'Could not read the deletion request'),
    );
  }
  return readSchedule(await response.json().catch(() => null));
}

/** Keep the account, while the purge has not started. */
export async function cancelAccountDeletion(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetchImpl('/api/account/delete/cancel', {
    method: 'POST',
    headers: await authHeaders(getToken),
  });
  if (!response.ok) {
    return {
      ok: false,
      error: await errorMessage(response, 'The account could not be kept'),
    };
  }
  return { ok: true };
}

/**
 * The refusal every other route gives an account that asked to be deleted
 * (`deletionScheduled` in `worker/principal.ts`), recognised so the shell
 * can say that rather than "we could not check your account".
 */
export function readDeletionRefusal(
  status: number,
  body: unknown,
): { purgeAfter: string } | null {
  if (status !== 403 || typeof body !== 'object' || body === null) return null;
  const value = body as { reason?: unknown; purgeAfter?: unknown };
  return value.reason === 'deletion-scheduled' &&
    typeof value.purgeAfter === 'string'
    ? { purgeAfter: value.purgeAfter }
    : null;
}

/** One pending deletion, as the operator's panel reads it. */
export interface PendingDeletion {
  userId: string;
  requestedAt: string;
  purgeAfter: string;
  /** The immediate steps not yet done, by name. */
  undone: ImmediateStep[];
  lastError: string | null;
  /** How far the purge has got; zero before it starts. */
  purgeStep: number;
  /** A site of the account's still serving, which blocks the purge. */
  liveSlug: string | null;
}

const STEP_NAMES: readonly ImmediateStep[] = [
  'subscription',
  'preview',
  'sites',
  'github',
  'referrals',
];

function readPending(value: unknown): PendingDeletion | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.userId !== 'string' ||
    typeof row.requestedAt !== 'string' ||
    typeof row.purgeAfter !== 'string'
  ) {
    return null;
  }
  const done =
    typeof row.done === 'object' && row.done !== null
      ? (row.done as Record<string, unknown>)
      : {};
  return {
    userId: row.userId,
    requestedAt: row.requestedAt,
    purgeAfter: row.purgeAfter,
    undone: STEP_NAMES.filter((step) => typeof done[step] !== 'string'),
    lastError: typeof row.lastError === 'string' ? row.lastError : null,
    purgeStep: typeof row.purgeStep === 'number' ? row.purgeStep : 0,
    liveSlug: typeof row.liveSlug === 'string' ? row.liveSlug : null,
  };
}

/** The operator's list (`/api/admin/deletions`), behind the admin check. */
export async function fetchPendingDeletions(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<
  | { ok: true; pending: PendingDeletion[]; purged: number }
  | { ok: false; error: string }
> {
  const response = await fetchImpl('/api/admin/deletions', {
    headers: await authHeaders(getToken),
  });
  if (!response.ok) {
    return {
      ok: false,
      error: await errorMessage(response, 'The list could not be read'),
    };
  }
  const body: unknown = await response.json().catch(() => null);
  const record = (body ?? {}) as { pending?: unknown; purged?: unknown };
  if (!Array.isArray(record.pending) || typeof record.purged !== 'number') {
    return { ok: false, error: 'The server returned an unexpected response.' };
  }
  return {
    ok: true,
    pending: record.pending
      .map(readPending)
      .filter((row): row is PendingDeletion => row !== null),
    purged: record.purged,
  };
}
