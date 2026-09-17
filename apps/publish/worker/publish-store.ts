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
import type {
  PublishD1Database,
  PublishD1Statement,
  PublishR2Bucket,
} from './types.ts';

function objectKey(slug: string, path: string): string {
  return `published/${slug}/${path}`;
}

interface PublishedProjectRow {
  slug: string;
  project_id: string;
  user_id: string;
  /** ISO timestamp, or null for a site that is live. See 0016_unpublish.sql. */
  unpublished_at: string | null;
  /** ISO timestamp an operator held this site at, or null. 0018_operator_hold.sql. */
  held_at: string | null;
}

/**
 * Why a slug is not serving, for the owner's own lookup.
 *
 * `held` is not a variety of `down`: the owner can undo their own takedown
 * by publishing again, and must not be able to undo an operator's.
 */
export type PublishState = 'live' | 'down' | 'held';

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
  ): Promise<
    | { slug: string; userId: string; live: boolean; state: PublishState }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT slug, user_id, unpublished_at, held_at FROM published_projects WHERE project_id = ?1`,
      )
      .bind(projectId)
      .first<
        Pick<
          PublishedProjectRow,
          'slug' | 'user_id' | 'unpublished_at' | 'held_at'
        >
      >();
    if (!row) return undefined;
    // A hold outranks a takedown: an owner who took their own site down and
    // was then held must be told the second thing, because it is the one
    // publishing again will not clear.
    const state: PublishState =
      row.held_at !== null
        ? 'held'
        : row.unpublished_at === null
          ? 'live'
          : 'down';
    return {
      slug: row.slug,
      userId: row.user_id,
      live: state === 'live',
      state,
    };
  }

  /**
   * The project a public request's slug resolves to, if published.
   *
   * A tombstoned slug resolves to nothing, which is the whole of what
   * "taken down" means to the outside world. The row is still there,
   * holding the name (0016_unpublish.sql). A slug an operator has held is
   * refused on the same terms and for the same reason, by a column the
   * owner cannot clear (0018_operator_hold.sql).
   */
  async resolveSlug(
    slug: string,
  ): Promise<{ projectId: string; userId: string } | undefined> {
    const row = await this.#db
      .prepare(
        `SELECT project_id, user_id FROM published_projects
         WHERE slug = ?1 AND unpublished_at IS NULL AND held_at IS NULL`,
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
   *
   * `held_at` is deliberately untouched. An operator hold the owner could
   * lift by pressing Publish is not a hold, and `handlePublish` refuses
   * before reaching here while one is set (0018_operator_hold.sql).
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
   * Whether this slug is still marked down with exactly this stamp.
   *
   * The stamp is the guard against a republish that arrives mid-takedown:
   * clearing the tombstone sets it to NULL, and a second takedown writes a
   * different one, so either answers false and the deletion stops.
   */
  async #stillDown(slug: string, stamp: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT unpublished_at, held_at FROM published_projects WHERE slug = ?1`,
      )
      .bind(slug)
      .first<Pick<PublishedProjectRow, 'unpublished_at' | 'held_at'>>();
    // A hold arriving mid-paging stops the deletion where it is, for the
    // same reason it is refused at the start: the bytes are what the hold
    // keeps. The tombstone is left, so the site stays down, which is what
    // the owner asked for; a later release and republish is what puts it
    // back, and a repeat of this call clears whatever was left.
    return row?.unpublished_at === stamp && (row?.held_at ?? null) === null;
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
   *
   * **The stamp, and what it does not fix.** A republish from another tab
   * can land while this is deleting, clear the tombstone and write fresh
   * files, and an unguarded loop would then delete those. Re-reading the
   * stamp before each batch stops the loop as soon as that happens, so the
   * deletion cannot run on through a site that is live again. It does not
   * close the window: a republish that lands between the check and the
   * delete still loses the keys in that one batch. Closing it properly means
   * either a lock per slug or R2 prefixes scoped to a content generation,
   * and the second of those is the same mechanism rolling back to a previous
   * published checkpoint needs -- which ADR-0013 left waiting on a retention
   * decision. Narrowing it here is worth doing on its own; calling it fixed
   * would not be.
   */
  async unpublish(slug: string, at = new Date()): Promise<boolean> {
    const stamp = at.toISOString();
    /*
     * `AND held_at IS NULL` is the guard, not a repeat of one the caller
     * made. Reading the state and then deleting are two round trips, and a
     * hold placed between them would find the deletion already committed to
     * -- so the owner of a site somebody had just held could still empty it
     * by timing, which is the whole of what the refusal is for. Deciding in
     * the write is the only way to be sure, and it is the shape `claimSlug`
     * already settled on for the same reason.
     *
     * `changes` is 0 only when the row is held: the slug is never released
     * (below), so the row is there, and an already-unpublished site still
     * matches and still has its leftovers cleared.
     */
    const marked = await this.#db
      .prepare(
        `UPDATE published_projects
         SET unpublished_at = ?1, updated_at = ?1
         WHERE slug = ?2 AND held_at IS NULL`,
      )
      .bind(stamp, slug)
      .run();
    if (marked.meta.changes === 0) return false;

    // R2 pages with a cursor, so this loops. A site with more files than one
    // page holds would otherwise be half removed, and the half left behind
    // is content nothing points at and nobody thinks to look for.
    let cursor: string | undefined;
    do {
      const page = await this.#bucket.list({
        prefix: `published/${slug}/`,
        ...(cursor === undefined ? {} : { cursor }),
      });
      // Checked between the listing and the deletion rather than before
      // both. Listing is a round trip of its own, and a republish or a hold
      // arriving during it used to find this already committed to deleting
      // the page it had just read. Moving the check down leaves a window of
      // one delete call rather than a list and a delete.
      //
      // That last window cannot be closed from here: R2 and D1 are two
      // stores and there is no write that spans them. What closes it is
      // deleting nothing, which is what the retention work will do by
      // giving each publish its own prefix and expiring old ones instead.
      if (!(await this.#stillDown(slug, stamp))) return true;
      if (page.objects.length > 0) {
        await this.#bucket.delete(page.objects.map((object) => object.key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);
    return true;
  }

  /**
   * Take somebody else's site off the web (#172, 0018_operator_hold.sql).
   *
   * The flag only. The bytes stay, on purpose: the harm is the content being
   * reachable and this stops that the moment it is written, while deleting
   * is irreversible, destroys what was served before anybody has looked at
   * it, and makes a hold placed in haste on a wrong report impossible to
   * undo. An operator acting in minutes on somebody else's account should
   * not be making the irreversible call.
   *
   * Who and why are recorded because a takedown of work that is not yours is
   * the clearest case of the auditable action SECURITY.md asks for.
   *
   * Re-holding an already-held site overwrites the reason rather than
   * refusing. The second report is usually the better-documented one, and a
   * hold that cannot be annotated is a hold somebody works around by
   * releasing and re-holding, which is a window where the site serves.
   */
  async hold(
    slug: string,
    by: string,
    reason: string,
    at = new Date(),
  ): Promise<void> {
    const now = at.toISOString();
    // One batch, so the flag and the record of who set it cannot land apart.
    await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET held_at = ?1, held_by = ?2, held_reason = ?3, updated_at = ?1
           WHERE slug = ?4`,
        )
        .bind(now, by, reason, slug),
      this.#recordStatement(slug, 'held', by, reason, now),
    ]);
  }

  /**
   * The statement that appends what somebody did, where releasing cannot
   * erase it (0020_hold_history.sql).
   *
   * Returned rather than run, so the caller can put it in the same batch as
   * the state change it records. Two separate writes let the flag change
   * while the record is lost, which on the release path means a site going
   * live with nobody recorded as having lifted it and a retry refused
   * because it is no longer held.
   *
   * The columns above are the current state, which is what serving and the
   * republish refusal read. They are not a record, and the first cut of this
   * mistook one for the other: `release` nulled all three, so after the
   * ordinary hold-then-release there was no evidence the site had ever been
   * taken down, by whom or why. That contradicted the reason they were added.
   */
  #recordStatement(
    slug: string,
    action: 'held' | 'released',
    actor: string,
    reason: string | undefined,
    at: string,
  ): PublishD1Statement {
    return this.#db
      .prepare(
        `INSERT INTO published_site_holds (slug, action, actor, reason, at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(slug, action, actor, reason ?? null, at);
  }

  /** What has been done to this site, oldest first. */
  async holdHistory(slug: string): Promise<
    {
      action: 'held' | 'released';
      actor: string;
      reason?: string;
      at: string;
    }[]
  > {
    const result = await this.#db
      .prepare(
        `SELECT action, actor, reason, at FROM published_site_holds
         WHERE slug = ?1 ORDER BY at, id`,
      )
      .bind(slug)
      .all<{
        action: string;
        actor: string;
        reason: string | null;
        at: string;
      }>();
    return result.results.map((row) => ({
      action: row.action === 'released' ? 'released' : 'held',
      actor: row.actor,
      ...(row.reason === null ? {} : { reason: row.reason }),
      at: row.at,
    }));
  }

  /**
   * Lift a hold. Only an operator reaches this.
   *
   * It does not put the site back by itself, and that is deliberate rather
   * than an oversight: releasing a site the owner had also taken down must
   * leave it down. Clearing the hold returns the decision to whoever else
   * has a say in it, which for an owner takedown is the owner.
   *
   * `by` is required for the same reason `hold` takes one: lifting a hold is
   * as much an action somebody took as placing it, and the history is where
   * both are kept once the columns are cleared.
   */
  async release(slug: string, by: string, at = new Date()): Promise<void> {
    const now = at.toISOString();
    // One batch, for the reason `hold` gives and more sharply: a release
    // that cleared the flag and then lost its record would put the site back
    // on the web with nobody recorded as having done it, and the retry would
    // be refused because it is no longer held.
    await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET held_at = NULL, held_by = NULL, held_reason = NULL, updated_at = ?1
           WHERE slug = ?2`,
        )
        .bind(now, slug),
      this.#recordStatement(slug, 'released', by, undefined, now),
    ]);
  }

  /** What an operator needs to see about a slug before acting on it. */
  async siteBySlug(slug: string): Promise<
    | {
        slug: string;
        projectId: string;
        userId: string;
        state: PublishState;
        heldBy?: string;
        heldReason?: string;
      }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT slug, project_id, user_id, unpublished_at, held_at, held_by, held_reason
         FROM published_projects WHERE slug = ?1`,
      )
      .bind(slug)
      .first<
        PublishedProjectRow & {
          held_by: string | null;
          held_reason: string | null;
        }
      >();
    if (!row) return undefined;
    const state: PublishState =
      row.held_at !== null
        ? 'held'
        : row.unpublished_at === null
          ? 'live'
          : 'down';
    return {
      slug: row.slug,
      projectId: row.project_id,
      userId: row.user_id,
      state,
      ...(row.held_by === null ? {} : { heldBy: row.held_by }),
      ...(row.held_reason === null ? {} : { heldReason: row.held_reason }),
    };
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
