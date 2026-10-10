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
