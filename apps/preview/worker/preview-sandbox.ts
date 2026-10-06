import { Sandbox } from '@cloudflare/sandbox';
import { networkFailure } from './build-failure.ts';
import {
  budgeted,
  isMediaPath,
  OUT_OF_TIME,
  referencedMedia,
  serveLibraryMedia,
  withinDeadline,
} from '@vibld/core';
import type { MediaBucket, MediaLibraryDb } from '@vibld/core';
import {
  OUTPUT_DIRS,
  admit,
  collectOutput,
  findOutput,
  writeFiles,
} from './build-files.ts';
import { destroyWithin, releaseWithin } from './teardown.ts';
import type { BuildFailureReason } from './build-failure.ts';
import type { ProjectFile } from '@vibld/core';
import type { EnqueueResult, PreviewFleet } from './preview-fleet.ts';
import { HARD_LIFETIME_MS } from './fleet.ts';
import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
  BUILD_WALL_CLOCK_MS,
  FLEET_CALL_TIMEOUT_MS,
  LOCK_RENEWAL_INTERVAL_MS,
  MAX_DESTROY_WAIT_MS,
  TEARDOWN_WALL_CLOCK_MS,
} from './build-limits.ts';
// The one fleet instance that counts every container, previews and builds
// alike: see `capacity.ts` for how the budget is shared (internal issue 197).
import { FLEET_NAME } from './capacity.ts';
import { FREE_PREVIEW_LIMIT_ERROR } from './free-previews.ts';
import {
  DEV_COMMAND,
  PREVIEW_INSTALL_TIMEOUT_MS,
  PROVISION_LOST_ERROR,
  provisionLost,
  provisionPreview,
} from './provision.ts';
import {
  applyLiveUpdate,
  describeFiles,
  filesProblem,
  planUpdate,
} from './live-update.ts';
import type {
  LiveUpdateResult,
  LiveUpdateSteps,
  ServedFiles,
} from './live-update.ts';

/**
 * Vibld's own untrusted-execution sandbox (ADR-0004; docs/decisions.md L7,
 * L9, L11). One instance per preview, addressed by
 * `getSandbox(env.Sandbox, userId, { normalizeId: true })` -- see
 * `worker/index.ts`.
 *
 * L9's per-user concurrency limit ("1 concurrent preview per user") needs no
 * code of its own here: the caller always names this instance by the user's
 * own id, so starting a second preview for the same user reuses this same
 * Durable Object rather than creating a competing one. `sleepAfter` is L9's
 * idle half (10 minutes, the SDK's own default -- set explicitly so a future
 * default change can't silently move it).
 *
 * The 30-minute hard lifetime is enforced lazily, on the next call that
 * touches this preview (`startPreview`/`getPreviewStatus`/`stopPreview`),
 * the same way `apps/web/worker/budget.ts` reclaims an abandoned spend
 * reservation on the next `reserve()` rather than through a scheduled alarm
 * -- deliberately: `Container`'s own `alarm()` already owns this object's
 * one Durable Object alarm slot for `sleepAfter`, and a second, competing
 * `setAlarm()` call here would fight it rather than add to it.
 *
 * L11 (deny sandbox egress by default, package registry only): `Container`
 * defaults `enableInternet` to `true`, so it is set to `false` explicitly
 * here rather than relied on. `interceptHttps` is required too -- the
 * registry is HTTPS, and without it the allowlist only ever sees plaintext
 * HTTP, which nothing a generated project's `npm install` actually sends.
 *
 * L10 (sharing: "a signed, revocable, time-limited URL"): `createShare`/
 * `listShares`/`revokeShare`/`proxyShared` below. Grants live in this same
 * Durable Object's own SQLite storage (a `shares` table, the same
 * `ctx.storage.sql` idiom `preview-fleet.ts`'s queue table already uses) --
 * no new binding, since this instance already owns everything else about
 * the preview a share points at. `worker/share-token.ts` is the "signed"
 * half (an HMAC the Worker layer verifies before ever calling in here);
 * this class is the "revocable" half -- a grant row this method finds
 * `revoked_at IS NULL` for, checked fresh on every proxied request, is what
 * lets a share be killed independently of the preview it points at.
 */

export interface Env {
  Fleet: DurableObjectNamespace<PreviewFleet>;
  /**
   * The media library, read-only (`serveLibraryMedia`): the same D1 and R2
   * apps/web writes uploads to. Optional, so a deployment without them
   * previews exactly as before and a `/media/` request falls through to the
   * dev server.
   */
  DB?: MediaLibraryDb;
  PROJECT_CONTENT?: MediaBucket;
}

/** Whose media library this sandbox's previews serve `/media/` from. */
const MEDIA_OWNER_KEY = 'media-owner';

/**
 * Which of that library the previewed files reference, and so the only
 * part of it a `/media/` request here may read. A preview can be shared,
 * and the library is the whole account's.
 */
const MEDIA_ALLOWED_KEY = 'media-allowed';

/**
 * Which files the running preview was given, as digests (D74,
 * `live-update.ts`'s `ServedFiles`). What a live update diffs against, so
 * it is written wherever the files the dev server runs change, and nowhere
 * else. A preview with none recorded (one started before D74, or one an
 * update left half-written) is never updated in place, only restarted.
 */
const SERVED_KEY = 'vibld:preview-files';

/**
 * The sandbox's id for the running dev server process, so a live update
 * that installs new dependencies can stop it and start another in the same
 * container. Absent means it cannot, and such an update is a restart.
 */
const DEV_PROCESS_KEY = 'vibld:preview-dev';

/**
 * The least of its lifetime a preview must have left to install new
 * dependencies in place. Less than this and the install would be cut short
 * by the preview's own end, so the update is refused and the builder
 * restarts, which begins a new lifetime.
 */
const MIN_UPDATE_INSTALL_MS = 60_000;

/**
 * How long the pre-preview typecheck may take before it is abandoned.
 *
 * Generous against what it measures and strict against what it can cost.
 * `tsc --noEmit` over a generated project is seconds on a container that
 * has just finished `npm install`, so ninety seconds is not a budget
 * anything real is expected to approach. It is a bound on the case where
 * the script does not terminate at all (internal PR 195 review): the prompt requires
 * a "typecheck" script to exist and cannot require it to exit, and a
 * `--watch` variant would otherwise hold a fleet slot until the preview's
 * hard lifetime ran out.
 */
const TYPECHECK_TIMEOUT_MS = 90_000;

type Phase = 'queued' | 'installing' | 'starting' | 'ready' | 'failed';

/**
 * Why a build did not produce output, as a value rather than as prose.
 * Declared in `build-failure.ts`, beside the list it is derived from, and
 * re-exported here because this is the module callers of the build have.
 */
export type { BuildFailureReason } from './build-failure.ts';

export type BuildOutcome =
  | { files: ProjectFile[]; skipped: string[] }
  | { reason: BuildFailureReason; error: string };

interface PreviewState {
  phase: Phase;
  startedAt: number;
  fleetTicketId: number;
  url?: string;
  expiresAt?: number;
  error?: string;
  typecheckFailure?: string;
  /**
   * The revision the dev server is serving, when the caller named one
   * (D74). Moved on by a live update only once every file is written, and
   * cleared when one stops part way, since the sandbox then serves neither.
   */
  revision?: string;
}

const STORAGE_KEY = 'vibld:preview';

/**
 * When the build running in this instance started, while one is.
 *
 * Its own key rather than the preview's state: since internal PR 196 a build runs in
 * an instance named for building, where `STORAGE_KEY` is never written at
 * all, and what it needs to exclude is another build rather than a preview.
 */
const BUILD_LOCK_KEY = 'vibld:build';

/** The lock a build holds, and the token that says whose it is. */
interface BuildLock {
  startedAt: number;
  token: string;
}

export interface PreviewStatus {
  status: Phase | 'ready-to-start';
  position?: number;
  url?: string;
  expiresAt?: number;
  error?: string;
  /**
   * What `npm run typecheck` printed when it failed (internal issue 194).
   *
   * Named for the command rather than for the compiler, because the script
   * is the generated manifest's to declare and need not be `tsc` (internal PR 195
   * review). What is known is that the project's own typecheck exited
   * non-zero and said this.
   *
   * Never an error: the preview started, and this is a finding about the
   * project rather than about the run. Present only when the typecheck
   * actually failed, so absent means clean, not declared, or not asked.
   */
  typecheckFailure?: string;
  /** The revision being served, when one is known (D74). */
  revision?: string;
}

/**
 * What asking a running preview to take a new revision came to (D74).
 *
 * - `applied`: the files are in and the dev server has them; `status` is
 *   the preview as it now is.
 * - `installing`: new dependencies are being installed; poll the status,
 *   which says `installing` until the update ends as `ready` or `failed`.
 * - `busy`: a start-up or another update is running here; poll, and ask
 *   again once it has settled.
 * - `restart`: this preview cannot be updated in place, for `reason`. The
 *   caller restarts it (stop, then start), which is the path that existed
 *   before D74.
 * - `invalid`: the request itself was refused, and nothing was touched.
 */
