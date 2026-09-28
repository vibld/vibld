/**
 * Deleting everything under an R2 prefix, a bounded number of pages at a
 * time.
 *
 * Written for the account purge (`account-deletion.ts`) and moved here when
 * deleting one project needed exactly the same thing: a project's code and
 * its conversation all live under `projects/{id}/`, so removing a project is
 * removing that prefix, and one copy of how to do that safely is better
 * than two that could come to differ about what "safely" means.
 */

/** The slice of an R2 binding a purge needs: list a prefix, delete keys. */
export interface PurgeBucket {
  list(options: { prefix: string; limit?: number }): Promise<{
    objects: { key: string }[];
    truncated: boolean;
  }>;
  delete(keys: string | string[]): Promise<void>;
}

/** R2 list pages one prefix may take in one call, at up to 1000 keys each. */
export const R2_PAGES_PER_STEP = 2;

/**
 * Delete everything under a prefix, a bounded number of pages at a time.
 *
 * Listed from the start every page rather than by cursor, because what the
 * last page listed has just been deleted and the start is where the rest
 * now begins. True once nothing is left.
 */
export async function deletePrefix(
  bucket: PurgeBucket,
  prefix: string,
  pages: number = R2_PAGES_PER_STEP,
): Promise<boolean> {
  for (let page = 0; page < pages; page += 1) {
    const listed = await bucket.list({ prefix, limit: 1000 });
    const keys = listed.objects
      .map((object) => object.key)
      // Belt and braces: a prefix listing returns only keys under it, and
      // a delete that ever reached past it would be deleting somebody else.
      .filter((key) => key.startsWith(prefix));
    if (keys.length > 0) await bucket.delete(keys);
    if (!listed.truncated) return true;
  }
  return false;
}

/**
 * An id that is safe to build a storage prefix from. Clerk's user ids are
 * `user_` and base62, and a project's is a UUID or, for the one project an
 * account had before there were several, that same user id. Anything with
 * a slash in it could name another prefix, and an empty one would name
 * everybody's.
 */
export function assertPrefixSafe(id: string): void {
  if (id.length === 0 || /[/\\]/.test(id)) {
    throw new Error('refusing to build a storage prefix from this id');
  }
}
