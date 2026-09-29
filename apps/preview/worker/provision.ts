/**
 * The steps that take a preview from files to a running dev server, with
 * every step bounded and every step timed.
 *
 * Their own module, behind a small interface, so they can be run under
 * `node --test` against fakes: `preview-sandbox.ts` imports
 * `@cloudflare/sandbox` and cannot be loaded there, and the property that
 * matters here is behaviour (does a stuck step end, and does the reader
 * learn why), not the text of a call.
 *
 * Written after a preview sat on "Starting the dev server…" for as long as
 * the reader watched (2026-09-28). Three things made that possible, and
 * this module removes each:
 *
 * - The phase said `starting` before `npm install` had begun, so the
 *   reader was told the wrong step. The install now runs under
 *   `installing`, and `starting` means the dev server.
 * - Neither the install nor the wait for the dev server's port had a
 *   bound. A container short of memory, or a dev server listening on the
 *   wrong port, held the preview (and one of the fleet's slots) until its
 *   hard lifetime. Both are bounded now, and running out of time is a
 *   failure with a sentence, not a spinner.
 * - Nothing was logged. Each step now logs its name and duration, and a
 *   failure logs its reason, so the Worker's logs show where a slow preview
 *   spent its time. No project content is logged, only step names, times
 *   and exit codes.
 */

/** Vite's default dev-server port; every generated project here uses Vite. */
export const DEV_PORT = 5173;

/**
 * How long `npm install` may take in a preview.
 *
 * The same bound a build's install has (`build-limits.ts`), because it is
 * the same install of the same project in the same container class. A cold
 * install of a generated project is a minute or two; five is room for a
 * slow registry, not a budget anything is expected to use.
 */
export const PREVIEW_INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * How long the dev server has to start listening once it is launched.
 *
 * Vite's cold start on an installed project is a few seconds; a minute and
 * a half covers a slow first dependency pre-bundle. Past that, something
 * is wrong with the server rather than slow about it: it crashed without
 * the SDK noticing, or it is listening somewhere other than `DEV_PORT`.
 */
export const DEV_SERVER_READY_TIMEOUT_MS = 90_000;

/** How much of a failing command's output a reader is shown. */
const OUTPUT_TAIL_CHARS = 1500;

