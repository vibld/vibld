import type { ProjectFile } from '@vibld/core';
import { contentTypeFor } from './content-type.ts';
import { isAuthorizedInternalCaller } from './internal-auth.ts';
import { PublishStore } from './publish-store.ts';
import { candidatePaths } from './resolve-path.ts';
import { isValidSlug } from './slug.ts';
import type { PublishD1Database, PublishR2Bucket } from './types.ts';

export interface Env {
  DB: PublishD1Database;
  /** Shared with apps/web -- see generation-store.ts's own PROJECT_CONTENT binding. Same bucket, a `published/` prefix. */
  PROJECT_CONTENT: PublishR2Bucket;
  /** Shared secret between this Worker and apps/web -- see internal-auth.ts. */
  PUBLISH_INTERNAL_SECRET?: string;
  /**
   * The public domain published projects are exposed on (ADR-0010:
   * `published.vibld-preview.dev`, a third-level label under the same
   * second registrable domain apps/preview already isolates ephemeral
   * previews on, so a published site never shares cookie scope with
   * `app.vibld.com` either).
   */
  PUBLISH_HOSTNAME?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isProjectFileArray(value: unknown): value is ProjectFile[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry): entry is ProjectFile =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ProjectFile).path === 'string' &&
        typeof (entry as ProjectFile).content === 'string',
    )
  );
}

/**
 * Publish a project's already-built static output (internal API, called by
 * apps/web over a service binding once it has actually run the build --
 * this Worker only stores and serves the result, it does not build).
 *
 * First publish must include `slug`; a later publish of the same project
 * may omit it (the existing slug is reused) or repeat the same one -- a
 * different slug on a later publish is refused, since ADR-0010 fixes a
 * project's slug for its lifetime.
 */
async function handlePublish(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId, projectId, slug, files } = (body ?? {}) as {
    userId?: unknown;
    projectId?: unknown;
    slug?: unknown;
    files?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return json({ error: '"projectId" is required.' }, 400);
  }
  if (!isProjectFileArray(files)) {
    return json(
      { error: '"files" must be a non-empty list of {path, content}.' },
      400,
    );
  }

  const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
  const existing = await store.slugForProject(projectId);

  let resolvedSlug: string;
  if (existing) {
    if (existing.userId !== userId) {
      return json({ error: 'This project is published by another user.' }, 403);
    }
    if (typeof slug === 'string' && slug !== existing.slug) {
      return json(
        { error: `This project is already published at "${existing.slug}".` },
        409,
      );
    }
    resolvedSlug = existing.slug;
    await store.touch(resolvedSlug);
  } else {
    if (typeof slug !== 'string' || !isValidSlug(slug)) {
      return json(
        {
          error:
            '"slug" is required on first publish and must be a valid DNS label.',
        },
        400,
      );
    }
    const claim = await store.claimSlug(slug, projectId, userId);
    if (!claim.claimed) {
      return json({ error: 'That slug is already taken.' }, 409);
    }
    resolvedSlug = slug;
  }

  await store.putFiles(resolvedSlug, files);

  const hostname = env.PUBLISH_HOSTNAME ?? 'published.vibld-preview.dev';
  return json({
    slug: resolvedSlug,
    url: `https://${resolvedSlug}.${hostname}/`,
  });
}

async function handleInternal(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  if (
    !isAuthorizedInternalCaller(request.headers, env.PUBLISH_INTERNAL_SECRET)
  ) {
    return json({ error: 'Not authorized.' }, 403);
  }
  if (pathname === '/internal/publish' && request.method === 'POST') {
    return handlePublish(request, env);
  }
  return json({ error: 'Not found.' }, 404);
}

/**
 * Public traffic for `<slug>.{PUBLISH_HOSTNAME}`: resolve the slug, then
 * serve the first candidate path R2 actually has, per resolve-path.ts's
 * static-hosting fallback order.
 */
async function handlePublished(
  env: Env,
  slug: string,
  pathname: string,
): Promise<Response> {
  const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
  const resolved = await store.resolveSlug(slug);
  if (!resolved) {
    return new Response('Not found.', { status: 404 });
  }

  for (const candidate of candidatePaths(pathname)) {
    const file = await store.getFile(slug, candidate);
    if (file) {
      return new Response(file.content, {
        headers: { 'content-type': contentTypeFor(candidate) },
      });
    }
  }
  return new Response('Not found.', { status: 404 });
}

/** `<slug>.{PUBLISH_HOSTNAME}` -> slug, or undefined for anything else (including a bare `{PUBLISH_HOSTNAME}` request). */
function slugFromHost(
  hostname: string,
  publishHostname: string,
): string | undefined {
  const suffix = `.${publishHostname}`;
  if (!hostname.endsWith(suffix)) return undefined;
  const slug = hostname.slice(0, -suffix.length);
  return slug.includes('.') ? undefined : slug;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/internal/')) {
      return handleInternal(request, env, url.pathname);
    }

    const hostname = env.PUBLISH_HOSTNAME ?? 'published.vibld-preview.dev';
    const slug = slugFromHost(url.hostname, hostname);
    if (!slug) {
      return json({ error: 'Not found.' }, 404);
    }
    return handlePublished(env, slug, url.pathname);
  },
};
