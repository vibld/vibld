import { Sandbox } from '@cloudflare/sandbox';
import type { ProjectFile } from '@vibld/core';
import type { EnqueueResult, PreviewFleet } from './preview-fleet.ts';
import { HARD_LIFETIME_MS } from './fleet.ts';
import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
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
 *
 * The message alone was enough while the only caller was publish, which
 * shows it to a person and stops. #194 added a caller that has to *decide*
 * from it: a generation that builds its own output and, when the build
 * fails, spends a second model call trying to repair the project. Deciding
 * that from a string means matching on wording, and wording changes.
 *
 * Only two of these are evidence about the project the model wrote:
 *
 *  - `install`: a dependency that does not resolve, which is usually a
 *    package the model invented or misspelled.
 *  - `build`: the compiler or bundler refused what it was given.
 *
 * The rest are about this service having a bad day, and none of them says
 * anything is wrong with the code. `busy` in particular is a refusal before
 * any work happens: a preview is already running for the project, so the
 * build never started. Repairing on any of these would spend somebody's
 * money to fix a problem they do not have.
 */
export type BuildFailureReason =
  'busy' | 'install' | 'build' | 'output' | 'sandbox';

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
   * produced compiles). Unlike `startPreview`, this never touches
   * `PreviewFleet` -- a build finishes within one request's lifetime,
   * holding no exposed port and no long-lived dev server, so L9's "1
   * concurrent preview per user" accounting (which exists to bound exactly
   * those two things) does not apply to it.
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

    try {
      slot = await this.env.Fleet.getByName(BUILD_FLEET_NAME).enqueue(
        `build:${this.ctx.id.toString()}`,
        BUILD_CONTAINER_HEADROOM,
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
      const cleared = await this.exec('rm -rf /workspace', { cwd: '/' });
      if (!cleared.success) {
        return {
          reason: 'sandbox',
          error: `The build workspace could not be emptied (exit ${cleared.exitCode}).`,
        };
      }
      await this.mkdir('/workspace', { recursive: true });

      await this.writeProject(files);

      const installStartedAt = Date.now();
      const install = await this.exec('npm install --no-audit --no-fund', {
        cwd: '/workspace',
        timeout: BUILD_INSTALL_TIMEOUT_MS,
      });
      if (!install.success) {
        // A command that reached its bound was stopped, and being stopped
        // says nothing about the project: `sandbox` rather than `install`,
        // so no repair is bought on the strength of it. Checked here as
        // well as bounded above for `typecheck`'s reason -- whether the SDK
        // reports its own timeout as a rejection or as an unsuccessful
        // result is its business, and an "install failure" that was really
        // a stopwatch would be this method inventing one.
        if (Date.now() - installStartedAt >= BUILD_INSTALL_TIMEOUT_MS) {
          return {
            reason: 'sandbox',
            error: 'npm install did not finish within the time allowed.',
          };
        }
        return {
          reason: 'install',
          error: `npm install failed (exit ${install.exitCode}): ${install.stderr.slice(-2000)}`,
        };
      }

      const buildStartedAt = Date.now();
      const build = await this.exec('npm run build', {
        cwd: '/workspace',
        timeout: BUILD_COMPILE_TIMEOUT_MS,
      });
      if (!build.success) {
        if (Date.now() - buildStartedAt >= BUILD_COMPILE_TIMEOUT_MS) {
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

      const outputDir = `/workspace/${BUILD_OUTPUT_DIR}`;
      const listing = await this.listFiles(outputDir, { recursive: true });
      if (!listing.success) {
        return {
          reason: 'output',
          error: `The build succeeded but its output directory (${BUILD_OUTPUT_DIR}) could not be read.`,
        };
      }

      const output: ProjectFile[] = [];
      const skipped: string[] = [];
      for (const entry of listing.files) {
        if (entry.type !== 'file') continue;
        const read = await this.readFile(`${outputDir}/${entry.relativePath}`);
        if (read.encoding === 'base64') {
          skipped.push(entry.relativePath);
          continue;
        }
        output.push({ path: entry.relativePath, content: read.content });
      }
      if (output.length === 0) {
        return {
          reason: 'output',
          error: `The build produced no readable output in ${BUILD_OUTPUT_DIR}.`,
        };
      }
      return { files: output, skipped };
    } catch (error) {
      return {
        reason: 'sandbox',
        error: error instanceof Error ? error.message : 'Build failed.',
      };
    } finally {
      // Released on every path, including the refusals above that return
      // from inside the `try`. A lock this method takes and does not give
      // back is one that blocks this user's next build until it ages out.
      //
      // Only if it is still this build's. A build that overran its lock
      // comes through here after somebody else has taken one, and deleting
      // that would hand a third build the workspace the second is using.
      const mine = await this.ctx.storage.get<BuildLock>(BUILD_LOCK_KEY);
      if (mine?.token === token) {
        await this.ctx.storage.delete(BUILD_LOCK_KEY);
        // Given back as well as unlocked (#196 review). A build container
        // that merely stops working still holds a platform container slot
        // for the class's ten-minute `sleepAfter`, and those slots are now
        // shared with previews. There is nothing left in it worth keeping:
        // the next build empties the workspace before it starts, so the
        // only thing idling buys is a container start.
        //
        // Under the same ownership check as the unlock, and for a sharper
        // reason: if this build overran and somebody else now holds the
        // lock, they are running in this very container, and destroying it
        // would kill their build rather than free a slot.
        await this.destroy().catch(() => {
          // A container that will not go away is the platform's to
          // reclaim. Failing the build over it would turn a capacity
          // problem into a wrong answer about somebody's project.
        });
      }
      // After the container is gone, never before it (#196 review). The
      // slot is what authorises somebody else to start a container, so
      // releasing it while this one still existed let the fleet admit a
      // build the platform had no room for: the same over-admission this
      // counter was added to prevent, moved from previews to builds.
      //
      // Released whatever the ticket's state, because a queued one holds a
      // place in line as surely as an active one holds a slot. Released
      // even when the destroy above failed: a container the platform has
      // to reclaim is a bounded cost, while a slot nobody gives back costs
      // everybody a build until the fleet's own stale reclaim notices half
      // an hour later.
      if (slot) {
        await this.env.Fleet.getByName(BUILD_FLEET_NAME)
          .release(slot.id, BUILD_CONTAINER_HEADROOM)
          .catch(() => {});
      }
    }
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
      await this.writeProject(files);
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

  private async writeProject(files: ProjectFile[]): Promise<void> {
    for (const file of files) {
      const path = `/workspace/${file.path}`;
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && dir !== '/workspace') {
        await this.mkdir(dir, { recursive: true });
      }
      await this.writeFile(path, file.content);
    }
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
