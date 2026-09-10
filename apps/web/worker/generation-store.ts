/**
 * A `GenerationStore` (`@vibld/core`) backed by D1 and R2 -- the control
 * plane persistence docs/decisions.md L24/L25 call for.
 *
 * File content lives in R2, content-addressed by revision at
 * `projects/{projectId}/snapshots/{revision}.json`. D1 holds only metadata:
 * which revision a project has accepted, and one row per generation run.
 * Splitting it this way means promotion never copies file content -- a
 * staged snapshot is already sitting in R2 by the time it is accepted, so
 * accepting it is a metadata update, not a rewrite.
 *
 * The compare-and-set `promote` this module implements is what D12 requires
 * ("stage edits against a known base revision... enforce one writer per
 * project and surface conflicts without overwriting user work") and what
 * ADR-0006 assumes exists. It is a single conditional `UPDATE`, not a
 * read-then-write: the row either matches `expectedBaseRevision` and is
 * counted in `meta.changes`, or nothing is written. Two requests racing to
 * promote the same base revision can both attempt it; at most one succeeds.
 */

import type {
  GenerationStageRecord,
  GenerationStore,
  ProjectSnapshot,
  PromotionResult,
} from '@vibld/core';

function snapshotKey(projectId: string, revision: string): string {
  return `projects/${projectId}/snapshots/${revision}.json`;
}

async function readSnapshot(
  bucket: R2Bucket,
  projectId: string,
  revision: string | null | undefined,
): Promise<ProjectSnapshot | undefined> {
  if (!revision) return undefined;
  const object = await bucket.get(snapshotKey(projectId, revision));
  if (!object) return undefined;
  return JSON.parse(await object.text()) as ProjectSnapshot;
}

async function writeSnapshot(
  bucket: R2Bucket,
  projectId: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  await bucket.put(
    snapshotKey(projectId, snapshot.revision),
    JSON.stringify(snapshot),
  );
}

interface ProjectRow {
  id: string;
  accepted_revision: string | null;
}

interface StageRow {
  run_id: string;
  project_id: string;
  base_revision: string | null;
  state: string;
  snapshot_revision: string | null;
}

export class D1GenerationStore implements GenerationStore {
  #db: D1Database;
  #bucket: R2Bucket;

  constructor(db: D1Database, bucket: R2Bucket) {
    this.#db = db;
    this.#bucket = bucket;
  }

  async saveStage(record: GenerationStageRecord): Promise<void> {
    const now = new Date().toISOString();

    // A project row must exist before promote()'s compare-and-set UPDATE can
    // match it. saveStage always runs before promote in real usage
    // (durable-runner.ts stages every state transition), so creating the
    // row here -- as a no-op when it already exists -- means promote()
    // never has to decide between inserting and updating.
    await this.#db
      .prepare(
        `INSERT INTO generation_projects (id, accepted_revision, created_at, updated_at)
         VALUES (?1, NULL, ?2, ?2)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(record.projectId, now)
      .run();

    if (record.snapshot) {
      await writeSnapshot(this.#bucket, record.projectId, record.snapshot);
    }

    await this.#db
      .prepare(
        `INSERT INTO generation_stages
           (run_id, project_id, base_revision, state, snapshot_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(run_id) DO UPDATE SET
           project_id = excluded.project_id,
           base_revision = excluded.base_revision,
           state = excluded.state,
           snapshot_revision = excluded.snapshot_revision,
           updated_at = excluded.updated_at`,
      )
      .bind(
        record.runId,
        record.projectId,
        record.baseRevision,
        record.state,
        record.snapshot?.revision ?? null,
        now,
      )
      .run();
  }

  async loadStage(runId: string): Promise<GenerationStageRecord | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT run_id, project_id, base_revision, state, snapshot_revision
         FROM generation_stages WHERE run_id = ?1`,
      )
      .bind(runId)
      .first<StageRow>();
    if (!row) return undefined;

    const snapshot = await readSnapshot(
      this.#bucket,
      row.project_id,
      row.snapshot_revision,
    );

    return {
      runId: row.run_id,
      projectId: row.project_id,
      baseRevision: row.base_revision,
      // GenerationState is a closed union; this table only ever holds
      // values this module itself writes, all of which are valid members.
      state: row.state as GenerationStageRecord['state'],
      snapshot,
    };
  }

  async loadAccepted(projectId: string): Promise<ProjectSnapshot | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT id, accepted_revision FROM generation_projects WHERE id = ?1`,
      )
      .bind(projectId)
      .first<ProjectRow>();
    if (!row) return undefined;
    return readSnapshot(this.#bucket, projectId, row.accepted_revision);
  }

  async promote(
    projectId: string,
    runId: string,
    expectedBaseRevision: string | null,
    snapshot: ProjectSnapshot,
  ): Promise<PromotionResult> {
    const stage = await this.#db
      .prepare(
        `SELECT run_id, project_id FROM generation_stages WHERE run_id = ?1`,
      )
      .bind(runId)
      .first<Pick<StageRow, 'run_id' | 'project_id'>>();

    if (!stage || stage.project_id !== projectId) {
      return { promoted: false, current: await this.loadAccepted(projectId) };
    }

    // Written before the compare-and-set so the accepted pointer, once it
    // moves, always points at content that is already there -- never a
    // pointer to a write that could still fail.
    await writeSnapshot(this.#bucket, projectId, snapshot);

    const now = new Date().toISOString();
    // The `IS` operator is SQLite's NULL-safe equality: it handles
    // `expectedBaseRevision = NULL` (a brand-new project's first promotion)
    // the same single WHERE clause handles every other revision string.
    const update = await this.#db
      .prepare(
        `UPDATE generation_projects
         SET accepted_revision = ?1, updated_at = ?2
         WHERE id = ?3 AND accepted_revision IS ?4`,
      )
      .bind(snapshot.revision, now, projectId, expectedBaseRevision)
      .run();

    if (update.meta.changes !== 1) {
      return { promoted: false, current: await this.loadAccepted(projectId) };
    }

    await this.#db
      .prepare(
        `UPDATE generation_stages
         SET state = 'accepted', snapshot_revision = ?1, updated_at = ?2
         WHERE run_id = ?3`,
      )
      .bind(snapshot.revision, now, runId)
      .run();

    return { promoted: true, current: snapshot };
  }
}
