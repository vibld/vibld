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

import { isRunStop, stopIsRecordable } from '@vibld/core';
import type {
  GenerationStageRecord,
  GenerationStore,
  ProjectSnapshot,
  PromotionResult,
  RunStepTrace,
  RunTrace,
} from '@vibld/core';

/**
 * The stage row a run's check is recorded under (D69): `<runId>:verify`,
 * beside the `:repair` and `:restore` rows its repair turn writes.
 */
export const CHECK_SUFFIX = ':verify';

export function checkRunId(runId: string): string {
  return `${runId}${CHECK_SUFFIX}`;
}

/** How a check ends: it builds, it does not, or nothing could say. */
export type CheckStageState = 'accepted' | 'failed' | 'idle';

/**
 * Where one revision of a project is stored. Exported for the one other
 * writer of this layout, duplicating a project (`project-store.ts`), which
 * puts the copy exactly where this store will look for it.
 */
export function snapshotKey(projectId: string, revision: string): string {
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

interface TraceRow {
  run_id: string;
  project_id: string;
  stop: string;
  model: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  context_window: number;
  cost_micro_usd: number;
  elapsed_ms: number;
  ended_at: string;
  /** NULL on a row written before `0037_run_trace_steps.sql`. */
  reasoning_tokens?: number | null;
  steps_json?: string | null;
}

/** A count that is a whole, non-negative number, or nothing. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/**
 * A row's steps, read back defensively: a column this build did not write
 * (an older one, or a hand edit) is read as no steps rather than trusted,
 * and a step without the shape is dropped.
 */
export function readSteps(
  json: string | null | undefined,
): RunStepTrace[] | undefined {
  if (!json) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const steps: RunStepTrace[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const step = item as Record<string, unknown>;
    const ms = count(step.ms);
    if (typeof step.name !== 'string' || ms === undefined) continue;
    const reasoningTokens = count(step.reasoningTokens);
    steps.push({
      name: step.name.slice(0, 64),
      ms,
      outputTokens: count(step.outputTokens) ?? 0,
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    });
  }
  return steps;
}

/**
 * The steps as the column stores them: compact JSON, in order, each step's
 * name, time and output, and its reasoning only where it was reported.
 * NULL for a run with none.
 */
export function writeSteps(
  steps: readonly RunStepTrace[] | undefined,
): string | null {
  if (!steps || steps.length === 0) return null;
  return JSON.stringify(
    steps.map((step) => ({
      name: step.name,
      ms: Math.max(0, Math.round(step.ms)),
      outputTokens: step.outputTokens,
      ...(step.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: step.reasoningTokens }),
    })),
  );
}

function toTrace(row: TraceRow): RunTrace {
  const steps = readSteps(row.steps_json);
  const reasoningTokens = count(row.reasoning_tokens);
  return {
    runId: row.run_id,
    projectId: row.project_id,
    // Read back through the guard rather than cast. A row written by an
    // older deployment, or by hand, can hold a value this build does not
    // know, and `provider-error` is the honest answer for a stop that cannot
    // be read: it says the run did not finish cleanly without inventing a
    // reason it did not have.
    stop: isRunStop(row.stop) ? row.stop : 'provider-error',
    model: row.model,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    contextWindow: row.context_window,
    costMicroUsd: row.cost_micro_usd,
    elapsedMs: row.elapsed_ms,
    endedAt: row.ended_at,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(steps && steps.length > 0 ? { steps } : {}),
  };
}

export class D1GenerationStore implements GenerationStore {
  #db: D1Database;
  #bucket: R2Bucket;

  constructor(db: D1Database, bucket: R2Bucket) {
    this.#db = db;
    this.#bucket = bucket;
  }

