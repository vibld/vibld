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
