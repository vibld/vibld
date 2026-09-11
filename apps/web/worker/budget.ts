import { DurableObject } from 'cloudflare:workers';
import type { SpendVerdict } from './spend.ts';
import { decide } from './spend.ts';

/**
 * One spend ledger, keyed by whoever `getByName` names it for.
 *
 * A Durable Object is used because it is the only option on the platform that
 * serialises concurrent callers: a series of reads followed by writes with no
 * `await` between them is atomic, which is what turns a balance check into a
 * ceiling rather than a race. Its SQLite storage is also the usage record --
 * there is no second store to keep in step.
 *
 * Keyed per user, deliberately, for the account's main ledger. Cloudflare's
 * own guidance warns against a single object as a global counter, because it
 * funnels all traffic through one instance; an object per identity shards
 * naturally and each one sees a handful of requests a day. The aggregate
 * ceiling is arithmetic instead: choose a per-user ceiling such that
 * (users x ceiling) is a bill worth paying.
 *
 * `index.ts`'s `reserveBudget` also uses this same class, under a second key
 * per user (`"<userId>:topup"`), as a running top-up credit balance
 * (docs/decisions.md L37) -- the period key it passes in for that instance
 * never changes, so nothing here needs to know that "period" can mean a UTC
 * day (the account-wide ceiling, L29), a UTC month (a subscribed tier's
 * monthly allowance, L35-L39) or "forever" (a top-up balance that persists
 * until spent). The `reserve`/`usageFor` caller decides what a period means;
 * this class only groups spend by whatever string it is given.
 *
 * Nothing here is provisioned. The object is created on first access.
 */

/** A run whose Worker died mid-flight settles at its reservation. */
const ABANDONED_AFTER_MS = 15 * 60_000;

export interface Reservation {
  verdict: SpendVerdict;
  /** Present only when the verdict allows the run. */
  id?: number;
  spentMicroUsd: number;
}

interface Totals {
  spent: number;
  inflight: number;
}

export class UserBudget extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    // One-time schema setup. Per-request work must never go here: it would
    // block every other caller of this object.
    void ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          day      TEXT    NOT NULL,
          started  INTEGER NOT NULL,
          settled  INTEGER,
          reserved INTEGER NOT NULL,
          actual   INTEGER
        )
      `);
      ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS runs_by_day ON runs(day)`,
      );
    });
  }

  /**
   * Charge the worst case up front and return whether the run may proceed.
   *
   * Synchronous on purpose. Awaiting anything between the read and the write
   * opens the input gate, lets a concurrent caller read the same balance, and
   * quietly turns the ceiling back into a race.
   *
   * `periodKey` is opaque to this class -- see the class comment. The `day`
   * column name predates that generalisation and is kept rather than
   * migrated: a live rename would break any object that already has rows
   * under the old schema, for no benefit over just no longer assuming what
   * the string in it means.
   */
  reserve(
    worstCaseMicroUsd: number,
    ceilingMicroUsd: number,
    maxInFlight: number,
    periodKey: string,
  ): Reservation {
    const now = Date.now();

    // Reclaim reservations whose run never came back to settle. Without this
    // a crashed Worker holds its worst case against the user indefinitely.
    this.ctx.storage.sql.exec(
      `UPDATE runs SET settled = ?, actual = reserved
         WHERE settled IS NULL AND started < ?`,
      now,
      now - ABANDONED_AFTER_MS,
    );

    // Cursors are not a stable snapshot across an await, so it is consumed
    // immediately.
    const [totals] = this.ctx.storage.sql
      .exec<Totals>(
        `SELECT
           COALESCE(SUM(COALESCE(actual, reserved)), 0) AS spent,
           COALESCE(SUM(CASE WHEN settled IS NULL THEN 1 ELSE 0 END), 0)
             AS inflight
         FROM runs WHERE day = ?`,
        periodKey,
      )
      .toArray();

    const spent = totals?.spent ?? 0;
    const verdict = decide({
      spentMicroUsd: spent,
      inFlight: totals?.inflight ?? 0,
      worstCaseMicroUsd,
      ceilingMicroUsd,
      maxInFlight,
    });

    if (!verdict.allow) {
      return { verdict, spentMicroUsd: spent };
    }

    const [row] = this.ctx.storage.sql
      .exec<{ id: number }>(
        `INSERT INTO runs (day, started, reserved) VALUES (?, ?, ?)
           RETURNING id`,
        periodKey,
        now,
        worstCaseMicroUsd,
      )
      .toArray();

    return {
      verdict,
      id: row?.id,
      spentMicroUsd: spent + worstCaseMicroUsd,
    };
  }

  /** Reconcile the pessimistic debit down to what the run actually cost. */
  settle(id: number, actualMicroUsd: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE runs SET settled = ?, actual = ?
         WHERE id = ? AND settled IS NULL`,
      Date.now(),
      actualMicroUsd,
      id,
    );
  }

  /** This period's spend, for reporting. Reads nothing the ceiling does not. */
  usageFor(periodKey: string): { spentMicroUsd: number; inFlight: number } {
    const [totals] = this.ctx.storage.sql
      .exec<Totals>(
        `SELECT
           COALESCE(SUM(COALESCE(actual, reserved)), 0) AS spent,
           COALESCE(SUM(CASE WHEN settled IS NULL THEN 1 ELSE 0 END), 0)
             AS inflight
         FROM runs WHERE day = ?`,
        periodKey,
      )
      .toArray();
    return {
      spentMicroUsd: totals?.spent ?? 0,
      inFlight: totals?.inflight ?? 0,
    };
  }
}
