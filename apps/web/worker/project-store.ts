import { parseTranscript } from '@vibld/core';
import type { ProjectSnapshot, TranscriptTurn } from '@vibld/core';
import { sanitizeStyleDna } from '@vibld/ai/style-dna';
import type { StyleDna } from '@vibld/ai/style-dna';
import { isStylePresetId } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';

import { D1GenerationStore, snapshotKey } from './generation-store.ts';
import { assertPrefixSafe, deletePrefix } from './storage-purge.ts';

/**
 * The projects an account owns (`0033_projects.sql`): their names, whether
 * they are archived, what they remember, and the storage behind them.
 *
 * The one place that reads or writes the `projects` table, so every query
 * that decides whose a project is lives in one file somebody can audit.
 * Every read of a project is asked with its owner's id as well as its own,
 * and answers "not found" for somebody else's. There is no method that
 * looks a project up by id alone except the ones the purge and a run use
 * after ownership has already been established.
 *
 * The code itself stays in the generation store (`generation-store.ts`),
 * which this reads through rather than around: a project's accepted
 * snapshot is whatever that store's compare-and-set last promoted.
 */

/** What a project remembers besides its code and its conversation. */
export interface ProjectSettings {
  /** The style preset, by id; null for none. */
  style: StylePresetId | null;
  /** The reference page the next build will read; null for none. */
  referenceUrl: string | null;
  /** The chosen model, by id; null for "this browser's choice". */
  model: string | null;
  /**
   * Standing instructions: null for "never set, use this browser's", and
   * the empty string for "set to none".
   */
  knowledge: string | null;
  /** Visual preferences: null for "never set", `{}` for "set to none". */
  styleDna: StyleDna | null;
}

export const EMPTY_SETTINGS: ProjectSettings = {
  style: null,
  referenceUrl: null,
  model: null,
  knowledge: null,
  styleDna: null,
};

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  /** The row's own last change: rename, archive, a save. */
  updatedAt: string;
  /** The later of that and the last accepted build. What "last edited" shows. */
  editedAt: string;
  lastOpenedAt: string;
  /** Null until the first build is accepted. */
  acceptedRevision: string | null;
  settings: ProjectSettings;
  transcriptKey: string | null;
  transcriptTurns: number;
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  last_opened_at: string;
  accepted_revision: string | null;
  style_preset: string | null;
  reference_url: string | null;
  model: string | null;
  knowledge: string | null;
  style_dna: string | null;
  transcript_key: string | null;
  transcript_turns: number;
}

/**
 * The columns every read selects, with the accepted revision and the later
 * of the two edit times from the generation store's row beside them. A
 * LEFT JOIN, because a project nobody has built in yet has no row there.
 */
const SELECT = `SELECT p.id, p.user_id, p.name, p.archived_at, p.created_at,
       p.updated_at, p.last_opened_at, p.style_preset, p.reference_url,
       p.model, p.knowledge, p.style_dna, p.transcript_key,
       p.transcript_turns, g.accepted_revision,
       MAX(p.updated_at, COALESCE(g.updated_at, p.updated_at)) AS edited_at
  FROM projects AS p
  LEFT JOIN generation_projects AS g ON g.id = p.id`;

function styleDnaOf(raw: string | null): StyleDna | null {
  if (raw === null) return null;
  try {
    // Sanitised on the way out as well as in: a dimension renamed since
    // this was saved costs that one dimension, the rule `parseStyleDna`
    // already applies to a request.
    return sanitizeStyleDna(JSON.parse(raw));
  } catch {
    return null;
  }
}

function recordOf(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at ?? row.updated_at,
    lastOpenedAt: row.last_opened_at,
    acceptedRevision: row.accepted_revision,
    settings: {
      style: isStylePresetId(row.style_preset) ? row.style_preset : null,
      referenceUrl: row.reference_url,
      model: row.model,
      knowledge: row.knowledge,
      styleDna: styleDnaOf(row.style_dna),
    },
    transcriptKey: row.transcript_key,
    transcriptTurns: row.transcript_turns,
  };
}

/** Everything a project stores in R2: its snapshots and its transcript. */
export function projectPrefix(projectId: string): string {
  assertPrefixSafe(projectId);
  return `projects/${projectId}/`;
}

/** Where a project's conversation is kept, under the same prefix as its code. */
export function transcriptKeyFor(projectId: string): string {
  return `${projectPrefix(projectId)}transcript.json`;
}

/**
 * The rows one project has, in the order they are deleted: its run
 * history, its runs' stages, its accepted pointer, and last the row that
 * says whose it is, so a failure part way through leaves a project that
 * still has an owner and can be deleted again.
 *
 * Shared with the account purge (`account-deletion-store.ts`), so deleting
 * one project and deleting all of them are the same statements.
 */
