import { Sandbox } from '@cloudflare/sandbox';
import type { ProjectFile } from '@vibld/core';
import type { PreviewFleet } from './preview-fleet.ts';
import { HARD_LIFETIME_MS } from './fleet.ts';

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

/** L9: the account-wide cap this sandbox asks `PreviewFleet` to enforce. */
const ACCOUNT_MAX_IN_FLIGHT = 25;

/** Vite's default dev-server port; every generated project here uses Vite. */
const DEV_PORT = 5173;

type Phase = 'queued' | 'installing' | 'starting' | 'ready' | 'failed';

interface PreviewState {
  phase: Phase;
  startedAt: number;
  fleetTicketId: number;
  url?: string;
  expiresAt?: number;
  error?: string;
}

const STORAGE_KEY = 'vibld:preview';

export interface PreviewStatus {
  status: Phase | 'ready-to-start';
  position?: number;
  url?: string;
  expiresAt?: number;
  error?: string;
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
    };
  }

  private readState(): Promise<PreviewState | undefined> {
    return this.ctx.storage.get<PreviewState>(STORAGE_KEY);
  }

  private writeState(state: PreviewState): Promise<void> {
    return this.ctx.storage.put(STORAGE_KEY, state);
  }
}
