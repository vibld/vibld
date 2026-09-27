/**
 * A `RoadmapD1Database` backed by `node:sqlite`, for tests.
 *
 * Copied from apps/publish/test/fakes/sqlite-d1.ts and retargeted at this
 * app's narrow interfaces (worker/roadmap-store.ts). D1 is SQLite, so the
 * store's conditional writes, its upserts and its batches are exercised for
 * real, against the real migration, rather than by a mock that could only
 * prove `prepare` and `bind` were called in some order.
 *
 * One difference from that copy: `batch` returns each statement's rows, as
 * D1's does, because the store reads its answer from a SELECT at the end of
 * the same batch that wrote it.
 *
 * Test-only. `node:sqlite` may print an experimental-feature warning; that is
 * expected and not a sign anything is wrong.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  RoadmapD1Database,
  RoadmapD1Result,
  RoadmapD1Statement,
} from '../../worker/roadmap-store.ts';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');

/** Every migration in this app, in the order wrangler applies them. */
export function migrationsSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

class SqliteD1Statement implements RoadmapD1Statement {
  #db: DatabaseSync;
  #sql: string;
  #values: unknown[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...values: unknown[]): RoadmapD1Statement {
    const bound = new SqliteD1Statement(this.#db, this.#sql);
    bound.#values = values;
    return bound;
  }

  async run(): Promise<RoadmapD1Result<unknown>> {
    const result = this.#db
      .prepare(this.#sql)
      .run(...(this.#values as never[]));
    return { results: [], meta: { changes: Number(result.changes) } };
  }

  async all<T = Record<string, unknown>>(): Promise<RoadmapD1Result<T>> {
    return this.allNow<T>();
  }

  /** Synchronous, so a batch cannot be interleaved with another; see below. */
  allNow<T>(): RoadmapD1Result<T> {
    const rows = this.#db.prepare(this.#sql).all(...(this.#values as never[]));
    return { results: rows.map((row) => ({ ...row })) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.#db.prepare(this.#sql).get(...(this.#values as never[]));
    return row === undefined ? null : ({ ...row } as T);
  }
}

export class SqliteD1Database implements RoadmapD1Database {
  #db: DatabaseSync;

  constructor(schemaSql: string = migrationsSql()) {
    this.#db = new DatabaseSync(':memory:');
    this.#db.exec(schemaSql);
  }

  prepare(query: string): RoadmapD1Statement {
    return new SqliteD1Statement(this.#db, query);
  }

  /**
   * All of them or none, which is what D1 gives a batch, and one batch at a
   * time, which is also what D1 gives: its writes are serialised. Run without
   * an `await` inside, so two batches started together cannot interleave
   * their statements the way two real ones never do.
   */
  async batch<T = Record<string, unknown>>(
    statements: RoadmapD1Statement[],
  ): Promise<RoadmapD1Result<T>[]> {
    this.#db.exec('BEGIN');
    try {
      const results: RoadmapD1Result<T>[] = [];
      for (const statement of statements) {
        results.push((statement as SqliteD1Statement).allNow<T>());
      }
      this.#db.exec('COMMIT');
      return results;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** For assertions only: a query the store itself never makes. */
  rows<T>(sql: string, ...values: unknown[]): T[] {
    return this.#db
      .prepare(sql)
      .all(...(values as never[]))
      .map((row) => ({ ...row })) as T[];
  }
}
