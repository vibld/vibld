import { runIdInPath } from './access-gate.ts';
import type { UserBudget } from './budget.ts';
import { D1GenerationStore } from './generation-store.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';
import { ProjectStore, RUN_IN_FLIGHT_MS } from './project-store.ts';
import type { RunStageRow } from './project-store.ts';
import { isProjectId } from './request-guard.ts';
import { topupKeyFor } from './reserve.ts';
import type { HoldClaim, HoldSettler } from './run-progress.ts';
import { phaseFor } from './run-stage.ts';
import type { RunProgressState } from './generation-run.ts';
import type { RunPhase } from '../src/generation/run-phase.ts';
import { ACCOUNT_BUDGET_KEY } from './spend.ts';

/**
 * `/api/runs/:id`: one of the caller's builds, asked after and stopped
 * (docs/decisions.md, "Resolved 2026-09-29", keep building).
 *
 *     GET     /api/runs/:id    what became of it: running, accepted,
 *                              failed or cancelled
 *     DELETE  /api/runs/:id    stop it
 *
 * A build used to be stopped by its page going away: `handlePlan`
 * terminated the Workflow whenever the connection dropped, so a phone
 * locked three minutes into a build lost the build and still paid for the
 * model call in flight. A build now runs to the end whether anybody is
 * watching, and this route is the only thing that stops one. The builder
 * calls it from Stop, and asks after a build it is no longer streaming
 * (a reopened project, or a connection that dropped) until it ends.
 *
 * `:id` is the Workflow instance's id, which `handlePlan` sends the builder
 * as the stream's first event. A run in somebody else's project, or no run
 * at all, is answered 404, never 403, for the reason `project-handlers.ts`
 * gives.
 *
 * In its own module rather than in `index.ts`, which cannot be loaded under
 * `node --test`, so ownership, the stop and the settling of a run the
 * engine ended without saying so are tested against the real schema.
 */

export interface RunControlEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
}

export interface RunControlDeps {
  resolvePrincipal: (
    request: Request,
  ) => Promise<PrincipalDenied | PrincipalGranted>;
  /**
   * The Workflow instance's own status (`running`, `complete`,
   * `terminated`, ...), or undefined where it cannot be read. Absent where
   * there is no Workflow binding.
   */
  instanceStatus?: (runId: string) => Promise<string | undefined>;
  /**
   * The Workflow instance's result (`status().output`), or undefined where
   * it cannot be read. Only its summary is used. Absent where there is no
   * Workflow binding.
   */
  instanceOutput?: (runId: string) => Promise<unknown>;
  /** Terminate the Workflow instance. Absent where there is no binding. */
  terminate?: (runId: string) => Promise<void>;
  /**
   * Close the reservation of a run this route stopped (`settleStopped`,
   * D60). Absent where there is no ledger or no progress channel to find
   * the reservation in, and the abandoned-reservation reclaim closes it
   * later, as it always did.
   */
  settleStopped?: (runId: string, userId: string) => Promise<void>;
  /**
   * What a running build's own progress channel says (`RunProgress.read`),
   * for where it has got to. Absent where there is no channel.
   */
  progressOf?: (runId: string) => Promise<RunProgressState | undefined>;
  /** The per-address limiter a stop is counted against (`IP_BURST`). */
  ipLimit?: RateLimit;
  now?: () => Date;
}

export type RunState = 'running' | 'accepted' | 'failed' | 'cancelled';

/** A build as the builder reads it. */
export interface RunView {
  id: string;
  state: RunState;
  /** When the run was created: what a reopened builder's clock counts from. */
  startedAt: string;
  /** The revision it was accepted at, for `accepted`. */
  revision?: string | null;
  /**
   * What the build says it made, for `accepted`: the same sentence the
   * stream ends with, for a builder that was not streaming it. Absent where
   * the instance can no longer say.
   */
  summary?: string;
  /**
   * Where a `running` build has got to (`run-phase.ts`), as the stream's
   * progress events say it, for a builder asking rather than streaming.
   * Absent where the run has not said, or its channel cannot be read.
   */
  phase?: RunPhase;
}

/** What `WorkflowInstance.status()` says of an instance that has stopped. */
const INSTANCE_ENDED = new Set(['complete', 'errored', 'terminated']);

/** Stage states that end a run; the rest are a run still going. */
const STAGE_ENDED = new Set(['accepted', 'failed', 'cancelled', 'idle']);

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const NOT_FOUND = () => json({ error: 'That build does not exist.' }, 404);

