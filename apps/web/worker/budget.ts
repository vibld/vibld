import { DurableObject } from 'cloudflare:workers';
import { RUN_ABANDONED_AFTER_MS } from '@vibld/ai';
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

/**
 * A run whose Worker died mid-flight settles at its reservation.
 *
 * Derived rather than chosen, because reclaiming a run that is merely slow
 * bills its caller the whole worst case: `settle` writes only where
 * `settled IS NULL`, so once this has fired the real figure is discarded.
 * It must therefore outlast the point at which the Workflow itself gives
 * up, which is what `RUN_ABANDONED_AFTER_MS` guarantees.
 */
const ABANDONED_AFTER_MS = RUN_ABANDONED_AFTER_MS;

export interface Reservation {
  verdict: SpendVerdict;
  /** Present only when the verdict allows the run. */
  id?: number;
  spentMicroUsd: number;
  /**
   * Runs this ledger had in flight in the period when it answered, not
   * counting the one it admitted. Lets a second ledger asked for the same
   * run hold it to the in-flight limit the first one applied.
   */
  inFlight?: number;
  /**
   * True when the period had room and the pool did not (D158), so the
   * refusal can say which. Absent on every other answer.
   */
  poolRefused?: true;
}

/**
 * A share of one period that some rows also count against (D158): the
 * Free plan's part of the deployment's day. A row in a pool still counts
 * against the period's whole ceiling, so a pool can only ever refuse more,
 * never admit more.
 */
