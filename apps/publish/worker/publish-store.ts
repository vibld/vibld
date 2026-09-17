/**
 * Publish metadata and content (ADR-0010): a slug -> project mapping in D1,
 * built file content in R2.
 *
 * Both live in the *same* `vibld-control-plane` D1 database and R2 bucket
 * apps/web already binds for billing and generation state (ADR-0005's "R2
 * behind storage contracts" already covers build artifacts) -- one more
 * control-plane table and one more R2 prefix, not a second database or
 * bucket for an operator to provision. wrangler.jsonc binds the identical
 * `database_id`/`bucket_name` apps/web uses; Cloudflare allows the same D1
 * database and R2 bucket to be bound into more than one Worker.
 *
 * A slug is claimed once, at a project's first publish, and never changes
 * after (ADR-0010's Consequences: "a slug is a durable, semi-public
 * identifier"). Every later publish of the same project reuses it and
 * simply overwrites the R2 objects at that slug's prefix.
 */

import type { ProjectFile } from '@vibld/core';
import type { PublishD1Database, PublishR2Bucket } from './types.ts';

function objectKey(slug: string, path: string): string {
  return `published/${slug}/${path}`;
}

interface PublishedProjectRow {
  slug: string;
  project_id: string;
  user_id: string;
  /** ISO timestamp, or null for a site that is live. See 0016_unpublish.sql. */
  unpublished_at: string | null;
}

export type ClaimResult =
  { claimed: true } | { claimed: false; reason: 'slug-taken' };

export class PublishStore {
  #db: PublishD1Database;
  #bucket: PublishR2Bucket;

  constructor(db: PublishD1Database, bucket: PublishR2Bucket) {
    this.#db = db;
    this.#bucket = bucket;
  }

  /**
   * The slug a project already published under, if any, and whether it is
   * still live.
   *
   * Deliberately finds a taken-down site too. The owner's next publish is
   * then a republish under the name they already have, rather than a fresh
   * claim on a name the tombstone is holding for them.
   */
  async slugForProject(
    projectId: string,
  ): Promise<{ slug: string; userId: string; live: boolean } | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT slug, user_id, unpublished_at FROM published_projects WHERE project_id = ?1`,
      )
      .bind(projectId)
      .first<
        Pick<PublishedProjectRow, 'slug' | 'user_id' | 'unpublished_at'>
      >();
    return row
      ? {
          slug: row.slug,
          userId: row.user_id,
          live: row.unpublished_at === null,
        }
      : undefined;
  }

  /**
   * The project a public request's slug resolves to, if published.
   *
   * A tombstoned slug resolves to nothing, which is the whole of what
   * "taken down" means to the outside world. The row is still there,
   * holding the name (0016_unpublish.sql).
   */
  async resolveSlug(
    slug: string,
  ): Promise<{ projectId: string; userId: string } | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT project_id, user_id FROM published_projects
         WHERE slug = ?1 AND unpublished_at IS NULL`,
      )
      .bind(slug)
      .first<Pick<PublishedProjectRow, 'project_id' | 'user_id'>>();
    return row ? { projectId: row.project_id, userId: row.user_id } : undefined;
  }

  /**
   * First publish only -- `handlePublish` calls this only when
   * `slugForProject` found nothing yet. `ON CONFLICT DO NOTHING` makes the
   * claim atomic against a second request racing to claim the same slug;
   * the follow-up read tells the two racers apart.
   */
  async claimSlug(
    slug: string,
    projectId: string,
    userId: string,
  ): Promise<ClaimResult> {
    const now = new Date().toISOString();
    await this.#db
      .prepare(
        `INSERT INTO published_projects (slug, project_id, user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(slug) DO NOTHING`,
      )
      .bind(slug, projectId, userId, now)
      .run();

    const row = await this.#db
      .prepare(`SELECT project_id FROM published_projects WHERE slug = ?1`)
      .bind(slug)
      .first<Pick<PublishedProjectRow, 'project_id'>>();
    if (row?.project_id !== projectId) {
      return { claimed: false, reason: 'slug-taken' };
    }
    return { claimed: true };
  }

  /**
   * Mark a republish. Clearing `unpublished_at` is what puts a taken-down
   * site back: publishing again under the name you still hold is the same
   * act as publishing it the first time, so it does not need its own verb.
   */
  async touch(slug: string): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE published_projects
         SET updated_at = ?1, unpublished_at = NULL
         WHERE slug = ?2`,
      )
      .bind(new Date().toISOString(), slug)
      .run();
  }

  /** Overwrites whatever this slug's prefix already held -- publishing is idempotent replace, not append. */
  async putFiles(slug: string, files: ProjectFile[]): Promise<void> {
    await Promise.all(
      files.map((file) =>
        this.#bucket.put(objectKey(slug, file.path), file.content),
      ),
    );
  }

  /**
   * Take a published site off the web (ADR-0013).
   *
   * The tombstone first, then the bytes. That order is the whole of the care
   * this needs: a failure in between leaves the site down, which is what was
   * asked for, and some objects still sitting in R2 under a prefix nothing
   * resolves to. A repeat of this call clears them. The other order fails
   * the other way -- content gone while the row still says live, so the site
   * reads as up and serves nothing, and nobody is told.
   *
   * The slug is not released. ADR-0010 makes it a durable, semi-public
   * identifier, and handing a name somebody has linked to over to the next
   * person who asks for it is a redirect nobody consented to. So the row
   * stays and is marked (0016_unpublish.sql): public serving refuses it, the
   * owner still holds it, and nobody else can claim it. Publishing again
   * under that name is what puts the site back.
   */
  async unpublish(slug: string, at = new Date()): Promise<void> {
    const now = at.toISOString();
    await this.#db
      .prepare(
        `UPDATE published_projects
         SET unpublished_at = ?1, updated_at = ?1
         WHERE slug = ?2`,
      )
      .bind(now, slug)
      .run();

    // R2 pages with a cursor, so this loops. A site with more files than one
    // page holds would otherwise be half removed, and the half left behind
    // is content nothing points at and nobody thinks to look for.
    let cursor: string | undefined;
    do {
      const page = await this.#bucket.list({
        prefix: `published/${slug}/`,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (page.objects.length > 0) {
        await this.#bucket.delete(page.objects.map((object) => object.key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
  }

  async getFile(
    slug: string,
    path: string,
  ): Promise<{ content: string } | undefined> {
    const object = await this.#bucket.get(objectKey(slug, path));
    if (!object) return undefined;
    return { content: await object.text() };
  }
}