const unended = (row: RunStageRow) => !STAGE_ENDED.has(row.state);

/** A run's stages as one answer. `rows` is never empty. */
export function viewOf(runId: string, rows: RunStageRow[]): RunView {
  const own = rows.find((row) => row.run_id === runId) ?? rows[0]!;
  const startedAt = own.created_at;
  if (rows.some(unended)) return { id: runId, state: 'running', startedAt };
  const accepted = rows.filter(
    (row) => row.state === 'accepted' && row.snapshot_revision !== null,
  );
  if (accepted.length > 0) {
    // The project's revision where it is one of this run's (the build, or
    // the repair that followed it), and otherwise the run's latest: the
    // project has moved on since, and the run was still accepted.
    const current = own.accepted_revision;
    const revision = accepted.some((row) => row.snapshot_revision === current)
      ? current
      : accepted.at(-1)!.snapshot_revision;
    return { id: runId, state: 'accepted', startedAt, revision };
  }
  return {
    id: runId,
    state: own.state === 'cancelled' ? 'cancelled' : 'failed',
    startedAt,
  };
}

async function readStatus(
  deps: Pick<RunControlDeps, 'instanceStatus'>,
  runId: string,
): Promise<string | undefined> {
  if (!deps.instanceStatus) return undefined;
  try {
    return await deps.instanceStatus(runId);
  } catch {
    return undefined;
  }
}

/**
 * A run, with its stages settled first if it stopped without saying so.
 *
 * A Workflow terminated or errored between steps writes nothing: its row
 * stays at whatever it last said, which for the production run that
 * prompted this was `planning`, three and a half minutes in, for good. So
 * a row that has not ended is checked against the instance before it is
 * believed. An instance that has ended settles it: `cancelled` for one
 * that was terminated, which only a stop does, and `failed` for the rest.
 * A row older than `RUN_IN_FLIGHT_MS` whose instance cannot be read at all
 * settles as `failed` too, the reading `runInFlight` already gives it.
 *
 * `null` for a run that is not the caller's, or none at all.
 */
export async function describeRun(
  load: () => Promise<RunStageRow[]>,
  generation: Pick<D1GenerationStore, 'settleRun'>,
  runId: string,
  now: Date,
  deps: Pick<RunControlDeps, 'instanceStatus'>,
): Promise<RunView | null> {
  let rows = await load();
  if (rows.length === 0) return null;
  const going = rows.filter(unended);
  if (going.length > 0) {
    const status = await readStatus(deps, runId);
    const cutoff = now.getTime() - RUN_IN_FLIGHT_MS;
    const stale = going.every((row) => Date.parse(row.updated_at) <= cutoff);
    const ended = status !== undefined && INSTANCE_ENDED.has(status);
    if (ended || (stale && status === undefined)) {
      await generation.settleRun(
        runId,
        status === 'terminated' ? 'cancelled' : 'failed',
      );
      rows = await load();
    }
  }
  return viewOf(runId, rows);
}

/**
 * The build still running in a project, if there is one, for the builder
 * opening it: its id, to ask after and to stop, and when it started.
 *
 * Every run the project has that has not ended is looked at, however old,
 * so opening a project is also what settles a run the engine stopped
 * without writing its end (`describeRun`).
 */
/**
 * The summary a build ended with, read from its Workflow instance's result,
 * where that result is the revision the run was accepted at.
 *
 * Not stored anywhere of this service's own: the stage row has no column
 * for it, and the instance already holds it for as long as the engine keeps
 * the instance. A builder that asks after that gets the build without a
 * summary, which is what every one got before this.
 */
async function summaryOf(
  deps: Pick<RunControlDeps, 'instanceOutput'>,
  runId: string,
  revision: string | null | undefined,
): Promise<string | undefined> {
  if (!deps.instanceOutput || !revision) return undefined;
  let output: unknown;
  try {
    output = await deps.instanceOutput(runId);
  } catch {
    return undefined;
  }
  if (typeof output !== 'object' || output === null) return undefined;
  const result = output as {
    accepted?: { revision?: unknown };
    summary?: unknown;
  };
  if (result.accepted?.revision !== revision) return undefined;
  return typeof result.summary === 'string' && result.summary.length > 0
    ? result.summary
    : undefined;
}

