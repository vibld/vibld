import { DurableObject } from 'cloudflare:workers';
import {
  HARD_LIFETIME_MS,
  isStale,
  queuePosition,
  toActivate,
} from './fleet.ts';
import type { QueueRow } from './fleet.ts';

/**
 * The account-wide preview concurrency gate (docs/decisions.md L9: 25
 * concurrent previews across every user, the 26th queued with a visible
 * position rather than refused).
 *
 * A single, well-known instance (`getByName('fleet')`) rather than one per
 * user, deliberately: it is the one thing about preview concurrency that
 * genuinely has to be counted globally. Per-user concurrency needs none of
 * this -- see fleet.ts's module comment.
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
  /** Present only while `active` is false. */
  position?: number;
}

export interface StatusResult {
  active: boolean;
  position?: number;
}

const ONLY_INSTANCE_NAME = 'fleet';

export class PreviewFleet extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
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
      ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS queue_waiting ON queue(activated, released)`,
      );
    });
  }

  /**
   * `label` is metadata only (who is waiting, for observability) -- it is
   * never used as a limit key. The limit is the single account-wide
   * `maxInFlight`.
   */
  enqueue(label: string, maxInFlight: number): EnqueueResult {
    const now = Date.now();
    this.reclaimStale(now);

    const [inserted] = this.ctx.storage.sql
      .exec<{ id: number }>(
        `INSERT INTO queue (label, requested) VALUES (?, ?) RETURNING id`,
        label,
        now,
      )
      .toArray();
    const id = inserted!.id;

    this.promote(maxInFlight, now);
    return this.describe(id);
  }

  /** Re-check a previously enqueued row -- promotes first, so a poll can observe a just-freed slot. */
  status(id: number, maxInFlight: number): StatusResult {
    const now = Date.now();
    this.reclaimStale(now);
    this.promote(maxInFlight, now);
    const { active, position } = this.describe(id);
    return position === undefined ? { active } : { active, position };
  }

  release(id: number, maxInFlight: number): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE queue SET released = ? WHERE id = ? AND released IS NULL`,
      now,
      id,
    );
    this.promote(maxInFlight, now);
  }

  /** A row whose activation outran the hard lifetime without releasing must not hold its slot forever. */
  private reclaimStale(now: number): void {
    const rows = this.ctx.storage.sql
      .exec<{ id: number; activated: number }>(
        `SELECT id, activated FROM queue WHERE activated IS NOT NULL AND released IS NULL`,
      )
      .toArray();
    for (const row of rows) {
      if (isStale(row.activated, now)) {
        this.ctx.storage.sql.exec(
          `UPDATE queue SET released = ? WHERE id = ?`,
          now,
          row.id,
        );
      }
    }
  }

  private promote(maxInFlight: number, now: number): void {
    const activeCount = this.activeCount();
    const waiting = this.waitingRows();
    for (const row of toActivate(waiting, activeCount, maxInFlight)) {
      this.ctx.storage.sql.exec(
        `UPDATE queue SET activated = ? WHERE id = ?`,
        now,
        row.id,
      );
    }
  }

  private activeCount(): number {
    const [row] = this.ctx.storage.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM queue WHERE activated IS NOT NULL AND released IS NULL`,
      )
      .toArray();
    return row?.n ?? 0;
  }

  private waitingRows(): QueueRow[] {
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue> & QueueRow>(
        `SELECT id, requested FROM queue WHERE activated IS NULL AND released IS NULL`,
      )
      .toArray();
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

/** The one instance this Durable Object class is ever addressed by. */
export function fleetName(): string {
  return ONLY_INSTANCE_NAME;
}

export { HARD_LIFETIME_MS };