export type UpdateOutcome =
  | { outcome: 'applied'; status: PreviewStatus }
  | { outcome: 'installing' }
  | { outcome: 'busy' }
  | { outcome: 'restart'; reason: string }
  | { outcome: 'invalid'; error: string };

/** L10's default and ceiling for how long a share grant lasts, independent of (but still capped by) the preview's own remaining L9 lifetime. */
const SHARE_LIFETIME_MS = 24 * 60 * 60_000;

export interface ShareGrant {
  id: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

interface ShareRow {
  id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

function shareGrantFrom(row: ShareRow): ShareGrant {
  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class PreviewSandbox extends Sandbox<Env> {
  sleepAfter = '10m';
  enableInternet = false;
  interceptHttps = true;
  // Package tarballs and metadata alike are served from the registry host
  // itself -- npm has no separate CDN, and neither esbuild's nor Rollup's
  // platform binaries need one, since both ship as ordinary npm
  // optionalDependencies. Widen this only with evidence a real install
  // needed a host that isn't here, not speculatively.
  allowedHosts = ['registry.npmjs.org'];

  /**
   * Whether this instance is running a preview's start-up now. In memory on
   * purpose: the start-up lives in the instance that began it, so a new
   * instance starts at false, which is how `settleLostProvision` knows a
   * stored `installing` or `starting` was left by one that is gone.
   */
  private provisioning = false;

  /**
   * Whether this instance is running a live update that installs new
   * dependencies (D74). In memory for the same reason as `provisioning`:
   * such an update writes `installing` and runs past the call that began
   * it, so an instance that finds `installing` stored with neither flag set
   * has found one that was lost with an earlier instance, and settles it
   * the same way (`settleLostProvision`).
   */
  private updating = false;

  /**
   * Live updates, one at a time. Each writes files into /workspace across
   * several awaits, and the input gate opens at every one of them, so two
   * that overlapped would interleave their writes and each record a set of
   * files the other had changed underneath it.
   */
  private updates: Promise<unknown> = Promise.resolve();

  /**
   * Start (or report progress on, or resume after queueing) a preview of
   * `files`. `label` is metadata only, passed straight to `PreviewFleet` for
   * observability -- never a limit key.
   *
   * Returns as soon as the immediate outcome is known -- queued, or
   * provisioning has begun -- rather than waiting for the whole install and
   * dev-server boot to finish. A generated project's `npm install` can take
   * well past what a browser (or an intermediate proxy) will wait on a
   * single request for, the same reason `/api/plan` streams instead of
   * buffering. The caller polls `getPreviewStatus()` for the rest.
   */
  async startPreview(
    files: ProjectFile[],
    hostname: string,
    label: string,
    // The Clerk user id this sandbox belongs to, whose media library a
    // `/media/` request to this preview reads. The sandbox's own name is
    // that id lower-cased (`normalizeId`), which cannot be turned back into
    // it, so it is recorded here by the caller that knows it.
    owner?: string,
    // Which checkpoint these files are, when the caller knows (D74).
    revision?: string,
    // The account is on the Free plan (D158): the fleet holds the start to
    // the account's daily limit and keeps it out of the containers kept for
    // paid plans. The account is `owner`, whose preview this is wherever it
    // runs, so a shared link draws on the same day as the builder.
    free = false,
  ): Promise<PreviewStatus> {
    // A start-up lost with an earlier instance is a failed one, so this
    // start is a retry rather than a report of it (`settleLostProvision`).
    const existing = await this.settleLostProvision(await this.readState());
    const fleet = this.env.Fleet.getByName(FLEET_NAME);

    // A failed attempt is a finished one, not an in-progress one -- it must
    // not block a retry for up to the full hard lifetime. Restarting after
    // an already-ready or in-progress preview, though, reports that one
    // rather than replacing it: call `stopPreview()` first for a clean
    // restart against new files. Comparing file sets to detect "these are
    // different, restart" is a real refinement, just not this one's.
    if (existing && !this.isExpired(existing) && existing.phase !== 'failed') {
      if (existing.phase !== 'queued') {
        // Already installing, starting or ready: report it. This is not a
        // second preview -- it is the same one, asked about again.
        return this.describe(existing);
      }
      // Still queued: check the *same* ticket rather than enqueueing a new
      // one, or every retry would push this caller to the back of the line.
      // It carries the plan as it is now, which may not be the one it was
      // queued under (internal PR 376 review).
      const ticket = await fleet.status(existing.fleetTicketId, {
        free,
        account: owner ?? label,
      });
      if (ticket.limited) return this.limitedWhileQueued(existing);
      if (!ticket.active) {
        return { status: 'queued', position: ticket.position };
      }
      await this.recordMedia(owner, files);
      await this.recordServed(files);
      await this.beginProvisioning(
        existing.startedAt,
        existing.fleetTicketId,
        files,
        hostname,
        revision,
      );
      return { status: 'installing' };
    }

    const startedAt = Date.now();
    const ticket = await fleet.enqueue(label, 'preview', free, owner ?? label);
    // Refused for the day, before any row was written: nothing to give back.
    if (ticket.limited) {
      return { status: 'failed', error: FREE_PREVIEW_LIMIT_ERROR };
    }
    if (!ticket.active) {
      await this.writeState({
        phase: 'queued',
        startedAt,
        fleetTicketId: ticket.id,
      });
      return { status: 'queued', position: ticket.position };
    }
    await this.recordMedia(owner, files);
    await this.recordServed(files);
    await this.beginProvisioning(
      startedAt,
      ticket.id,
      files,
      hostname,
      revision,
    );
    return { status: 'installing' };
  }

  /**
   * A queued Free preview the fleet closed because its account's day ran
   * out while it waited (D158). Written as a failure, so the next start is
   * a new one and is refused, or admitted tomorrow, on its own terms. The
   * fleet already closed the row, so there is no slot to give back.
   */
  private async limitedWhileQueued(
    state: PreviewState,
  ): Promise<PreviewStatus> {
    await this.writeState({
      phase: 'failed',
      startedAt: state.startedAt,
      fleetTicketId: state.fleetTicketId,
      error: FREE_PREVIEW_LIMIT_ERROR,
    });
    return { status: 'failed', error: FREE_PREVIEW_LIMIT_ERROR };
  }

  /**
   * What the dev server is about to be given, as `live-update.ts` diffs
   * it. Written beside `recordMedia`, before the files go in, for the same
   * reason: this describes the files being provisioned now, and a start
   * that fails leaves a `failed` phase no update will act on.
   */
  private async recordServed(files: ProjectFile[]): Promise<void> {
    await this.ctx.storage.put<ServedFiles>(
      SERVED_KEY,
      await describeFiles(files),
    );
  }

  /**
   * Take a new revision into the preview that is running, without a
   * restart (D74).
   *
   * Only the files that differ from what the sandbox is serving are
   * written, deleted ones are removed, and Vite's watcher reloads the page.
   * When the dependencies changed the install runs first, under the
   * `installing` phase, and this returns before it ends; the caller polls
   * `getPreviewStatus` as it does for a start.
   *
   * Everything this does happens inside the preview that already exists:
   * it takes no fleet ticket, moves no clock (the hard lifetime still runs
   * from the original start, and the install is bounded by what is left of
   * it), and runs under the same egress allowlist. Anything it cannot do in
   * place it refuses as `restart` with a reason, and the caller restarts,
   * which is the path that existed before.
   */
  async updatePreview(
    files: ProjectFile[],
    revision: string,
  ): Promise<UpdateOutcome> {
    const problem = filesProblem(files);
    if (problem) return { outcome: 'invalid', error: problem };
    const turn = this.updates.then(() => this.liveUpdate(files, revision));
    this.updates = turn.catch(() => undefined);
    return turn;
  }

  private async liveUpdate(
    files: ProjectFile[],
    revision: string,
  ): Promise<UpdateOutcome> {
    const refuse = (code: string, reason: string): UpdateOutcome => {
      console.log('preview.update-refused', JSON.stringify({ reason: code }));
      return { outcome: 'restart', reason };
    };
    // A start-up, or an update's install, owns the workspace until it
    // ends. Asked to wait rather than refused, because nothing is wrong:
    // the caller asks again once the status settles.
    if (this.provisioning || this.updating) return { outcome: 'busy' };

    const state = await this.settleLostProvision(await this.readState());
    if (!state || state.phase !== 'ready' || !state.url) {
      return refuse('not-running', 'The preview was not running.');
    }
    if (this.isExpired(state)) {
      return refuse('expired', "The preview's time limit was reached.");
    }
    const served = await this.ctx.storage.get<ServedFiles>(SERVED_KEY);
    if (!served) {
      return refuse(
        'unrecorded',
        'The preview does not know which files it is serving.',
      );
    }

    const next = await describeFiles(files);
    const plan = planUpdate(served, next, files);
    if (plan.write.length === 0 && plan.remove.length === 0) {
      // Already serving these files, under whatever name: say so under
      // this one, without touching the container.
      const same: PreviewState = { ...state, revision };
      await this.writeState(same);
      console.log(
        'preview.updated',
        JSON.stringify({ ms: 0, written: 0, removed: 0, installed: false }),
      );
      return { outcome: 'applied', status: this.describe(same) };
    }

    const devProcess = await this.ctx.storage.get<string>(DEV_PROCESS_KEY);
    if (plan.installs && !devProcess) {
      return refuse(
        'no-dev-process',
        'The dev server cannot be restarted in place for the new dependencies.',
      );
    }
    const steps = this.liveUpdateSteps(devProcess);
    // A first start's bound, cut down to what is left of this preview's
    // lifetime: an install that outlived the preview would be spending a
    // fleet slot the fleet has already reclaimed.
    const installTimeoutMs = budgeted(
      PREVIEW_INSTALL_TIMEOUT_MS,
      state.startedAt + HARD_LIFETIME_MS - Date.now(),
    );
    // A restart starts a fresh lifetime, so it is the better answer for an
    // install that would have to race this one's end.
    if (plan.installs && installTimeoutMs < MIN_UPDATE_INSTALL_MS) {
      return refuse(
        'expiring',
        'The preview is too close to its time limit to install new dependencies.',
      );
    }

    if (!plan.installs) {
      const result = await applyLiveUpdate(plan, steps, { installTimeoutMs });
      if (!(await this.stillServing(state))) {
        return refuse('stopped', 'The preview was stopped during the update.');
      }
      if (result.ok) {
        return this.finishUpdate(state, next, files, revision, result);
      }
      await this.forgetServed(state, result.touched);
      return refuse('failed', result.error);
    }

    // Set before the phase is written, so no read in this instance can see
    // this update's `installing` without it (`settleLostProvision`).
    this.updating = true;
    try {
      await this.writeState({ ...state, phase: 'installing' });
    } catch (error) {
      this.updating = false;
      throw error;
    }
    this.ctx.waitUntil(
      applyLiveUpdate(plan, steps, { installTimeoutMs })
        .then(async (result) => {
          // Stopped (or replaced by a new start) while it installed: that
          // preview is gone, and neither ending may be written over it.
          if (!(await this.stillServing(state))) return;
          if (result.ok) {
            await this.finishUpdate(state, next, files, revision, result);
            return;
          }
          await this.failUpdate(state, result.error);
        })
        .catch(async (error: unknown) => {
          if (!(await this.stillServing(state))) return;
          await this.failUpdate(
            state,
            error instanceof Error ? error.message : 'The update failed.',
          );
        })
        .finally(() => {
          this.updating = false;
        }),
    );
    return { outcome: 'installing' };
  }

  /**
   * Whether the preview an update began on is still the one stored.
   *
   * An update awaits the container many times, and a stop can land in any
   * of those gaps. Writing `ready` (or `failed`) afterwards would bring a
   * stopped preview back as a state with nothing behind it, so an update
   * writes its ending only over the preview it began on: the same start
   * and the same fleet ticket.
   */
  private async stillServing(began: PreviewState): Promise<boolean> {
    const now = await this.readState();
    return (
      now !== undefined &&
      now.startedAt === began.startedAt &&
      now.fleetTicketId === began.fleetTicketId &&
      (now.phase === 'ready' || now.phase === 'installing')
    );
  }

  /** The container, as `live-update.ts` asks for it. */
  private liveUpdateSteps(devProcess: string | undefined): LiveUpdateSteps {
    return {
      exec: (command, options) => this.exec(command, options),
      write: async (path, content) => {
        const dir = path.slice(0, path.lastIndexOf('/'));
        if (dir && dir !== '/workspace') {
          await this.mkdir(dir, { recursive: true });
        }
        await this.writeFile(path, content);
      },
      // Removing a file that is not there is the state being asked for,
      // not a failure: somebody's own code may have deleted it already.
      remove: async (path) => {
        if ((await this.exists(path)).exists) await this.deleteFile(path);
      },
      typecheck: () => this.typecheck(),
      // A kill that fails (the process already gone, say) is not the
      // answer: whether the port is free is, and `applyLiveUpdate` waits
      // for that and fails the update if it never comes.
      stopDevServer: async () => {
        if (devProcess) await this.killProcess(devProcess).catch(() => {});
      },
      startDevServer: async () => {
        const dev = await this.startProcess(DEV_COMMAND, {
          cwd: '/workspace',
        });
        await this.ctx.storage.put(DEV_PROCESS_KEY, dev.id);
        return dev;
      },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      log: (event, fields) => console.log(event, JSON.stringify(fields)),
    };
  }

  /**
   * An update that got every file in: record what is served now, which
   * media its code may reference, and the revision, as one moment.
   */
  private async finishUpdate(
    before: PreviewState,
    next: ServedFiles,
    files: ProjectFile[],
    revision: string,
    result: Extract<LiveUpdateResult, { ok: true }>,
  ): Promise<UpdateOutcome> {
    await this.ctx.storage.put<ServedFiles>(SERVED_KEY, next);
    // The allowlist follows the code the dev server now runs, in both
    // directions: an image the new revision references is served, and one
    // it no longer references stops being.
    const owner = await this.ctx.storage.get<string>(MEDIA_OWNER_KEY);
    await this.recordMedia(owner, files);
    const ready: PreviewState = {
      phase: 'ready',
      startedAt: before.startedAt,
      fleetTicketId: before.fleetTicketId,
      ...(before.url ? { url: before.url } : {}),
      ...(before.expiresAt ? { expiresAt: before.expiresAt } : {}),
      revision,
      ...(result.typecheckFailure
        ? { typecheckFailure: result.typecheckFailure }
        : {}),
    };
    await this.writeState(ready);
    return { outcome: 'applied', status: this.describe(ready) };
  }

  /**
   * An update that stopped without its install: the preview is left
   * running and still ready, since the dev server is up, but when files
   * were written it is serving neither revision, so it stops saying it
   * serves the old one and refuses any further update in place.
   */
  private async forgetServed(
    state: PreviewState,
    touched: boolean,
  ): Promise<void> {
    if (!touched) return;
    await this.ctx.storage.delete(SERVED_KEY);
    const { revision: _served, ...rest } = state;
    await this.writeState(rest);
  }

  /**
   * An update whose install, or the dev server's restart after it, failed.
   *
   * Written as a failure, with the fleet slot given back and the container
   * destroyed, exactly as a failed start is: the dev server may be down,
   * the workspace is half one revision and half the other, and the phase a
   * poll is waiting on has to end. The builder restarts from here, which
   * is the fallback D74 asks for, and a restart is a clean container.
   */
  private async failUpdate(state: PreviewState, why: string): Promise<void> {
    await this.writeState({
      phase: 'failed',
      startedAt: state.startedAt,
      fleetTicketId: state.fleetTicketId,
      error: `The preview could not take the new dependencies. ${why}`,
    });
    await this.ctx.storage.delete(SERVED_KEY);
    await this.env.Fleet.getByName(FLEET_NAME)
      .release(state.fleetTicketId, 'preview')
      .catch(() => {});
    await this.destroy().catch(() => {});
  }

  /**
   * Whose library `/media/` reads, and which of it the files being
   * provisioned reference. Written only where those files are the ones the
   * dev server will run: a start that reports a preview already running
   * leaves the list describing that preview, not files it never loaded.
   */
  private async recordMedia(
    owner: string | undefined,
    files: ProjectFile[],
  ): Promise<void> {
    if (!owner) return;
    await this.ctx.storage.put({
      [MEDIA_OWNER_KEY]: owner,
      [MEDIA_ALLOWED_KEY]: referencedMedia(files),
    });
  }

  /**
   * Never enqueues, never provisions. Safe to poll freely. It writes only
   * to settle a start-up that was lost with an earlier instance, which it
   * does once (`settleLostProvision`).
   */
  async getPreviewStatus(
    // The account's plan as it is now (D158), which a preview still
    // waiting takes in place of the one it was queued under (internal PR 376 review).
    plan?: { free: boolean; account: string },
  ): Promise<PreviewStatus> {
    const state = await this.settleLostProvision(await this.readState());
    if (!state) {
      return { status: 'failed', error: 'No preview has been started.' };
    }
    if (this.isExpired(state)) {
      await this.stopPreview();
      return {
        status: 'failed',
        error: "This preview's time limit was reached. Start a new one.",
      };
    }
    if (state.phase === 'queued') {
      const ticket = await this.env.Fleet.getByName(FLEET_NAME).status(
        state.fleetTicketId,
        plan,
      );
      if (ticket.limited) return this.limitedWhileQueued(state);
      return ticket.active
        ? { status: 'ready-to-start' }
        : { status: 'queued', position: ticket.position };
    }
    return this.describe(state);
  }

  /** Idempotent: stopping a preview that never started, or already stopped, still succeeds. */
  async stopPreview(): Promise<void> {
    const state = await this.readState();
    await this.ctx.storage.delete([STORAGE_KEY, SERVED_KEY, DEV_PROCESS_KEY]);
    if (state) {
      await this.env.Fleet.getByName(FLEET_NAME)
        .release(state.fleetTicketId, 'preview')
        .catch(() => {});
    }
    await this.destroy().catch(() => {});
  }

  /**
   * A one-shot production build of `files` (ADR-0010's Cloudflare
   * auto-publish primary path: apps/web calls this, then hands the result
   * straight to apps/publish's `/internal/publish`; since internal issue 194 the
   * generation workflow calls it too, to find out whether what it just
   * produced compiles). It takes a `PreviewFleet` ticket like a preview
   * does, from the same instance and against the same budget, because it
   * holds one of the platform's containers while it runs; `capacity.ts`
   * states how that budget is shared (internal issue 197). Its ticket is a build's, so
   * it counts against the build bound as well and is refused rather than
   * queued, and two builds for one user are still excluded by this
   * method's own lock rather than by any count.
   *
   * It runs in an instance of its own, named for building rather than for
   * the user's preview (`worker/index.ts`'s `buildSandboxName`), under the
   * same L11 egress restrictions -- untrusted code is untrusted whether or
   * not anything is ever exposed. It used to share the preview's instance
   * and refuse whenever a preview was live, which was correct about the
   * filesystem race and wrong about how often that happens (internal PR 196 review):
   * the Workspace keeps a preview running across submissions and nothing
   * stops it on submit, so the ordinary follow-up edit found the sandbox
   * busy, and the verification this exists for was skipped exactly when a
   * reader was iterating hardest. Two instances cost a second container and
   * buy back both the verification and the ability to publish without
   * stopping the preview first.
   *
   * Only text output is returned. A build that emits binary assets (images,
   * fonts) skips them and reports which paths were skipped, rather than
   * silently mangling them: apps/publish's own R2 usage is text-only today
   * (the same narrowing `apps/web/worker/generation-store.ts`'s R2Bucket
   * interface already applies), so there is nowhere correct to put binary
   * bytes yet.
   */
  async buildProject(files: ProjectFile[]): Promise<BuildOutcome> {
    // Started before anything is awaited, including the lock (internal PR 196 review).
    //
    // It used to start after the lock had been read and written, on the
    // reasoning that those are this object's own storage. Local is not the
    // same as bounded, and it is certainly not the same as inside the
    // bound: a storage call that stalled left `buildProject` with no
    // deadline running at all, so the whole-build guarantee this method
    // advertises did not cover its own first two lines. The caller in
    // `apps/web` stops waiting after its own bound and `/api/publish` has
    // none, so if storage then resumed, the abandoned invocation would
    // take a fleet ticket and run a twelve-minute build for nobody.
    //
    // The round that enumerated every await here classified those two as
    // "this object's own storage" and moved on. That was the wrong
    // question: what matters is not where a call goes but whether the
    // clock is already running when it is made.
    const deadline = Date.now() + BUILD_WALL_CLOCK_MS;
    const bounded = <T>(work: Promise<T>): Promise<T> =>
      withinDeadline(work, deadline - Date.now());

    // Two builds for the same user would still write into the same
    // /workspace at once, which is the filesystem race the old refusal was
    // really about -- a repair's verification build and an auto-publish can
    // overlap. Not a security boundary (both are the same user's own
    // untrusted code either way): a build that read a half-written tree
    // would simply be measuring the wrong project.
    //
    // The lock expires rather than being trusted forever. A build whose
    // container died between taking it and releasing it must not wedge
    // every later build for this user, and nothing else here would ever
    // clear it.
    const held = await bounded(this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY));
    if (held && Date.now() - held.startedAt < BUILD_LOCK_TTL_MS) {
      return {
        reason: 'busy',
        error:
          'Another build is already running for this project. Try again once it has finished.',
      };
    }
    // Read and written with nothing but storage awaited in between, which
    // is what makes taking it atomic (internal PR 196 review).
    //
    // Cloudflare's input gate defers every other event to this object
    // "until such a time as the object is no longer executing JavaScript
    // code and is no longer waiting for any storage operations", so a
    // read followed by a write is a critical section as long as only
    // storage is awaited inside it. Await anything else here -- a
    // `fetch`, a sleep, a service binding -- and the gate opens, a
    // concurrent build reads the same absent lock, and two builds share
    // one workspace. `apps/web/worker/budget.ts` makes the same point from
    // the other side, which is why its reservation is synchronous.
    //
    // `build-reason.test.ts` counts the awaits in here rather than trusting
    // this paragraph, because the guarantee is invisible at the call site:
    // adding one innocuous await is all it takes, and nothing about the
    // code would look wrong afterwards.
    //
    // Taken with a token, and released only while it is still this build's
    // (internal PR 196 review). Expiry alone made the lock unsafe in the one case it
    // was for: once a stale lock let a second build in, the first build's
    // own `finally` deleted the second's lock on its way out, and a third
    // would then walk into the second's workspace. Ownership is what makes
    // release mean "give back mine" rather than "clear whatever is there".
    const token = crypto.randomUUID();
    // A lock written after this gave up ages out on its own after
    // BUILD_LOCK_TTL_MS, which refuses that user's builds as `busy` in the
    // meantime and claims nothing about any project. Bounded and
    // self-healing, unlike a fleet ticket, which is why this one needs no
    // late cleanup of its own.
    await bounded(
      this.ctx.storage.put<BuildLock>(BUILD_LOCK_KEY, {
        startedAt: Date.now(),
        token,
      }),
    );

    // The build's container, counted (internal PR 196 review) and counted in the same
    // budget as every preview (internal issue 197). Subtracting headroom from the preview
    // cap without counting builds let six builds overlap nineteen previews
    // and fill all twenty-five platform slots while the fleet still thought
    // it had room; counting them in an instance of their own fixed that and
    // left previews five short of L9 whenever nothing was building. One
    // counter that knows which rows are builds does both halves: the total
    // cannot pass the platform limit, and builds cannot pass their bound.
    //
    // Refused rather than queued when there is no room: a build has a paid
    // Workflow waiting on its answer, so making it wait behind others
    // spends that Workflow's timeout. The fleet closes a refused build's
    // row itself, so it never stands in line in front of a preview.
    // `busy` is the right refusal, and `worthRepairing` already reads it as
    // saying nothing about the project, so no repair is bought and nothing
    // is claimed.
    // Asked for *inside* the try below rather than before it (internal PR 196 review).
    // `enqueue` is a call to another Durable Object and can reject on its
    // own account; outside the try, that rejection skipped every piece of
    // cleanup and left this user's build lock in storage, so every
    // verification and publish of theirs was refused as `busy` for the next
    // fifteen minutes over a failure that had nothing to do with them.
    let slot: EnqueueResult | undefined;

    /**
     * Whether anything was ever run in the container.
     *
     * A `PreviewSandbox` has no container until something executes in it,
     * so every path that refuses before the first `exec` -- a full fleet,
     * an `enqueue` that rejected -- has nothing to tear down and nothing
     * to account for. Teardown reads this rather than special-casing those
     * paths, which is what let the last version hold a ticket for a
     * refusal it had issued itself (internal PR 196 review).
     */
    let started = false;

    /**
     * Whether this build is still entitled to the workspace: inside its
     * wall clock, and still the owner of the lock (internal PR 196 review).
     *
     * Both halves stop the work rather than only failing to extend it.
     * Renewing was conditional on ownership already, so a superseded build
     * used to renew nothing, learn nothing, and carry on writing into a
     * workspace its successor had emptied. And a build that has run out of
     * time is not entitled to it either: without a bound of its own the
     * lock's TTL and the fleet's hard lifetime were both things a slow
     * build could outlive, which is what made every protection around it a
     * heartbeat that had to cover every single `await`.
     */
    const keepAlive = async (): Promise<boolean> =>
      Date.now() < deadline && (await this.keepLock(token, deadline));

    /**
     * A command's own cap, cut down to what is left (internal PR 196 review).
     *
     * Bounding the calls that had no bound left the ones that did: each
     * command kept its full five minutes however much of the budget had
     * gone, so a compile starting just before the deadline ran five
     * minutes past it, and `REPAIR_BUILD_ALLOWANCE_MS` was funding two
     * builds that could each overrun. A bound that the two slowest things
     * in the build ignore is not a bound.
     */
    const within = (cap: number): number =>
      budgeted(cap, deadline - Date.now());

    /** What a build that was stopped says: nothing about the project. */
    const stopped: BuildOutcome = {
      reason: 'sandbox',
      error:
        'The build was stopped before it finished, so nothing was measured about this project.',
    };

    try {
      // Bounded like every other cross-object call here (internal PR 196 review).
      // Awaited directly, a stalled `enqueue` kept the build alive past its
      // own deadline: the lock expired, a successor took the sandbox, and
      // when this finally returned the very next thing it did was empty
      // that successor's workspace.
      //
      // Giving up on it leaves a ticket nobody holds. A build the fleet
      // does not admit has its row closed by the fleet itself (internal issue 197), but
      // one admitted after we stopped waiting holds one of the shared
      // containers, which a preview may be queued for, until it is given
      // back or the fleet reclaims it. So whatever it hands back after we
      // have stopped waiting is given back.
      slot = await admit(
        this.env.Fleet.getByName(FLEET_NAME).enqueue(
          `build:${this.ctx.id.toString()}`,
          'build',
        ),
        bounded,
        async (ticket) => {
          await this.releaseTicket(ticket);
        },
        (work) => this.ctx.waitUntil(work),
      );
      if (!slot.active) {
        return {
          reason: 'busy',
          error:
            'Too many builds are running right now. Try again in a moment.',
        };
      }

      // Emptied first, because this container is reused (internal PR 196 review).
      // `writeProject` writes the paths it is given and removes nothing, so
      // a second build in the same instance compiles the new snapshot on
      // top of whatever the last one left: a file the repair deleted is
      // still there to satisfy an import, and a broken file it replaced by
      // a differently-named one is still there to fail the build. Either
      // way `built` and `repaired` would describe a tree that is not the
      // one handed back, which is the whole thing this feature is for.
      //
      // node_modules goes with it, deliberately, though it costs an install
      // on every build and two on a repair. Keeping it would leave a
      // package installed for an earlier project available to a later one
      // that never declared it, so a project importing something missing
      // from its own package.json would build here and fail anywhere else.
      // That is one of the two production failures behind internal issue 194: this check
      // is worth having only if it measures what a clean environment sees.
      // Asked before the first thing that touches the container, not
      // only between the steps that follow it (internal PR 196 review). Everything
      // above this point can take time -- the admission most of all -- and
      // the clear is destructive: starting it without knowing the lock is
      // still ours is how a build that had been superseded emptied its
      // successor's workspace.
      if (!(await keepAlive())) return stopped;

      started = true;
      // Bounded like every other call here. Left direct, this one could
      // stall past the deadline without ever reaching the teardown, and a
      // late `rm -rf /workspace` would then empty a successor's tree
      // (internal PR 196 review).
      const cleared = await bounded(
        this.exec('rm -rf /workspace', { cwd: '/' }),
      );
      if (!cleared.success) {
        return {
          reason: 'sandbox',
          error: `The build workspace could not be emptied (exit ${cleared.exitCode}).`,
        };
      }
      await bounded(this.mkdir('/workspace', { recursive: true }));

      // Renewed at every boundary between bounded and unbounded work, so
      // the TTL is measuring silence rather than project size, and inside
      // this stretch as well as after it: writing the project in is one or
      // two RPCs per file, and a big enough project outran the lock while
      // the renewal sat waiting for the loop to finish (internal PR 196 review).
      if (!(await this.writeProject(files, keepAlive, bounded))) return stopped;
      if (!(await keepAlive())) return stopped;

      const installStartedAt = Date.now();
      const installTimeout = within(BUILD_INSTALL_TIMEOUT_MS);
      const install = await this.exec('npm install --no-audit --no-fund', {
        cwd: '/workspace',
        timeout: installTimeout,
      });
      if (!install.success) {
        // A command that reached its bound was stopped, and being stopped
        // says nothing about the project: `sandbox` rather than `install`,
        // so no repair is bought on the strength of it. Checked here as
        // well as bounded above for `typecheck`'s reason -- whether the SDK
        // reports its own timeout as a rejection or as an unsuccessful
        // result is its business, and an "install failure" that was really
        // a stopwatch would be this method inventing one.
        if (Date.now() - installStartedAt >= installTimeout) {
          return {
            reason: 'sandbox',
            error: 'npm install did not finish within the time allowed.',
          };
        }
        // A registry or DNS outage is not the project's fault, and it
        // exits fast rather than reaching the timeout above, so the clock
        // cannot tell them apart (internal PR 196 review). Left as `install` it buys
        // a repair: a second paid model call asked to fix a project that
        // compiles perfectly well, whose reply cannot help, on a day when
        // npm is having trouble and every caller hits it at once.
        //
        // Matching on wording, which internal issue 194 deliberately moved away from for
        // the *caller's* decision -- but the caller decides from a typed
        // reason, and this is where that reason is worked out. npm's own
        // error codes are the only signal there is, and erring toward
        // `sandbox` is the cheap direction: at worst a genuine dependency
        // error goes unrepaired, which spends nothing and claims nothing.
        return {
          reason: networkFailure(install.stderr) ? 'sandbox' : 'install',
          error: `npm install failed (exit ${install.exitCode}): ${install.stderr.slice(-2000)}`,
        };
      }

      if (!(await keepAlive())) return stopped;
      const buildStartedAt = Date.now();
      const compileTimeout = within(BUILD_COMPILE_TIMEOUT_MS);
      const build = await this.exec('npm run build', {
        cwd: '/workspace',
        timeout: compileTimeout,
      });
      if (!build.success) {
        if (Date.now() - buildStartedAt >= compileTimeout) {
          return {
            reason: 'sandbox',
            error: 'npm run build did not finish within the time allowed.',
          };
        }
        // stdout first, and stdout at all: `tsc` writes its diagnostics
        // there, and `build` runs `tsc --noEmit` before it bundles
        // anything. Reporting stderr alone told somebody whose publish was
        // blocked by a type error that npm had exited 2, and nothing else
        // (internal issue 194).
        const said = [build.stdout, build.stderr]
          .map((stream) => stream.trim())
          .filter((stream) => stream.length > 0)
          .join('\n');
        return {
          reason: 'build',
          error: `npm run build failed (exit ${build.exitCode}): ${said.slice(-2000)}`,
        };
      }

      if (!(await keepAlive())) return stopped;
      // Wherever the project's build tool put it (`OUTPUT_DIRS`): a Vite
      // project writes `dist/`, the marketing template `build/client`.
      // A directory that does not exist is "not here", however the SDK
      // chooses to say so; running out of time is still "stop".
      const found = await findOutput(async (dir) => {
        try {
          const listing = await bounded(
            this.listFiles(`/workspace/${dir}`, { recursive: true }),
          );
          return {
            success: listing.success,
            files: listing.success ? listing.files : [],
          };
        } catch (error) {
          if (error instanceof Error && error.message === OUT_OF_TIME) {
            throw error;
          }
          return { success: false, files: [] };
        }
      });
      if (!found) {
        return {
          reason: 'output',
          error: `The build succeeded but wrote no files to any of ${OUTPUT_DIRS.join(', ')}.`,
        };
      }
      const outputDir = `/workspace/${found.dir}`;
      const listing = { files: found.files };

      // One RPC per output file, so the longest unbounded stretch here and
      // the one most likely to outrun a TTL. It lives in `build-files.ts`
      // so it can be called with fakes rather than read with regexes
      // (internal PR 196 review): the renewal used to count the files it kept rather
      // than the files it read, and nothing that reads this file as source
      // was ever going to notice.
      const { output, skipped, complete } = await collectOutput(
        listing.files,
        (relativePath) =>
          bounded(this.readFile(`${outputDir}/${relativePath}`)),
        keepAlive,
      );
      // Half an output tree is not this project's output, and publishing
      // or verifying against it would be a claim about files nobody read.
      if (!complete) return stopped;
      if (output.length === 0) {
        return {
          reason: 'output',
          error: `The build produced no readable output in ${found.dir}.`,
        };
      }
      return { files: output, skipped };
    } catch (error) {
      if (error instanceof Error && error.message === OUT_OF_TIME) {
        return stopped;
      }
      return {
        reason: 'sandbox',
        error: error instanceof Error ? error.message : 'Build failed.',
      };
    } finally {
      // Not awaited, which is the point (internal PR 196 review). Tearing a container
      // down is not the caller's business: they asked whether their project
      // builds, and by here that is known. Awaiting it put up to ten more
      // minutes of somebody else's problem on a paid Workflow's clock, and
      // made the repair step's own allowance wrong for the second time --
      // `REPAIR_BUILD_ALLOWANCE_MS` budgets for two builds, and a build had
      // quietly grown a teardown.
      //
      // The alternative was to grow that allowance to seventy-five minutes,
      // which fixes the arithmetic by making the product worse. This keeps
      // a build the length of a build.
      //
      // `ctx.waitUntil` is the same idiom `beginProvisioning` already uses
      // here, and the lock is held throughout by `releaseBuild` itself, so
      // a build arriving during a teardown is refused rather than admitted.
      this.ctx.waitUntil(this.releaseBuild(token, slot, started));
    }
  }

  /**
   * Give back what this build was holding, once its container is gone.
   *
   * Its own method because the caller no longer waits for it, and written
   * as the three cases it has rather than as a sequence of steps: every
   * finding on this teardown has been an order nobody enumerated.
   *
   * What has to hold:
   *  - the lock is not given up while this container exists or is being
   *    torn down, or the next build for this user starts inside a container
   *    that is about to die;
   *  - the slot is not given up while this container exists, or the fleet
   *    authorises a container the platform has no room for and the start
   *    simply fails;
   *  - neither is held forever, and neither is: the lock ages out after
   *    BUILD_LOCK_TTL_MS, and `PreviewFleet` reclaims a stale ticket after
   *    its own hard lifetime.
   */
  private async releaseBuild(
    token: string,
    slot: EnqueueResult | undefined,
    started: boolean,
  ): Promise<void> {
    // A clock of its own, because it no longer runs inside the build's
    // (internal PR 196 review). Every storage call below could stay pending, and a
    // teardown that never finishes is one that never reaches its release.
    //
    // Running out of time propagates, exactly as a storage rejection
    // already did, and the ticket is then held rather than released. That
    // is safe only because the fleet reclaims an activated ticket after
    // `HARD_LIFETIME_MS`; a ticket for a build that never started is given
    // back before any of this, below.
    const deadline = Date.now() + TEARDOWN_WALL_CLOCK_MS;
    const bounded = <T>(work: Promise<T>): Promise<T> =>
      withinDeadline(work, deadline - Date.now());

    // A ticket for a build that never started goes back first, and without
    // asking storage anything (internal PR 196 review).
    //
    // Nothing ever ran, so there is no container, so no ownership question
    // arises: the answer the read would give cannot change what happens to
    // this ticket. Ordering it after the read made the release depend on a
    // call that can reject or stall. A refused build's row is closed by the
    // fleet itself (internal issue 197), so what this still protects is an admitted
    // ticket for a build that stopped before its first command: left here,
    // it holds one of the shared containers, which a preview may be queued
    // for, until the fleet reclaims it.
    if (!started) {
      if (slot) await this.releaseTicket(slot.id);
      // The lock is still this build's to give back, but it expires on its
      // own after BUILD_LOCK_TTL_MS and refuses safely in the meantime, so
      // it is the half that may depend on storage answering.
      const held = await bounded(
        this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY),
      );
      if (held?.token === token) {
        await bounded(this.ctx.storage.delete(BUILD_LOCK_KEY));
      }
      return;
    }

    // Confirmed and pushed forward in one go, immediately before the
    // destroy (internal PR 196 review).
    //
    // Reading ownership answered the question and left the lock as old as
    // it already was, and `destroyWithin` does not renew until a whole
    // interval after the destroy is already in flight. The gap that opens
    // is the build's last renewal, plus this teardown's own storage read,
    // plus that interval: about eighteen minutes against a fifteen minute
    // TTL. A successor then finds the lock stale, takes it, starts in this
    // same container, and the destroy already running kills their build.
    // That is the cascade the ownership token was added to stop, arriving
    // from the one direction the token cannot see.
    //
    // A renewal answers both: false means the lock is no longer ours, and
    // true leaves it with a full TTL at the moment the destroy starts, so
    // the first interval cannot run it out. It rejects rather than
    // answering when storage will not say, which holds the ticket, and the
    // fleet reclaims an activated row.
    const ours = await this.renewLock(token, deadline);

    // Only ours is ours to destroy. A build that overran has had its lock
    // taken and is running in this very container, so destroying it would
    // end their build rather than free anything. The "nothing ever ran"
    // case is handled above, before any of this.
    const gone = ours ? await this.destroyHoldingLock(token, deadline) : false;

    // After the container is gone, never before it: a lock given back
    // mid-teardown hands this user's next build a container that is about
    // to die. Re-read rather than trusting `ours`, which was answered
    // before the destroy was awaited.
    if (ours && gone) {
      const still = await bounded(
        this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY),
      );
      if (still?.token === token) {
        await bounded(this.ctx.storage.delete(BUILD_LOCK_KEY));
      }
    }

