/** An `R2Bucket` backed by a `Map`, for tests. */
export class InMemoryR2Bucket implements R2Bucket {
  #objects = new Map<
    string,
    { value: string | Uint8Array; contentType?: string }
  >();

  async get(key: string): Promise<{
    size: number;
    body: ReadableStream<Uint8Array>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return null;
    const { value } = stored;
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return {
      size: bytes.byteLength,
      body: new Blob([bytes.slice()]).stream(),
      text: async () =>
        typeof value === 'string' ? value : new TextDecoder().decode(value),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async head(key: string): Promise<{ size: number } | null> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return null;
    const { value } = stored;
    return {
      size:
        typeof value === 'string'
          ? new TextEncoder().encode(value).byteLength
          : value.byteLength,
    };
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    const stored =
      typeof value === 'string'
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(
              value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
              ),
            );
    this.#objects.set(key, {
      value: stored,
      ...(options?.httpMetadata?.contentType
        ? { contentType: options.httpMetadata.contentType }
        : {}),
    });
    return undefined;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.#objects.delete(key);
    }
  }

  /** Keys under a prefix in key order, a page at a time, as R2 lists them. */
  async list(options: { prefix: string; limit?: number }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
  }> {
    const limit = options.limit ?? 1000;
    const keys = [...this.#objects.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort();
    return {
      objects: keys.slice(0, limit).map((key) => ({ key })),
      truncated: keys.length > limit,
    };
  }

  /** What is stored under `key`, as bytes, for assertions. */
  bytes(key: string): Uint8Array | undefined {
    const stored = this.#objects.get(key);
    if (stored === undefined) return undefined;
    return typeof stored.value === 'string'
      ? new TextEncoder().encode(stored.value)
      : stored.value;
  }

  /** The content type an object was stored with, for assertions. */
  contentTypeOf(key: string): string | undefined {
    return this.#objects.get(key)?.contentType;
  }

  /** Every key, for assertions about what was left behind. */
  keys(): string[] {
    return [...this.#objects.keys()];
  }
}