export interface ExecResultLike {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DevProcessLike {
  waitForPort(
    port: number,
    options: { mode: 'tcp'; timeout: number },
  ): Promise<void>;
  getLogs(): Promise<{ stdout: string; stderr: string }>;
}

export type ProvisionPhase = 'installing' | 'starting';

export interface ProvisionSteps {
  writeProject(): Promise<void>;
  setPhase(phase: ProvisionPhase): Promise<void>;
  exec(
    command: string,
    options: { cwd: string; timeout: number },
  ): Promise<ExecResultLike>;
  /** Never throws; returns the failure text, or undefined. */
  typecheck(): Promise<string | undefined>;
  startProcess(
    command: string,
    options: { cwd: string },
  ): Promise<DevProcessLike>;
  exposePort(port: number): Promise<{ url: string }>;
  now(): number;
  log(event: string, fields: Record<string, string | number | boolean>): void;
}

export type ProvisionResult =
  | { ok: true; url: string; typecheckFailure?: string }
  | { ok: false; error: string };

/** The last part of a command's output, as a reader would want to see it. */
export function outputTail(stdout: string, stderr: string): string {
  const text = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
  return text.length > OUTPUT_TAIL_CHARS
    ? `…${text.slice(-OUTPUT_TAIL_CHARS)}`
    : text;
}

/**
 * Runs the steps in order and says how it ended. Never throws: every exit
 * is a result, so the caller always has a final phase to write.
 */
export async function provisionPreview(
  steps: ProvisionSteps,
): Promise<ProvisionResult> {
  const began = steps.now();
  let step = 'write';
  let stepStarted = began;
  const done = (
    name: string,
    extra: Record<string, string | number | boolean> = {},
  ) =>
    steps.log('preview.step', {
      step: name,
      ms: steps.now() - stepStarted,
      ...extra,
    });
  const next = (name: string) => {
    step = name;
    stepStarted = steps.now();
  };
  const fail = (error: string): ProvisionResult => {
    steps.log('preview.failed', { step, ms: steps.now() - began });
    return { ok: false, error };
  };

  try {
    await steps.setPhase('installing');
    await steps.writeProject();
    done('write');

    next('install');
    const installTimedOut = `Installing dependencies did not finish within ${PREVIEW_INSTALL_TIMEOUT_MS / 60_000} minutes. Try "Run live preview" again; if it happens again, the project's dependencies may be too large for a preview.`;
    let install: ExecResultLike;
    try {
      install = await steps.exec('npm install --no-audit --no-fund', {
        cwd: '/workspace',
        timeout: PREVIEW_INSTALL_TIMEOUT_MS,
      });
    } catch (error) {
      // Whether the SDK reports its own timeout as a rejection or as an
      // unsuccessful result is its business; the clock decides which this
      // was, the same way the build path does.
      done('install', { ok: false });
      if (steps.now() - stepStarted >= PREVIEW_INSTALL_TIMEOUT_MS) {
        return fail(installTimedOut);
      }
      throw error;
    }
    if (!install.success) {
      done('install', { exitCode: install.exitCode, ok: false });
      if (steps.now() - stepStarted >= PREVIEW_INSTALL_TIMEOUT_MS) {
        return fail(installTimedOut);
      }
      return fail(
        `npm install failed (exit ${install.exitCode}):\n${outputTail(install.stdout, install.stderr)}`,
      );
    }
    done('install', { ok: true });

    next('typecheck');
    const typecheckFailure = await steps.typecheck();
    done('typecheck', { ok: typecheckFailure === undefined });

    next('dev-server');
    await steps.setPhase('starting');
    const dev = await steps.startProcess(
      `npm run dev -- --host 0.0.0.0 --port ${DEV_PORT}`,
      { cwd: '/workspace' },
    );
    try {
      // TCP only: a generated project's dev server has no guaranteed '/'
      // route or status code, only that something is listening.
      await dev.waitForPort(DEV_PORT, {
        mode: 'tcp',
        timeout: DEV_SERVER_READY_TIMEOUT_MS,
      });
    } catch (error) {
      done('dev-server', { ok: false });
      // The server's own words are the useful part: a Vite error, a crash
      // on start, or a server that chose another port. Reading them can
      // fail too, and must not replace the reason with a worse one.
      const logs = await dev
        .getLogs()
        .catch(() => ({ stdout: '', stderr: '' }));
      const tail = outputTail(logs.stdout, logs.stderr);
      const timedOut = steps.now() - stepStarted >= DEV_SERVER_READY_TIMEOUT_MS;
      const why = timedOut
        ? `The dev server did not start listening on port ${DEV_PORT} within ${DEV_SERVER_READY_TIMEOUT_MS / 1000} seconds.`
        : `The dev server stopped before it was ready${error instanceof Error && error.message ? ` (${error.message})` : ''}.`;
      return fail(tail ? `${why}\n${tail}` : why);
    }
    done('dev-server', { ok: true });

    next('expose');
    const exposed = await steps.exposePort(DEV_PORT);
    done('expose');
    steps.log('preview.ready', { ms: steps.now() - began });
    return {
      ok: true,
      url: exposed.url,
      ...(typecheckFailure ? { typecheckFailure } : {}),
    };
  } catch (error) {
    return fail(
      error instanceof Error && error.message
        ? error.message
        : 'Preview failed to start.',
    );
  }
}

/**
 * What a reader is told when a start-up was lost rather than failed.
 *
 * The start-up runs inside the Durable Object instance that began it
 * (`ctx.waitUntil`). When the platform replaces that instance mid-way, the
 * work goes with it, and so does the write that would have said how it
 * ended: production run 36611993082 (2026-09-29) installed and typechecked,
 * lost its instance as the dev server started, and was then reported as
 * "Installing dependencies…" on every poll until the e2e gave up six
 * minutes later.
 */
export const PROVISION_LOST_ERROR =
  'The preview stopped while it was starting. Run it again.';

/**
 * Whether a stored phase describes a start-up nothing is running any more.
 *
 * `installing` and `starting` are written only by the start-up itself, and
 * the start-up only runs in the instance that began it, so an instance that
 * finds either stored without a start-up of its own running has found one
 * that was lost with an earlier instance. `queued` is waiting on the fleet,
 * not on this instance, and `ready` and `failed` are finished, so none of
 * those is ever lost.
 */
export function provisionLost(
  phase: 'queued' | 'installing' | 'starting' | 'ready' | 'failed',
  runningHere: boolean,
): boolean {
  return (phase === 'installing' || phase === 'starting') && !runningHere;
}