    // Given back when this container is confirmed gone, and when it was
    // never ours -- in that case whoever took the lock holds a slot of
    // their own, so ours is double-counting a container already accounted
    // for.
    //
    // Held, along with the lock, when the destroy failed. That is a bounded
    // loss of one build slot against a container in an unknown state, and
    // it is the cheaper side: releasing would let the fleet admit a build
    // the platform then refuses to start.
    //
    // Retried before it is given up on: a ticket that is not given back
    // holds one of the shared containers until the fleet reclaims it, and a
    // preview may be queued behind it.
    if (slot && (!ours || gone)) await this.releaseTicket(slot.id);
  }

  /**
   * Give one build ticket back.
   *
   * Retried before it is given up on: a ticket that is not given back
   * holds one of the shared containers until the fleet reclaims it, and a
   * preview may be queued behind it.
   *
   * Its own method because the teardown is no longer the only caller
   * (internal PR 196 review): a build that gave up waiting for `enqueue` has to give
   * back whatever that call eventually hands it, and it is the same
   * release for the same reason.
   */
  private async releaseTicket(ticket: number): Promise<boolean> {
    // Each attempt, not the sequence (internal PR 196 review). `retrying` never
    // reaches its second attempt if the first never settles, so an
    // unbounded call turns the retry into a single unbounded one, and a
    // release that never settles never frees the container it was for.
    return releaseWithin(
      () => this.env.Fleet.getByName(FLEET_NAME).release(ticket, 'build'),
      FLEET_CALL_TIMEOUT_MS,
    );
  }

