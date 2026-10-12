import type { ProjectFile } from '@vibld/core';
import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/publish` (ADR-0010; docs/decisions.md L40).
 *
 * JSX-free for the same reason `preview-client.ts` and `billing-client.ts`
 * are (see the latter's own doc comment): this project's test runner
 * strips TypeScript types only and errors on JSX. `PublishButton.tsx` is
 * the JSX half that calls this from React.
 */

export type PublishResult =
  | { ok: true; slug: string; url: string; skipped: string[] }
  | { ok: false; error: string };

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorMessage(response: Response): Promise<string> {
  const problem: unknown = await response.json().catch(() => null);
  return typeof problem === 'object' &&
    problem !== null &&
    typeof (problem as { error?: unknown }).error === 'string'
    ? (problem as { error: string }).error
    : 'The publish request failed. Try again shortly.';
}

/**
 * Publish these files as `projectId`'s site. `slug` is required on a
 * project's first publish and optional after (the Worker reuses the
 * existing one) -- same contract `worker/index.ts`'s `handlePublish`
 * enforces server-side.
 *
 * Each project has its own site, so the project is named. Last and
 * optional, so the call reads as it always did: a builder with no server
 * projects (the in-browser fake) has none to name, and the Worker then
 * reads the request as an older builder's.
 *
 * `revision` names the checkpoint the files are, so the Worker can record
 * which one went out (D219). With `files` null it is a rollback: the
 * Worker reads that checkpoint back from the project's history and
 * publishes it, and nothing of the code is sent.
 *
 * Always the direct result of something the caller just clicked, so this
 * throws on failure rather than swallowing it, the same as
 * `startSandboxPreview`.
 */
export async function publishProject(
  files: ProjectFile[] | null,
  slug: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  projectId: string | null = null,
  revision: string | null = null,
): Promise<PublishResult> {
  const response = await fetchImpl('/api/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify({
      ...(files ? { files } : {}),
      ...(slug ? { slug } : {}),
      ...(projectId ? { projectId } : {}),
      ...(revision ? { revision } : {}),
    }),
  });
  if (!response.ok) {
    return { ok: false, error: await errorMessage(response) };
  }
  try {
    const body: unknown = await response.json();
    const record = (body ?? {}) as {
      slug?: unknown;
      url?: unknown;
      skipped?: unknown;
    };
    if (typeof record.slug === 'string' && typeof record.url === 'string') {
      return {
        ok: true,
        slug: record.slug,
        url: record.url,
        skipped: Array.isArray(record.skipped)
          ? record.skipped.filter(
              (entry): entry is string => typeof entry === 'string',
            )
          : [],
      };
    }
    return {
      ok: false,
      error: 'The publish service returned an unexpected response.',
    };
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
    };
  }
}

export type UnpublishResult =
  { ok: true; slug: string } | { ok: false; error: string };

/**
 * Take this project's published site off the web (ADR-0013).
 *
 * `DELETE` on the same path publishing uses, naming the project whose site
 * comes down, which the Worker checks is the caller's. With no project
 * named (a builder with no server projects), no body, which the Worker
 * reads as an older builder's request for the account's first site.
 */
export async function unpublishProject(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  projectId: string | null = null,
): Promise<UnpublishResult> {
  const response = await fetchImpl('/api/publish', {
    method: 'DELETE',
    headers: projectId
      ? {
          'content-type': 'application/json',
          ...(await authHeaders(getToken)),
        }
      : await authHeaders(getToken),
    ...(projectId ? { body: JSON.stringify({ projectId }) } : {}),
  });
  if (!response.ok) {
    return { ok: false, error: await errorMessage(response) };
  }
  try {
    const body: unknown = await response.json();
    const record = (body ?? {}) as { slug?: unknown };
    if (typeof record.slug === 'string') {
      return { ok: true, slug: record.slug };
    }
    return {
      ok: false,
      error: 'The publish service returned an unexpected response.',
    };
  } catch {
    return {
      ok: false,
      error: 'The publish service returned an unreadable response.',
    };
  }
}

/** One publish of a project's site, as `/api/projects/:id/publishes` lists it. */
export interface SitePublish {
  revision: string;
  slug: string;
  publishedAt: string;
  /** Whether the project's history still holds it, so it can go out again. */
  available: boolean;
  /** Whether this is the publish the site is serving now. */
  live: boolean;
}

/**
 * Which checkpoints this project's site went out at, newest first (D219).
 * Throws on failure, like the rest of this module's reads: the caller shows
 * the message.
 */
export async function listSitePublishes(
  projectId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<SitePublish[]> {
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(projectId)}/publishes`,
    { headers: await authHeaders(getToken) },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = (await response.json().catch(() => null)) as {
    publishes?: unknown;
  } | null;
  if (!body || !Array.isArray(body.publishes)) {
    throw new Error('The publish history could not be read.');
  }
  return body.publishes
    .filter(
      (entry): entry is SitePublish =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SitePublish).revision === 'string' &&
        typeof (entry as SitePublish).slug === 'string' &&
        typeof (entry as SitePublish).publishedAt === 'string' &&
        typeof (entry as SitePublish).available === 'boolean',
    )
    .map((entry) => ({ ...entry, live: entry.live === true }));
}