  /**
   * Record what became of one run (internal issue 167).
   *
   * Refuses to write a trace for a stop that did not describe a run, which
   * is the rule that keeps a refusal out of somebody's generation history.
   * Asked of the reason rather than remembered here, so the two places that
   * could disagree cannot.
   *
   * `ON CONFLICT DO NOTHING` keeps the first answer. A run ends once; a
   * second write for the same id is a retried step, and the later attempt
   * knows no more than the first did.
   */
  async saveTrace(trace: RunTrace): Promise<void> {
    if (!stopIsRecordable(trace.stop)) return;
    await this.#db
      .prepare(
        `INSERT INTO generation_run_traces
           (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
            output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at,
            reasoning_tokens, steps_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .bind(
        trace.runId,
        trace.projectId,
        trace.stop,
        trace.model,
        trace.inputTokens,
        trace.cachedInputTokens,
        trace.outputTokens,
        trace.contextWindow,
        trace.costMicroUsd,
        trace.elapsedMs,
        trace.endedAt,
        trace.reasoningTokens ?? null,
        writeSteps(trace.steps),
      )
      .run();
  }

  /**
   * This project's runs, newest first, so the builder can rehydrate them
   * after a reload rather than holding them in memory and losing them.
   */
  async tracesForProject(projectId: string, limit = 20): Promise<RunTrace[]> {
    const result = await this.#db
      .prepare(
        `SELECT run_id, project_id, stop, model, input_tokens,
                cached_input_tokens, output_tokens, context_window,
                cost_micro_usd, elapsed_ms, ended_at, reasoning_tokens,
                steps_json
           FROM generation_run_traces
          WHERE project_id = ?1
          ORDER BY ended_at DESC
          LIMIT ?2`,
      )
      .bind(projectId, limit)
      .all<TraceRow>();
    return (result.results ?? []).map(toTrace);
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

  /**
   * Record that a run has been created, before any step of it has run.
   *
   * A bounded build writes its first stage only once its model steps are
   * over, in `assemble`, so without this a run spends most of its life with
   * no row at all: invisible to `ProjectStore.runInFlight` and to a builder
   * reopening the project to ask whether it is still going
   * (docs/decisions.md, "Resolved 2026-09-29", keep building).
   *
   * `DO NOTHING` on a row that exists, so it can never put back a run that
   * has already moved past `planning`.
   */
  async openStage(record: {
    runId: string;
    projectId: string;
    baseRevision: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO generation_stages
           (run_id, project_id, base_revision, state, snapshot_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'planning', NULL, ?4, ?4)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .bind(record.runId, record.projectId, record.baseRevision, now)
      .run();
  }

  /**
   * Record that run `runId` has promoted `revision` and is now checking it
   * (D69): its own row, `runId:verify`, at `validating`, whose revision is
   * the one the builder is shown while the check runs.
   *
   * A row of its own rather than a new state on the run's row, because
   * that row is already `accepted`, which is true, and everything that asks
   * whether a run has ended (`ProjectStore.runInFlight`, `unendedRuns`,
   * `/api/runs/:id`) reads every row of a run and already counts one that
   * has not ended as the run still going. So a reopened project finds a
   * build that is still being checked, and a project is not deleted from
   * under a repair that is about to promote into it.
   *
   * `DO NOTHING` on a row that exists, so a replayed step never reopens a
   * check that has closed. The snapshot is already in R2, promoted, so
   * nothing is written there.
   */
  async openCheck(record: {
    runId: string;
    projectId: string;
    baseRevision: string | null;
    revision: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO generation_stages
           (run_id, project_id, base_revision, state, snapshot_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'validating', ?4, ?5, ?5)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .bind(
        checkRunId(record.runId),
        record.projectId,
        record.baseRevision,
        record.revision,
        now,
      )
      .run();
  }

  /**
   * End run `runId`'s check (D69) at what it found, `revision` being the
   * one the run ended at:
   *
   *   accepted   it was built and it builds
   *   failed     it was built and it does not
   *   idle       nothing could judge whether it builds
   *
   * Only a check still open is closed, so asking twice is asking once and
   * a check a Stop already ended is left as the Stop left it.
   */
  async closeCheck(
    runId: string,
    state: CheckStageState,
    revision: string | null,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE generation_stages
            SET state = ?2, snapshot_revision = COALESCE(?3, snapshot_revision),
                updated_at = ?4
          WHERE run_id = ?1
            AND state NOT IN ('accepted', 'failed', 'cancelled', 'idle')`,
      )
      .bind(checkRunId(runId), state, revision, new Date().toISOString())
      .run();
  }

  /** One revision of a project, whether or not it is the accepted one. */
  async loadRevision(
    projectId: string,
    revision: string,
  ): Promise<ProjectSnapshot | undefined> {
    return readSnapshot(this.#bucket, projectId, revision);
  }

  /**
   * End every stage of run `runId` that has not ended, as `state`: the
   * run's own row and the ones its repair turn writes under `runId:repair`
   * and `runId:restore`.
   *
   * Its check (`runId:verify`, D69) ends as `idle` whichever `state` says:
   * a check that was stopped or cut off found nothing about the project,
   * and `failed` there would read as "it does not build".
   *
   * For a run that stopped without writing its own end: one somebody
   * stopped (`cancelled`), or one the Workflow engine reports finished,
   * errored or terminated while its row still says `planning`. Left alone,
   * that row reads as a run in flight for `RUN_IN_FLIGHT_MS` and as
   * `planning` for ever after.
   *
   * A row that has ended is never touched, so this cannot overwrite an
   * accepted run, and asking twice is the same as asking once. Matched by
   * prefix without `LIKE`, so an id cannot carry a wildcard into it.
   */
  async settleRun(runId: string, state: 'failed' | 'cancelled'): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE generation_stages
            SET state = CASE WHEN run_id = ?1 || '${CHECK_SUFFIX}'
                             THEN 'idle' ELSE ?2 END,
                updated_at = ?3
          WHERE (run_id = ?1 OR substr(run_id, 1, length(?1) + 1) = ?1 || ':')
            AND state NOT IN ('accepted', 'failed', 'cancelled', 'idle')`,
      )
      .bind(runId, state, new Date().toISOString())
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
