/**
 * Talks to `@vibld/preview` over a service binding.
 *
 * Sandbox execution lives in its own Worker, not here -- see that package's
 * README for why (an isolated origin, and a real TypeScript constraint this
 * app's shared browser/Worker tsconfig can't accommodate). This file is the
 * only place in `apps/web` that knows the shape of its internal API.
 */

export interface PreviewFile {
  path: string;
  content: string;
}

export type PreviewStatus =
  | { status: 'queued'; position: number }
  | { status: 'ready-to-start' }
  | { status: 'installing' }
  | { status: 'starting' }
  | { status: 'ready'; url: string; expiresAt: number }
  | { status: 'failed'; error: string };

/** The slice of a Workers service binding this file calls. */
export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface PreviewServiceEnv {
  PREVIEW?: ServiceBinding;
  PREVIEW_INTERNAL_SECRET?: string;
}

export function previewConfigured(env: PreviewServiceEnv): boolean {
  return Boolean(env.PREVIEW && env.PREVIEW_INTERNAL_SECRET);
}

const INTERNAL_ORIGIN = 'https://internal.invalid';

function authHeaders(env: PreviewServiceEnv): Record<string, string> {
  return env.PREVIEW_INTERNAL_SECRET
    ? { Authorization: `Bearer ${env.PREVIEW_INTERNAL_SECRET}` }
    : {};
}

/**
 * `@vibld/preview`'s own reply is trusted content -- it is our other
 * Worker, not a caller -- but every field is still checked, the same
 * discipline `detectDeploymentConfig` applies to `/api/config`'s own
 * response: a shape that drifted must not hand a browser `undefined` where
 * a URL or a position was expected.
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

async function call(
  env: PreviewServiceEnv,
  path: string,
  init: RequestInit = {},
): Promise<PreviewStatus> {
  const response = await env.PREVIEW!.fetch(
    new Request(new URL(path, INTERNAL_ORIGIN), {
      ...init,
      headers: { ...authHeaders(env), ...(init.headers ?? {}) },
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: 'failed',
      error: 'The preview service returned an unreadable response.',
    };
  }
  return parseStatus(body);
}

export function startPreview(
  env: PreviewServiceEnv,
  userId: string,
  files: PreviewFile[],
): Promise<PreviewStatus> {
  return call(env, '/internal/preview/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, label: userId, files }),
  });
}

export function previewStatus(
  env: PreviewServiceEnv,
  userId: string,
): Promise<PreviewStatus> {
  return call(
    env,
    `/internal/preview/status?userId=${encodeURIComponent(userId)}`,
  );
}

export async function stopPreview(
  env: PreviewServiceEnv,
  userId: string,
): Promise<void> {
  await env.PREVIEW!.fetch(
    new Request(new URL('/internal/preview/stop', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(env) },
      body: JSON.stringify({ userId }),
    }),
  );
}

/** L10: "Preview sharing is a signed, revocable, time-limited URL." One row per grant; a preview may have several active at once, each independently revocable. */
export interface PreviewShare {
  shareId: string;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
  /** Present only for a still-active grant -- @vibld/preview omits it for a dead one rather than hand out a working-looking link to a 403. */
  url?: string;
}

export type CreateShareResult =
  | { ok: true; shareId: string; expiresAt: number; url: string }
  | { ok: false; error: string };

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

export async function createShare(
  env: PreviewServiceEnv,
  userId: string,
): Promise<CreateShareResult> {
  const response = await env.PREVIEW!.fetch(
    new Request(new URL('/internal/preview/share', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(env) },
      body: JSON.stringify({ userId }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The preview service returned an unreadable response.',
    };
  }
  const record = (body ?? {}) as {
    shareId?: unknown;
    expiresAt?: unknown;
    url?: unknown;
    error?: unknown;
  };
  if (
    response.ok &&
    typeof record.shareId === 'string' &&
    typeof record.expiresAt === 'number' &&
    typeof record.url === 'string'
  ) {
    return {
      ok: true,
      shareId: record.shareId,
      expiresAt: record.expiresAt,
      url: record.url,
    };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not create a share link.',
  };
}

export async function listShares(
  env: PreviewServiceEnv,
  userId: string,
): Promise<PreviewShare[]> {
  const response = await env.PREVIEW!.fetch(
    new Request(
      new URL(
        `/internal/preview/share?userId=${encodeURIComponent(userId)}`,
        INTERNAL_ORIGIN,
      ),
      { headers: authHeaders(env) },
    ),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return [];
  }
  const shares = (body as { shares?: unknown } | null)?.shares;
  return Array.isArray(shares) ? shares.filter(isPreviewShare) : [];
}

export async function revokeShare(
  env: PreviewServiceEnv,
  userId: string,
  shareId: string,
): Promise<void> {
  await env.PREVIEW!.fetch(
    new Request(new URL('/internal/preview/share', INTERNAL_ORIGIN), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', ...authHeaders(env) },
      body: JSON.stringify({ userId, shareId }),
    }),
  );
}
