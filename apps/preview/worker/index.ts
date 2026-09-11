import {
  ContainerProxy,
  getSandbox,
  proxyToSandbox,
} from '@cloudflare/sandbox';
import type { ProjectFile } from '@vibld/core';
import { isAuthorizedInternalCaller } from './internal-auth.ts';
import { PreviewFleet } from './preview-fleet.ts';
import { PreviewSandbox } from './preview-sandbox.ts';

/** Re-exported so Wrangler can find these classes from the entrypoint. */
export { ContainerProxy, PreviewFleet, PreviewSandbox };

export interface Env {
  Sandbox: DurableObjectNamespace<PreviewSandbox>;
  Fleet: DurableObjectNamespace<PreviewFleet>;
  /**
   * Shared secret between this Worker and apps/web -- see internal-auth.ts's
   * module comment for why the internal API needs one at all.
   */
  PREVIEW_INTERNAL_SECRET?: string;
  /**
   * The public domain previews are exposed on (docs/decisions.md L8:
   * `vibld-preview.dev`, a second registrable domain so a preview never
   * shares cookie scope with the control plane). Passed to `exposePort` as
   * the hostname a preview URL is minted under.
   */
  PREVIEW_HOSTNAME?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isProjectFileArray(value: unknown): value is ProjectFile[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry): entry is ProjectFile =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ProjectFile).path === 'string' &&
        typeof (entry as ProjectFile).content === 'string',
    )
  );
}

/** Every internal handler needs both the caller identified and the public hostname configured. */
function requireConfigured(
  env: Env,
): { error: Response } | { error: null; hostname: string } {
  if (!env.PREVIEW_HOSTNAME) {
    return {
      error: json({ error: 'Preview hosting is not configured.' }, 503),
    };
  }
  return { error: null, hostname: env.PREVIEW_HOSTNAME };
}

async function handleStart(request: Request, env: Env): Promise<Response> {
  const configured = requireConfigured(env);
  if (configured.error) return configured.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId, label, files } = (body ?? {}) as {
    userId?: unknown;
    label?: unknown;
    files?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }
  if (!isProjectFileArray(files)) {
    return json({ error: '"files" must be a list of {path, content}.' }, 400);
  }

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  const result = await sandbox.startPreview(
    files,
    configured.hostname,
    typeof label === 'string' ? label : userId,
  );
  return json(result);
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return json({ error: '"userId" is required.' }, 400);

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  const result = await sandbox.getPreviewStatus();
  return json(result);
}

async function handleStop(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId } = (body ?? {}) as { userId?: unknown };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  await sandbox.stopPreview();
  return json({ ok: true });
}

/**
 * The internal control-plane API apps/web calls over a service binding.
 * Every route here requires the shared secret -- see internal-auth.ts.
 * Distinct from everything else this Worker answers, which is public
 * preview traffic on `*.vibld-preview.dev`, proxied straight into a sandbox.
 */
async function handleInternal(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (
    !isAuthorizedInternalCaller(request.headers, env.PREVIEW_INTERNAL_SECRET)
  ) {
    return json({ error: 'Not authorized.' }, 403);
  }

  if (pathname === '/internal/preview/start' && request.method === 'POST') {
    return handleStart(request, env);
  }
  if (pathname === '/internal/preview/status' && request.method === 'GET') {
    return handleStatus(request, env);
  }
  if (pathname === '/internal/preview/stop' && request.method === 'POST') {
    return handleStop(request, env);
  }
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/internal/')) {
      return handleInternal(request, env, pathname);
    }

    // Public preview traffic: `*.vibld-preview.dev` requests for an exposed
    // sandbox port. `proxyToSandbox` returns null for anything that isn't a
    // recognised preview URL -- there is no other route this Worker serves.
    const proxied = await proxyToSandbox(request, env);
    return proxied ?? json({ error: 'Not found.' }, 404);
  },
};
