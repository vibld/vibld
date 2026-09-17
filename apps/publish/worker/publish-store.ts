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

/**
 * Where one revision's files live (0021_publish_generations.sql).
 *
 * The generation is in the key rather than the row alone, so writing a new
 * revision cannot touch the one that is serving. That is what lets the
 * decision about whether a publish is allowed happen after its bytes have
 * landed, which is the only place it can be made safely: the flag is in D1
 * and the content is in R2, and no write spans the two.
 */
function objectKey(slug: string, generation: string, path: string): string {
  return `published/${slug}/${generation}/${path}`;
}

/** Everything under one revision, for listing and deleting it. */
function generationPrefix(slug: string, generation: string): string {
  return `published/${slug}/${generation}/`;
}

/**
 * How many revisions a slug keeps.
 *
 * Three rather than one because a publish that replaced the last good one
 * with something broken used to leave nothing to go back to, and three
 * rather than everything because R2 is not free and nobody is reading the
 * eleventh.
 */
export const REVISIONS_KEPT = 3;

interface PublishedProjectRow {
  slug: string;
  project_id: string;
  user_id: string;
  /** ISO timestamp, or null for a site that is live. See 0016_unpublish.sql. */
  unpublished_at: string | null;
  /** ISO timestamp an operator held this site at, or null. 0018_operator_hold.sql. */
  held_at: string | null;
  /** The revision the public gets, or null before the first publish lands. 0021. */
  generation: string | null;
}

/**
 * Why a slug is not serving, for the owner's own lookup.
 *
 * `held` is not a variety of `down`: the owner can undo their own takedown
 * by publishing again, and must not be able to undo an operator's.
 */
export type PublishState = 'live' | 'down' | 'held';

/**
 * What a row means to whoever is asking about the site.
 *
 * One function because there were two copies of this and they drifted:
 * `0021_publish_generations.sql` gave a row a way to have no revision
 * behind it, and only the serving path was taught about it.
 */