  /**
   * Mint a new share grant (L10) for the preview currently running here.
   * Multiple grants may be active at once, each independently revocable --
   * requesting a new share does not disturb any other still-active one.
   *
   * Refuses when there is nothing running to share: a grant for a preview
   * that is queued, installing, starting or already gone would only ever
   * resolve to an error once visited.
   */
  async createShare(): Promise<
    { shareId: string; expiresAt: number } | { error: string }
  > {
    const state = await this.readState();
    if (!state || this.isExpired(state) || state.phase !== 'ready') {
      return { error: 'This preview is not currently running.' };
    }
    this.ensureSharesTable();

    const shareId = crypto.randomUUID();
    // Capped by the preview's own remaining lifetime: a share must not
    // outlive the preview it points at, and `proxyShared` would refuse it
    // once the preview itself expires regardless -- this just makes the
    // grant's own stated expiry honest about that rather than advertising
    // a full 24 hours a preview open for another five minutes can't back.
    const expiresAt = Math.min(
      Date.now() + SHARE_LIFETIME_MS,
      state.expiresAt ?? Date.now() + SHARE_LIFETIME_MS,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO shares (id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, NULL)`,
      shareId,
      Date.now(),
      expiresAt,
    );
    return { shareId, expiresAt };
  }

  /** Every grant ever issued for this preview, active or not -- the caller decides what to show. */
  async listShares(): Promise<ShareGrant[]> {
    this.ensureSharesTable();
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue> & ShareRow>(
        `SELECT id, created_at, expires_at, revoked_at FROM shares`,
      )
      .toArray()
      .map(shareGrantFrom);
  }

  /** Idempotent: revoking an already-revoked or unknown grant still succeeds -- there is no state where a caller trying to kill a share should see an error. */
  async revokeShare(shareId: string): Promise<void> {
    this.ensureSharesTable();
    this.ctx.storage.sql.exec(
      `UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      Date.now(),
      shareId,
    );
  }

