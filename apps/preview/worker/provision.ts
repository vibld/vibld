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

/**
 * How a preview's dev server is started, here and when a live update
 * restarts it after new dependencies (`live-update.ts`).
 *
 * `--strictPort` because something else may still hold the port: a restart
 * waits for the old server to let go of it, and a Vite that quietly moved
 * to 5174 instead would leave `waitForPort` answering for the old one.
 * Failing is the honest outcome there, and on a first start nothing else
 * is listening, so it changes nothing.
 */
export const DEV_COMMAND = `npm run dev -- --host 0.0.0.0 --port ${DEV_PORT} --strictPort`;

/**
 * The install a preview runs, cache first (D74).
 *
 * `--prefer-offline` because a container installs more than once: a live
 * update that brings new dependencies installs again in the container its
 * start installed in, and what the first install fetched is in npm's cache
 * minutes old. Without the flag npm asks the registry about every cached
 * package document again, one round trip each. Anything not in the cache
 * is fetched as before, under the same egress allowlist.
 */
export const INSTALL_COMMAND =
  'npm install --prefer-offline --no-audit --no-fund';

/**
 * The same install asking the registry about everything, for the one case
 * the cache answers wrongly.
 *
 * A cached package document is used as it is, so a range that only a
 * version published since it was cached satisfies fails with ETARGET
 * rather than being fetched (npm's resolver leaves a note where that
 * revalidation would go). Retried once online, inside what is left of the
 * same bound, rather than reported as the project's fault.
 */
export const ONLINE_INSTALL_COMMAND = 'npm install --no-audit --no-fund';

/**
 * Removes what the project does not declare, after an install that started
 * from the image's tree (D74).
 *
 * `npm install` adds what a project asks for beyond the stack, and removes
 * what it does not ask for only when it has something else to change: on
 * a tree that is otherwise up to date it leaves an undeclared package where
 * an import can still find it (measured: `cmdk`, seeded and undeclared,
 * survived the install). That is the mistake internal issue 194 fixed in the build path,
 * a project that works here and fails in a clean install, so the prune
 * runs whenever the tree was seeded.
 */
export const PRUNE_COMMAND = 'npm prune --no-audit --no-fund';

/** How long the prune may take: seconds in practice, never a minute. */
export const PRUNE_TIMEOUT_MS = 120_000;

/**
 * Where the image keeps the generation stack already installed (D74,
 * `apps/preview/Dockerfile`).
 */
export const WARM_MODULES = '/opt/warm/node_modules';

/**
 * Puts the image's installed stack in place as the project's
 * node_modules, before its own `npm install` runs (D74).
 *
 * Most of a first start was the install, and most of the install was not
 * the network but unpacking and writing a hundred-odd packages on a
 * quarter of a CPU: measured at the container's size, a cold install of
 * the stack took about 111 seconds and one from a warm npm cache still 87
 * to 98. With the stack already installed, `npm install` has only to
 * reconcile it with what the project's package.json declares, adding what
 * it asks for beyond the stack, and a project that declares only the stack
 * is up to date in seconds (13 to 27 in all, seed and prune included).
 * What it does not ask for is left to `PRUNE_COMMAND`.
 *
 * Moved rather than copied, and only once: a container runs one preview,
 * so the image's copy is needed once, and a move within one filesystem is
 * a rename. Staged under another name first, so a move that fails part way
 * (across filesystems it is a copy) never leaves a half-written
 * node_modules for npm to trust; `SEED_CLEANUP` removes the staging.
 * Skipped when the project already has a node_modules (a retry in the same
 * container) or the image has none.
 */
export const SEED_COMMAND = `if [ -d ${WARM_MODULES} ] && [ ! -e /workspace/node_modules ]; then rm -rf /workspace/.node_modules-seed && mv ${WARM_MODULES} /workspace/.node_modules-seed && mv /workspace/.node_modules-seed /workspace/node_modules; fi`;

/** What a failed seed leaves to remove before the install runs cold. */
export const SEED_CLEANUP = 'rm -rf /workspace/.node_modules-seed';

/**
 * How long the seed may take. A rename is instant; this is room for the
 * copy a move across filesystems becomes, which measured 5 to 19 seconds
 * at the container's size.
 */
export const SEED_TIMEOUT_MS = 180_000;

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

/** What an install came to, for a caller that words it for its reader. */
export type InstallOutcome =
  | { ok: true; retriedOnline: boolean }
  | { ok: false; timedOut: boolean; exitCode: number; output: string };

/** Whether an install failed because a cached package document was stale. */
export function staleCacheMiss(output: string): boolean {
  return /\bETARGET\b|No matching version found/.test(output);
}

/**
 * `npm install` in /workspace, cache first, bounded by `timeoutMs` in all.
 *
 * Shared by a first start and by a live update that brings new
 * dependencies, because they are the same install of the same project in
 * the same container and should not drift apart. Rejects only when the
 * command itself rejected before its bound: whether the SDK reports its
 * own timeout as a rejection or as an unsuccessful result is its business,
 * and the clock decides which this was, as it does in the build path.
 */