export async function buildInFlight(
  projects: ProjectStore,
  generation: Pick<D1GenerationStore, 'settleRun'>,
  userId: string,
  projectId: string,
  now: Date,
  deps: Pick<RunControlDeps, 'instanceStatus'>,
): Promise<{ runId: string; startedAt: string } | null> {
  for (const runId of await projects.unendedRuns(projectId)) {
    const view = await describeRun(
      () => projects.runStages(userId, runId),
      generation,
      runId,
      now,
      deps,
    );
    if (view?.state === 'running') {
      return { runId, startedAt: view.startedAt };
    }
  }
  return null;
}

/**
 * Close a stopped run's reservation now, at what its model calls spent
 * (D65), rather than in thirty-five minutes at all it reserved (D60).
 *
 * Stop terminates the Workflow before its `settle-budget` step, so the
 * reservation it held, against the caller's ledger and the deployment's,
 * used to stay open until `UserBudget.reserve` reclaimed it after
 * `RUN_ABANDONED_AFTER_MS`. Open, it held an in-flight slot, and at
 * `VIBLD_MAX_IN_FLIGHT=2` two Stops locked a caller out.
 *
 * What each layer is charged is what the run's own record says its model
 * calls came to (`RunProgress.spentByCalls`): every call that finished at
 * what it cost, priced the way the settle step prices it, and a call that
 * had started and not finished, the one in flight when Stop landed, at the
 * most it could cost. Each layer is charged that or its own reservation,
 * whichever is less (`UserBudget.reclaim`), so a Stop never charges more
 * than was reserved. Where the record cannot be read, or the run never
 * kept one (a run enqueued before D65), each layer is charged its whole
 * reservation, which is what the reclaim would have charged.
 *
 * The run's own record also says where the reservation is
 * (`RunProgress.hold`). Taking it for Stop is what keeps the settle step
 * from closing it again if the Workflow reaches that step anyway; a second
 * Stop takes it again and finds both rows already closed, which changes
 * nothing. Each layer is closed on its own, so a ledger that fails for one
 * does not keep the other open; one that fails is left to the reclaim, as
 * before.
 *
 * Returns what the caller's own layer was charged, or nothing where this
 * Stop closed nothing of theirs.
 */
