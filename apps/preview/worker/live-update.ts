import type { ProjectFile } from '@vibld/core';
import {
  DEV_PORT,
  DEV_SERVER_READY_TIMEOUT_MS,
  installDependencies,
  outputTail,
  pruneUndeclared,
} from './provision.ts';
import type {
  DevProcessLike,
  InstallOutcome,
  ProvisionSteps,
} from './provision.ts';

/**
 * A new revision applied to a preview that is already running (D74).
 *
 * Before this, a running preview could not take new files: accepting a
 * follow-up left the frame on the older checkpoint, and the only way to see
 * the change was a restart, which destroyed the container and paid for a
 * cold `npm install`, a typecheck and a dev-server start all over again.
 * That was a minute or two on every change (a first preview measured about
 * 126 seconds end to end in production). Most follow-ups change a handful
 * of source files that Vite's own watcher would pick up in well under a
 * second, so this writes only the files that differ from what the sandbox
 * is serving and lets the dev server do the rest.
 *
 * Its own module, behind small interfaces, for the reason `provision.ts`
 * is: `preview-sandbox.ts` imports `@cloudflare/sandbox` and cannot be
 * loaded under `node --test`, and what matters here is behaviour (which
 * files are written, when an install runs, what a failure says), not the
 * text of a call.
 *
 * Nothing here decides whether to fall back to a restart. It reports what
 * happened, and `preview-sandbox.ts` and the builder turn a failure into
 * the restart path that already existed.
 */

/**
 * How many files an update may carry, and how long a path may be.
 *
 * The same numbers apps/web's request guard applies to every preview start
 * (`DEFAULT_LIMITS` in `apps/web/worker/request-guard.ts`, where the
 * content ceiling is `MAX_BASE_CONTENT_CHARS`), because an update is the
 * same project arriving by a different route. apps/web checks them first;
 * they are repeated here because this is where a path becomes a file on a
 * filesystem, and `preview-live-update.test.ts` in apps/web keeps the two
 * equal.
 */
export const MAX_UPDATE_FILES = 50;
export const MAX_UPDATE_PATH_CHARS = 256;
export const MAX_UPDATE_TOTAL_PATH_CHARS = 8000;
export const MAX_UPDATE_CONTENT_CHARS = 160_000;

/**
 * The longest revision id an update may name. Revisions are generated ids,
 * far shorter than this; the bound only stops the field being used to
 * store something else in this object's state.
 */
export const MAX_REVISION_CHARS = 200;

/** The files whose change means the installed packages may be wrong. */
export const MANIFEST_PATHS = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
] as const;

/** The package.json fields an install reads to decide what to install. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
] as const;

/**
 * A relative, canonical path that stays inside /workspace.
 *
 * The same rule apps/web applies before a preview is started
 * (`pathProblem` in `apps/web/worker/request-guard.ts`), repeated because a
 * client-side or upstream rule is not the boundary: this is the code that
 * turns the path into a write, and a delete, inside the container.
 */
export function pathProblem(path: string): string | undefined {
  if (path.length === 0) return 'A file has an empty path.';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    return `"${path}" must be a relative path.`;
  }
  if (path.includes('\\')) return `"${path}" must use forward slashes.`;
  // Control characters as well as NUL: a path is written into the
  // container and logged by nothing, but a line break in one is never a
  // file anybody meant.
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    return `"${path}" contains an invalid character.`;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..')) {
    return `"${path}" escapes the project root.`;
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return `"${path}" is not a canonical path.`;
  }
  if (path.length > MAX_UPDATE_PATH_CHARS) {
    return `File paths must be ${MAX_UPDATE_PATH_CHARS} characters or fewer.`;
  }
  return undefined;
}

/** Where a checked path lives in the container. Throws for any other. */
export function workspacePath(path: string): string {
  const problem = pathProblem(path);
  if (problem) throw new Error(problem);
  return `/workspace/${path}`;
}

