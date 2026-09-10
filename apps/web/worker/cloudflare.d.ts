/**
 * The slice of the Workers runtime this Worker uses.
 *
 * Declared here rather than pulled in from `@cloudflare/workers-types` for the
 * same reason `ExecutionContext` is declared in `index.ts`: the app's tsconfig
 * is shared with the browser bundle, where the Workers globals would collide
 * with the DOM ones. Everything below is narrowed to what is actually called,
 * so an unused API cannot drift out of date without anyone noticing.
 */

interface SqlStorageCursor<T> {
  toArray(): T[];
}

interface SqlStorage {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlStorageCursor<T>;
}

interface DurableObjectStorage {
  readonly sql: SqlStorage;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  /** For one-time setup only. Per-request work here serialises the object. */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

/**
 * A stub calls the object's methods over RPC, so every result arrives as a
 * promise whether or not the method itself is async.
 */
type DurableObjectStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

interface DurableObjectNamespace<T> {
  /** Derives the object's id from the name. Nothing is provisioned. */
  getByName(name: string): DurableObjectStub<T>;
}

/** The `ratelimits` binding. Every call decrements by one; there is no weight. */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The `d1_databases` binding. `changes` is what makes the compare-and-set
 * promotion in `generation-store.ts` atomic: a conditional `UPDATE`'s `WHERE`
 * either matches and is counted here, or it does not and nothing is written
 * -- no read-then-write race between checking and setting the value.
 */
interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

/** The `r2_buckets` binding, narrowed to plain text get/put. */
interface R2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
}

declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
