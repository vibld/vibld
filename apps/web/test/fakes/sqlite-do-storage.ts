/**
 * A Durable Object `ctx` whose `storage.sql` is real SQLite, for tests.
 *
 * `UserBudget` is the spend ledger, and until now nothing exercised it: it
 * is a Durable Object, so testing it meant a Workers runtime. That left the
 * one class in this codebase that decides what a caller is charged as the
 * one class with no tests, which is the wrong way round.
 *
 * The same reasoning as `sqlite-d1.ts`: Durable Object storage *is* SQLite,
 * so this runs the real statements rather than asserting that some mock was
 * called. What it deliberately does not model is the input gate. Every
 * method under test here is synchronous precisely so that serialisation is
 * the runtime's problem and not the query's, so a single-threaded fake
 * exercises exactly the semantics the code relies on.
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

export function fakeDurableObjectCtx(): DurableObjectState {
  const db = new DatabaseSync(':memory:');
  return {
    storage: { sql: new FakeSqlStorage(db) },
    // The real one serialises callers around an await. Nothing under test
    // awaits, so running the callback straight through is faithful.
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) =>
      await callback(),
  } as unknown as DurableObjectState;
}