export async function settleStopped(
  /** The run's own `RunProgress`, as its stub or the object itself. */
  channel: {
    claimSettlement(by: HoldSettler): HoldClaim | Promise<HoldClaim>;
    spentByCalls(): number | undefined | Promise<number | undefined>;
    stopCharged(microUsd: number): void | Promise<void>;
  },
  ledger: DurableObjectNamespace<Pick<UserBudget, 'reclaim'>>,
  userId: string,
  runId: string,
): Promise<number | undefined> {
  const claim = await channel.claimSettlement('stop');
  if (claim.claimed !== 'yours') return undefined;
  const { hold } = claim;
  // Read after the claim, so a call that finishes in between is counted at
  // what it cost rather than at its worst case. Undefined is "charge the
  // reservation": a record that cannot be read is not a reason to charge
  // less.
  let spent: number | undefined;
  try {
    spent = await channel.spentByCalls();
  } catch (error) {
    console.error('could not read what a stopped run spent', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    spent = undefined;
  }
  const close = async (key: string, id: number | undefined) => {
    if (id === undefined) return undefined;
    return ledger.getByName(key).reclaim(id, spent);
  };
  const [own, account] = await Promise.allSettled([
    close(hold.topup ? topupKeyFor(userId) : userId, hold.reservationId),
    close(ACCOUNT_BUDGET_KEY, hold.accountReservationId),
  ]);
  for (const [layer, result] of [
    ['user', own],
    ['account', account],
  ] as const) {
    if (result.status === 'rejected') {
      console.error('could not settle a stopped run', {
        runId,
        layer,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }
  const charged = own.status === 'fulfilled' ? own.value : undefined;
  if (charged !== undefined) {
    // For the settle step's record, if the Workflow reaches it anyway.
    // Best effort: it only changes what that step logs and traces.
    try {
      await channel.stopCharged(charged);
    } catch {
      // The settle step then reports the reservation, as it did before.
    }
    console.log(
      JSON.stringify({
        event: 'generation.stopped',
        userId,
        runId,
        microUsd: charged,
        measured: spent !== undefined,
      }),
    );
  }
  return charged;
}

export async function handleRun(
  request: Request,
  env: RunControlEnv,
  deps: RunControlDeps,
): Promise<Response> {
  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Builds are not configured for this deployment.' },
      503,
    );
  }
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'DELETE') {
    return json({ error: 'Use GET, DELETE.' }, 405);
  }

  if (method === 'DELETE') {
    // A DELETE carries no body, so only the origin is checked, as a
    // project's DELETE is: a cross-site page that could reach this would be
    // stopping somebody's build.
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
      return json({ error: 'Cross-site requests are not allowed.' }, 403);
    }
    // Per address, before identity, as `/api/plan` is, and failing open for
    // the reason it does. Only the stop: the builder asks after a build
    // every poll, which this limit is not sized for.
    if (deps.ipLimit) {
      try {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const result = await deps.ipLimit.limit({ key: `ip:${ip}` });
        if (!result.success) {
          return json({ error: 'Too many requests from this address.' }, 429);
        }
      } catch (error) {
        console.error('IP rate limiter unavailable', error);
      }
    }
  }

  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;

  const runId = runIdInPath(new URL(request.url).pathname);
  if (!isProjectId(runId)) return NOT_FOUND();

  const now = (deps.now ?? (() => new Date()))();
  const projects = new ProjectStore(env.DB, env.PROJECT_CONTENT);
  const generation = new D1GenerationStore(env.DB, env.PROJECT_CONTENT);
  const load = () => projects.runStages(userId, runId);

  if (method === 'GET') {
    const view = await describeRun(load, generation, runId, now, deps);
    if (!view) return NOT_FOUND();
    if (view.state === 'running') {
      // Never a reason to fail the answer: without it the builder shows the
      // lifecycle as its own status says, which is what it did before.
      const progress = deps.progressOf
        ? await deps.progressOf(runId).catch(() => undefined)
        : undefined;
      const phase = phaseFor('running', progress);
      return json({ run: phase ? { ...view, phase } : view, snapshot: null });
    }
    // The code with the answer, when the build moved the project to it: a
    // builder that was not streaming the build has none of it, and asking
    // for the whole project again would be a second request for the same
    // thing.
    let snapshot = null;
    let summary: string | undefined;
    if (view.state === 'accepted') {
      const rows = await load();
      const accepted = await generation.loadAccepted(rows[0]!.project_id);
      if (accepted && accepted.revision === view.revision) {
        snapshot = { revision: accepted.revision, files: accepted.files };
      }
      // What the build said it made, which a builder settling the turn by
      // asking would otherwise not have: its turn read "9 files", and the
      // conversation told the agent "Built it (9 files)".
      summary = await summaryOf(deps, runId, view.revision);
    }
    return json({ run: summary ? { ...view, summary } : view, snapshot });
  }

  // DELETE: stop it.
  const rows = await load();
  if (rows.length === 0) return NOT_FOUND();
  if (rows.some(unended)) {
    if (deps.terminate) {
      try {
        await deps.terminate(runId);
      } catch (error) {
        // Terminating an instance that has already stopped is refused by
        // the engine, and that is a stop that happened. Anything else is a
        // build still running, and the caller is told so rather than shown
        // a stop that did not happen.
        const status = await readStatus(deps, runId);
        const cutoff = now.getTime() - RUN_IN_FLIGHT_MS;
        const gone =
          status === undefined
            ? rows
                .filter(unended)
                .every((row) => Date.parse(row.updated_at) <= cutoff)
            : INSTANCE_ENDED.has(status);
        if (!gone) {
          console.error('build could not be stopped', { runId, error });
          return json(
            { error: 'The build could not be stopped. It is still running.' },
            503,
          );
        }
      }
    }
    await generation.settleRun(runId, 'cancelled');
  }
  // Idempotent: a build that had already ended is answered with how it
  // ended, and a second stop is answered like the first.
  const view = viewOf(runId, await load());
  // Only a run that is cancelled, which only a stop makes it: one that
  // finished settled what it measured, and one that failed is not this
  // route's to charge. Asked again on a second stop, so one whose first
  // settlement failed gets another try, and one that succeeded is left
  // exactly as it is.
  if (view.state === 'cancelled' && deps.settleStopped) {
    try {
      await deps.settleStopped(runId, userId);
    } catch (error) {
      // The build is stopped either way, and the reclaim still closes what
      // this could not. Telling the caller the stop failed would be false.
      console.error('could not settle a stopped run', { runId, error });
    }
  }
  return json({ run: view });
}
