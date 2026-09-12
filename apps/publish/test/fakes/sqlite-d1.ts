/**
 * A `PublishD1Database` backed by `node:sqlite`, for tests.
 *
 * Copied from apps/web/test/fakes/sqlite-d1.ts and retargeted at this
 * package's own narrow `PublishD1Database`/`PublishD1Statement` interfaces
 * (types.ts) rather than the ambient `D1Database`/`D1PreparedStatement`
 * globals `@cloudflare/workers-types` declares -- those are the much
 * larger real interfaces (`batch`, `exec`, `withSession`, `dump`, a `raw()`
 * statement method, extra `D1Meta` fields), which this fake does not need
 * to implement any more than `publish-store.ts` needs to call them.
 *
 * D1 *is* SQLite, so this exercises the real compare-and-set semantics
 * `publish-store.ts`'s `claimSlug` depends on (`ON CONFLICT`, `changes`
 * reflecting exactly the rows a write matched) rather than a hand-written
 * mock that would only prove the code calls `prepare`/`bind`/`run` in the
 * right order.
 *
 * Test-only. `node:sqlite` is stable enough to use without a flag, per
 * Node's own docs, but still prints an experimental-feature warning; that
 * warning is expected here and not a signal anything is wrong.
 */

import { DatabaseSync } from 'node:sqlite';
import type {
  PublishD1Database,
  PublishD1Result,
  PublishD1Statement,
} from '../../worker/types.ts';

class SqliteD1Statement implements PublishD1Statement {
  #db: DatabaseSync;
  #sql: string;
  #values: unknown[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...values: unknown[]): PublishD1Statement {
    const bound = new SqliteD1Statement(this.#db, this.#sql);
    bound.#values = values;
    return bound;
  }

  async run<T = Record<string, unknown>>(): Promise<PublishD1Result<T>> {
    const statement = this.#db.prepare(this.#sql);
    const result = statement.run(...(this.#values as never[]));
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.#db.prepare(this.#sql);
    const row = statement.get(...(this.#values as never[]));
    return (row as T | undefined) ?? null;
  }
}

export class SqliteD1Database implements PublishD1Database {
  #db: DatabaseSync;

  constructor(schemaSql: string) {
    this.#db = new DatabaseSync(':memory:');
    this.#db.exec(schemaSql);
  }

  prepare(query: string): PublishD1Statement {
    return new SqliteD1Statement(this.#db, query);
  }
}
