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
  /** Identifies one hold, so a release can name the one it answers. 0022. */
  hold_token: string | null;
  /** Set while a takedown is removing this site's bytes. 0022. */
  deleting_at: string | null;
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
    // Catalogued before a single byte is written, so nothing can ever exist
    // in R2 that this database cannot name. `promote` used to be where a
    // revision first became enumerable, which left a window with no way
    // out: `putFiles` succeeds, `promote` throws, its batch rolls back, and
    // the objects sit under a prefix no pruning and no takedown can reach,
    // for ever, with every retry adding another.
    //
    // The cost is that the catalogue also lists revisions that never went
    // live. That is the right way round: a dead revision listed is one
    // pruning will collect, and a live revision unlisted is a leak.
    await this.#db
      .prepare(
        `INSERT INTO published_generations (slug, generation, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(slug, generation) DO NOTHING`,
      )
      .bind(slug, generation, new Date().toISOString())
      .run();
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
   * Returns false when the site is held, or when a takedown is part way
   * through removing this slug's bytes. Those are the only two reasons the
   * row can fail to match: the slug is never released, so it is always
   * there.
   *
   * The second condition is what stops a publish and a takedown both
   * reporting success over a site that then serves nothing. Cataloguing a
   * revision before writing it, which is what keeps bytes from leaking,
   * also makes it visible to the takedown's own enumeration: the takedown
   * can delete a revision whose upload has just finished, and without this
   * the promotion that followed would point the site at a prefix that is
   * no longer there. Both calls would answer success and every request
   * would 404.
   *
   * `deleting_at` is the takedown's claim, so reading it here is the same
   * compare-and-set the rest of this file settled on: whoever wrote first
   * wins, and the loser is told. A republish after the deletion finishes
   * sees it cleared and works, which is what putting a site back means.
   *
   * And the revision has to still be catalogued and unclaimed. That is the
   * general form of the same rule, and it is why this no longer inserts the
   * catalogue row: creating it here would resurrect a revision whose bytes
   * somebody has already collected.
   *
   * Catalogued alone was not enough, and the reason is worth keeping. The
   * claim has to be retracted before the act it guards, and `discard`
   * deleted the row after the objects, so for the length of a deletion the
   * row still said the bytes were there. `collecting_at` is written first
   * (0025_generation_collecting.sql) and the row stays, which is also what
   * keeps an interrupted deletion's objects nameable. `putFiles` registers
   * a revision; everything that collects one marks it before touching a
   * byte; so promotion asking whether the row is there and unmarked is
   * asking whether the bytes are still there.
   *
   * Without it, a slow upload overtaken by three quicker publishes gets
   * pruned as stale and then promoted anyway, and the site serves 404s
   * while both requests report success. A takedown could do the same. One
   * condition covers every collector, present and future, which is worth
   * more than a list of the ones that exist today.
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
           SET generation = ?1, unpublished_at = NULL, updated_at = ?2,
               deleting_at = NULL
           WHERE slug = ?3 AND held_at IS NULL AND deleting_at IS NULL
             AND EXISTS (
               SELECT 1 FROM published_generations
               WHERE slug = ?3 AND generation = ?1
                 AND collecting_at IS NULL
             )`,
        )
        .bind(generation, now, slug),
    ]);
    if (moved?.meta.changes === 0) return false;

    // Retention runs after the promotion has committed, so it must not be
    // able to fail it. A throw here used to answer the publish with a 500
    // while the new revision was live, and the obvious retry then made
    // another generation: a publish reported as failed, twice, that had
    // worked both times. What is left behind is storage, which the next
    // promotion prunes.
    try {
      await this.#prune(slug);
    } catch (error) {
      console.error('publish: could not prune old revisions', slug, error);
    }
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
    // The live one is never stale, whatever its age.
    //
    // It usually is the newest, so this looks redundant, and it is not:
    // the catalogue now lists revisions that never went live, so a slug
    // that fails to publish several times running can push the revision
    // actually serving past the keep count. Pruning by age alone would
    // then delete the site out from under itself.
    const live = await this.#db
      .prepare(`SELECT generation FROM published_projects WHERE slug = ?1`)
      .bind(slug)
      .first<Pick<PublishedProjectRow, 'generation'>>();
    // Slice first, so the keep count still means the newest three. Then
    // take the live one out of whatever that leaves, which normally removes
    // nothing because the live one is the newest.
    const stale = (await this.revisions(slug))
      .slice(REVISIONS_KEPT)
      .filter((generation) => generation !== live?.generation);
    for (const generation of stale) await this.discard(slug, generation);
  }

  /**
   * Remove one revision: claim it, then its objects, then its row.
   *
   * The claim is the whole of it. This used to delete the objects and then
   * the row, on the ground that a row without objects wastes a retention
   * slot while objects without a row are storage nothing can ever name
   * again. Both true, and it left the catalogue row, which is what
   * `promote` reads to decide whether the bytes are still there, present
   * for the entire deletion. A slow upload selected as stale could have its
   * objects removed and then promote successfully against the row the
   * deletion had not reached, pointing the site at an emptied prefix with
   * both requests reporting success.
   *
   * Writing `collecting_at` first retracts the claim before anything acts
   * on it, and keeps the row, so an interrupted deletion still names its
   * objects for the next prune or takedown to finish. Enumeration does not
   * skip a marked revision for exactly that reason: resuming is what should
   * happen to one. Only promotion refuses them.
   *
   * The claim also refuses to collect the revision that is serving, which
   * is the other half of the same race: promotion committing first has to
   * beat a collection that is about to start, not only the reverse. The
   * callers that pass an already-stale revision (`#prune` filters the live
   * one out, `unpublish` has already cleared the pointer, a refused publish
   * never had it) are unaffected; the condition is what makes that a
   * property of the write rather than of the caller getting it right.
   *
   * Returns having done nothing when the claim is refused.
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
    // Claimed before a byte goes (0025_generation_collecting.sql). Refused
    // when this revision is the one serving, so a promotion that committed
    // first is not collected out from under itself.
    //
    // Re-marking an already-marked revision is a resume, and has to stay
    // one: a deletion interrupted halfway leaves the row marked, and the
    // next prune or takedown finishing it is the thing that stops those
    // objects leaking.
    const [claimed] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_generations SET collecting_at = ?3
           WHERE slug = ?1 AND generation = ?2
             AND NOT EXISTS (
               SELECT 1 FROM published_projects
               WHERE slug = ?1 AND generation = ?2
             )`,
        )
        .bind(slug, generation, new Date().toISOString()),
    ]);
    if (claimed?.meta.changes === 0) {
      // Two different refusals wear the same zero, and only one of them
      // means stop.
      //
      // A row that is there is the live revision, and collecting what is
      // serving is the thing the condition exists to refuse.
      //
      // No row at all is the opposite: nothing can promote it and nothing
      // else will ever come back for it, so its objects are orphans and
      // collecting them is the whole point. Treating that as a refusal is
      // what gating the deletion on the claim got wrong. `handlePublish`
      // cleans up after a refused publish by calling this, and a takedown
      // that removed the row first left that cleanup a no-op, so an object
      // from the upload still in flight stayed in R2 with nothing naming
      // it. The gate was meant to stop a deletion racing a promotion, not
      // to stop a sweep.
      const row = await this.#db
        .prepare(
          `SELECT 1 FROM published_generations
           WHERE slug = ?1 AND generation = ?2`,
        )
        .bind(slug, generation)
        .first<{ 1: number }>();
      if (row !== null) return;
    }

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
      .prepare(`SELECT deleting_at FROM published_projects WHERE slug = ?1`)
      .bind(slug)
      .first<Pick<PublishedProjectRow, 'deleting_at'>>();
    // The claim, not the absence of a hold.
    //
    // Reading `held_at` here was a check in D1 followed by a delete in R2,
    // which is not an order: a hold landing between the two was ignored and
    // its bytes went anyway. What decides it now is the conditional UPDATE
    // in `unpublish`, which refuses while a hold is set and, when it does
    // take the site down, stamps `deleting_at` in the same write. So this
    // asks only whether the claim it made is still the one standing.
    //
    // A republish clears the stamp, which is what stops a takedown deleting
    // files somebody has just put back.
    return row?.deleting_at === stamp;
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
         SET unpublished_at = ?1, generation = NULL, updated_at = ?1,
             deleting_at = ?1
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

    // The claim is released once there is nothing left to delete. Only this
    // run's own claim, so a republish that took the site back and started
    // its own life is not disturbed by a late finisher.
    await this.#db
      .prepare(
        `UPDATE published_projects SET deleting_at = NULL
         WHERE slug = ?1 AND deleting_at = ?2`,
      )
      .bind(slug, stamp)
      .run();
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
  ): Promise<string> {
    const now = at.toISOString();
    // A token per hold, because a timestamp is not an identity. `release`
    // names the hold it is answering so that a second admin re-holding the
    // site keeps theirs, and two holds in the same millisecond share a
    // `held_at`: `Date` has millisecond resolution and two people acting on
    // the same report is exactly when that happens.
    const token = crypto.randomUUID();
    // One batch, so the flag and the record of who set it cannot land apart.
    await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET held_at = ?1, held_by = ?2, held_reason = ?3, updated_at = ?1,
               hold_token = ?5
           WHERE slug = ?4`,
        )
        .bind(now, by, reason, slug, token),
      this.#recordStatement(slug, 'held', by, reason, now),
    ]);
    return token;
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
     *
     * The token rather than `held_at`, which was the first cut: two holds
     * in the same millisecond share a timestamp, so comparing on it let
     * exactly the overlap this guards against through.
     */
    holdToken: string,
    at = new Date(),
  ): Promise<boolean> {
    const now = at.toISOString();
    // A receipt for this attempt, which only the UPDATE below can write
    // (0024_release_receipt.sql). The record's condition reads it rather
    // than inspecting the site's state, because the question is whether
    // *this* write cleared the hold and every state-based answer to that
    // has been wrong: a timestamp collides, and an unheld site can be the
    // work of somebody else's release entirely.
    const receipt = crypto.randomUUID();
    // One batch, for the reason `hold` gives and more sharply: a release
    // that cleared the flag and then lost its record would put the site back
    // on the web with nobody recorded as having done it, and the retry would
    // be refused because it is no longer held.
    const [cleared] = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE published_projects
           SET held_at = NULL, held_by = NULL, held_reason = NULL,
               hold_token = NULL, updated_at = ?1, last_release_token = ?4
           WHERE slug = ?2 AND hold_token = ?3`,
        )
        .bind(now, slug, holdToken, receipt),
      // Only when the clear above actually happened.
      //
      // Three earlier conditions, each wrong, and all in the same way.
      //
      // Unconditional first, on the grounds that somebody did press
      // release. That wrote `held, held, released` with the newer hold
      // still standing, which an audit reads as the site having been let
      // back on the web. An entry that cannot be told from a real one is
      // worse than a missing entry, because it is believed.
      //
      // Then the row's state plus this write's timestamp, which is the
      // mistake `hold_token` had just been added to fix: two releases of
      // one hold in a millisecond both matched.
      //
      // Then the hold's own token, which fixed that pair and still read the
      // wrong answer from a longer interleaving: a release of X overtaken
      // by a hold Y that is itself released arrives to find the site unheld
      // with no entry for X, and writes one, having cleared nothing.
      //
      // All three ask whether the world looks like this write succeeded.
      // The receipt asks whether it did. A batch runs in order inside one
      // transaction, so the UPDATE's value is visible here, and only the
      // UPDATE that matched can have written it.
      this.#db
        .prepare(
          `INSERT INTO published_site_holds
             (slug, action, actor, reason, at, hold_token)
           SELECT ?1, 'released', ?2, NULL, ?3, ?4
           WHERE EXISTS (
             SELECT 1 FROM published_projects
             WHERE slug = ?1 AND last_release_token = ?5
           )`,
        )
        .bind(slug, by, now, holdToken, receipt),
    ]);
    return cleared?.meta.changes !== 0;
  }

  /** What an operator needs to see about a slug before acting on it. */
  async siteBySlug(slug: string): Promise<
    | {
        slug: string;
        projectId: string;
        userId: string;
        state: PublishState;
        /** The token a release has to name to be about this hold. */
        holdToken?: string;
        heldBy?: string;
        heldReason?: string;
      }
    | undefined
  > {
    const row = await this.#db
      .prepare(
        `SELECT slug, project_id, user_id, unpublished_at, held_at, held_by,
                held_reason, generation, hold_token
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
      ...(row.hold_token === null ? {} : { holdToken: row.hold_token }),
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
