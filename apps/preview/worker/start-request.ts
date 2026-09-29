import type { ProjectFile } from '@vibld/core';
import { MAX_REVISION_CHARS, filesProblem } from './live-update.ts';

/**
 * What `/internal/preview/start` is asked, checked.
 *
 * Its own module so the rules can be tested: `index.ts` imports the
 * sandbox runtime, which cannot be loaded under `node --test`.
 */
export interface StartRequest {
  /** The sandbox's name: the caller's user id, or a share link's key. */
  userId: string;
  /** Metadata for the fleet, never a limit key. */
  label: string;
  files: ProjectFile[];
  /**
   * Whose media library `/media/` reads. The sandbox's own name unless
   * apps/web says otherwise: a shared project's preview runs in a sandbox
   * named for its link (apps/web's `share-link.ts`) and serves its owner's
   * media. Still only the files the code references (`recordMedia`), so
   * naming an owner grants nothing past what the shared code already
   * shows, and only apps/web can say it, behind the internal secret.
   */
  mediaOwner: string;
  /**
   * The checkpoint these files are (D74), when the caller knows it. Kept
   * with the preview so a live update can say which revision the sandbox
   * serves, rather than the builder inferring it from what it last sent.
   */
  revision?: string;
}

/** What `/internal/preview/update` is asked, checked. */
export interface UpdateRequest {
  userId: string;
  files: ProjectFile[];
  revision: string;
}

function revisionProblem(revision: unknown): string | undefined {
  if (
    typeof revision !== 'string' ||
    revision.length === 0 ||
    revision.length > MAX_REVISION_CHARS
  ) {
    return `"revision" must be a string of 1 to ${MAX_REVISION_CHARS} characters.`;
  }
  return undefined;
}

export function isProjectFileArray(value: unknown): value is ProjectFile[] {
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

export function parseStartRequest(
  body: unknown,
): { ok: true; value: StartRequest } | { ok: false; error: string } {
  const { userId, label, files, mediaOwner, revision } = (body ?? {}) as {
    userId?: unknown;
    label?: unknown;
    files?: unknown;
    mediaOwner?: unknown;
    revision?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, error: '"userId" is required.' };
  }
  if (!isProjectFileArray(files)) {
    return { ok: false, error: '"files" must be a list of {path, content}.' };
  }
  if (
    mediaOwner !== undefined &&
    (typeof mediaOwner !== 'string' || mediaOwner.length === 0)
  ) {
    return { ok: false, error: '"mediaOwner" must be a non-empty string.' };
  }
  // Optional, so a caller from before D74 starts a preview exactly as it
  // did; a preview started without one is simply never said to be serving
  // any particular revision.
  if (revision !== undefined) {
    const problem = revisionProblem(revision);
    if (problem) return { ok: false, error: problem };
  }
  return {
    ok: true,
    value: {
      userId,
      label: typeof label === 'string' ? label : userId,
      files,
      mediaOwner: typeof mediaOwner === 'string' ? mediaOwner : userId,
      ...(typeof revision === 'string' ? { revision } : {}),
    },
  };
}

/**
 * `/internal/preview/update`'s body: whose preview, the whole new set of
 * files, and which revision they are.
 *
 * The whole set rather than a diff, because only the sandbox knows what it
 * is serving: a caller that computed the difference itself would compute
 * it against what it last sent, which a restart, a second tab or a lost
 * reply all make wrong. The paths and sizes are checked here too
 * (`filesProblem`), because this is the request that writes and deletes
 * files in a running container.
 */
export function parseUpdateRequest(
  body: unknown,
): { ok: true; value: UpdateRequest } | { ok: false; error: string } {
  const { userId, files, revision } = (body ?? {}) as {
    userId?: unknown;
    files?: unknown;
    revision?: unknown;
  };
  if (typeof userId !== 'string' || userId.length === 0) {
    return { ok: false, error: '"userId" is required.' };
  }
  if (!isProjectFileArray(files)) {
    return { ok: false, error: '"files" must be a list of {path, content}.' };
  }
  const invalid = filesProblem(files);
  if (invalid) return { ok: false, error: invalid };
  const problem = revisionProblem(revision);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    value: { userId, files, revision: revision as string },
  };
}
