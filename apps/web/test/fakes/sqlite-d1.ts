/**
 * A `D1Database` backed by `node:sqlite`, for tests.
 *
 * D1 *is* SQLite, so this exercises the real compare-and-set semantics
 * `generation-store.ts` depends on -- the `IS` operator, `ON CONFLICT`, and
 * `changes` reflecting exactly the rows a conditional `UPDATE` matched --
 * rather than a hand-written mock that would only prove the code calls
 * `prepare`/`bind`/`run` in the right order.
 *
 * Test-only. `node:sqlite` is stable enough to use without a flag, per
 * Node's own docs, but still prints an experimental-feature warning; that
 * warning is expected here and not a signal anything is wrong.
 */

import { DatabaseSync } from 'node:sqlite';

class SqliteD1Statement implements D1PreparedStatement {
  #db: DatabaseSync;
  #sql: string;
  #values: unknown[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    const bound = new SqliteD1Statement(this.#db, this.#sql);
    bound.#values = values;
    return bound;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.#db.prepare(this.#sql);
    // D1 gives a RETURNING statement's rows from run() too, which a batch
    // is the only way to read.
    if (/\bRETURNING\b/i.test(this.#sql)) {
      const rows = statement.all(...(this.#values as never[]));
      return {
        results: rows as T[],
        success: true,
        meta: { changes: rows.length, last_row_id: 0 },
      };
    }
    const result = statement.run(...(this.#values as never[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.#db.prepare(this.#sql);
    const row = statement.get(...(this.#values as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.#db.prepare(this.#sql);
    const rows = statement.all(...(this.#values as never[]));
    return {
      results: rows as T[],
      success: true,
      meta: { changes: 0, last_row_id: 0 },
    };
  }
}

export class SqliteD1Database implements D1Database {
  #db: DatabaseSync;

  constructor(schemaSql: string) {
    this.#db = new DatabaseSync(':memory:');
    this.#db.exec(schemaSql);
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.#db, query);
  }

  /**
   * All of them or none, which is what D1 gives a batch.
   *
   * A transaction rather than a loop that stops early, for the reason
   * apps/publish's copy of this fake gives: one that committed the
   * statements it got through before a failure would let a test pass
   * against the half-written state a batch is used to prevent.
   */
  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.#db.exec('BEGIN');
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.#db.exec('COMMIT');
      return results;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Run a script of several statements, the way `wrangler d1 migrations
   * apply` runs a migration file. For a test that has to put rows in place
   * between two migrations, which is the only way to test a backfill.
   */
  exec(script: string): void {
    this.#db.exec(script);
  }
}
