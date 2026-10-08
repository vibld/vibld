import { DurableObject } from 'cloudflare:workers';
import {
  ACCOUNT_MAX_IN_FLIGHT,
  BUILD_MAX_IN_FLIGHT,
  PAID_PREVIEW_RESERVED,
} from './capacity.ts';
import {
  HARD_LIFETIME_MS,
  isAbandoned,
  isStale,
  queuePosition,
  toActivate,
} from './fleet.ts';
import type { FleetKind, QueueRow } from './fleet.ts';
import { countedSince, dailyLimitMs, mayStart } from './free-previews.ts';
import type { PreviewSession } from './free-previews.ts';

/**
 * The account-wide container gate (docs/decisions.md L9: 25 concurrent
 * previews across every user, the 26th queued with a visible position
 * rather than refused), which since internal issue 197 counts builds as well.
 *
 * A well-known instance rather than one per user, deliberately: this is
 * the one thing about preview concurrency that genuinely has to be counted
 * globally. Per-user concurrency needs none of this -- see fleet.ts's
 * module comment.
 *
 * One instance, counting both kinds of work against one budget. Internal PR 196 made
 * builds run in containers of the same class and counted them in a second
 * instance against a static split, which kept the total honest and left
 * previews five short of L9 even when nothing was building. The shared
 * budget Chris chose for internal issue 197 needs one counter that can tell a build row
 * from a preview row, so each row records its kind, `toActivate` enforces
 * the build bound inside the one total, and the limits come from
 * `capacity.ts` rather than from each caller.
 *
 * Same reserve-now/release-later shape as `apps/web`'s `UserBudget`, but a
 * queue slot has no calendar-day reset: a row is either waiting, active, or
 * released, and a stale active row (one that outlived L9's hard lifetime
 * without releasing) is reclaimed the same way an abandoned spend
 * reservation is.
 */
export interface EnqueueResult {
  id: number;
  active: boolean;
  /**
   * Present only while `active` is false, and only for a preview: a build
   * that is not admitted is refused rather than queued, so it has no place
   * in line to report.
   */
  position?: number;
  /**
   * A Free preview refused because its account's day is spent (D158). No
   * row was written, so there is nothing to poll or give back, and `id` is
   * zero.
   */
  limited?: true;
}

/** What the fleet reads from its deployment. */
export interface FleetEnv {
  /** Minutes a day a Free account's previews may hold a container (D158). */
  VIBLD_FREE_PREVIEW_DAILY_MINUTES?: string;
}

/**
 * How long a Free session is kept: two days, so a session that began
 * before yesterday's midnight is still there to count today.
 */
const FREE_SESSION_KEPT_MS = 2 * 24 * 60 * 60_000;

export interface StatusResult {
  active: boolean;
  position?: number;
  /**
   * A queued Free preview closed rather than admitted, because its
   * account's day was spent while it waited (D158, internal PR 376 review).
   */
  limited?: true;
}

