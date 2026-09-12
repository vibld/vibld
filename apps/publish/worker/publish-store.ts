/**
 * Publish metadata and content (ADR-0010): a slug -> project mapping in D1,
 * built file content in R2.
 *
 * Both live in the *same* `vibld-control-plane` D1 database and R2 bucket
 * apps/web already binds for billing and generation state (ADR-0005's "R2
 * behind storage contracts" already covers build artifacts) -- one more
 * control-plane table and one more R2 prefix, not a second database or
 * bucket for Chris to provision. wrangler.jsonc binds the identical
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

  /** The slug a project already published under, if any. */
  async slugForProject(
    projectId: string,
  ): Promise<{ slug: string; userId: string } | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT slug, user_id FROM published_projects WHERE project_id = ?1`,
      )
      .bind(projectId)
      .first<Pick<PublishedProjectRow, 'slug' | 'user_id'>>();
    return row ? { slug: row.slug, userId: row.user_id } : undefined;
  }

  /** The project a public request's slug resolves to, if published. */
  async resolveSlug(
    slug: string,
  ): Promise<{ projectId: string; userId: string } | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT project_id, user_id FROM published_projects WHERE slug = ?1`,
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

  async touch(slug: string): Promise<void> {
    await this.#db
      .prepare(`UPDATE published_projects SET updated_at = ?1 WHERE slug = ?2`)
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

  async getFile(
    slug: string,
    path: string,
  ): Promise<{ content: string } | undefined> {
    const object = await this.#bucket.get(objectKey(slug, path));
    if (!object) return undefined;
    return { content: await object.text() };
  }
}
