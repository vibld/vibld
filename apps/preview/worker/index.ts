import {
  ContainerProxy,
  getSandbox,
  proxyToSandbox,
} from '@cloudflare/sandbox';
import type { ProjectFile } from '@vibld/core';
import { isAuthorizedInternalCaller } from './internal-auth.ts';
import { PreviewFleet } from './preview-fleet.ts';
import { PreviewSandbox } from './preview-sandbox.ts';
import { signShare, verifyShare } from './share-token.ts';

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
  /**
   * Worker secret: signs and verifies share links (docs/decisions.md L10).
   * Distinct from `PREVIEW_INTERNAL_SECRET` on purpose -- that one
   * authenticates apps/web calling in over a service binding; this one
   * authenticates an anonymous third party on the public internet, a
   * different trust boundary entirely. Sharing is unavailable, not open,
   * when this is unset -- the same fail-closed rule `PREVIEW_INTERNAL_SECRET`
   * already follows.
   */
  PREVIEW_SHARE_SECRET?: string;
}

/** The reserved subdomain share links are served from -- see `handleSharedPreview`. */
function shareHostname(env: Env): string | undefined {
  return env.PREVIEW_HOSTNAME ? `share.${env.PREVIEW_HOSTNAME}` : undefined;
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
 * Cloudflare auto-publish's build step (ADR-0010). Unlike `handleStart`,
 * this needs no `PREVIEW_HOSTNAME` -- a build exposes no port, so
 * `requireConfigured` does not gate it.
 */
async function handleBuild(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId, files } = (body ?? {}) as {
    userId?: unknown;
    files?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }
  if (!isProjectFileArray(files)) {
    return json({ error: '"files" must be a list of {path, content}.' }, 400);
  }

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  const result = await sandbox.buildProject(files);
  return json(result, 'error' in result ? 422 : 200);
}

function shareUrlFor(
  hostname: string,
  sandboxId: string,
  shareId: string,
  expiresAt: number,
  signature: string,
): string {
  const url = new URL(
    `https://share.${hostname}/${encodeURIComponent(sandboxId)}/${shareId}`,
  );
  url.searchParams.set('exp', String(expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

async function handleShareCreate(
  request: Request,
  env: Env,
): Promise<Response> {
  const configured = requireConfigured(env);
  if (configured.error) return configured.error;
  if (!env.PREVIEW_SHARE_SECRET) {
    return json({ error: 'Preview sharing is not configured.' }, 503);
  }

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
  const result = await sandbox.createShare();
  if ('error' in result) return json({ error: result.error }, 409);

  const signature = await signShare(
    env.PREVIEW_SHARE_SECRET,
    result.shareId,
    result.expiresAt,
  );
  return json({
    shareId: result.shareId,
    expiresAt: result.expiresAt,
    url: shareUrlFor(
      configured.hostname,
      userId,
      result.shareId,
      result.expiresAt,
      signature,
    ),
  });
}

async function handleShareList(request: Request, env: Env): Promise<Response> {
  const configured = requireConfigured(env);
  if (configured.error) return configured.error;
  if (!env.PREVIEW_SHARE_SECRET) {
    return json({ error: 'Preview sharing is not configured.' }, 503);
  }
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return json({ error: '"userId" is required.' }, 400);

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  const grants = await sandbox.listShares();
  const now = Date.now();
  const secret = env.PREVIEW_SHARE_SECRET;
  const shares = await Promise.all(
    grants.map(async (grant) => {
      const active = grant.revokedAt === null && grant.expiresAt > now;
      return {
        shareId: grant.id,
        createdAt: grant.createdAt,
        expiresAt: grant.expiresAt,
        revoked: grant.revokedAt !== null,
        // A dead grant's URL would just be a working-looking link to a 403
        // -- omitted rather than handed out, so the caller has nothing to
        // accidentally re-share.
        ...(active
          ? {
              url: shareUrlFor(
                configured.hostname,
                userId,
                grant.id,
                grant.expiresAt,
                await signShare(secret, grant.id, grant.expiresAt),
              ),
            }
          : {}),
      };
    }),
  );
  return json({ shares });
}

async function handleShareRevoke(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId, shareId } = (body ?? {}) as {
    userId?: unknown;
    shareId?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }
  if (typeof shareId !== 'string' || shareId.length === 0) {
    return json({ error: '"shareId" is required.' }, 400);
  }

  const sandbox = getSandbox(env.Sandbox, userId, { normalizeId: true });
  await sandbox.revokeShare(shareId);
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
  if (pathname === '/internal/preview/build' && request.method === 'POST') {
    return handleBuild(request, env);
  }
  if (pathname === '/internal/preview/share') {
    if (request.method === 'POST') return handleShareCreate(request, env);
    if (request.method === 'GET') return handleShareList(request, env);
    if (request.method === 'DELETE') return handleShareRevoke(request, env);
  }
  return json({ error: 'Not found.' }, 404);
}

/**
 * Redeem a share link (docs/decisions.md L10): `/{sandboxId}/{shareId}` on
 * the reserved `share.` subdomain, with `?exp=` and `?sig=` proving this URL
 * was minted by `handleShareCreate` and not forged or altered. The
 * signature is checked here, before a Durable Object is ever woken for it;
 * whether the grant is still live -- not yet expired, not revoked -- is
 * `PreviewSandbox.proxyShared`'s own job, since only it can see that state.
 */
async function handleSharedPreview(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.PREVIEW_SHARE_SECRET) {
    return json({ error: 'Preview sharing is not configured.' }, 503);
  }

  const url = new URL(request.url);
  const [sandboxId, shareId, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!sandboxId || !shareId) {
    return json({ error: 'Not found.' }, 404);
  }

  const expiresAtRaw = url.searchParams.get('exp');
  const signature = url.searchParams.get('sig');
  const expiresAt = expiresAtRaw !== null ? Number(expiresAtRaw) : NaN;
  if (!Number.isFinite(expiresAt) || !signature) {
    return json({ error: 'Invalid share link.' }, 400);
  }
  if (expiresAt < Date.now()) {
    return new Response('This share link has expired.', { status: 403 });
  }
  const valid = await verifyShare(
    env.PREVIEW_SHARE_SECRET,
    shareId,
    expiresAt,
    signature,
  );
  if (!valid) {
    return new Response('This share link is invalid.', { status: 403 });
  }

  // What the running app itself should see: the `/{sandboxId}/{shareId}`
  // prefix this route was reached under, stripped. `PreviewSandbox` knows
  // nothing about share URLs -- it forwards this request to the real
  // preview's own path.
  const appUrl = new URL(request.url);
  appUrl.pathname = `/${rest.join('/')}`;
  appUrl.search = '';

  const sandbox = getSandbox(env.Sandbox, sandboxId, { normalizeId: true });
  return await sandbox.proxyShared(
    new Request(appUrl, {
      method: request.method,
      headers: request.headers,
    }),
    shareId,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/internal/')) {
      return handleInternal(request, env, url.pathname);
    }

    // The reserved subdomain share links are served from (L10) -- checked
    // before `proxyToSandbox`, which never recognises it as a preview URL
    // in the first place (it has no port/token, only a share id).
    if (url.hostname === shareHostname(env)) {
      return handleSharedPreview(request, env);
    }

    // Public preview traffic: `*.vibld-preview.dev` requests for an exposed
    // sandbox port. `proxyToSandbox` returns null for anything that isn't a
    // recognised preview URL -- there is no other route this Worker serves.
    const proxied = await proxyToSandbox(request, env);
    return proxied ?? json({ error: 'Not found.' }, 404);
  },
};
