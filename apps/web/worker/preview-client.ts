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