export interface Pool {
  name: string;
  ceilingMicroUsd: number;
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
      // The pool a row also counts against inside its period (D158): the
      // Free plan's share of the deployment's day. Added to tables made
      // before it, since SQLite has no "ADD COLUMN IF NOT EXISTS".
      const columns = ctx.storage.sql
        .exec<{ name: string }>(`PRAGMA table_info(runs)`)
        .toArray();
      if (!columns.some((column) => column.name === 'pool')) {
        ctx.storage.sql.exec(`ALTER TABLE runs ADD COLUMN pool TEXT`);
      }
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
    pool?: Pool,
  ): Reservation {
    const now = Date.now();
    this.reclaimAbandoned(now);

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
    const inFlight = totals?.inflight ?? 0;
    const verdict = decide({
      spentMicroUsd: spent,
      inFlight,
      worstCaseMicroUsd,
      ceilingMicroUsd,
      maxInFlight,
    });

    if (!verdict.allow) {
      return { verdict, spentMicroUsd: spent, inFlight };
    }

    if (pool) {
      // Still no await: the same read-then-write the period's own check is.
      const [pooled] = this.ctx.storage.sql
        .exec<{ spent: number }>(
          `SELECT COALESCE(SUM(COALESCE(actual, reserved)), 0) AS spent
             FROM runs WHERE day = ? AND pool = ?`,
          periodKey,
          pool.name,
        )
        .toArray();
      const poolVerdict = decide({
        spentMicroUsd: pooled?.spent ?? 0,
        inFlight: 0,
        worstCaseMicroUsd,
        ceilingMicroUsd: pool.ceilingMicroUsd,
        maxInFlight,
      });
      if (!poolVerdict.allow) {
        return {
          verdict: poolVerdict,
          spentMicroUsd: spent,
          inFlight,
          poolRefused: true,
        };
      }
    }

    const [row] = this.ctx.storage.sql
      .exec<{ id: number }>(
        `INSERT INTO runs (day, started, reserved, pool) VALUES (?, ?, ?, ?)
           RETURNING id`,
        periodKey,
        now,
        worstCaseMicroUsd,
        pool?.name ?? null,
      )
      .toArray();

    return {
      verdict,
      id: row?.id,
      spentMicroUsd: spent + worstCaseMicroUsd,
      inFlight,
    };
  }

  /**
   * Reclaim reservations whose run never came back to settle. Without this
   * a crashed Worker holds its worst case against the user indefinitely.
   */
  private reclaimAbandoned(now: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE runs SET settled = ?, actual = reserved
         WHERE settled IS NULL AND started < ?`,
      now,
      now - ABANDONED_AFTER_MS,
    );
  }

  /**
   * How many runs are in flight in this period, for a second ledger
   * enforcing one in-flight limit across both (`reserve.ts`, internal PR 374 review).
   *
   * Reclaims first, exactly as `reserve` does, so a run that died stops
   * counting after the same window here as it does there: this ledger may
   * be read for its count long after anything last reserved in it.
   */
  inFlightFor(periodKey: string): number {
    this.reclaimAbandoned(Date.now());
    const [row] = this.ctx.storage.sql
      .exec<{ inflight: number }>(
        `SELECT COALESCE(SUM(CASE WHEN settled IS NULL THEN 1 ELSE 0 END), 0)
           AS inflight
         FROM runs WHERE day = ?`,
        periodKey,
      )
      .toArray();
    return row?.inflight ?? 0;
  }

  /**
   * Reconcile the pessimistic debit down to what the run actually cost.
   *
   * Writes whatever the row's current state, including one the reclaim above
   * has already closed at its worst case. That reclaim is a guess about a run
   * nobody has heard from; this is a measurement of one that finished. A
   * measurement outranks a guess whenever it arrives, and the two clocks
   * involved make late arrival ordinary rather than exceptional: the reclaim
   * counts from when the reservation was written, while the Workflow's step
   * timeout counts from when the step began, and a durable Workflow can sit
   * queued in between. No gap between the two constants can close that,
   * because they do not start together.
   *
   * It stays idempotent without the `settled IS NULL` guard it used to
   * carry: the settle step retries with the same id and the same figure, so
   * a second write lands on the same values. What it must not do is put the
   * run back in flight, and it does not -- `settled` is set either way, and
   * the reclaim already released the slot.
   */
  settle(id: number, actualMicroUsd: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE runs SET settled = ?, actual = ?
         WHERE id = ?`,
      Date.now(),
      actualMicroUsd,
      id,
    );
  }

  /**
   * Take a row out of its pool, leaving it in its period (D158). For a Free
   * account's run that turned out to draw on top-up credit, which is paid
   * money and not the Free plan's share of the day.
   */
  leavePool(id: number): void {
    this.ctx.storage.sql.exec(`UPDATE runs SET pool = NULL WHERE id = ?`, id);
  }

  /**
   * Close one reservation now, for a run the caller stopped: at
   * `atMostMicroUsd` where the run could say what it spent (D65), and
   * otherwise exactly as the reclaim in `reserve` would (D60).
   *
   * Stop terminates the Workflow before its settle step, so until this
   * existed the row stayed open until the reclaim found it, about
   * thirty-five minutes, holding an in-flight slot the whole time: two
   * Stops in a row locked a caller out with "A generation is already
   * running". With no figure, the charge is the reclaim's own, by the
   * reclaim's own statement restricted to one row, `actual = reserved`.
   * With one, it is that figure, never more than the row reserved and
   * never less than nothing, capped here in the statement so that no
   * caller's arithmetic can charge past the reservation.
   *
   * Only an unsettled row is touched, which is what makes a second Stop, or
   * a Stop after the run settled what it measured, change nothing. Returns
   * what the row was charged, or nothing when there was no open row to
   * close.
   */
  reclaim(id: number, atMostMicroUsd?: number): number | undefined {
    const figure =
      atMostMicroUsd !== undefined && Number.isFinite(atMostMicroUsd)
        ? Math.max(0, Math.ceil(atMostMicroUsd))
        : null;
    const [row] = this.ctx.storage.sql
      .exec<{ actual: number }>(
        `UPDATE runs SET settled = ?,
                         actual = MIN(reserved, COALESCE(?, reserved))
           WHERE id = ? AND settled IS NULL
           RETURNING actual`,
        Date.now(),
        figure,
        id,
      )
      .toArray();
    return row?.actual;
  }

  /**
   * Say that a reserved run is still alive, so the reclaim above does not
   * take it for dead.
   *
   * The reclaim counts from `started`, and it was sized for a run that was
   * one model call: `RUN_ABANDONED_AFTER_MS` outlasts one step's timeout. A
   * bounded build (`packages/ai/src/bounded-build.ts`) is many steps, each
   * inside that timeout, and together they can take longer than the window.
   * Reclaiming such a run releases its in-flight slot and bills its worst
   * case while it is still working. So every step moves `started` to now
   * before it calls the model, and the window keeps meaning what it meant:
   * this long since the run was last heard from, not since it began.
   *
   * Only an unsettled row moves. A row already settled, or already
   * reclaimed, stays as it is: a late heartbeat must not put a finished run
   * back in flight.
   */
  touch(id: number): void {
    this.ctx.storage.sql.exec(
      `UPDATE runs SET started = ?
         WHERE id = ? AND settled IS NULL`,
      Date.now(),
      id,
    );
  }

  /**
   * Delete this ledger's history, for an account being purged
   * (docs/decisions.md L32, `account-deletion.ts`).
   *
   * Every row, whatever its period: what an account spent and when is its
   * usage, not the accounting record, which is Stripe's and the billing
   * tables'. Idempotent, so a purge that stops after this and runs again
   * finds nothing to delete.
   */
  forget(): void {
    this.ctx.storage.sql.exec(`DELETE FROM runs`);
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
