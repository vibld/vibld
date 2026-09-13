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
 * Publish these files. `slug` is required on a project's first publish and
 * optional after (the Worker reuses the existing one) -- same contract
 * `worker/index.ts`'s `handlePublish` enforces server-side.
 *
 * Always the direct result of something the caller just clicked, so this
 * throws on failure rather than swallowing it, the same as
 * `startSandboxPreview`.
 */
export async function publishProject(
  files: ProjectFile[],
  slug: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PublishResult> {
  const response = await fetchImpl('/api/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders(getToken)),
    },
    body: JSON.stringify(slug ? { files, slug } : { files }),
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
