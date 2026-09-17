/**
 * A minimal, hand-narrowed slice of the D1/R2 bindings this package
 * actually calls -- named distinctly (`Publish`-prefixed) rather than
 * reusing the ambient `D1Database`/`R2Bucket` globals
 * `@cloudflare/workers-types` already declares, so this narrower shape can
 * coexist with those without a conflicting redeclaration.
 *
 * Same idea as apps/web's own `cloudflare.d.ts` narrowing, minus the naming
 * collision that approach would create here: apps/web has no reason to
 * import the real Workers types at all (its tsconfig shares a DOM lib with
 * the browser bundle), so it is free to reuse the real names for its own
 * narrow versions. This package already needs `@cloudflare/workers-types`
 * for `Request`/`Response`/`Headers`/`URL` (apps/preview's own reason), so
 * it can't also redeclare `D1Database`/`R2Bucket` under those names without
 * fighting the real ones -- these narrower, distinctly-named interfaces are
 * what `publish-store.ts` and `index.ts` actually type against instead. The
 * real bindings structurally satisfy them; so do the test fakes.
 */

export interface PublishD1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number };
}

export interface PublishD1Statement {
  bind(...values: unknown[]): PublishD1Statement;
  run<T = Record<string, unknown>>(): Promise<PublishD1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  /**
   * Every row, for a read that expects more than one.
   *
   * Declared separately from `run` rather than leaning on its `results`.
   * `run` is the write path here and the test fake answers it with an empty
   * list, which is the honest shape: a statement that changed rows has no
   * rows to give back. Reading a list through it would have returned nothing
   * and said nothing, which is how a history that was never read looks
   * exactly like a history that is empty.
   */
  all<T = Record<string, unknown>>(): Promise<PublishD1Result<T>>;
}

export interface PublishD1Database {
  prepare(query: string): PublishD1Statement;
  /**
   * Several statements, or none of them.
   *
   * D1 runs a batch inside one implicit transaction, which is the only way
   * this Worker can make two writes land together. It is needed where a
   * control flag and the record of who changed it are two rows: writing them
   * separately lets the flag change while the record is lost, and for the
   * release path that means a site going live with no releasing actor
   * recorded and a retry refused because it is no longer held.
   */
  batch<T = Record<string, unknown>>(
    statements: PublishD1Statement[],
  ): Promise<PublishD1Result<T>[]>;
}

/**
 * `delete` and `list` are here for taking a published site down (ADR-0013's
 * rollback rule). They are the narrowest shape of R2's own: `delete` takes
 * one key or a batch, and `list` pages with a cursor, which is why
 * `unpublish` loops rather than assuming one call sees every object.
 */
export interface PublishR2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}
