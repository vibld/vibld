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
}

export interface PublishD1Database {
  prepare(query: string): PublishD1Statement;
}

export interface PublishR2Bucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string): Promise<unknown>;
}