export class PreviewFleet extends DurableObject<FleetEnv> {
  constructor(ctx: DurableObjectState, env: FleetEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS queue (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          label     TEXT    NOT NULL,
          requested INTEGER NOT NULL,
          activated INTEGER,
          released  INTEGER
        )
      `);
      // Leading on `released`, because every query here starts by
      // excluding released rows and the reclaim has no second predicate to
      // narrow with (internal PR 200 review). An index led by `activated` cannot
      // serve `WHERE released IS NULL` on its own, so the reclaim scanned
      // the whole table on every enqueue, poll and release, and a queued
      // preview polls every 1.5 seconds. This one serves all three
      // queries; the old order served two of them and is dropped rather
      // than left to cost a write on every insert.
      ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS queue_open ON queue(released, activated)`,
      );
      ctx.storage.sql.exec(`DROP INDEX IF EXISTS queue_waiting`);
      // When anybody last asked about a row, so a waiting one that nobody
      // is waiting on can be reclaimed (internal issue 199). Added rather than included
      // in the CREATE above, because instances already exist with the old
      // shape and a CREATE TABLE IF NOT EXISTS does not reshape them.
      // Every read coalesces it to `requested`, so a row from before this
      // migration is treated as last seen when it was asked for, which is
      // the only thing known about it and is the conservative reading.
      const columns = ctx.storage.sql
        .exec<{ name: string }>(`PRAGMA table_info(queue)`)
        .toArray();
      if (!columns.some((column) => column.name === 'seen')) {
        ctx.storage.sql.exec(`ALTER TABLE queue ADD COLUMN seen INTEGER`);
      }
      // What each row holds a container for (internal issue 197), added the same way and
      // for the same reason. Every row that exists before this runs was
      // written while this instance counted previews alone, so defaulting
      // them to a preview is a fact rather than a guess.
      if (!columns.some((column) => column.name === 'kind')) {
        ctx.storage.sql.exec(
          `ALTER TABLE queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'preview'`,
        );
      }
      // Whether a preview is for a Free account (D158), added the same way.
      // Rows from before it are paid, which is how they were admitted.
      if (!columns.some((column) => column.name === 'free')) {
        ctx.storage.sql.exec(
          `ALTER TABLE queue ADD COLUMN free INTEGER NOT NULL DEFAULT 0`,
        );
      }
      // Whose day a Free preview draws on (D158): the account the preview
      // belongs to, which a shared link's sandbox name is not (internal PR 376 review).
      if (!columns.some((column) => column.name === 'account')) {
        ctx.storage.sql.exec(`ALTER TABLE queue ADD COLUMN account TEXT`);
      }
      // A queued Free row closed because its account's day ran out before
      // it reached the front, so a poll can say why rather than wait.
      if (!columns.some((column) => column.name === 'limited')) {
        ctx.storage.sql.exec(
          `ALTER TABLE queue ADD COLUMN limited INTEGER NOT NULL DEFAULT 0`,
        );
      }
      // Every Free admission, kept past its queue row (which goes half an
      // hour after release) so an account's day can be added up. One row
      // per ticket, begun at activation and ended at release or reclaim.
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS free_sessions (
          ticket  INTEGER PRIMARY KEY,
          account TEXT    NOT NULL,
          began   INTEGER NOT NULL,
          ended   INTEGER
        )
      `);
      ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS free_sessions_account ON free_sessions(account, began)`,
      );
    });
  }

  /**
   * `label` is metadata only (who is waiting, for observability) -- it is
   * never used as a limit key. `kind` is what decides which limits apply:
   * every row counts against the whole budget, and a build against the
   * build bound as well. `free` marks a Free account's preview, which may
   * not take the containers kept for paid plans and is refused as
   * `limited` once `account`'s day is spent (D158); it means nothing on a
   * build, which is bounded on its own.
   *
   * A build that is not admitted on the spot is refused rather than
   * queued, and its row is closed before this returns. Its caller has a
   * paid Workflow waiting and answers `busy` straight away, so a build row
   * left waiting would stand in front of previews for nobody, and could be
   * promoted later into a container for a caller that had already gone.
   * Closing it here rather than trusting the caller's release means no
   * failure on that path can leave one behind.
   */
  enqueue(
    label: string,
    kind: FleetKind,
    free = false,
    account: string = label,
  ): EnqueueResult {
    const checked = kindOf(kind);
    const freeRow = checked === 'preview' && free === true ? 1 : 0;
    const now = Date.now();
    this.reclaimStale(now);
    if (freeRow === 1 && !this.dayLeft(account, now)) {
      return { id: 0, active: false, limited: true };
    }

    const [inserted] = this.ctx.storage.sql
      .exec<{ id: number }>(
        `INSERT INTO queue (label, requested, seen, kind, free, account) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        label,
        now,
        now,
        checked,
        freeRow,
        freeRow === 1 ? account : null,
      )
      .toArray();
    const id = inserted!.id;

    this.promote(now);
    if (this.wasLimited(id)) return { id: 0, active: false, limited: true };
    const result = this.describe(id);
    if (checked === 'build' && !result.active) {
      this.ctx.storage.sql.exec(
        `UPDATE queue SET released = ? WHERE id = ? AND released IS NULL`,
        now,
        id,
      );
      return { id, active: false };
    }
    return result;
  }

  /**
   * Re-check a previously enqueued row -- promotes first, so a poll can
   * observe a just-freed slot.
   *
   * `plan` is what a new start says about the account now (D158). A
   * preview still waiting takes it in place of what it was queued with, so
   * an account that upgraded while it waited is no longer held behind the
   * paid reserve, and one that became Free is held to its day: refused at
   * once when the day is spent, as a new start would be (internal PR 376 review). Its
   * place in the line is kept either way.
   */
  status(id: number, plan?: { free: boolean; account: string }): StatusResult {
    const now = Date.now();
    // Somebody is still waiting on this one, so it is not abandoned (internal issue 199).
    // Before the reclaim rather than after it: a poll that arrives exactly
    // on the boundary is a caller who is still there, and reclaiming their
    // row and then answering the question is the wrong order.
    this.ctx.storage.sql.exec(
      `UPDATE queue SET seen = ? WHERE id = ? AND released IS NULL`,
      now,
      id,
    );
    this.reclaimStale(now);
    if (plan) this.reclassify(id, plan.free === true, plan.account, now);
    this.promote(now);
    if (this.wasLimited(id)) return { active: false, limited: true };
    const { active, position } = this.describe(id);
    return position === undefined ? { active } : { active, position };
  }

  /**
   * Idempotent, and only for the kind of ticket it names (internal issue 197). Previews
   * and builds were separate instances until the budget was shared, so a
   * build's ticket id could never name a preview's row; in one table it
   * could, and a release that names the wrong kind must not free somebody
   * else's container.
   */
  release(id: number, kind: FleetKind): void {
    const checked = kindOf(kind);
    const now = Date.now();
    // Every entry point reclaims before it promotes, so a promotion can
    // never hand a slot to a row the reclaim was about to take (internal issue 199).
    this.reclaimStale(now);
    this.ctx.storage.sql.exec(
      `UPDATE queue SET released = ? WHERE id = ? AND kind = ? AND released IS NULL`,
      now,
      id,
      checked,
    );
    // Only a release that freed this preview's row ends its session: a
    // release naming the wrong kind leaves the row holding its slot, so its
    // time is still being spent (internal PR 376 review).
    if (checked === 'preview') this.endSession(id, now);
    this.promote(now);
  }

  /** A waiting preview's plan, as `status` describes; admitted rows keep theirs. */
  private reclassify(
    id: number,
    free: boolean,
    account: string,
    now: number,
  ): void {
    const limited = free && !this.dayLeft(account, now);
    this.ctx.storage.sql.exec(
      `UPDATE queue SET free = ?, account = ?, limited = ?, released = ?
         WHERE id = ? AND kind = 'preview' AND activated IS NULL AND released IS NULL`,
      free ? 1 : 0,
      free ? account : null,
      limited ? 1 : 0,
      limited ? now : null,
      id,
    );
  }

  /** Whether `account` has Free preview time left today (D158). */
  private dayLeft(account: string, now: number): boolean {
    const sessions = this.ctx.storage.sql
      .exec<{ began: number; ended: number | null }>(
        `SELECT began, ended FROM free_sessions WHERE account = ? AND began >= ?`,
        account,
        countedSince(now),
      )
      .toArray() as PreviewSession[];
    return mayStart(
      sessions,
      now,
      dailyLimitMs(this.env?.VIBLD_FREE_PREVIEW_DAILY_MINUTES),
    );
  }

  /** Whether this row was closed because its account's day ran out. */
  private wasLimited(id: number): boolean {
    const [row] = this.ctx.storage.sql
      .exec<{ limited: number }>(`SELECT limited FROM queue WHERE id = ?`, id)
      .toArray();
    return row?.limited === 1;
  }

  /** A Free session's end, the first time its ticket stops holding a slot. */
  private endSession(ticket: number, now: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE free_sessions SET ended = ?
         WHERE ticket = ? AND ended IS NULL
           AND EXISTS (SELECT 1 FROM queue WHERE id = ? AND released IS NOT NULL)`,
      now,
      ticket,
      ticket,
    );
  }

  /**
   * Two ways a row stops being anybody's, and both used to have to be
   * somebody else's job (internal issue 199).
   *
   * An activated row that outran the hard lifetime without releasing is
   * the original case: a crashed Worker or a client that never called
   * stop must not hold a slot forever.
   *
   * A waiting row that nobody has asked about is the case that had no
   * expiry at all, which made every release path in front of it load
   * bearing. It holds nothing while it waits and costs a slot later, when
   * it is promoted for a caller that gave up long ago.
   */
  private reclaimStale(now: number): void {
    const rows = this.ctx.storage.sql
      .exec<{ id: number; activated: number | null; seen: number | null }>(
        `SELECT id, activated, COALESCE(seen, requested) AS seen FROM queue WHERE released IS NULL`,
      )
      .toArray();
    for (const row of rows) {
      // Either, never one instead of the other (internal PR 200 review). Written as a
      // ternary, promotion erased the abandonment deadline: a row nobody
      // was waiting on, promoted at minute twenty-nine, stopped being
      // judged by `seen` and started a fresh lifetime from its activation,
      // holding a slot for another half hour. That is the exact failure
      // this change exists to remove, so the release path in front of it
      // would have stayed load bearing.
      //
      // A caller that is still there keeps both clocks honest, because
      // `status` refreshes `seen` on an activated row as well as a waiting
      // one, and a build that never polls is covered by the arithmetic:
      // its whole life plus its teardown is inside the abandonment bound.
      const done =
        isAbandoned(row.seen!, now) ||
        (row.activated != null && isStale(row.activated, now));
      if (done) {
        this.ctx.storage.sql.exec(
          `UPDATE queue SET released = ? WHERE id = ?`,
          now,
          row.id,
        );
        this.endSession(row.id, now);
      }
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM free_sessions WHERE began < ?`,
      now - FREE_SESSION_KEPT_MS,
    );

    // Released rows were kept forever, so the table grew with all
    // historical usage and every query above paid for it (internal PR 200 review).
    // Indexing the predicate stops it costing a scan; this stops it
    // costing storage.
    //
    // Nothing can read one again. `release` matches on `released IS NULL`,
    // both counting queries exclude them, and `describe` already answers
    // "not active, position 0" for a released row and for a missing one
    // alike, so a caller polling an id this removed gets the same answer
    // it got before.
    //
    // A hard lifetime of history rather than none, because a row released
    // that long ago cannot be part of any decision still being made, and
    // keeping the recent ones leaves something to read when a slot went
    // missing.
    this.ctx.storage.sql.exec(
      `DELETE FROM queue WHERE released IS NOT NULL AND released < ?`,
      now - HARD_LIFETIME_MS,
    );
  }

  /**
   * Fill whatever room there is, under the limits in `capacity.ts` and no
   * caller's. With both kinds of work in one instance, a caller passing its
   * own cap could promote the whole queue under the wrong one.
   */
  private promote(now: number): void {
    const { total, builds } = this.activeCounts();
    const waiting = this.waitingRows();
    for (const row of toActivate(
      waiting,
      total,
      ACCOUNT_MAX_IN_FLIGHT,
      { active: builds, max: BUILD_MAX_IN_FLIGHT },
      PAID_PREVIEW_RESERVED,
    )) {
      // Checked again here, one row at a time, because another of the
      // account's previews may have spent the day while this one waited,
      // and an admission before it in this same loop counts too (internal PR 376
      // review). Its slot goes unused until the next call, which is the
      // next poll.
      if (row.free === true) {
        const [owner] = this.ctx.storage.sql
          .exec<{ account: string | null }>(
            `SELECT account FROM queue WHERE id = ?`,
            row.id,
          )
          .toArray();
        if (owner?.account && !this.dayLeft(owner.account, now)) {
          this.ctx.storage.sql.exec(
            `UPDATE queue SET released = ?, limited = 1 WHERE id = ?`,
            now,
            row.id,
          );
          continue;
        }
      }
      this.ctx.storage.sql.exec(
        `UPDATE queue SET activated = ? WHERE id = ?`,
        now,
        row.id,
      );
      // A Free preview's day starts counting the moment it holds a slot.
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO free_sessions (ticket, account, began)
           SELECT id, account, ? FROM queue
            WHERE id = ? AND free = 1 AND account IS NOT NULL`,
        now,
        row.id,
      );
    }
  }

  /** Every container authorised and not yet given back, and how many of those are builds. */
  private activeCounts(): { total: number; builds: number } {
    const [row] = this.ctx.storage.sql
      .exec<{ total: number; builds: number | null }>(
        `SELECT COUNT(*) AS total, SUM(kind = 'build') AS builds FROM queue WHERE activated IS NOT NULL AND released IS NULL`,
      )
      .toArray();
    return { total: row?.total ?? 0, builds: row?.builds ?? 0 };
  }

  private waitingRows(): QueueRow[] {
    return this.ctx.storage.sql
      .exec<{ id: number; requested: number; kind: FleetKind; free: number }>(
        `SELECT id, requested, kind, free FROM queue WHERE activated IS NULL AND released IS NULL`,
      )
      .toArray()
      .map(({ free, ...row }) => (free === 1 ? { ...row, free: true } : row));
  }

  private describe(id: number): EnqueueResult {
    const [row] = this.ctx.storage.sql
      .exec<{ activated: number | null }>(
        `SELECT activated FROM queue WHERE id = ?`,
        id,
      )
      .toArray();
    if (row?.activated != null) {
      return { id, active: true };
    }
    const waiting = this.waitingRows();
    const mine = waiting.find((entry) => entry.id === id);
    return {
      id,
      active: false,
      position: mine ? queuePosition(mine, waiting) : 0,
    };
  }
}

/**
 * A kind as it arrived over RPC, checked. The types say it can only be one
 * of two strings, but a value from another object is only as good as that
 * object's build, and an unknown kind read as a preview would escape the
 * build bound.
 */
function kindOf(kind: FleetKind): FleetKind {
  if (kind !== 'preview' && kind !== 'build') {
    throw new Error(`Unknown fleet ticket kind: ${String(kind)}`);
  }
  return kind;
}
