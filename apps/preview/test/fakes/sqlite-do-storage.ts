/**
 * A Durable Object `ctx` whose `storage.sql` is real SQLite, for tests.
 *
 * The same fake `apps/web/test/fakes/sqlite-do-storage.ts` gives the spend
 * ledger, copied rather than reached for across packages, because a test
 * here that imported another app's files would not be rerun when those
 * files changed.
 *
 * It is here for `PreviewFleet`, which decides how many containers this
 * deployment runs and until internal issue 197 had no test that ever ran it: every
 * assertion about it read its source. Durable Object storage *is* SQLite,
 * so this runs the real statements rather than asserting that some mock was
 * called. What it deliberately does not model is the input gate. Every
 * fleet method is synchronous precisely so that serialisation is the
 * runtime's problem and not the query's, so a single-threaded fake
 * exercises exactly the semantics the code relies on.
 *
 * `sql` is returned alongside the context so a test can count rows itself
 * rather than trusting the object under test to report its own totals.
 */

import { DatabaseSync } from 'node:sqlite';

class FakeSqlStorage {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  exec<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    const statement = this.#db.prepare(sql);
    // `exec` is used for both statements that return rows and statements
    // that do not, and node:sqlite throws if `all` is called on the latter.
    let rows: T[] = [];
    try {
      rows = statement.all(...(params as never[])) as T[];
    } catch {
      statement.run(...(params as never[]));
    }
    return {
      toArray: () => rows,
      [Symbol.iterator]: () => rows[Symbol.iterator](),
    };
  }
}

export interface FakeContext {
  ctx: DurableObjectState;
  sql: FakeSqlStorage;
}

export function fakeDurableObjectCtx(): FakeContext {
  const db = new DatabaseSync(':memory:');
  const sql = new FakeSqlStorage(db);
  const ctx = {
    storage: { sql },
    // The real one serialises callers around an await. Nothing under test
    // awaits, so running the callback straight through is faithful.
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) =>
      await callback(),
  } as unknown as DurableObjectState;
  return { ctx, sql };
}