/** Why a set of files cannot be applied, or undefined when it can. */
export function filesProblem(
  files: readonly ProjectFile[],
): string | undefined {
  if (files.length === 0) return "An update must carry the project's files.";
  if (files.length > MAX_UPDATE_FILES) {
    return `A project may contain at most ${MAX_UPDATE_FILES} files.`;
  }
  const seen = new Set<string>();
  let pathChars = 0;
  let contentChars = 0;
  for (const file of files) {
    const problem = pathProblem(file.path);
    if (problem) return problem;
    // Two entries for one path would leave which one the dev server sees
    // to the order of the writes, and the recorded digest to the last.
    if (seen.has(file.path)) return `"${file.path}" appears twice.`;
    seen.add(file.path);
    pathChars += file.path.length;
    if (pathChars > MAX_UPDATE_TOTAL_PATH_CHARS) {
      return 'The project has too many path characters.';
    }
    contentChars += file.path.length + file.content.length;
    if (contentChars > MAX_UPDATE_CONTENT_CHARS) {
      return `A previewed project must be ${MAX_UPDATE_CONTENT_CHARS} characters or fewer.`;
    }
  }
  return undefined;
}

/**
 * What the sandbox is serving, as much as an update needs to know.
 *
 * Digests rather than contents, because this lives in the Durable Object's
 * storage for the life of the preview and the files themselves are
 * already in the container. A digest is all a diff needs: equal means
 * leave it, different means write it.
 */
