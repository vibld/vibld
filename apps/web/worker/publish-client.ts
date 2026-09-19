/**
 * Talks to `@vibld/preview`'s build step and `@vibld/publish`'s publish
 * step over their own service bindings (ADR-0010). Two separate Workers,
 * two separate calls -- this file is the only place in `apps/web` that
 * knows the shape of either internal API for auto-publish.
 */

import type { ProjectFile } from '@vibld/core';

/** The slice of a Workers service binding this file calls. Same shape preview-client.ts already declares. */
export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export interface PublishServiceEnv {
  PREVIEW?: ServiceBinding;
  PREVIEW_INTERNAL_SECRET?: string;
  PUBLISH?: ServiceBinding;
  PUBLISH_INTERNAL_SECRET?: string;
}

export function autoPublishConfigured(env: PublishServiceEnv): boolean {
  return Boolean(
    env.PREVIEW &&
    env.PREVIEW_INTERNAL_SECRET &&
    env.PUBLISH &&
    env.PUBLISH_INTERNAL_SECRET,
  );
}

/**
 * What taking a site down needs, which is less than publishing does.
 *
 * Publishing builds first, so it needs apps/preview as well. A takedown
 * builds nothing. Asking for the build service anyway would mean that
 * turning preview off, or losing its secret, leaves every already-published
 * site up with its owner answered 503 by the only control that removes one.
 * A fail-closed check has to fail closed on the thing it is actually about.
 */
export function publishServiceConfigured(env: PublishServiceEnv): boolean {
  return Boolean(env.PUBLISH && env.PUBLISH_INTERNAL_SECRET);
}

const INTERNAL_ORIGIN = 'https://internal.invalid';

/**
 * Why a build produced nothing, carried across the service boundary.
 *
 * A copy of `@vibld/preview`'s own union rather than an import: the two
 * Workers are separate deployments that talk over a service binding and
 * share no build, the same reason `ServiceBinding` is declared here rather
 * than imported. `parseBuildResult` checks the wire value against this list,
 * so the copy cannot silently drift into accepting something the other side
 * never sends.
 */
export type BuildFailureReason =
  'busy' | 'install' | 'build' | 'output' | 'sandbox';

const BUILD_FAILURE_REASONS: readonly BuildFailureReason[] = [
  'busy',
  'install',
  'build',
  'output',
  'sandbox',
];

export type BuildResult =
  | { ok: true; files: ProjectFile[]; skipped: string[] }
  | { ok: false; error: string; reason?: BuildFailureReason };

/**
 * `@vibld/preview`'s own reply is trusted content -- it is our other
 * Worker, not a caller -- but every field is still checked, same discipline
 * `preview-client.ts`'s `parseStatus` already applies.
 */
function parseBuildResult(body: unknown): BuildResult {
  const record = (body ?? {}) as {
    files?: unknown;
    skipped?: unknown;
    error?: unknown;
    reason?: unknown;
  };
  if (Array.isArray(record.files)) {
    const files = record.files.filter(
      (entry): entry is ProjectFile =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ProjectFile).path === 'string' &&
        typeof (entry as ProjectFile).content === 'string',
    );
    if (files.length > 0) {
      return {
        ok: true,
        files,
        skipped: Array.isArray(record.skipped)
          ? record.skipped.filter(
              (entry): entry is string => typeof entry === 'string',
            )
          : [],
      };
    }
  }
  // Absent rather than guessed when the wire value is not one this knows.
  // A caller deciding whether to spend a model call on a repair reads the
  // absence as "no evidence about the project" and does nothing, which is
  // the safe direction: the alternative is inventing a reason and spending
  // somebody's money on it (#194).
  const reason = BUILD_FAILURE_REASONS.find((known) => known === record.reason);
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'The build service returned an unexpected response.',
    ...(reason ? { reason } : {}),
  };
}

export async function buildProject(
  env: PublishServiceEnv,
  userId: string,
  files: ProjectFile[],
): Promise<BuildResult> {
  const response = await env.PREVIEW!.fetch(
    new Request(new URL('/internal/preview/build', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PREVIEW_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, files }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The build service returned an unreadable response.',
    };
  }
  return parseBuildResult(body);
}

export type PublishResult =
  | { ok: true; slug: string; url: string }
  | { ok: false; error: string; status: number };

export async function publishProject(
  env: PublishServiceEnv,
  userId: string,
  projectId: string,
  slug: string | undefined,
  files: ProjectFile[],
): Promise<PublishResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL('/internal/publish', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, projectId, slug, files }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (body ?? {}) as {
    slug?: unknown;
    url?: unknown;
    error?: unknown;
  };
  if (
    response.ok &&
    typeof record.slug === 'string' &&
    typeof record.url === 'string'
  ) {
    return { ok: true, slug: record.slug, url: record.url };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not publish this project.',
    // Pass through a meaningful status (400/403/409) rather than
    // collapsing every failure to 502 -- a slug conflict or an invalid
    // slug is the caller's to fix, not this service's own error.
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export type UnpublishResult =
  { ok: true; slug: string } | { ok: false; error: string; status: number };

/**
 * Take this project's published site off the web (ADR-0013).
 *
 * No build step, unlike publishing: there is nothing to make, only
 * something to stop serving. Ownership is checked again on the other side
 * -- apps/web knows who is asking, apps/publish knows whose slug this is --
 * so a caller cannot take down somebody else's site by naming their
 * project.
 */
export async function unpublishProject(
  env: PublishServiceEnv,
  userId: string,
  projectId: string,
): Promise<UnpublishResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL('/internal/unpublish', INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify({ userId, projectId }),
    }),
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (body ?? {}) as { slug?: unknown; error?: unknown };
  if (response.ok && typeof record.slug === 'string') {
    return { ok: true, slug: record.slug };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not take this project down.',
    // Same rule publishing uses: a 403 or a 404 is the caller's answer, not
    // this service failing.
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export type HoldResult =
  | { ok: true; slug: string; state: 'held' | 'live' | 'down' }
  | { ok: false; error: string; status: number };

/**
 * Take somebody else's published site off the web, or put the decision back
 * (#172). Called only from the platform-admin routes.
 *
 * `by` and `reason` travel because a takedown of work that is not yours is
 * the clearest case of the auditable action SECURITY.md asks for, and the
 * store is where that record belongs.
 */
async function holdCall(
  env: PublishServiceEnv,
  path: '/internal/hold' | '/internal/release',
  body: Record<string, string>,
): Promise<HoldResult> {
  const response = await env.PUBLISH!.fetch(
    new Request(new URL(path, INTERNAL_ORIGIN), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_INTERNAL_SECRET}`,
      },
      body: JSON.stringify(body),
    }),
  );
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    };
  }
  const record = (parsed ?? {}) as {
    slug?: unknown;
    state?: unknown;
    error?: unknown;
  };
  if (
    response.ok &&
    typeof record.slug === 'string' &&
    (record.state === 'held' ||
      record.state === 'live' ||
      record.state === 'down')
  ) {
    return { ok: true, slug: record.slug, state: record.state };
  }
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'Could not change this site.',
    status:
      response.status >= 400 && response.status < 500 ? response.status : 502,
  };
}

export function holdProject(
  env: PublishServiceEnv,
  slug: string,
  by: string,
  reason: string,
): Promise<HoldResult> {
  return holdCall(env, '/internal/hold', { slug, by, reason });
}

export function releaseProject(
  env: PublishServiceEnv,
  slug: string,
  by: string,
): Promise<HoldResult> {
  return holdCall(env, '/internal/release', { slug, by });
}