export async function installDependencies(
  exec: ProvisionSteps['exec'],
  now: () => number,
  timeoutMs: number,
): Promise<InstallOutcome> {
  const began = now();
  const attempt = async (
    command: string,
    timeout: number,
  ): Promise<ExecResultLike | 'timed-out'> => {
    try {
      const result = await exec(command, { cwd: '/workspace', timeout });
      if (!result.success && now() - began >= timeoutMs) return 'timed-out';
      return result;
    } catch (error) {
      if (now() - began >= timeoutMs) return 'timed-out';
      throw error;
    }
  };
  const failed = (result: ExecResultLike | 'timed-out'): InstallOutcome =>
    result === 'timed-out'
      ? { ok: false, timedOut: true, exitCode: -1, output: '' }
      : {
          ok: false,
          timedOut: false,
          exitCode: result.exitCode,
          output: outputTail(result.stdout, result.stderr),
        };

  const first = await attempt(INSTALL_COMMAND, timeoutMs);
  if (first !== 'timed-out' && first.success) {
    return { ok: true, retriedOnline: false };
  }
  const left = timeoutMs - (now() - began);
  if (
    first === 'timed-out' ||
    left <= 0 ||
    !staleCacheMiss(`${first.stdout}\n${first.stderr}`)
  ) {
    return failed(first);
  }
  const second = await attempt(ONLINE_INSTALL_COMMAND, left);
  if (second !== 'timed-out' && second.success) {
    return { ok: true, retriedOnline: true };
  }
  return failed(second);
}

/**
 * `SEED_COMMAND`, answering whether it ran cleanly. Never throws: a seed
 * that failed is cleaned up and the install runs without it.
 */
export async function seedModules(
  exec: ProvisionSteps['exec'],
): Promise<boolean> {
  try {
    const seeded = await exec(SEED_COMMAND, {
      cwd: '/workspace',
      timeout: SEED_TIMEOUT_MS,
    });
    if (seeded.success) return true;
  } catch {
    // Falls through to the cleanup, as a failed result does.
  }
  await exec(SEED_CLEANUP, { cwd: '/', timeout: SEED_TIMEOUT_MS }).catch(
    () => undefined,
  );
  return false;
}

/**
 * `PRUNE_COMMAND`, answering whether it ran cleanly. Never throws, and a
 * failure does not fail the start: the preview runs either way, and what a
 * failed prune can leave behind is a package the project did not declare,
 * which the build's own clean install still refuses.
 */
export async function pruneUndeclared(
  exec: ProvisionSteps['exec'],
): Promise<boolean> {
  try {
    const pruned = await exec(PRUNE_COMMAND, {
      cwd: '/workspace',
      timeout: PRUNE_TIMEOUT_MS,
    });
    return pruned.success;
  } catch {
    return false;
  }
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

    // Never a reason to fail the start: without it, the install below is
    // the cold one every preview used to run.
    next('seed');
    const seeded = await seedModules(steps.exec);
    done('seed', { ok: seeded });

    next('install');
    const installTimedOut = `Installing dependencies did not finish within ${PREVIEW_INSTALL_TIMEOUT_MS / 60_000} minutes. Try "Run live preview" again; if it happens again, the project's dependencies may be too large for a preview.`;
    let install: InstallOutcome;
    try {
      install = await installDependencies(
        steps.exec,
        steps.now,
        PREVIEW_INSTALL_TIMEOUT_MS,
      );
    } catch (error) {
      done('install', { ok: false });
      throw error;
    }
    if (!install.ok) {
      done('install', { exitCode: install.exitCode, ok: false });
      if (install.timedOut) return fail(installTimedOut);
      return fail(
        `npm install failed (exit ${install.exitCode}):\n${install.output}`,
      );
    }
    done('install', { ok: true, retriedOnline: install.retriedOnline });

    if (seeded) {
      next('prune');
      done('prune', { ok: await pruneUndeclared(steps.exec) });
    }

    next('typecheck');
    const typecheckFailure = await steps.typecheck();
    done('typecheck', { ok: typecheckFailure === undefined });

    next('dev-server');
    await steps.setPhase('starting');
    const dev = await steps.startProcess(DEV_COMMAND, { cwd: '/workspace' });
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
 * `installing` and `starting` are written only by the start-up itself, or
 * by a live update installing new dependencies (D74), and each only runs
 * in the instance that began it, so an instance that finds either stored
 * without one of its own running has found one that was lost with an
 * earlier instance. `runningHere` is whether either is running here. `queued` is waiting on the fleet,
 * not on this instance, and `ready` and `failed` are finished, so none of
 * those is ever lost.
 */
export function provisionLost(
  phase: 'queued' | 'installing' | 'starting' | 'ready' | 'failed',
  runningHere: boolean,
): boolean {
  return (phase === 'installing' || phase === 'starting') && !runningHere;
}
