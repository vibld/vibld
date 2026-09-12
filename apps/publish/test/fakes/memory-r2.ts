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
}
