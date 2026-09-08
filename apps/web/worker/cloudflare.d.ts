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

declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
