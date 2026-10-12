/**
 * The publishes of each project's site (D219), newest first, so its owner
 * can see which checkpoint went out when and put an earlier one back.
 *
 * Written by `/api/publish` once a publish has landed, and only for a
 * checkpoint the project's history holds: the revision is what a rollback
 * reads back, so a row naming anything else would offer a version that
 * cannot be published again. Read by `GET /api/projects/:id/publishes`.
 */

/** How many publishes a project keeps. */
export const MAX_PUBLISHES = 50;

export interface SitePublish {
  revision: string;
  slug: string;
  publishedAt: string;
  /** The publish service's revision for this publish, when it said. */
  generation: string | null;
}

export async function recordPublish(
  db: D1Database,
  row: {
    projectId: string;
    slug: string;
    revision: string;
    generation: string | null;
    now: Date;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        'INSERT INTO site_publishes (project_id, slug, revision, published_at, generation) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        row.projectId,
        row.slug,
        row.revision,
        row.now.toISOString(),
        row.generation,
      ),
    db
      .prepare(
        `DELETE FROM site_publishes WHERE project_id = ? AND id NOT IN (
           SELECT id FROM site_publishes WHERE project_id = ?
           ORDER BY id DESC LIMIT ?
         )`,
      )
      .bind(row.projectId, row.projectId, MAX_PUBLISHES),
  ]);
}

export async function listPublishes(
  db: D1Database,
  projectId: string,
): Promise<SitePublish[]> {
  const { results } = await db
    .prepare(
      'SELECT revision, slug, published_at, generation FROM site_publishes WHERE project_id = ? ORDER BY id DESC LIMIT ?',
    )
    .bind(projectId, MAX_PUBLISHES)
    .all<{
      revision: string;
      slug: string;
      published_at: string;
      generation: string | null;
    }>();
  return results.map((row) => ({
    revision: row.revision,
    slug: row.slug,
    publishedAt: row.published_at,
    generation: row.generation,
  }));
}

/**
 * The revision the project's site is serving now, or null when nothing is
 * (never published, taken down, or held). Compared with each row's
 * `generation`, it is what lets the history say which publish is live
 * without assuming the newest row is: a publish whose row was not written
 * (an older client sent no revision, or recording failed) leaves the
 * newest row naming files that are no longer up.
 */
export async function servingGeneration(
  db: D1Database,
  projectId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT generation FROM published_projects
        WHERE project_id = ? AND unpublished_at IS NULL AND held_at IS NULL`,
    )
    .bind(projectId)
    .first<{ generation: string | null }>();
  return row?.generation ?? null;
}

/** The slice of the generation store a publish reads checkpoints through. */
export interface CheckpointReader {
  listCheckpoints(
    projectId: string,
  ): Promise<{ checkpoints: readonly { revision: string }[] }>;
  loadRevision(
    projectId: string,
    revision: string,
  ): Promise<{ files: { path: string; content: string }[] } | undefined>;
}

export type PublishSource =
  | {
      ok: true;
      files: { path: string; content: string }[];
      /** The checkpoint to record, when the history holds it. */
      revision: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * What a publish puts on the web, and which checkpoint to record it as.
 *
 * With `files`, the builder's own checkpoint, as it always was; its
 * `revision` is recorded only if the project's history holds it and the
 * files sent are that checkpoint's. With a
 * `revision` and no `files`, a rollback (D219): the checkpoint's files are
 * read back from the history here, never taken from the request, so what
 * goes out is exactly what that checkpoint was.
 */
export async function resolvePublishSource(
  body: Record<string, unknown>,
  projectId: string,
  checkpoints: CheckpointReader | null,
  parseFiles: (
    body: unknown,
  ) =>
    | { ok: true; value: { path: string; content: string }[] }
    | { ok: false; status: number; error: string },
): Promise<PublishSource> {
  const { revision, files } = body;
  if (
    revision !== undefined &&
    (typeof revision !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(revision))
  ) {
    return { ok: false, status: 400, error: 'That checkpoint does not exist.' };
  }
  const held = async (wanted: string): Promise<boolean> =>
    checkpoints !== null &&
    (await checkpoints.listCheckpoints(projectId)).checkpoints.some(
      (entry) => entry.revision === wanted,
    );

  if (files === undefined && typeof revision === 'string') {
    if (!(await held(revision))) {
      return {
        ok: false,
        status: 404,
        error: 'That checkpoint is no longer in this project’s history.',
      };
    }
    const snapshot = await checkpoints!.loadRevision(projectId, revision);
    if (!snapshot) {
      return {
        ok: false,
        status: 404,
        error: 'That checkpoint is no longer stored.',
      };
    }
    return { ok: true, files: snapshot.files, revision };
  }

  const parsed = parseFiles(body);
  if (!parsed.ok) return parsed;
  // Recorded only when the files sent are that checkpoint's files. A stale
  // or hand-written request naming one revision and sending another's would
  // otherwise put a row in the history that "Put this back" cannot honor.
  const matches =
    typeof revision === 'string' &&
    (await held(revision)) &&
    sameFiles(
      parsed.value,
      (await checkpoints!.loadRevision(projectId, revision))?.files,
    );
  return {
    ok: true,
    files: parsed.value,
    revision: matches ? (revision as string) : null,
  };
}

/** Whether two file lists hold the same paths with the same content. */
function sameFiles(
  sent: readonly { path: string; content: string }[],
  stored: readonly { path: string; content: string }[] | undefined,
): boolean {
  if (!stored || stored.length !== sent.length) return false;
  const byPath = new Map(stored.map((file) => [file.path, file.content]));
  // Each path once: a repeated path standing in for a missing one would
  // otherwise match the same stored entry twice.
  const seen = new Set(sent.map((file) => file.path));
  return (
    seen.size === sent.length &&
    byPath.size === stored.length &&
    sent.every((file) => byPath.get(file.path) === file.content)
  );
}
