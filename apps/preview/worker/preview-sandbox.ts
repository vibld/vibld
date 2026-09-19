import { Sandbox } from '@cloudflare/sandbox';
import { retrying } from '@vibld/core';
import { networkFailure } from './build-failure.ts';
import {
  OUT_OF_TIME,
  admit,
  budgeted,
  collectOutput,
  withinDeadline,
  writeFiles,
} from './build-files.ts';
import type { BuildFailureReason } from './build-failure.ts';
import type { ProjectFile } from '@vibld/core';
import type { EnqueueResult, PreviewFleet } from './preview-fleet.ts';
import { HARD_LIFETIME_MS } from './fleet.ts';
import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
  BUILD_WALL_CLOCK_MS,
  LOCK_RENEWAL_INTERVAL_MS,
  MAX_DESTROY_WAIT_MS,
} from './build-limits.ts';
// L9's account-wide preview cap, which is no longer the whole container
// budget: see `capacity.ts` for what builds take out of it.
import {
  ACCOUNT_MAX_IN_FLIGHT,
  BUILD_CONTAINER_HEADROOM,
  BUILD_FLEET_NAME,
} from './capacity.ts';

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
}

/** Vite's default dev-server port; every generated project here uses Vite. */
const DEV_PORT = 5173;

/**
 * How long the pre-preview typecheck may take before it is abandoned.
 *
 * Generous against what it measures and strict against what it can cost.
 * `tsc --noEmit` over a generated project is seconds on a container that
 * has just finished `npm install`, so ninety seconds is not a budget
 * anything real is expected to approach. It is a bound on the case where
 * the script does not terminate at all (#195 review): the prompt requires
 * a "typecheck" script to exist and cannot require it to exit, and a
 * `--watch` variant would otherwise hold a fleet slot until the preview's
 * hard lifetime ran out.
 */
const TYPECHECK_TIMEOUT_MS = 90_000;

/**
 * Where `npm run build` writes its output, for the one template this
 * codebase generates today (`templates/marketing`'s `react-router.config.ts`
 * sets `ssr: false`, so `react-router build` emits plain static files here).
 * A second template with a different build tool would need its own
 * convention -- this is not yet a per-project setting, the same way
 * `DEV_PORT` above is not.
 */
const BUILD_OUTPUT_DIR = 'build/client';

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
}

const STORAGE_KEY = 'vibld:preview';