export interface ServedFiles {
  /** Each path the dev server was given, with a SHA-256 of its content. */
  files: Record<string, string>;
  /** What an install would be asked to satisfy (`dependencyKey`). */
  dependencies: string;
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** A JSON value with its object keys in one order, so equal means equal. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/**
 * What an install depends on: package.json's dependency fields, and the
 * lockfile if the project has one.
 *
 * The dependency fields rather than the whole package.json, because D71
 * rewrites package.json on a follow-up only to add a package, and the
 * common edit to it that is not that (a name, a script) needs no install.
 * A package.json that does not parse counts by its digest, so any change
 * to it is treated as a dependency change: the install will then fail on
 * it exactly as a restart would, and say why.
 */
export function dependencyKey(
  files: readonly ProjectFile[],
  digests: Readonly<Record<string, string>>,
): string {
  const manifest = files.find((file) => file.path === 'package.json');
  let declared = 'none';
  if (manifest) {
    try {
      const parsed: unknown = JSON.parse(manifest.content);
      declared =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? JSON.stringify(
              canonical(
                Object.fromEntries(
                  DEPENDENCY_FIELDS.map((field) => [
                    field,
                    (parsed as Record<string, unknown>)[field] ?? null,
                  ]),
                ),
              ),
            )
          : `unparsed:${digests['package.json']}`;
    } catch {
      declared = `unparsed:${digests['package.json']}`;
    }
  }
  return JSON.stringify([
    declared,
    ...MANIFEST_PATHS.slice(1).map((path) => digests[path] ?? null),
  ]);
}

/** The record of `files`, as `ServedFiles`. */
export async function describeFiles(
  files: readonly ProjectFile[],
): Promise<ServedFiles> {
  const digests: Record<string, string> = {};
  for (const file of files) digests[file.path] = await digest(file.content);
  return { files: digests, dependencies: dependencyKey(files, digests) };
}

/** What an update has to do to turn one set of files into another. */
export interface UpdatePlan {
  /** Files that are new or different, package manifests first. */
  write: ProjectFile[];
  /** Paths the sandbox was given that the new revision no longer has. */
  remove: string[];
  /** Whether the installed packages have to be brought up to date. */
  installs: boolean;
}

/**
 * The difference between what is being served and `files`.
 *
 * Only paths this service wrote are ever removed: `served` lists what the
 * sandbox was given, so `node_modules`, a lockfile npm wrote for itself and
 * Vite's own cache are never in it and never touched.
 */
export function planUpdate(
  served: ServedFiles,
  next: ServedFiles,
  files: readonly ProjectFile[],
): UpdatePlan {
  const manifest = new Set<string>(MANIFEST_PATHS);
  const write = files
    .filter((file) => served.files[file.path] !== next.files[file.path])
    // Manifests first, so an install that follows reads the new ones.
    .sort(
      (a, b) => Number(manifest.has(b.path)) - Number(manifest.has(a.path)),
    );
  const remove = Object.keys(served.files)
    .filter((path) => !(path in next.files))
    .sort();
  return {
    write,
    remove,
    installs: served.dependencies !== next.dependencies,
  };
}

/**
 * Asks whether anything is listening on the dev server's port.
 *
 * A TCP connect from inside the container rather than a process lookup,
 * because the question is whether the preview's address would be answered,
 * and a process can exist without listening. `node` because it is the one
 * thing every image this runs in has; `--input-type=commonjs` because
 * /workspace's package.json says `"type": "module"`.
 */
export const PORT_PROBE = `node --input-type=commonjs -e "const s=require('net').connect(${DEV_PORT},'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)"`;

/** How long one probe may take, well past the two seconds it gives itself. */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * How long an old dev server has to let go of its port after it is asked
 * to stop. Vite closes in well under a second; this is room for a slow
 * container, not a wait anything is expected to use.
 */
export const PORT_RELEASE_TIMEOUT_MS = 15_000;

/** How often the release is checked for while waiting on it. */
const PORT_RELEASE_POLL_MS = 500;

export interface LiveUpdateSteps {
  exec: ProvisionSteps['exec'];
  /** Writes one file at an absolute path under /workspace. */
  write(path: string, content: string): Promise<void>;
  /** Removes one file at an absolute path under /workspace, if it is there. */
  remove(path: string): Promise<void>;
  /** Never throws; returns the failure text, or undefined. */
  typecheck(): Promise<string | undefined>;
  /** Asks the running dev server to stop. Resolves once asked, not once gone. */
  stopDevServer(): Promise<void>;
  startDevServer(): Promise<DevProcessLike>;
  wait(ms: number): Promise<void>;
  now(): number;
  log(event: string, fields: Record<string, string | number | boolean>): void;
}

export type LiveUpdateResult =
  | {
      ok: true;
      written: number;
      removed: number;
      installed: boolean;
      typecheckFailure?: string;
    }
  | {
      ok: false;
      /** A sentence for the builder, which says it beside the restart. */
      error: string;
      /**
       * Whether anything in /workspace was changed before it stopped. When
       * it was, the sandbox is serving neither revision, and the caller
       * must stop recording it as serving the old one.
       */
      touched: boolean;
    };

async function listening(steps: LiveUpdateSteps): Promise<boolean> {
  try {
    const probe = await steps.exec(PORT_PROBE, {
      cwd: '/',
      timeout: PROBE_TIMEOUT_MS,
    });
    return probe.success;
  } catch {
    return false;
  }
}

/**
 * Applies `plan` to the running preview. Never throws: every exit is a
 * result, so the caller always has a state to write.
 *
 * Without new dependencies: check the dev server is up, write the changed
 * files, remove the deleted ones, and let Vite's watcher reload the page.
 *
 * With them: the manifests go in first and `npm install` runs against
 * them (bounded like a first start's install, and cache first like it),
 * then the rest of the files, and then the dev server is restarted.
 * Restarted rather than left to notice, because Vite pre-bundles
 * dependencies when it starts and serves that bundle until it restarts: a
 * package added later is discovered on its first import, but one whose
 * version changed would go on being served from the old bundle. A restart
 * of the dev server alone is seconds; it is the container's that was
 * minutes.
 */
export async function applyLiveUpdate(
  plan: UpdatePlan,
  steps: LiveUpdateSteps,
  options: { installTimeoutMs: number },
): Promise<LiveUpdateResult> {
  const began = steps.now();
  let step = 'update-probe';
  let stepStarted = began;
  let touched = false;
  const next = (name: string) => {
    step = name;
    stepStarted = steps.now();
  };
  const done = (extra: Record<string, string | number | boolean> = {}) =>
    steps.log('preview.step', {
      step,
      ms: steps.now() - stepStarted,
      ...extra,
    });
  const fail = (error: string): LiveUpdateResult => {
    steps.log('preview.update-failed', { step, ms: steps.now() - began });
    return { ok: false, error, touched };
  };
  const manifest = new Set<string>(MANIFEST_PATHS);
  const writeAll = async (files: readonly ProjectFile[]) => {
    for (const file of files) {
      const path = workspacePath(file.path);
      touched = true;
      await steps.write(path, file.content);
    }
  };
  const removeAll = async (paths: readonly string[]) => {
    for (const relative of paths) {
      const path = workspacePath(relative);
      touched = true;
      await steps.remove(path);
    }
  };

  try {
    // Before anything is written: a dead server would make every write
    // pointless, and the restart it needs does its own.
    if (!(await listening(steps))) {
      done({ ok: false });
      return fail('The dev server was no longer running.');
    }
    done({ ok: true });

    if (plan.installs) {
      next('update-install');
      await writeAll(plan.write.filter((file) => manifest.has(file.path)));
      await removeAll(plan.remove.filter((path) => manifest.has(path)));
      let install: InstallOutcome;
      try {
        install = await installDependencies(
          steps.exec,
          steps.now,
          options.installTimeoutMs,
        );
      } catch (error) {
        done({ ok: false });
        throw error;
      }
      if (!install.ok) {
        done({ exitCode: install.exitCode, ok: false });
        return fail(
          install.timedOut
            ? `Installing the new dependencies did not finish within ${Math.round(options.installTimeoutMs / 60_000)} minutes.`
            : `npm install failed (exit ${install.exitCode}):\n${install.output}`,
        );
      }
      done({ ok: true, retriedOnline: install.retriedOnline });

      // As after a start from the image's tree: a package the project
      // stopped declaring must not stay where an import can find it.
      next('update-prune');
      done({ ok: await pruneUndeclared(steps.exec) });
    }

    next('update-write');
    await writeAll(
      plan.installs
        ? plan.write.filter((file) => !manifest.has(file.path))
        : plan.write,
    );
    await removeAll(
      plan.installs
        ? plan.remove.filter((path) => !manifest.has(path))
        : plan.remove,
    );
    done({ written: plan.write.length, removed: plan.remove.length });

    if (plan.installs) {
      next('update-dev-server');
      await steps.stopDevServer();
      const releaseBy = steps.now() + PORT_RELEASE_TIMEOUT_MS;
      while (await listening(steps)) {
        if (steps.now() >= releaseBy) {
          done({ ok: false });
          return fail(
            'The dev server did not stop, so it could not be restarted with the new dependencies.',
          );
        }
        await steps.wait(PORT_RELEASE_POLL_MS);
      }
      const dev = await steps.startDevServer();
      try {
        await dev.waitForPort(DEV_PORT, {
          mode: 'tcp',
          timeout: DEV_SERVER_READY_TIMEOUT_MS,
        });
      } catch {
        done({ ok: false });
        const logs = await dev
          .getLogs()
          .catch(() => ({ stdout: '', stderr: '' }));
        const tail = outputTail(logs.stdout, logs.stderr);
        const why =
          'The dev server did not start again after the new dependencies were installed.';
        return fail(tail ? `${why}\n${tail}` : why);
      }
      done({ ok: true });
    }

    next('update-typecheck');
    const typecheckFailure = await steps.typecheck();
    done({ ok: typecheckFailure === undefined });

    steps.log('preview.updated', {
      ms: steps.now() - began,
      written: plan.write.length,
      removed: plan.remove.length,
      installed: plan.installs,
    });
    return {
      ok: true,
      written: plan.write.length,
      removed: plan.remove.length,
      installed: plan.installs,
      ...(typecheckFailure ? { typecheckFailure } : {}),
    };
  } catch (error) {
    return fail(
      error instanceof Error && error.message
        ? error.message
        : 'The update could not be applied.',
    );
  }
}