export const PROJECT_ROW_DELETIONS: readonly string[] = [
  `DELETE FROM generation_run_traces WHERE project_id = ?1`,
  `DELETE FROM generation_stages WHERE project_id = ?1`,
  `DELETE FROM generation_projects WHERE id = ?1`,
  `DELETE FROM projects WHERE id = ?1`,
];

/**
 * How long a run's stage may go unchanged and still be a run in flight.
 *
 * Twice a run's whole wall-clock budget (`RUN_WALL_CLOCK_BUDGET_MS`, fifteen
 * minutes), because a repair turn can follow a build. A stage older than
 * this and still not settled belongs to a run that was stopped between
 * steps and never came back, and must not block a deletion for ever.
 */
export const RUN_IN_FLIGHT_MS = 30 * 60_000;

/** A limit, or `null` for none: `ACTIVE_PROJECT_LIMIT` in `entitlement.ts`. */
export type ActiveLimit = number | null;

export type Unarchived = 'unarchived' | 'limit' | 'missing';

export class ProjectStore {
  readonly #db: D1Database;
  readonly #bucket: R2Bucket;

  constructor(db: D1Database, bucket: R2Bucket) {
    this.#db = db;
    this.#bucket = bucket;
  }

  /** Every project this account has, most recently opened first. */
  async list(userId: string): Promise<ProjectRecord[]> {
    const result = await this.#db
      .prepare(
        `${SELECT} WHERE p.user_id = ?1 ORDER BY p.last_opened_at DESC, p.id`,
      )
      .bind(userId)
      .all<ProjectRow>();
    return (result.results ?? []).map(recordOf);
  }

  /** One of this account's projects, or null for none (or somebody else's). */
  async find(userId: string, id: string): Promise<ProjectRecord | null> {
    const row = await this.#db
      .prepare(`${SELECT} WHERE p.id = ?1 AND p.user_id = ?2`)
      .bind(id, userId)
      .first<ProjectRow>();
    return row ? recordOf(row) : null;
  }

  /** The active project this account opened last, or null for none. */
  async mostRecentActive(userId: string): Promise<ProjectRecord | null> {
    const row = await this.#db
      .prepare(
        `${SELECT} WHERE p.user_id = ?1 AND p.archived_at IS NULL
          ORDER BY p.last_opened_at DESC, p.id LIMIT 1`,
      )
      .bind(userId)
      .first<ProjectRow>();
    return row ? recordOf(row) : null;
  }

