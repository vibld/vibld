/**
 * `mcp_builds` (migration 0052): the builds an assistant started through
 * `/mcp`, for the daily cap `mcp-server.ts` holds them to (D182).
 *
 * A build takes its place in the count before it starts: `reserve` writes
 * a row under a placeholder id only while the account is under the cap, in
 * one statement, so two calls at once cannot both take the last place.
 * `confirm` then gives the row the build's own id, and `release` frees the
 * place when no build started.
 */
export class McpBuildStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Takes one of the account's places since `since` (ISO), under
   * `placeholder`. False when all `limit` are taken.
   */
  async reserve(entry: {
    placeholder: string;
    userId: string;
    clientId: string;
    since: string;
    startedAt: string;
    limit: number;
  }): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `INSERT INTO mcp_builds
           (run_id, user_id, client_id, project_id, started_at)
         SELECT ?1, ?2, ?3, '', ?5
          WHERE (SELECT COUNT(*) FROM mcp_builds
                  WHERE user_id = ?2 AND started_at >= ?4) < ?6`,
      )
      .bind(
        entry.placeholder,
        entry.userId,
        entry.clientId,
        entry.since,
        entry.startedAt,
        entry.limit,
      )
      .run();
    return result.meta.changes > 0;
  }

  /** The reserved place now names the build that took it. */
  async confirm(
    placeholder: string,
    runId: string,
    projectId: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE mcp_builds SET run_id = ?2, project_id = ?3
          WHERE run_id = ?1`,
      )
      .bind(placeholder, runId, projectId)
      .run();
  }

  /** No build started: the place is free again. */
  async release(placeholder: string): Promise<void> {
    await this.#db
      .prepare(`DELETE FROM mcp_builds WHERE run_id = ?1`)
      .bind(placeholder)
      .run();
  }
}

/**
 * `mcp_calls` (migration 0054): the editing tools' calls (D190), for the
 * per-plan daily cap `mcp-server.ts` holds them to (D201).
 *
 * The pattern `McpBuildStore.reserve` uses: a call is written only while
 * the account is under the cap, in one statement, so two calls at once
 * cannot both take the last place. A call is never given back: every
 * call the cap lets through has read or written something.
 *
 * Only the window is kept. The rows are what the cap counts, not a
 * record of what an assistant did (the history shows each edit), so each
 * take clears the account's rows that have left it, which bounds the
 * table by the cap, and `sweep` clears everybody's on a Cron Trigger, so
 * an account that stops calling is not kept past the window either (the
 * Privacy Policy says 24 hours; Codex review of internal PR 421).
 */
export class McpCallStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Takes one of the account's `limit` calls since `since` (ISO). False
   * when all are taken.
   */
  async take(entry: {
    id: string;
    userId: string;
    clientId: string;
    tool: string;
    projectId: string;
    since: string;
    calledAt: string;
    limit: number;
  }): Promise<boolean> {
    const [, taken] = await this.#db.batch([
      this.#db
        .prepare(`DELETE FROM mcp_calls WHERE user_id = ?1 AND called_at < ?2`)
        .bind(entry.userId, entry.since),
      this.#db
        .prepare(
          `INSERT INTO mcp_calls
             (id, user_id, client_id, tool, project_id, called_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?7
            WHERE (SELECT COUNT(*) FROM mcp_calls
                    WHERE user_id = ?2 AND called_at >= ?6) < ?8`,
        )
        .bind(
          entry.id,
          entry.userId,
          entry.clientId,
          entry.tool,
          entry.projectId,
          entry.since,
          entry.calledAt,
          entry.limit,
        ),
    ]);
    return (taken?.meta.changes ?? 0) > 0;
  }

  /** Clears every account's calls before `before` (ISO). How many went. */
  async sweep(before: string): Promise<number> {
    const result = await this.#db
      .prepare(`DELETE FROM mcp_calls WHERE called_at < ?1`)
      .bind(before)
      .run();
    return result.meta.changes ?? 0;
  }
}
