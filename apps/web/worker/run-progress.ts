import { DurableObject } from 'cloudflare:workers';
import { isRunPhase } from '../src/generation/run-phase.ts';
import type { RunPhase } from '../src/generation/run-phase.ts';
import type { ProgressReport, RunProgressState } from './generation-run.ts';

/**
 * Where one run's reservation is held: the two ledger rows `handlePlan`
 * reserved, and which of the caller's two ledgers the first is in.
 *
 * The caller's ledger is named by whether it was their top-up credit rather
 * than by its key, because the key is their user id and this row should not
 * carry one. Stop is made by the run's owner, whose id it already has.
 */
export interface RunHold {
  reservationId?: number;
  /** Drawn from `"<userId>:topup"` rather than the allowance at `userId`. */
  topup: boolean;
  accountReservationId?: number;
  /**
   * Every model call of this run records itself here as it starts and as
   * it finishes (`callStarted`, `callFinished`), so a Stop can charge what
   * the run spent rather than all it reserved (D65). Set by `handlePlan`
   * for a bounded build; absent for a run whose calls do not, which Stop
   * charges in full.
   */
  metered?: boolean;
}

/**
 * Who is closing a run's reservation: Stop, or the Workflow's own
 * settle step. Whichever asks first owns it, and asking again as the same
 * party is answered the same way, so a retried settle step or a second Stop
 * is not refused its own settlement.
 */
export type HoldSettler = 'stop' | 'workflow';

export type HoldClaim =
  | { claimed: 'yours'; hold: RunHold }
  /**
   * The other party has it. `charged` is what Stop charged the caller's
   * own layer, where it closed that layer and said so (`stopCharged`).
   */
  | { claimed: 'taken'; charged?: number }
  /**
   * No hold was recorded for this run: one enqueued before D60, or one
   * whose record failed to write.
   */
  | { claimed: 'none' };

/**
 * The live channel between a running Workflow step and the Worker polling it.
 *
 * Internal issue 183: the progress meter was built, shipped and then orphaned. Everything
 * on the client still works -- `ProgressMeter.tsx`, `progress.ts`,
 * `remote-provider.ts`'s `progress` event, the DeepSeek client's per-delta
 * callback -- and the one thing missing was a way for the model call, which
 * happens inside a durable Workflow step, to say anything before that step
 * returns. A step's return value is the only channel Workflows give, and it
 * arrives once, at the end.
 *
 * So this is the channel, and it is deliberately the smallest thing that can
 * be one. A Durable Object is addressable by name from both sides, and
 * `getByName(runId)` gives the generate step and the poll loop the same
 * object without either knowing where it is.
 *
 * Progress is never written to storage, on purpose. A run reports several
 * times a second and is read every 1.5 seconds; persisting that would be
 * hundreds of writes per run to record a number whose whole value expires in
 * about a second. Progress is not a fact anyone needs later: it is not in the trace,
 * not in the ledger, and not in the result. Once the run ends, the last
 * report is worth nothing.
 *
 * The cost of holding it in memory is that an evicted object forgets, and
 * the reader then sees no count until the next report lands. That is already
 * a supported shape rather than a defect: `describeProgress` treats an
 * absent count as unknown and carries the line on the clock alone, which is
 * exactly what shipped before this file existed. The failure mode of the
 * channel is the state the product was already in.
 *
 * SQLite-backed because that is the only backend on the Workers Free plan
 * and the only one whose storage is not billed there (`budget.ts` says the
 * same).
 *
 * One thing is written to storage, and it is not progress: where the run's
 * reservation is (`hold`, D60). Stop has only the run's id and has to close
 * that reservation after terminating the Workflow that would have closed
 * it, so the ids have to be findable from the run id, durably, and this is
 * the one object already keyed by it. A single small row, written once per
 * run, holding ledger row numbers and nothing that identifies a person.
 *
 * And, for the same reader, what the run's model calls have spent (D65): a
 * row per call, written as it starts with the most it may cost and again
 * as it finishes with what it did cost. Stop charges their sum, a call that
 * started and has not finished at its most, rather than the whole
 * reservation. A few rows per run, each a name and two numbers.
 */
export class RunProgress extends DurableObject {
  #report: ProgressReport | undefined;
  #finished = false;
  #phase: RunPhase | undefined;

  /**
   * Called by the generate step, throttled by `throttleProgress`.
   *
   * Last writer wins, and no attempt is made to keep a report from going
   * backwards. The counts a single run streams only increase, and a run has
   * exactly one writer, so there is nothing here for an ordering rule to
   * protect against.
   */
  report(report: ProgressReport): void {
    this.#report = report;
    // A report carries the phase of the model step that sent it. One that
    // lands after the steps have finished is late, and must not take the
    // phase back from what the Workflow has moved on to (`enter`).
    if (!this.#finished && isRunPhase(report.phase)) {
      this.#phase = report.phase;
    }
  }

  /**
   * The Workflow moving on to a part of its work the model steps do not
   * report: putting the files together, building them, repairing them
   * (`run-phase.ts`). In memory, like the report, and for the same reason.
   */
  enter(phase: RunPhase): void {
    if (isRunPhase(phase)) this.#phase = phase;
  }

  /**
   * Called once, as the generate step leaves, however it leaves.
   *
   * Deliberately one-way. Reports are sent without being awaited, so one
   * can still be in flight when this arrives; letting a late report undo
   * the finish would reopen exactly the window this closes (internal PR 193 review).
   * A report that lands afterwards updates the numbers and nothing else.
   */
  finish(): void {
    this.#finished = true;
  }