/**
 * When the build running in this instance started, while one is.
 *
 * Its own key rather than the preview's state: since #196 a build runs in
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
   * What `npm run typecheck` printed when it failed (#194).
   *
   * Named for the command rather than for the compiler, because the script
   * is the generated manifest's to declare and need not be `tsc` (#195
   * review). What is known is that the project's own typecheck exited
   * non-zero and said this.
   *
   * Never an error: the preview started, and this is a finding about the
   * project rather than about the run. Present only when the typecheck
   * actually failed, so absent means clean, not declared, or not asked.
   */
  typecheckFailure?: string;
}

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
  ): Promise<PreviewStatus> {
    const existing = await this.readState();
    const fleet = this.env.Fleet.getByName('fleet');

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
      const ticket = await fleet.status(
        existing.fleetTicketId,
        ACCOUNT_MAX_IN_FLIGHT,
      );
      if (!ticket.active) {
        return { status: 'queued', position: ticket.position };
      }
      await this.beginProvisioning(
        existing.startedAt,
        existing.fleetTicketId,
        files,
        hostname,
      );
      return { status: 'installing' };
    }

    const startedAt = Date.now();
    const ticket = await fleet.enqueue(label, ACCOUNT_MAX_IN_FLIGHT);
    if (!ticket.active) {
      await this.writeState({
        phase: 'queued',
        startedAt,
        fleetTicketId: ticket.id,
      });
      return { status: 'queued', position: ticket.position };
    }
    await this.beginProvisioning(startedAt, ticket.id, files, hostname);
    return { status: 'installing' };
  }

  /** Read-only: never enqueues, never provisions. Safe to poll freely. */
  async getPreviewStatus(): Promise<PreviewStatus> {
    const state = await this.readState();
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
      const ticket = await this.env.Fleet.getByName('fleet').status(
        state.fleetTicketId,
        ACCOUNT_MAX_IN_FLIGHT,
      );
      return ticket.active
        ? { status: 'ready-to-start' }
        : { status: 'queued', position: ticket.position };
    }
    return this.describe(state);
  }

  /** Idempotent: stopping a preview that never started, or already stopped, still succeeds. */
  async stopPreview(): Promise<void> {
    const state = await this.readState();
    await this.ctx.storage.delete(STORAGE_KEY);
    if (state) {
      await this.env.Fleet.getByName('fleet')
        .release(state.fleetTicketId, ACCOUNT_MAX_IN_FLIGHT)
        .catch(() => {});
    }
    await this.destroy().catch(() => {});
  }

  /**
   * A one-shot production build of `files` (ADR-0010's Cloudflare
   * auto-publish primary path: apps/web calls this, then hands the result
   * straight to apps/publish's `/internal/publish`; since #194 the
   * generation workflow calls it too, to find out whether what it just
   * produced compiles). It takes a `PreviewFleet` ticket like a preview
   * does, but from an instance of its own, because it holds one of the
   * platform's containers while it runs; `capacity.ts` states how that
   * budget is divided. What it does not use is the preview queue, so two
   * builds for one user are excluded by this method's own lock rather than
   * by any preview count.
   *
   * It runs in an instance of its own, named for building rather than for
   * the user's preview (`worker/index.ts`'s `buildSandboxName`), under the
   * same L11 egress restrictions -- untrusted code is untrusted whether or
   * not anything is ever exposed. It used to share the preview's instance
   * and refuse whenever a preview was live, which was correct about the
   * filesystem race and wrong about how often that happens (#196 review):
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
    const held = await this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY);
    if (held && Date.now() - held.startedAt < BUILD_LOCK_TTL_MS) {
      return {
        reason: 'busy',
        error:
          'Another build is already running for this project. Try again once it has finished.',
      };
    }
    // Taken with a token, and released only while it is still this build's
    // (#196 review). Expiry alone made the lock unsafe in the one case it
    // was for: once a stale lock let a second build in, the first build's
    // own `finally` deleted the second's lock on its way out, and a third
    // would then walk into the second's workspace. Ownership is what makes
    // release mean "give back mine" rather than "clear whatever is there".
    const token = crypto.randomUUID();
    await this.ctx.storage.put<BuildLock>(BUILD_LOCK_KEY, {
      startedAt: Date.now(),
      token,
    });

    // The build half of the container split, actually enforced (#196
    // review). Subtracting the headroom from the preview cap only made the
    // partition true on the preview side: nothing stopped six builds
    // overlapping nineteen previews and filling all twenty-five platform
    // slots while the fleet still thought it had room.
    //
    // Its own `PreviewFleet` instance rather than the preview queue, since
    // that queue's count is what enforces L9 and must stay about previews.
    // Same class, same reserve-now/release-later shape, separate storage.
    //
    // Refused rather than queued when the slots are full: a build has a
    // paid Workflow waiting on its answer, so making it wait behind others
    // spends that Workflow's timeout. `busy` is the right refusal, and
    // `worthRepairing` already reads it as saying nothing about the
    // project, so no repair is bought and nothing is claimed.
    // Asked for *inside* the try below rather than before it (#196 review).
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
     * refusal it had issued itself (#196 review).
     */
    let started = false;

    /**
     * Whether this build is still entitled to the workspace: inside its
     * wall clock, and still the owner of the lock (#196 review).
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
    const deadline = Date.now() + BUILD_WALL_CLOCK_MS;
    const keepAlive = async (): Promise<boolean> =>
      Date.now() < deadline && (await this.renewLock(token));

    /**
     * The deadline applied to one RPC rather than between two of them
     * (#196 review).
     *
     * Checking the clock between operations bounds a build made of many
     * quick calls and does nothing about a build stuck in one slow call.
     * A single `writeFile` that hung past the deadline left everything the
     * bound was for: the lock expired at its TTL, a second build took the
     * workspace, the fleet reclaimed the ticket of a container still
     * running, and when the stalled call finally landed it wrote into
     * somebody else's tree. I claimed the ownership check on resume
     * covered that. It does not: the write happens first and the check
     * happens after.
     *
     * The losing call is not cancelled, because none of these can be. What
     * this buys is that the *build* ends on time, so the teardown starts on
     * time and destroys the container, and destroying the container is what
     * actually stops an orphaned RPC. That is the same reasoning as
     * `destroyHoldingLock`'s cap: bound what can be bounded, and let the
     * container's death end what cannot.
     */
    const bounded = <T>(work: Promise<T>): Promise<T> =>
      withinDeadline(work, deadline - Date.now());

    /**
     * A command's own cap, cut down to what is left (#196 review).
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
      // Bounded like every other cross-object call here (#196 review).
      // Awaited directly, a stalled `enqueue` kept the build alive past its
      // own deadline: the lock expired, a successor took the sandbox, and
      // when this finally returned the very next thing it did was empty
      // that successor's workspace.
      //
      // Giving up on it leaves a ticket nobody holds, which is worse than
      // it sounds: `reclaimStale` only reclaims rows it has activated, so
      // an abandoned queued row is never reclaimed at all. So whatever it
      // hands back after we have stopped waiting is given back.
      slot = await admit(
        this.env.Fleet.getByName(BUILD_FLEET_NAME).enqueue(
          `build:${this.ctx.id.toString()}`,
          BUILD_CONTAINER_HEADROOM,
        ),
        bounded,
        (ticket) => this.releaseTicket(ticket),
        (work) => this.ctx.waitUntil(work),
      );
      if (!slot.active) {
        return {
          reason: 'busy',
          error:
            'Too many builds are running right now. Try again in a moment.',
        };
      }

      // Emptied first, because this container is reused (#196 review).
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
      // That is one of the two production failures behind #194: this check
      // is worth having only if it measures what a clean environment sees.
      // Asked before the first thing that touches the container, not
      // only between the steps that follow it (#196 review). Everything
      // above this point can take time -- the admission most of all -- and
      // the clear is destructive: starting it without knowing the lock is
      // still ours is how a build that had been superseded emptied its
      // successor's workspace.
      if (!(await keepAlive())) return stopped;

      started = true;
      // Bounded like every other call here. Left direct, this one could
      // stall past the deadline without ever reaching the teardown, and a
      // late `rm -rf /workspace` would then empty a successor's tree
      // (#196 review).
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
      // the renewal sat waiting for the loop to finish (#196 review).
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
        // cannot tell them apart (#196 review). Left as `install` it buys
        // a repair: a second paid model call asked to fix a project that
        // compiles perfectly well, whose reply cannot help, on a day when
        // npm is having trouble and every caller hits it at once.
        //
        // Matching on wording, which #194 deliberately moved away from for
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
        // (#194).
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
      const outputDir = `/workspace/${BUILD_OUTPUT_DIR}`;
      const listing = await bounded(
        this.listFiles(outputDir, { recursive: true }),
      );
      if (!listing.success) {
        return {
          reason: 'output',
          error: `The build succeeded but its output directory (${BUILD_OUTPUT_DIR}) could not be read.`,
        };
      }

      // One RPC per output file, so the longest unbounded stretch here and
      // the one most likely to outrun a TTL. It lives in `build-files.ts`
      // so it can be called with fakes rather than read with regexes
      // (#196 review): the renewal used to count the files it kept rather
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
          error: `The build produced no readable output in ${BUILD_OUTPUT_DIR}.`,
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
      // Not awaited, which is the point (#196 review). Tearing a container
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
    const mine = await this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY);
    const ours = mine?.token === token;

    // "No container of ours is left standing." True without asking when
    // nothing ever ran, because there is no container until something does:
    // a refusal issued before the first `exec` leaves nothing behind, and
    // holding its lock or its ticket would be holding them against a
    // container that was never created.
    //
    // Otherwise only ours is ours to destroy. A build that overran has had
    // its lock taken and is running in this very container, so destroying
    // it would end their build rather than free anything.
    const gone = !started
      ? true
      : ours
        ? await this.destroyHoldingLock(token)
        : false;

    // After the container is gone, never before it: a lock given back
    // mid-teardown hands this user's next build a container that is about
    // to die. Re-read rather than trusting `ours`, which was answered
    // before the destroy was awaited.
    if (ours && gone) {
      const still = await this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY);
      if (still?.token === token) {
        await this.ctx.storage.delete(BUILD_LOCK_KEY);
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
    // Retried before it is given up on: `reclaimStale` only reclaims rows
    // it has activated, so an abandoned queued ticket never expires at all.
    if (slot && (!ours || gone)) await this.releaseTicket(slot.id);
  }

  /**
   * Give one build ticket back.
   *
   * Retried before it is given up on: `reclaimStale` only reclaims rows it
   * has activated, so an abandoned queued ticket never expires at all.
   *
   * Its own method because the teardown is no longer the only caller
   * (#196 review): a build that gave up waiting for `enqueue` has to give
   * back whatever that call eventually hands it, and it is the same
   * release for the same reason.
   */
  private async releaseTicket(ticket: number): Promise<void> {
    await retrying(() =>
      this.env.Fleet.getByName(BUILD_FLEET_NAME).release(
        ticket,
        BUILD_CONTAINER_HEADROOM,
      ),
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
  ): Promise<void> {
    await this.writeState({ phase: 'installing', startedAt, fleetTicketId });
    this.ctx.waitUntil(
      this.provision(files, hostname, startedAt, fleetTicketId),
    );
  }

  private async provision(
    files: ProjectFile[],
    hostname: string,
    startedAt: number,
    fleetTicketId: number,
  ): Promise<void> {
    try {
      // Always alive: a preview holds no build lock, so there is nothing
      // to renew and nothing that can take the workspace from it. Its own
      // claim on this sandbox is the fleet ticket, which has a hard
      // lifetime rather than a heartbeat and is `reclaimStale`'s business.
      await this.writeProject(
        files,
        async () => true,
        (work) => work,
      );
      await this.writeState({ phase: 'starting', startedAt, fleetTicketId });

      const install = await this.exec('npm install --no-audit --no-fund', {
        cwd: '/workspace',
      });
      if (!install.success) {
        throw new Error(
          `npm install failed (exit ${install.exitCode}): ${install.stderr.slice(-2000)}`,
        );
      }

      // The cheapest place in the product to find out that a generated
      // project does not compile (#194): the container is up and the
      // install has already happened, so this costs seconds rather than a
      // second sandbox. Two of six real generations measured against the
      // production provider produced a project that fails `npm run build`,
      // for two unrelated reasons, and until now the only gate was publish.
      //
      // Deliberately not a failure. The dev server starts either way, and
      // Vite does not typecheck, so the preview really does run -- it just
      // may show Vite's own transform error where a page should be, which
      // reads as Vibld being broken rather than as the project needing a
      // fix. Naming it is the whole point.
      const typecheckFailure = await this.typecheck();

      const dev = await this.startProcess(
        `npm run dev -- --host 0.0.0.0 --port ${DEV_PORT}`,
        { cwd: '/workspace' },
      );
      // TCP only: a generated project's dev server has no guaranteed '/'
      // route or status code, only that something is listening.
      await dev.waitForPort(DEV_PORT, { mode: 'tcp' });

      const exposed = await this.exposePort(DEV_PORT, { hostname });
      await this.writeState({
        phase: 'ready',
        startedAt,
        fleetTicketId,
        url: exposed.url,
        expiresAt: startedAt + HARD_LIFETIME_MS,
        ...(typecheckFailure ? { typecheckFailure } : {}),
      });
    } catch (error) {
      await this.writeState({
        phase: 'failed',
        startedAt,
        fleetTicketId,
        error:
          error instanceof Error ? error.message : 'Preview failed to start.',
      });
      // A failed attempt must not go on occupying an account-wide slot for
      // up to the full hard lifetime (L9) while doing nothing useful with
      // it -- release it the moment the failure is known, same as a normal
      // stop does.
      await this.env.Fleet.getByName('fleet')
        .release(fleetTicketId, ACCOUNT_MAX_IN_FLIGHT)
        .catch(() => {});
    }
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
   * Bounded, and that bound is not a safety margin (#195 review). The
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
   * output back are one RPC per file and scale with the project (#196
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
   * `destroy()` has no deadline of its own (#196 review). A destroy that
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
   * accepted rather than overlooked (#196 review). The destroy is still in
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
  private async destroyHoldingLock(token: string): Promise<boolean> {
    const destroyed = this.destroy().then(
      () => true,
      () => false,
    );
    const until = Date.now() + MAX_DESTROY_WAIT_MS;
    while (Date.now() < until) {
      const settled = await Promise.race([
        destroyed,
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), LOCK_RENEWAL_INTERVAL_MS);
        }),
      ]);
      if (settled !== undefined) return settled;
      await this.renewLock(token);
    }
    return false;
  }

  /**
   * Push the lock forward, and say whether it was still ours to push
   * (#196 review).
   *
   * The answer is the half that was missing. Renewing has always been
   * conditional on ownership, so a build that had already been superseded
   * called this, wrote nothing, and carried on working in a workspace that
   * now belonged to somebody else. Returning the answer lets the loops
   * stop, which is the only response that is actually safe.
   */
  private async renewLock(token: string): Promise<boolean> {
    const mine = await this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY);
    if (mine?.token !== token) return false;
    await this.ctx.storage.put<BuildLock>(BUILD_LOCK_KEY, {
      startedAt: Date.now(),
      token,
    });
    return true;
  }

  /**
   * One or two RPCs per file and no bound of its own, which makes it the
   * other end of the same hazard as reading the output back (#196 review).
   * A build holds a lock while this runs, so `renew` pushes it forward as
   * the loop goes; a preview holds none and says so at its call site.
   */
  private writeProject(
    files: ProjectFile[],
    keepAlive: () => Promise<boolean>,
    /**
     * Applied to each RPC rather than around the loop, because a loop bound
     * only catches a build made of many slow calls and this also has to
     * catch one made of a single stuck one (#196 review). A preview passes
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
    };
  }

  private readState(): Promise<PreviewState | undefined> {
    return this.ctx.storage.get<PreviewState>(STORAGE_KEY);
  }

  private writeState(state: PreviewState): Promise<void> {
    return this.ctx.storage.put(STORAGE_KEY, state);
  }
}
