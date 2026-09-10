/** An `R2Bucket` backed by a `Map`, for tests. */
export class InMemoryR2Bucket implements R2Bucket {
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
