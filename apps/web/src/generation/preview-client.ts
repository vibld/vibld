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
  | { status: 'ready'; url: string; expiresAt: number }
  | { status: 'failed'; error: string };

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
function parseStatus(body: unknown): PreviewStatus {
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
        };
      }
      return {
        status: 'failed',
        error: 'The preview service returned an unexpected response.',
      };
    default:
      return {
        status: 'failed',
        error:
          typeof record.error === 'string'
            ? record.error
            : 'The preview service returned an unexpected response.',
      };
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
 * Start (or restart -- the sandbox is one instance per user, L9) a preview of
 * these files. Unlike `fetchPreviewStatus`, this is the direct result of
 * something the caller just clicked, so it throws rather than swallowing the
 * problem.
 */
export async function startSandboxPreview(
  files: ProjectFile[],
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PreviewStatus> {
  const response = await fetchImpl('/api/preview', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({ files }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  try {
    return parseStatus(await response.json());
  } catch {
    return {
      status: 'failed',
      error: 'The preview service returned an unreadable response.',
    };
  }
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
