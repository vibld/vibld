import { DurableObject } from 'cloudflare:workers';
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
  | { claimed: 'taken' }
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
 */
export class RunProgress extends DurableObject {
  #report: ProgressReport | undefined;
  #finished = false;

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
      return { claimed: 'taken' };
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
