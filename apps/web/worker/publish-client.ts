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

const INTERNAL_ORIGIN = 'https://internal.invalid';

export type BuildResult =
  | { ok: true; files: ProjectFile[]; skipped: string[] }
  | { ok: false; error: string };

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
  return {
    ok: false,
    error:
      typeof record.error === 'string'
        ? record.error
        : 'The build service returned an unexpected response.',
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
