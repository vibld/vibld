import type { ProjectFile } from '@vibld/core';

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
  const { userId, label, files, mediaOwner } = (body ?? {}) as {
    userId?: unknown;
    label?: unknown;
    files?: unknown;
    mediaOwner?: unknown;
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
  return {
    ok: true,
    value: {
      userId,
      label: typeof label === 'string' ? label : userId,
      files,
      mediaOwner: typeof mediaOwner === 'string' ? mediaOwner : userId,
    },
  };
}