  /**
   * `/media/<name>` on this sandbox's own preview URL: the owner's uploaded
   * file, after the same token check every other request to the preview
   * passes. `null` when the token does not match, there is no owner or no
   * media binding, or there is no such file, so the caller proxies to the
   * dev server as it would have anyway.
   */
  async serveMedia(
    port: number,
    token: string,
    request: Request,
  ): Promise<Response | null> {
    if (!(await this.validatePortToken(port, token))) return null;
    return (await this.mediaFor(request)) ?? null;
  }

  private async mediaFor(request: Request): Promise<Response | undefined> {
    const { DB, PROJECT_CONTENT } = this.env;
    if (!DB || !PROJECT_CONTENT) return undefined;
    const owner = await this.ctx.storage.get<string>(MEDIA_OWNER_KEY);
    if (!owner) return undefined;
    const allowed = new Set(
      (await this.ctx.storage.get<string[]>(MEDIA_ALLOWED_KEY)) ?? [],
    );
    // A library that cannot be read (D1 or R2 unavailable, or a migration
    // not yet applied) is a file that is not here: the request goes on to
    // the dev server, which answers it as it always did.
    try {
      return await serveLibraryMedia(
        DB,
        PROJECT_CONTENT,
        owner,
        new URL(request.url).pathname,
        request,
        allowed,
      );
    } catch (error) {
      console.error('media library unavailable in preview', error);
      return undefined;
    }
  }