  /**
   * The report is absent until the first one, and again after an eviction.
   * `finished` is false in both of those cases, which is the same answer
   * eviction gives to everything else here: nothing is known, so nothing is
   * claimed, and `stageFor` falls back to what the Workflow itself says.
   */
  read(): RunProgressState {
    return {
      ...(this.#report ? { report: this.#report } : {}),
      finished: this.#finished,
      ...(this.#phase ? { phase: this.#phase } : {}),
    };
  }

  /**
   * Created on first use rather than in a constructor, so a run that only
   * reports progress never touches storage at all.
   */
  #holdTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS hold (
        id                     INTEGER PRIMARY KEY CHECK (id = 1),
        reservation_id         INTEGER,
        topup                  INTEGER NOT NULL,
        account_reservation_id INTEGER,
        claimed_by             TEXT
      )
    `);
  }

  /**
   * The run's model calls, and whether the run records them at all.
   *
   * Tables of their own rather than columns on `hold`, which objects made
   * before D65 already have without them. `metering` has its one row only
   * when `handlePlan` said the run records its calls, which is what tells
   * "no call has started" apart from "this run never said". `stopped` is
   * what a Stop charged, once it has.
   */
  #callTables(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        name       TEXT PRIMARY KEY,
        worst_case INTEGER NOT NULL,
        actual     INTEGER
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metering (
        id INTEGER PRIMARY KEY CHECK (id = 1)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS stopped (
        id      INTEGER PRIMARY KEY CHECK (id = 1),
        charged INTEGER NOT NULL
      )
    `);
  }

  /**
   * Record where this run's reservation is. Called once, by `handlePlan`,
   * before the Workflow exists. The first record stands: a second call for
   * the same run changes nothing.
   */
  hold(hold: RunHold): void {
    this.#holdTable();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO hold
         (id, reservation_id, topup, account_reservation_id)
       VALUES (1, ?, ?, ?)`,
      hold.reservationId ?? null,
      hold.topup ? 1 : 0,
      hold.accountReservationId ?? null,
    );
    if (hold.metered) {
      this.#callTables();
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO metering (id) VALUES (1)`,
      );
    }
  }

  /**
   * A model call is about to be made, and the most it can cost. Called
   * inside the call's step, before the call. The first record for a name
   * stands, so a step run again does not lower what it was said to risk.
   */
  callStarted(name: string, worstCaseMicroUsd: number): void {
    this.#callTables();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO calls (name, worst_case) VALUES (?, ?)`,
      name,
      Math.max(0, Math.ceil(worstCaseMicroUsd)),
    );
  }

  /**
   * A model call came back, and what it cost, priced the way the run's
   * settlement prices it. Written whether or not its start was recorded.
   */
  callFinished(name: string, actualMicroUsd: number): void {
    this.#callTables();
    const actual = Math.max(0, Math.ceil(actualMicroUsd));
    this.ctx.storage.sql.exec(
      `INSERT INTO calls (name, worst_case, actual) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET actual = excluded.actual`,
      name,
      actual,
      actual,
    );
  }

  /**
   * What the run's calls have spent: each finished call at what it cost,
   * and each call that started and has not finished at the most it could.
   * Undefined for a run that never said it records its calls, whose spend
   * this cannot know.
   */
  spentByCalls(): number | undefined {
    this.#callTables();
    const [marked] = this.ctx.storage.sql
      .exec<{ id: number }>(`SELECT id FROM metering WHERE id = 1`)
      .toArray();
    if (!marked) return undefined;
    const [row] = this.ctx.storage.sql
      .exec<{ spent: number }>(
        `SELECT COALESCE(SUM(COALESCE(actual, worst_case)), 0) AS spent
           FROM calls`,
      )
      .toArray();
    return row?.spent ?? 0;
  }

  /**
   * What Stop charged the caller's own layer, for the Workflow's settle
   * step to report if it runs after all (`stoppedFirst`).
   */
  stopCharged(microUsd: number): void {
    this.#callTables();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO stopped (id, charged) VALUES (1, ?)`,
      microUsd,
    );
  }

  /**
   * Take the closing of this run's reservation for `by`, or learn that the
   * other party already has.
   *
   * Synchronous, like `UserBudget.reserve`, so the read and the write
   * cannot be split by another caller: a Stop and a settle step arriving
   * together get one `yours` between them, never two.
   */
  claimSettlement(by: HoldSettler): HoldClaim {
    this.#holdTable();
    const [row] = this.ctx.storage.sql
      .exec<{
        reservation_id: number | null;
        topup: number;
        account_reservation_id: number | null;
        claimed_by: string | null;
      }>(
        `SELECT reservation_id, topup, account_reservation_id, claimed_by
           FROM hold WHERE id = 1`,
      )
      .toArray();
    if (!row) return { claimed: 'none' };
    if (row.claimed_by !== null && row.claimed_by !== by) {
      this.#callTables();
      const [stop] = this.ctx.storage.sql
        .exec<{ charged: number }>(`SELECT charged FROM stopped WHERE id = 1`)
        .toArray();
      return stop
        ? { claimed: 'taken', charged: stop.charged }
        : { claimed: 'taken' };
    }
    if (row.claimed_by === null) {
      this.ctx.storage.sql.exec(
        `UPDATE hold SET claimed_by = ? WHERE id = 1`,
        by,
      );
    }
    return {
      claimed: 'yours',
      hold: {
        ...(row.reservation_id !== null
          ? { reservationId: row.reservation_id }
          : {}),
        topup: row.topup === 1,
        ...(row.account_reservation_id !== null
          ? { accountReservationId: row.account_reservation_id }
          : {}),
      },
    };
  }
}
