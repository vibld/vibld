import type { PublishR2Bucket } from '../../worker/types.ts';

/** A `PublishR2Bucket` backed by a `Map`, for tests. Copied from apps/web/test/fakes/memory-r2.ts, retargeted at this package's own narrow R2 interface (types.ts) -- see sqlite-d1.ts's module comment for why. */
export class InMemoryR2Bucket implements PublishR2Bucket {
  #objects = new Map<string, string>();

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    const value = this.#objects.get(key);
    if (value === undefined) return null;
    return { text: async () => value };
  }

  async put(key: string, value: string): Promise<unknown> {
    this.#objects.set(key, value);
    return undefined;
  }

  async delete(keys: string | string[]): Promise<unknown> {
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      this.#objects.delete(key);
    }
    return undefined;
  }

  /**
   * Pages like R2 does, including the small default, so a caller that
   * forgets the cursor is caught here rather than on the first published
   * site big enough to need a second page.
   */
  async list(
    options: {
      prefix?: string;
      cursor?: string;
      limit?: number;
      startAfter?: string;
    } = {},
  ): Promise<{
    objects: { key: string }[];
    truncated: boolean;
    cursor?: string;
  }> {
    const { prefix = '', cursor, limit = 2, startAfter } = options;
    const keys = [...this.#objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .filter((key) => startAfter === undefined || key > startAfter)
      .sort();
    const from = cursor ? keys.indexOf(cursor) : 0;
    const page = keys.slice(from, from + limit);
    const next = keys[from + limit];
    return next === undefined
      ? { objects: page.map((key) => ({ key })), truncated: false }
      : {
          objects: page.map((key) => ({ key })),
          truncated: true,
          cursor: next,
        };
  }

  /** What is actually stored, for a test that wants to see nothing left. */
  keys(): string[] {
    return [...this.#objects.keys()].sort();
  }
}