  /**
   * Serve a request a share grant has already been cryptographically
   * verified for (`worker/index.ts`'s `handleSharedPreview` checks the HMAC
   * before ever calling this) -- what is left is the "revocable" half:
   * confirming the grant still exists and has not been revoked or expired.
   *
   * `request` arrives with its path already rewritten to what the running
   * app itself should see (`handleSharedPreview` strips the
   * `/{sandboxId}/{shareId}` prefix the share URL is reached under first).
   * Forwarded as an ordinary outbound `fetch()` to this preview's own real,
   * currently-valid URL rather than by reaching into anything
   * `@cloudflare/sandbox` has not declared public: that URL already routes
   * correctly through this Worker's own entrypoint (`proxyToSandbox`), so
   * this share check is the only new authorization decision being made --
   * everything downstream of it (token validation, stale-container
   * detection, WebSocket upgrades) is the SDK's own existing, tested path,
   * unchanged.
   */
  async proxyShared(request: Request, shareId: string): Promise<Response> {
    this.ensureSharesTable();
    const [grant] = this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue> & ShareRow>(
        `SELECT id, created_at, expires_at, revoked_at FROM shares WHERE id = ?`,
        shareId,
      )
      .toArray();
    if (!grant || grant.revoked_at !== null || grant.expires_at < Date.now()) {
      return new Response(
        'This share link is invalid, expired, or has been revoked.',
        { status: 403 },
      );
    }

    const state = await this.readState();
    if (
      !state ||
      this.isExpired(state) ||
      state.phase !== 'ready' ||
      !state.url
    ) {
      return new Response('This preview is no longer running.', {
        status: 404,
      });
    }

    // The owner's media, after the grant and the preview's own state have
    // both been checked: a share link reaches exactly what the preview
    // shows, and a preview shows its owner's uploads.
    if (isMediaPath(new URL(request.url).pathname.replace(/^\/+/, ''))) {
      const media = await this.mediaFor(request);
      if (media) return media;
    }

    const target = new URL(state.url);
    const requested = new URL(request.url);
    target.pathname = requested.pathname;
    target.search = requested.search;

    // A shared preview is a viewer, never a submitter: nothing here ever
    // forwards a request with a body, so `duplex: 'half'` -- required on
    // Workers only when one might be streamed -- is not needed. If that
    // ever changes, add it back (and the type cast the workers-types
    // version here currently needs for it).
    return await fetch(
      new Request(target, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'manual',
      }),
    );
  }

  private ensureSharesTable(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS shares (
        id         TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      )
    `);
  }

  /**
   * Fire-and-forget from the caller's perspective (`ctx.waitUntil` on the
   * Durable Object's own context, the same idiom `handlePlan` uses to let a
   * generation continue after its response has been sent). Every exit path
   * writes a final phase, so a poller is never left looking at "installing"
   * forever because this threw.
   */
  private async beginProvisioning(
    startedAt: number,
    fleetTicketId: number,
    files: ProjectFile[],
    hostname: string,
    revision: string | undefined,
  ): Promise<void> {
    // Before the phase is written, so no read in this instance can see
    // `installing` without it.
    this.provisioning = true;
    try {
      await this.writeState({
        phase: 'installing',
        startedAt,
        fleetTicketId,
        ...(revision ? { revision } : {}),
      });
    } catch (error) {
      this.provisioning = false;
      throw error;
    }
    this.ctx.waitUntil(
      this.provision(
        files,
        hostname,
        startedAt,
        fleetTicketId,
        revision,
      ).finally(() => {
        this.provisioning = false;
      }),
    );
  }

  /**
   * A stored start-up with nothing running it, written down as the failure
   * it is, with its fleet slot given back; anything else, as it was.
   *
   * `provision` writes a final phase on every exit it gets to take, but an
   * instance the platform replaces takes none: the start-up and the write
   * that would have ended it both go with it (run 36611993082, 2026-09-29).
   * Left alone, the stored `installing` was reported on every poll for the
   * preview's whole hard lifetime, a restart was answered with the same
   * report, and the slot stayed taken. Its container is destroyed as well,
   * since whatever the lost start-up left running in it serves nobody.
   */
  private async settleLostProvision(
    state: PreviewState | undefined,
  ): Promise<PreviewState | undefined> {
    if (
      !state ||
      !provisionLost(state.phase, this.provisioning || this.updating)
    ) {
      return state;
    }
    const failed: PreviewState = {
      phase: 'failed',
      startedAt: state.startedAt,
      fleetTicketId: state.fleetTicketId,
      error: PROVISION_LOST_ERROR,
    };
    await this.writeState(failed);
    console.log(
      'preview.lost',
      JSON.stringify({ phase: state.phase, ms: Date.now() - state.startedAt }),
    );
    await this.env.Fleet.getByName(FLEET_NAME)
      .release(state.fleetTicketId, 'preview')
      .catch(() => {});
    await this.destroy().catch(() => {});
    return failed;
  }

  private async provision(
    files: ProjectFile[],
    hostname: string,
    startedAt: number,
    fleetTicketId: number,
    revision: string | undefined,
  ): Promise<void> {
    const named = revision ? { revision } : {};
    // The steps, their bounds and their logging live in `provision.ts`,
    // where they can be run against fakes. This supplies the container.
    const result = await provisionPreview({
      // Always alive: a preview holds no build lock, so there is nothing
      // to renew and nothing that can take the workspace from it. Its own
      // claim on this sandbox is the fleet ticket, which has a hard
      // lifetime rather than a heartbeat and is `reclaimStale`'s business.
      writeProject: async () => {
        await this.writeProject(
          files,
          async () => true,
          (work) => work,
        );
      },
      setPhase: (phase) =>
        this.writeState({ phase, startedAt, fleetTicketId, ...named }),
      exec: (command, options) => this.exec(command, options),
      // The cheapest place in the product to find out that a generated
      // project does not compile (internal issue 194). Deliberately not a failure: the
      // dev server starts either way, and Vite does not typecheck.
      typecheck: () => this.typecheck(),
      // Its id kept, so a live update that installs new dependencies can
      // restart this server rather than the whole container (D74).
      startProcess: async (command, options) => {
        const dev = await this.startProcess(command, options);
        await this.ctx.storage.put(DEV_PROCESS_KEY, dev.id);
        return dev;
      },
      exposePort: (port) => this.exposePort(port, { hostname }),
      now: () => Date.now(),
      log: (event, fields) => console.log(event, JSON.stringify(fields)),
    });

    if (result.ok) {
      await this.writeState({
        phase: 'ready',
        startedAt,
        fleetTicketId,
        url: result.url,
        expiresAt: startedAt + HARD_LIFETIME_MS,
        ...named,
        ...(result.typecheckFailure
          ? { typecheckFailure: result.typecheckFailure }
          : {}),
      });
      return;
    }
    await this.writeState({
      phase: 'failed',
      startedAt,
      fleetTicketId,
      error: result.error,
    });
    // A failed attempt must not go on occupying an account-wide slot for
    // up to the full hard lifetime (L9) while doing nothing useful with
    // it -- release it the moment the failure is known, same as a normal
    // stop does.
    await this.env.Fleet.getByName(FLEET_NAME)
      .release(fleetTicketId, 'preview')
      .catch(() => {});
  }

  /**
   * `tsc` on the installed project, or nothing at all.
   *
   * `--if-present` because the script is the generated manifest's to
   * declare: the prompt requires a "typecheck" script and a real run has
   * written one, but a project that does not have it must start a preview
   * rather than fail one.
   *
   * Reads stdout as well as stderr, and stdout first, because that is where
   * `tsc` writes its diagnostics and every generated manifest measured so
   * far declares `tsc --noEmit` here. Both streams are reported rather than
   * either assumed, since the script is the project's own. stderr on this
   * path carries npm's wrapper ("exit code 2"), which says nothing a reader
   * can act on, and the same correction applies to `buildProject` below,
   * where it was the whole of what a blocked publish reported.
   *
   * Bounded, and that bound is not a safety margin (internal PR 195 review). The
   * prompt requires a "typecheck" script to exist and does not require it
   * to terminate, so a manifest declaring `tsc --watch --noEmit` would
   * never return here: the preview would sit in `starting` until its hard
   * lifetime reclaimed it, holding one of the twenty-five account-wide
   * fleet slots the whole time, for a diagnostic nobody asked for. A
   * diagnostic that can stop a preview is worse than no diagnostic.
   *
   * Never throws, and a timeout is not a finding. A typecheck that cannot
   * run, or does not finish, is not evidence about the project, and turning
   * either into one would fail previews over this function's own problems.
   */
  private async typecheck(): Promise<string | undefined> {
    const startedAt = Date.now();
    try {
      const result = await this.exec('npm run typecheck --if-present', {
        cwd: '/workspace',
        timeout: TYPECHECK_TIMEOUT_MS,
      });
      if (result.success) return undefined;
      // A run that reached the bound is a run that was stopped, and being
      // stopped says nothing about the project. Checked here as well as
      // caught below because whether the SDK surfaces its own timeout as a
      // rejection or as an unsuccessful result is its business, and a
      // "finding" that turned out to be `tsc --watch` still running would
      // be this function inventing one.
      if (Date.now() - startedAt >= TYPECHECK_TIMEOUT_MS) return undefined;
      const said = [result.stdout, result.stderr]
        .map((stream) => stream.trim())
        .filter((stream) => stream.length > 0)
        .join('\n');
      return said.length > 0 ? said.slice(-2000) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Push this build's lock forward, while it is still this build's.
   *
   * The TTL is what lets a crashed build stop blocking the next one, and
   * it was being compared against work that is only partly bounded: the
   * two commands have timeouts, but writing the project in and reading the
   * output back are one RPC per file and scale with the project (internal PR 196
   * review). A build that outran the TTL had its lock stolen, its
   * workspace emptied underneath it, and -- worse -- went on to destroy
   * the container the thief was now using.
   *
   * Renewing removes the premise rather than racing it: a lock goes stale
   * only when nothing has touched it for the whole TTL, which now means
   * the build really is gone.
   *
   * Conditional on still owning it, like every other write to this key. An
   * unconditional renew would let a build that *had* been superseded take
   * its lock back and start the whole problem again from the other side.
   */
  /**
   * Destroy this build's container while keeping its lock alive.
   *
   * The renewals around the build stopped at the edge of teardown, and
   * `destroy()` has no deadline of its own (internal PR 196 review). A destroy that
   * blocked past the TTL let another build take the lock and start in this
   * same named sandbox, and then the first destroy killed *their*
   * container. Re-reading the token before deleting protects the newer
   * lock; it cannot protect the newer container, because by then the
   * destroy is already in flight and cannot be called back.
   *
   * So the lock is held for the whole teardown rather than up to it. The
   * destroy races a renewal timer: whichever settles first decides, and a
   * timer win renews and waits again.
   *
   * Bounded, because a destroy that never settles must not renew forever
   * and block this user's builds for good. Giving up answers "not gone",
   * which is the branch that keeps both the lock and the slot -- correct
   * for a container in an unknown state, and self-limiting, because the
   * lock then ages out on its own.
   *
   * What giving up leaves behind, which was raised in review and is
   * accepted rather than overlooked (internal PR 196 review). The destroy is still in
   * flight and cannot be called back: once the lock ages out, a later build
   * for this user can start a fresh container here, and the orphaned SIGKILL
   * could land on it.
   *
   * That is accepted for two reasons, and the second is why it is not a
   * close call. `Container.destroy()` is one line -- `await
   * this.container.destroy()`, a SIGKILL RPC with no poll or drain of its
   * own -- so the case needs that single call to hang for ten minutes and
   * then complete, against an object that would likely be evicted first.
   * And when it does happen the later build's `exec` throws, which this
   * method reports as `sandbox`; `judgedTheProject` reads that as unknown,
   * so nothing is claimed about the project and no repair is bought. One
   * wasted build.
   *
   * Every alternative is worse than one wasted build. Holding the lock
   * until the destroy settles blocks this user's builds permanently when it
   * never does; the SDK offers no way to abandon the call; and a persisted
   * "destroying" marker needs its own expiry the moment the object is
   * evicted, which is the same trade wearing a different hat.
   */
  private async destroyHoldingLock(
    token: string,
    deadline: number,
  ): Promise<boolean> {
    // Its own cap, or what is left of the teardown's, whichever runs out
    // first (internal PR 196 review). I gave the teardown a wall clock one round ago
    // and then let the longest thing inside it start a fresh window of its
    // own, so the clock bounded every call in the method except the one it
    // was added for: twelve minutes of build, twelve waiting on storage
    // and ten more destroying is past the fleet's hard lifetime, and a
    // later enqueue reclaims the ticket while this container still exists.
    //
    // Nested rather than added, which is the same rule `budgeted` states
    // everywhere else it is used: a cap inside a budget is the smaller of
    // the two, never the sum.
    const until =
      Date.now() + budgeted(MAX_DESTROY_WAIT_MS, deadline - Date.now());
    return destroyWithin(
      this.destroy().then(
        () => true,
        () => false,
      ),
      () => this.renewLock(token, until),
      LOCK_RENEWAL_INTERVAL_MS,
      until,
    );
  }

  /**
   * Push the lock forward, and say whether it was still ours to push
   * (internal PR 196 review).
   *
   * The answer is the half that was missing. Renewing has always been
   * conditional on ownership, so a build that had already been superseded
   * called this, wrote nothing, and carried on working in a workspace that
   * now belonged to somebody else. Returning the answer lets the loops
   * stop, which is the only response that is actually safe.
   */
  /**
   * The same renewal, from inside the build, where running out of time is
   * an answer rather than a failure (internal PR 196 review).
   *
   * `keepAlive` answers false for "this build should stop", and a renewal
   * the deadline cut off is exactly that: the wall clock has run out, so
   * the build reports `sandbox` and tears down, which is the path it
   * already takes when the lock has been taken from it. A rejection from
   * storage still propagates, because that is a different fact and the
   * caller has always treated it as one.
   */
  private async keepLock(token: string, deadline: number): Promise<boolean> {
    try {
      return await this.renewLock(token, deadline);
    } catch (error) {
      if (error instanceof Error && error.message === OUT_OF_TIME) return false;
      throw error;
    }
  }

  private async renewLock(token: string, deadline: number): Promise<boolean> {
    // Its own two storage calls, bounded like everything else that awaits
    // (internal PR 196 review). Every protection this build has is a renewal, and a
    // renewal that never returns is the one thing none of them can survive:
    // `buildProject` outlives its wall clock without reaching its `finally`,
    // the lock ages out and the ticket is reclaimed while the container is
    // still running, and `/api/publish` waits with no bound of its own.
    //
    // Rejects rather than answering false, because each caller already
    // knows what a failed renewal means and they do not agree: the build
    // stops and reports `sandbox`, the teardown gives up and keeps both the
    // lock and the ticket.
    const bounded = <T>(work: Promise<T>): Promise<T> =>
      withinDeadline(work, deadline - Date.now());
    const mine = await bounded(this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY));
    if (mine?.token !== token) return false;
    await bounded(
      this.ctx.storage.put<BuildLock>(BUILD_LOCK_KEY, {
        startedAt: Date.now(),
        token,
      }),
    );
    return true;
  }

  /**
   * One or two RPCs per file and no bound of its own, which makes it the
   * other end of the same hazard as reading the output back (internal PR 196 review).
   * A build holds a lock while this runs, so `renew` pushes it forward as
   * the loop goes; a preview holds none and says so at its call site.
   */
  private writeProject(
    files: ProjectFile[],
    keepAlive: () => Promise<boolean>,
    /**
     * Applied to each RPC rather than around the loop, because a loop bound
     * only catches a build made of many slow calls and this also has to
     * catch one made of a single stuck one (internal PR 196 review). A preview passes
     * the identity, because it holds nothing anybody else is waiting for.
     */
    bounded: <T>(work: Promise<T>) => Promise<T>,
  ): Promise<boolean> {
    return writeFiles(
      files,
      async (file) => {
        const path = `/workspace/${file.path}`;
        const dir = path.slice(0, path.lastIndexOf('/'));
        if (dir && dir !== '/workspace') {
          await bounded(this.mkdir(dir, { recursive: true }));
        }
        await bounded(this.writeFile(path, file.content));
      },
      keepAlive,
    );
  }

  private isExpired(state: PreviewState): boolean {
    return Date.now() - state.startedAt > HARD_LIFETIME_MS;
  }

  private describe(state: PreviewState): PreviewStatus {
    return {
      status: state.phase,
      ...(state.url ? { url: state.url } : {}),
      ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(state.typecheckFailure
        ? { typecheckFailure: state.typecheckFailure }
        : {}),
      ...(state.revision ? { revision: state.revision } : {}),
    };
  }

  private readState(): Promise<PreviewState | undefined> {
    return this.ctx.storage.get<PreviewState>(STORAGE_KEY);
  }

  private writeState(state: PreviewState): Promise<void> {
    return this.ctx.storage.put(STORAGE_KEY, state);
  }
}
