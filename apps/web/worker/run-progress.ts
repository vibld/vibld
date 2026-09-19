import { DurableObject } from 'cloudflare:workers';
import type { ProgressReport } from './generation-run.ts';

/**
 * The live channel between a running Workflow step and the Worker polling it.
 *
 * #183: the progress meter was built, shipped and then orphaned. Everything
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
 * Nothing is written to storage, on purpose. A run reports several times a
 * second and is read every 1.5 seconds; persisting that would be hundreds of
 * writes per run to record a number whose whole value expires in about a
 * second. Progress is not a fact anyone needs later: it is not in the trace,
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
 * same). No table is created: the class never touches `ctx.storage`.
 */
export class RunProgress extends DurableObject {
  #report: ProgressReport | undefined;

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

  /** Undefined until the first report, and again after an eviction. */
  read(): ProgressReport | undefined {
    return this.#report;
  }
}