  /** How many projects this account has that are not archived. */
  async activeCount(userId: string): Promise<number> {
    const row = await this.#db
      .prepare(
        `SELECT COUNT(*) AS n FROM projects
          WHERE user_id = ?1 AND archived_at IS NULL`,
      )
      .bind(userId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Make a project, unless it would take the account past `limit`.
   *
   * The limit is checked by the INSERT itself rather than before it, the
   * way `MediaStore.add` checks its quota: D1 runs one statement at a time,
   * so two creates racing each other cannot both see the same free slot.
   * False when the limit refused it.
   */
  async create(
    userId: string,
    project: {
      id: string;
      name: string;
      now: string;
      settings?: ProjectSettings;
    },
    limit: ActiveLimit,
  ): Promise<boolean> {
    const settings = project.settings ?? EMPTY_SETTINGS;
    const result = await this.#db
      .prepare(
        `INSERT INTO projects
           (id, user_id, name, created_at, updated_at, last_opened_at,
            style_preset, reference_url, model, knowledge, style_dna)
         SELECT ?1, ?2, ?3, ?4, ?4, ?4, ?5, ?6, ?7, ?8, ?9
          WHERE ?10 IS NULL
             OR (SELECT COUNT(*) FROM projects
                  WHERE user_id = ?2 AND archived_at IS NULL) < ?10`,
      )
      .bind(
        project.id,
        userId,
        project.name,
        project.now,
        settings.style,
        settings.referenceUrl,
        settings.model,
        settings.knowledge,
        settings.styleDna ? JSON.stringify(settings.styleDna) : null,
        limit,
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /** Record that the owner opened this project, which is what orders the list. */
  async touchOpened(userId: string, id: string, now: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE projects SET last_opened_at = ?3 WHERE id = ?1 AND user_id = ?2`,
      )
      .bind(id, userId, now)
      .run();
  }

  async rename(
    userId: string,
    id: string,
    name: string,
    now: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE projects SET name = ?3, updated_at = ?4
          WHERE id = ?1 AND user_id = ?2`,
      )
      .bind(id, userId, name, now)
      .run();
  }

  /** Hide a project without deleting it. Archiving is never limited. */
  async archive(userId: string, id: string, now: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE projects SET archived_at = COALESCE(archived_at, ?3),
                             updated_at = ?3
          WHERE id = ?1 AND user_id = ?2`,
      )
      .bind(id, userId, now)
      .run();
  }

  /**
   * Bring an archived project back, unless that would take the account past
   * `limit`. Checked inside the UPDATE, for the reason `create` gives.
   *
   * An already active project is `unarchived`: the state asked for is the
   * state it is in, and a second click must not read as a refusal.
   */
  async unarchive(
    userId: string,
    id: string,
    now: string,
    limit: ActiveLimit,
  ): Promise<Unarchived> {
    const result = await this.#db
      .prepare(
        `UPDATE projects SET archived_at = NULL, updated_at = ?3
          WHERE id = ?1 AND user_id = ?2 AND archived_at IS NOT NULL
            AND (?4 IS NULL
                 OR (SELECT COUNT(*) FROM projects
                      WHERE user_id = ?2 AND archived_at IS NULL) < ?4)`,
      )
      .bind(id, userId, now, limit)
      .run();
    if ((result.meta?.changes ?? 0) > 0) return 'unarchived';
    const current = await this.find(userId, id);
    if (!current) return 'missing';
    return current.archivedAt === null ? 'unarchived' : 'limit';
  }

  /**
   * Replace the fields of `settings` that are present. A field left out is
   * left as it was, so a builder that only knows some of them cannot clear
   * the rest by omission.
   */
  async saveSettings(
    userId: string,
    id: string,
    settings: Partial<ProjectSettings>,
    now: string,
  ): Promise<void> {
    const columns: [keyof ProjectSettings, string][] = [
      ['style', 'style_preset'],
      ['referenceUrl', 'reference_url'],
      ['model', 'model'],
      ['knowledge', 'knowledge'],
      ['styleDna', 'style_dna'],
    ];
    const present = columns.filter(([field]) => field in settings);
    if (present.length === 0) return;
    const values = present.map(([field]) =>
      field === 'styleDna'
        ? settings.styleDna
          ? JSON.stringify(settings.styleDna)
          : null
        : (settings[field] ?? null),
    );
    // Column names come from the list above, never from the request.
    const sets = present
      .map(([, column], index) => `${column} = ?${index + 4}`)
      .join(', ');
    await this.#db
      .prepare(
        `UPDATE projects SET ${sets}, updated_at = ?3
          WHERE id = ?1 AND user_id = ?2`,
      )
      .bind(id, userId, now, ...values)
      .run();
  }

  /**
   * The saved conversation, or an empty one.
   *
   * A transcript that cannot be read back (an object R2 lost, or one a
   * later build of this Worker no longer understands) opens as empty
   * rather than failing the whole project: the code is the part that
   * matters most, and it is not in this object.
   */
  async readTranscript(project: ProjectRecord): Promise<TranscriptTurn[]> {
    if (!project.transcriptKey) return [];
    try {
      const object = await this.#bucket.get(project.transcriptKey);
      if (!object) return [];
      const parsed = parseTranscript(JSON.parse(await object.text()));
      return parsed.ok ? parsed.turns : [];
    } catch (error) {
      console.error('project transcript unreadable', error);
      return [];
    }
  }

  /**
   * Save the conversation: the object first, then the pointer to it, so the
   * pointer never names a write that could still fail.
   */
  async saveTranscript(
    userId: string,
    id: string,
    turns: TranscriptTurn[],
    now: string,
  ): Promise<void> {
    const key = transcriptKeyFor(id);
    await this.#bucket.put(key, JSON.stringify(turns));
    await this.#db
      .prepare(
        `UPDATE projects SET transcript_key = ?3, transcript_turns = ?4,
                             updated_at = ?5
          WHERE id = ?1 AND user_id = ?2`,
      )
      .bind(id, userId, key, turns.length, now)
      .run();
  }

  /** The project's accepted code, from the generation store. */
  async accepted(projectId: string): Promise<ProjectSnapshot | undefined> {
    return new D1GenerationStore(this.#db, this.#bucket).loadAccepted(
      projectId,
    );
  }

  /**
   * Whether a run is still working on this project.
   *
   * Deleting a project under a run is what this exists to refuse. The run
   * would go on to stage and promote into the project it was started for,
   * which `saveStage` recreates as a row with no owner, and its snapshot
   * lands under a prefix nothing names any more: code that outlives the
   * deletion of its project and, since it has no owner, the deletion of the
   * account as well.
   */
  async runInFlight(projectId: string, now: Date): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT 1 AS found FROM generation_stages
          WHERE project_id = ?1
            AND state NOT IN ('accepted', 'failed', 'cancelled', 'idle')
            AND updated_at > ?2
          LIMIT 1`,
      )
      .bind(projectId, new Date(now.getTime() - RUN_IN_FLIGHT_MS).toISOString())
      .first();
    return row !== null;
  }

  /**
   * Delete a project: everything under its prefix, then its rows.
   *
   * Bytes before rows, the order the account purge keeps, so a failure
   * leaves a project that still has an owner and can be deleted again,
   * rather than bytes nothing names. False when the prefix was too large to
   * finish in one request; what was deleted stays deleted, and asking
   * again carries on from there.
   */
  async remove(projectId: string, pages = 20): Promise<boolean> {
    if (!(await deletePrefix(this.#bucket, projectPrefix(projectId), pages))) {
      return false;
    }
    for (const sql of PROJECT_ROW_DELETIONS) {
      await this.#db.prepare(sql).bind(projectId).run();
    }
    return true;
  }

  /**
   * Copy a project into a new one, owned by `ownerId`, unless that would
   * take the owner past `limit`: its accepted code, its settings and its
   * conversation, under the name given.
   *
   * Only the accepted revision is copied, not the history of revisions
   * behind it, and not the run history either: a copy is a new project that
   * starts where the original stands, and the runs were the original's.
   *
   * The owner is a parameter rather than the source's own because copying
   * somebody's shared project into your account is this same operation
   * with a different owner, and the caller is what decides whether that is
   * allowed. Today the only caller copies within one account.
   *
   * `null` when the limit refused it. A copy that fails part way is removed
   * again before the error is thrown, so a refused or broken duplicate
   * never leaves a half-made project in somebody's list.
   */
  async duplicate(
    source: ProjectRecord,
    ownerId: string,
    copy: { id: string; name: string; now: string },
    limit: ActiveLimit,
  ): Promise<ProjectRecord | null> {
    const created = await this.create(
      ownerId,
      { ...copy, settings: source.settings },
      limit,
    );
    if (!created) return null;
    try {
      const snapshot = await this.accepted(source.id);
      if (snapshot) {
        await this.#bucket.put(
          snapshotKey(copy.id, snapshot.revision),
          JSON.stringify(snapshot),
        );
        await this.#db
          .prepare(
            `INSERT INTO generation_projects
               (id, accepted_revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)`,
          )
          .bind(copy.id, snapshot.revision, copy.now)
          .run();
      }
      const turns = await this.readTranscript(source);
      if (turns.length > 0) {
        await this.saveTranscript(ownerId, copy.id, turns, copy.now);
      }
    } catch (error) {
      await this.remove(copy.id).catch(() => undefined);
      throw error;
    }
    return this.find(ownerId, copy.id);
  }
}

/**
 * Which project a run belongs to, for the routes that start one or read
 * one's history (`/api/plan`, `/api/runs`).
 *
 * A project the caller names has to be theirs: another account's is
 * "not found", never "forbidden", so the answer does not confirm that the
 * id exists. An archived one is refused, because building in it would make
 * the free tier's limit on active projects a limit on nothing.
 *
 * A request that names no project comes from a builder older than
 * projects. It gets the caller's most recently opened active project,
 * which for everybody who built before projects existed is the one the
 * migration made of their old work, so an old tab left open keeps editing
 * what it was editing. An account with no active project at all gets a new
 * one when `create` is set, and not otherwise: a read of run history has no
 * business making anything.
 */
export type RunProject =
  | { ok: true; projectId: string | null }
  | { ok: false; status: number; error: string };

export async function resolveRunProject(
  store: ProjectStore,
  userId: string,
  requested: string | null,
  options: {
    create: boolean;
    /**
     * Whether an archived project may be named. A run may not start in
     * one; its history may still be read.
     */
    allowArchived?: boolean;
    newId: () => string;
    now: () => string;
    name: string;
  },
): Promise<RunProject> {
  if (requested !== null) {
    const project = await store.find(userId, requested);
    if (!project) {
      return { ok: false, status: 404, error: 'That project does not exist.' };
    }
    if (project.archivedAt !== null && !options.allowArchived) {
      return {
        ok: false,
        status: 409,
        error:
          'This project is archived. Unarchive it from your projects to keep building.',
      };
    }
    return { ok: true, projectId: project.id };
  }

  const recent = await store.mostRecentActive(userId);
  if (recent) return { ok: true, projectId: recent.id };
  if (!options.create) return { ok: true, projectId: null };

  // No limit: this branch is only reached with no active project at all,
  // which is inside every tier's limit.
  const id = options.newId();
  await store.create(
    userId,
    { id, name: options.name, now: options.now() },
    null,
  );
  return { ok: true, projectId: id };
}
