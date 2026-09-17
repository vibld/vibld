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
    // #172. Publishing again is what clears an owner's own takedown, so an
    // operator hold the owner could lift by pressing Publish would be no
    // hold at all. This is the refusal that makes it one.
    if (existing.state === 'held') {
      return json(
        {
          error:
            'This site has been taken down by the operator and cannot be republished.',
        },
        409,
      );
    }
    if (typeof slug === 'string' && slug !== existing.slug) {
      return json(
        { error: `This project is already published at "${existing.slug}".` },
        409,
      );
    }
    resolvedSlug = existing.slug;
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
  // The files first, then the row. `touch` is what clears a tombstone, so
  // calling it before the content exists would make a taken-down slug
  // publicly resolvable against an empty prefix, and a failed write would
  // then leave the site reading as live and serving nothing. That is the
  // exact failure `unpublish` orders itself to avoid, pointed the other way.
  //
  // It still only runs for a project that already held this slug: a first
  // publish has just claimed the row and has nothing to correct.
  if (existing) {
    await store.touch(resolvedSlug);
  }

  const hostname = env.PUBLISH_HOSTNAME ?? 'published.vibld-preview.dev';
  return json({
    slug: resolvedSlug,
    url: `https://${resolvedSlug}.${hostname}/`,
  });
}

/**
 * Take a published project off the web (internal API, ADR-0013).
 *
 * Ownership is checked here even though apps/web has already resolved a
 * principal, for the reason ADR-0006 gives at every boundary: the caller
 * says who is asking, and the store is what knows whose slug this is. A
 * project that was never published answers 404 rather than pretending to
 * have removed something.
 */
async function handleUnpublish(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { userId, projectId } = (body ?? {}) as {
    userId?: unknown;
    projectId?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return json({ error: '"userId" is required.' }, 400);
  }
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return json({ error: '"projectId" is required.' }, 400);
  }

  const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
  const existing = await store.slugForProject(projectId);
  if (!existing) {
    return json({ error: 'This project is not published.' }, 404);
  }
  if (existing.userId !== userId) {
    return json({ error: 'This project is published by another user.' }, 403);
  }
  // #172, and the sharper half of the refusal `handlePublish` makes. An
  // owner's takedown deletes the objects, which is right when it is their
  // decision and the site is theirs to empty. Under a hold it would erase
  // the bytes the hold exists to keep: an owner who disliked being held
  // could destroy what an operator is holding for review, and a hold placed
  // on a wrong report could no longer be simply lifted. The site is already
  // off the web, so refusing costs the owner nothing they do not already
  // have; what it costs is the ability to act on a site while somebody else
  // is deciding about it, which is the whole of what a hold is.
  if (existing.state === 'held') {
    return json(
      {
        error:
          'This site has been taken down by the operator and cannot be changed until that is lifted.',
      },
      409,
    );
  }

  await store.unpublish(existing.slug);
  return json({ slug: existing.slug });
}

/**
 * Take somebody else's published site off the web, and put it back (#172).
 *
 * Named by slug rather than by project, because that is what an operator has:
 * a report names an address. There is no ownership check here and that is the
 * point of the route -- apps/web has already established that the caller is a
 * platform admin, which is a stricter check than owning the thing.
 *
 * The bytes stay. See `PublishStore.hold`.
 */
async function handleHold(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { slug, by, reason } = (body ?? {}) as {
    slug?: unknown;
    by?: unknown;
    reason?: unknown;
  };
  if (typeof slug !== 'string' || slug.length === 0) {
    return json({ error: '"slug" is required.' }, 400);
  }
  if (typeof by !== 'string' || by.length === 0) {
    return json({ error: '"by" is required.' }, 400);
  }
  // A hold with no reason is a hold nobody can review later, which is the
  // half of "auditable" that costs nothing to require and everything to add
  // afterwards.
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return json({ error: '"reason" is required.' }, 400);
  }

  const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
  const site = await store.siteBySlug(slug);
  if (!site) return json({ error: 'No such published site.' }, 404);

  await store.hold(slug, by, reason.trim());
  return json({ slug, state: 'held' });
}

/** Lift a hold. Does not put the site back: see `PublishStore.release`. */
async function handleRelease(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { slug, by } = (body ?? {}) as { slug?: unknown; by?: unknown };
  if (typeof slug !== 'string' || slug.length === 0) {
    return json({ error: '"slug" is required.' }, 400);
  }
  // Required, because lifting a hold is as much an action somebody took as
  // placing it, and the history keeps both.
  if (typeof by !== 'string' || by.length === 0) {
    return json({ error: '"by" is required.' }, 400);
  }

  const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
  const site = await store.siteBySlug(slug);
  if (!site) return json({ error: 'No such published site.' }, 404);
  if (site.state !== 'held') {
    return json({ error: 'This site is not held.' }, 409);
  }

  await store.release(slug, by);
  const after = await store.siteBySlug(slug);
  return json({ slug, state: after?.state ?? 'down' });
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
  if (pathname === '/internal/unpublish' && request.method === 'POST') {
    return handleUnpublish(request, env);
  }
  if (pathname === '/internal/hold' && request.method === 'POST') {
    return handleHold(request, env);
  }
  if (pathname === '/internal/release' && request.method === 'POST') {
    return handleRelease(request, env);
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
