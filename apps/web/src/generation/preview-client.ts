import type { ProjectFile } from '@vibld/core';
import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/preview` (docs/decisions.md L7-L11): start, poll
 * and stop sandbox execution of the accepted project.
 *
 * JSX-free for the same reason `billing-client.ts` and `remote-provider.ts`
 * are (see the latter's own doc comment) -- this project's test runner
 * strips TypeScript types only and errors on JSX. The state machine that
 * drives this from a running component (`use-preview-sandbox.ts`) is a
 * separate file for the same reason `useBuilderSession.ts` is its own file:
 * it needs hooks, not JSX, so it stays a plain `.ts` module too, but it is
 * not unit-testable the way this one is -- calling a hook outside a React
 * render throws, and this repo has no React Testing Library.
 */

export type PreviewStatus =
  | { status: 'queued'; position: number }
  | { status: 'ready-to-start' }
  | { status: 'installing' }
  | { status: 'starting' }
  | {
      status: 'ready';
      url: string;
      expiresAt: number;
      typecheckFailure?: string;
      /** The revision the sandbox serves, when it knows (D74). */
      revision?: string;
    }
  | { status: 'failed'; error: string };

/**
 * What asking the running sandbox to take a new revision came to (D74):
 * applied in place, installing new dependencies (poll until it settles),
 * busy with a start or another update (poll, then ask again), or a restart
 * it could not avoid, with the reason.
 */
export type PreviewUpdate =
  | { outcome: 'applied'; status: PreviewStatus }
  | { outcome: 'installing' }
  | { outcome: 'busy' }
  | { outcome: 'restart'; reason: string };

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `worker/preview-client.ts`'s own `parseStatus` mirrored client-side: the
 * Worker's reply is trusted content, not a caller's, but every field is
 * still checked rather than assumed, the same discipline
 * `detectDeploymentConfig` applies to `/api/config`.
 */
function parseStatus(body: unknown): PreviewStatus | null {
  const record = (body ?? {}) as Record<string, unknown>;
  switch (record.status) {
    case 'queued':
      return {
        status: 'queued',
        position: typeof record.position === 'number' ? record.position : 0,
      };
    case 'ready-to-start':
      return { status: 'ready-to-start' };
    case 'installing':
      return { status: 'installing' };
    case 'starting':
      return { status: 'starting' };
    case 'ready':
      if (
        typeof record.url === 'string' &&
        typeof record.expiresAt === 'number'
      ) {
        return {
          status: 'ready',
          url: record.url,
          expiresAt: record.expiresAt,
          // Carried only when it is a non-empty string. A ready preview
          // with an unreadable finding attached is still a ready preview,
          // so this is dropped rather than allowed to null the status
          // (internal issue 194).
          ...(typeof record.typecheckFailure === 'string' &&
          record.typecheckFailure !== ''
            ? { typecheckFailure: record.typecheckFailure }
            : {}),
          ...(typeof record.revision === 'string' && record.revision !== ''
            ? { revision: record.revision }
            : {}),
        };
      }
      // A ready with nowhere to point is not a ready, and it is not the
      // service reporting a failure either. It is an answer this cannot
      // read, which is the null below.
      return null;
    case 'failed':
      return {
        status: 'failed',
        error:
          typeof record.error === 'string'
            ? record.error
            : 'The preview run failed.',
      };
    default:
      return null;
  }
}

/**
 * The caller's own sandbox status, or `null` for every case that is not
 * "here is a status to show" -- signed out, not yet configured, an expired
 * session, a network failure -- the same "render nothing" contract
 * `fetchBillingStatus` has, and for the same reason: a poll nobody asked to
 * see must not turn a blip into a visible error.
 */
export async function fetchPreviewStatus(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PreviewStatus | null> {
  let response: Response;
  try {
    response = await fetchImpl('/api/preview', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  try {
    // `null` for an answer this cannot read, the same as for a network
    // failure, and deliberately not a synthesised `failed`.
    //
    // A failed status is the service saying the sandbox is not running, and
    // callers act on that: the poll stops asking, the panel takes the Stop
    // button away, and an unconfirmed stop treats it as the answer that
    // settles whether the sandbox survived. None of that is established by
    // this client being unable to parse a 200.
    return parseStatus(await response.json());
  } catch {
    return null;
  }
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : 'The preview request failed. Try again shortly.';
}

/**
 * Start a preview of these files. One instance per user (L9), and this does
 * not replace a running one: the worker reports the existing preview
 * instead, unchanged, so a caller wanting a restart calls
 * `stopSandboxPreview` first. Unlike `fetchPreviewStatus`, this is the
 * direct result of something the caller just clicked, so it throws rather
 * than swallowing the problem.
 */
export async function startSandboxPreview(
  files: ProjectFile[],
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  /** Which checkpoint these files are, so the sandbox can say (D74). */
  revision?: string,
): Promise<PreviewStatus> {
  const response = await fetchImpl('/api/preview', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify(
      revision === undefined ? { files } : { files, revision },
    ),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const unreadable: PreviewStatus = {
    status: 'failed',
    error: 'The preview service returned an unreadable response.',
  };
  try {
    // Unlike the poll, a start has to answer the person who pressed the
    // button with something. `mayExist` is already set, so the sandbox this
    // may have created is still stopped before the next run.
    return parseStatus(await response.json()) ?? unreadable;
  } catch {
    return unreadable;
  }
}

/**
 * `PreviewUpdate` from the Worker's reply, or null for one this cannot
 * read. Checked field by field, as `parseStatus` is.
 */
export function parseUpdate(body: unknown): PreviewUpdate | null {
  const record = (body ?? {}) as Record<string, unknown>;
  switch (record.outcome) {
    case 'applied': {
      const status = parseStatus(record.status);
      return status?.status === 'ready' ? { outcome: 'applied', status } : null;
    }
    case 'installing':
      return { outcome: 'installing' };
    case 'busy':
      return { outcome: 'busy' };
    case 'restart':
      return {
        outcome: 'restart',
        reason:
          typeof record.reason === 'string' && record.reason !== ''
            ? record.reason
            : 'The preview could not be updated in place.',
      };
    default:
      return null;
  }
}

/**
 * Apply a new revision to the caller's running sandbox without restarting
 * it (D74). Throws for anything that is not an answer, as a start does,
 * because the caller's response to every such case is the same: restart,
 * which is what it did before live updates existed.
 */
export async function updateSandboxPreview(
  files: ProjectFile[],
  revision: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PreviewUpdate> {
  const response = await fetchImpl('/api/preview', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({ files, revision }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const update = parseUpdate(await response.json().catch(() => null));
  if (!update) {
    throw new Error('The preview service returned an unreadable response.');
  }
  return update;
}

/** Stop the caller's running preview, if any. */
export async function stopSandboxPreview(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<void> {
  const response = await fetchImpl('/api/preview', {
    method: 'DELETE',
    headers: await authHeaders(getToken),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

/** L10: "Preview sharing is a signed, revocable, time-limited URL." Several may be active for one preview at once, each independently revocable. */
export interface PreviewShare {
  shareId: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  /** Present only for a still-active grant. */
  url?: string;
}

function isPreviewShare(value: unknown): value is PreviewShare {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PreviewShare).shareId === 'string' &&
    typeof (value as PreviewShare).createdAt === 'number' &&
    typeof (value as PreviewShare).expiresAt === 'number' &&
    typeof (value as PreviewShare).revoked === 'boolean'
  );
}

/**
 * Every share grant ever issued for the caller's current preview. `[]` for
 * every case that is not "here is a list to show" -- the same "render
 * nothing rather than throw" contract `fetchPreviewStatus` has, and for the
 * same reason: this is read on mount and after every share/revoke action,
 * not in response to something the caller just explicitly asked for.
 */
export async function fetchPreviewShares(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PreviewShare[]> {
  let response: Response;
  try {
    response = await fetchImpl('/api/preview/share', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  try {
    const body: unknown = await response.json();
    const shares = (body as { shares?: unknown } | null)?.shares;
    return Array.isArray(shares) ? shares.filter(isPreviewShare) : [];
  } catch {
    return [];
  }
}

/**
 * Mint a new share link for the caller's currently-running preview. Unlike
 * `fetchPreviewShares`, this is the direct result of something the caller
 * just clicked, so it throws rather than swallowing the problem.
 */
export async function createPreviewShare(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PreviewShare> {
  const response = await fetchImpl('/api/preview/share', {
    method: 'POST',
    headers: await authHeaders(getToken),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const body: unknown = await response.json().catch(() => null);
  const record = (body ?? {}) as {
    shareId?: unknown;
    expiresAt?: unknown;
    url?: unknown;
  };
  if (
    typeof record.shareId !== 'string' ||
    typeof record.expiresAt !== 'number' ||
    typeof record.url !== 'string'
  ) {
    throw new Error('The preview service returned an unreadable response.');
  }
  return {
    shareId: record.shareId,
    createdAt: Date.now(),
    expiresAt: record.expiresAt,
    revoked: false,
    url: record.url,
  };
}

/** Revoke one share link. Idempotent -- revoking one already revoked still succeeds. */
export async function revokePreviewShare(
  shareId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<void> {
  const response = await fetchImpl('/api/preview/share', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({ shareId }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}