function stateOf(
  row: Pick<PublishedProjectRow, 'unpublished_at' | 'held_at' | 'generation'>,
): PublishState {
  // A hold outranks a takedown: an owner who took their own site down and
  // was then held must be told the second thing, because it is the one
  // publishing again will not clear.
  if (row.held_at !== null) return 'held';
  // Nothing promoted is nothing serving. A slug is claimed before its first
  // files are written, and a first publish that failed, or lost the race to
  // a hold, leaves the claim with no revision behind it. Calling that live
  // sends the owner to an address that answers 404, and tells an operator
  // who has just released a hold that the site is back when it never was.
  if (row.generation === null) return 'down';
  return row.unpublished_at === null ? 'live' : 'down';
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
  ): Promise<
    | { slug: string; userId: string; live: boolean; state: PublishState }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT slug, user_id, unpublished_at, held_at, generation FROM published_projects WHERE project_id = ?1`,
      )
      .bind(projectId)
      .first<
        Pick<
          PublishedProjectRow,
          'slug' | 'user_id' | 'unpublished_at' | 'held_at' | 'generation'
        >
      >();
    if (!row) return undefined;
    const state = stateOf(row);
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
  async resolveSlug(slug: string): Promise<
    | {
        projectId: string;
        userId: string;
        /** The revision to read files from. */
        generation: string;
      }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT project_id, user_id, generation FROM published_projects
         WHERE slug = ?1 AND unpublished_at IS NULL AND held_at IS NULL
           AND generation IS NOT NULL`,
      )
      .bind(slug)
      .first<
        Pick<PublishedProjectRow, 'project_id' | 'user_id' | 'generation'>
      >();
    // `generation IS NOT NULL` is not belt and braces. A slug is claimed
    // before its first files are written, so between those two there is a
    // row with a name and nothing behind it; serving it would answer an
    // empty prefix rather than a 404.
    return row?.generation
      ? {
          projectId: row.project_id,
          userId: row.user_id,
          generation: row.generation,
        }
      : undefined;
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
   * Write a revision's files. Nothing serves them until `promote`.
   *
   * Each call writes its own prefix rather than overwriting the last one,
   * which is what makes a publish undoable right up to the moment it is
   * promoted, and what keeps a request that turns out not to be allowed
   * from having already destroyed the revision it was replacing.
   */
  async putFiles(
    slug: string,
    generation: string,
    files: ProjectFile[],
  ): Promise<void> {
    // Settled rather than raced to the first rejection. `Promise.all`
    // rejects as soon as one write fails while the others are still in
    // flight, and those that land afterwards are objects under a revision
    // that will never be promoted: not catalogued, so pruning does not see
    // them, and not pointed at, so a takedown does not either. Storage
    // nothing will ever come back for.
    const writes = await Promise.allSettled(
      files.map((file) =>
        this.#bucket.put(objectKey(slug, generation, file.path), file.content),
      ),
    );
    const failed = writes.find((write) => write.status === 'rejected');
    if (failed === undefined) return;

    // Clear up before reporting the failure, so the caller does not have to
    // know that a half-written revision is a thing that can exist. The
    // revision is this call's own and nothing points at it, so this cannot
    // touch what is serving.
    await this.discard(slug, generation);
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error('The files could not be written.');
  }

  /**
   * Make a revision the one the public gets, unless the site is held.
   *
   * This is where a publish becomes visible, and it is the whole of the
   * decision. `handlePublish` checks the state before writing anything, but
   * that check and this write are two round trips, and a hold arriving
   * between them used to find the files already overwritten. Here the
   * condition is part of the write, so a publish that lost that race
   * changes nothing a reader can see and its bytes are discarded.
   *
   * Clearing `unpublished_at` is what puts a taken-down site back:
   * publishing again under the name you still hold is the same act as
   * publishing it the first time, so it does not need its own verb.
   *
   * `held_at` is read and never written. An operator hold the owner could
   * lift by pressing Publish is not a hold (0018_operator_hold.sql).
   *
   * Returns false when the site is held, which is the only reason the row
   * can fail to match: the slug is never released, so it is always there.
   */
  async promote(
    slug: string,
    generation: string,
    at = new Date(),
  ): Promise<boolean> {
    const now = at.toISOString();
    // One batch, so a revision cannot serve without being catalogued.
    //
    // These were two writes, with a comment claiming the cost of a failure
    // between them was one wasted retention slot. That was wrong, and
    // wrong in the direction that matters: `unpublish` and pruning both
    // enumerate `published_generations`, so a live revision missing from it
    // is one a later takedown clears the pointer to and never deletes. The
    // owner asks for their work to be gone and its bytes stay in R2 for
    // ever, with nothing left that names them.
    //
    // The insert runs even when the update matches nothing, because a batch
    // cannot be conditional halfway through. That is the harmless
    // direction: it catalogues a revision that is not serving, which is
    // exactly what the caller's `discard` removes, and what pruning would
    // remove if the caller never got that far.
    const [moved] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET generation = ?1, unpublished_at = NULL, updated_at = ?2
           WHERE slug = ?3 AND held_at IS NULL`,
        )
        .bind(generation, now, slug),
      this.#db
        .prepare(
          `INSERT INTO published_generations (slug, generation, created_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(slug, generation) DO NOTHING`,
        )
        .bind(slug, generation, now),
    ]);
    if (moved?.meta.changes === 0) return false;

    await this.#prune(slug);
    return true;
  }

  /** The revisions under a slug, newest first (0021_publish_generations.sql). */
  async revisions(slug: string): Promise<string[]> {
    const rows = await this.#db
      .prepare(
        `SELECT generation FROM published_generations
         WHERE slug = ?1 ORDER BY id DESC`,
      )
      .bind(slug)
      .all<{ generation: string }>();
    return rows.results.map((row) => row.generation);
  }

  /**
   * Drop everything past the newest `REVISIONS_KEPT`.
   *
   * Runs after a promotion rather than on a schedule: the moment a revision
   * stops being interesting is the moment three newer ones exist, and doing
   * it here means no second thing to deploy and nothing to go wrong quietly
   * overnight.
   */
  async #prune(slug: string): Promise<void> {
    const stale = (await this.revisions(slug)).slice(REVISIONS_KEPT);
    for (const generation of stale) await this.discard(slug, generation);
  }

  /**
   * Remove one revision: its objects, then its row.
   *
   * That order, because a row without objects is a retention slot wasted
   * and a set of objects without a row is storage nothing will ever come
   * back for.
   *
   * Also what a refused publish calls to clean up after itself. The bytes
   * are the caller's own, written under a prefix nothing points at, so
   * deleting them cannot touch what a hold is keeping.
   */
  async discard(
    slug: string,
    generation: string,
    /**
     * Asked again between each listing and the deletion that follows it,
     * and a false answer stops the whole thing where it is.
     *
     * Listing is a round trip of its own, so without this the loop commits
     * to deleting a page it read before anything could change. `unpublish`
     * is what needs it: a hold arriving mid-deletion is a claim on exactly
     * the bytes being removed. Pruning and cleaning up after a refused
     * publish pass nothing, because there the revision is already nobody's.
     */
    stillWanted?: () => Promise<boolean>,
  ): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.#bucket.list({
        prefix: generationPrefix(slug, generation),
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (stillWanted && !(await stillWanted())) return;
      if (page.objects.length > 0) {
        await this.#bucket.delete(page.objects.map((object) => object.key));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);

    await this.#db
      .prepare(
        `DELETE FROM published_generations WHERE slug = ?1 AND generation = ?2`,
      )
      .bind(slug, generation)
      .run();
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
         SET unpublished_at = ?1, generation = NULL, updated_at = ?1
         WHERE slug = ?2 AND held_at IS NULL`,
      )
      .bind(stamp, slug)
      .run();
    if (marked.meta.changes === 0) return false;

    // Every revision, not just the one that was serving. A takedown is the
    // owner saying the work should not be here, and leaving two older
    // copies behind because retention happens to keep three would be
    // answering a different request. Retention is for getting back to a
    // revision of a site you still have; this is not that.
    //
    // The pointer is cleared in the same write as the tombstone, so there
    // is no moment where the row names a revision that is being deleted.
    for (const generation of await this.revisions(slug)) {
      if (!(await this.#stillDown(slug, stamp))) return true;
      await this.discard(slug, generation, () => this.#stillDown(slug, stamp));
    }
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
        // By insertion, not by the stamp. `at` is a wall clock, and what
        // this answers is "what happened, in what order" about two people
        // acting on the same site within seconds of each other. A clock
        // that steps, or two writes in the same millisecond, would reorder
        // the very sequence the record exists to settle. `0019` learned
        // this on the reconcile cursor; it is the same mistake here.
        `SELECT action, actor, reason, at FROM published_site_holds
         WHERE slug = ?1 ORDER BY id`,
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
  async release(
    slug: string,
    by: string,
    /**
     * The hold this release is answering, as the caller saw it.
     *
     * Named rather than assumed, because two admins can overlap: one reads
     * a hold and decides to lift it, a second re-holds the site on a newer
     * report, and an unconditional clear then lifts the newer hold and puts
     * the site back on the web. The second admin acted last and their hold
     * is the one that stands, so a release that was about the earlier one
     * has to find it gone and say so.
     */
    heldAt: string,
    at = new Date(),
  ): Promise<boolean> {
    const now = at.toISOString();
    // One batch, for the reason `hold` gives and more sharply: a release
    // that cleared the flag and then lost its record would put the site back
    // on the web with nobody recorded as having done it, and the retry would
    // be refused because it is no longer held.
    const [cleared] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET held_at = NULL, held_by = NULL, held_reason = NULL, updated_at = ?1
           WHERE slug = ?2 AND held_at = ?3`,
        )
        .bind(now, slug, heldAt),
      this.#recordStatement(slug, 'released', by, undefined, now),
    ]);
    // The record is written either way, which is the honest shape: somebody
    // did press release, and a history that only kept the presses that won
    // would hide exactly the overlap this guard exists for. `holdHistory`
    // reads in order, so a `released` between two `held` entries is a
    // release that lost, and the state alongside it says so.
    return cleared?.meta.changes !== 0;
  }

  /** What an operator needs to see about a slug before acting on it. */
  async siteBySlug(slug: string): Promise<
    | {
        slug: string;
        projectId: string;
        userId: string;
        state: PublishState;
        /** The timestamp a release has to name to be about this hold. */
        heldAt?: string;
        heldBy?: string;
        heldReason?: string;
      }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT slug, project_id, user_id, unpublished_at, held_at, held_by, held_reason, generation
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
    const state = stateOf(row);
    return {
      slug: row.slug,
      projectId: row.project_id,
      userId: row.user_id,
      state,
      ...(row.held_at === null ? {} : { heldAt: row.held_at }),
      ...(row.held_by === null ? {} : { heldBy: row.held_by }),
      ...(row.held_reason === null ? {} : { heldReason: row.held_reason }),
    };
  }

  async getFile(
    slug: string,
    generation: string,
    path: string,
  ): Promise<{ content: string } | undefined> {
    const object = await this.#bucket.get(objectKey(slug, generation, path));
    if (!object) return undefined;
    return { content: await object.text() };
  }
}
