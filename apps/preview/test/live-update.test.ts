import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProjectFile } from '@vibld/core';
import {
  MAX_UPDATE_CONTENT_CHARS,
  MAX_UPDATE_FILES,
  MAX_UPDATE_PATH_CHARS,
  PORT_PROBE,
  PORT_RELEASE_TIMEOUT_MS,
  applyLiveUpdate,
  describeFiles,
  filesProblem,
  pathProblem,
  planUpdate,
  workspacePath,
} from '../worker/live-update.ts';
import type { LiveUpdateSteps, UpdatePlan } from '../worker/live-update.ts';
import {
  DEV_COMMAND,
  DEV_SERVER_READY_TIMEOUT_MS,
  INSTALL_COMMAND,
  PRUNE_COMMAND,
  PRUNE_TIMEOUT_MS,
} from '../worker/provision.ts';
import type { ExecResultLike } from '../worker/provision.ts';

/**
 * A new revision applied to a running preview (D74): which files it writes,
 * when it installs, and what it says when it cannot.
 *
 * The clock is a counter the fakes advance, as in `provision.test.ts`, so
 * "took too long" is a fact the test sets rather than a wait it performs.
 */

const PACKAGE = JSON.stringify({
  name: 'site',
  private: true,
  type: 'module',
  scripts: { dev: 'vite', build: 'tsc && vite build' },
  dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
  devDependencies: { vite: '^8.3.0' },
});

function withPackage(change: (pkg: Record<string, unknown>) => void): string {
  const pkg = JSON.parse(PACKAGE) as Record<string, unknown>;
  change(pkg);
  return JSON.stringify(pkg);
}

const BASE: ProjectFile[] = [
  { path: 'package.json', content: PACKAGE },
  { path: 'index.html', content: '<div id="root"></div>' },
  { path: 'src/App.tsx', content: 'export default () => <h1>one</h1>;' },
  { path: 'src/old.tsx', content: 'export const Old = 1;' },
];

function replaced(
  files: ProjectFile[],
  changes: Record<string, string | null>,
): ProjectFile[] {
  const out = files
    .filter((file) => changes[file.path] !== null)
    .map((file) =>
      file.path in changes
        ? { path: file.path, content: changes[file.path] as string }
        : file,
    );
  for (const [path, content] of Object.entries(changes)) {
    if (content !== null && !files.some((file) => file.path === path)) {
      out.push({ path, content });
    }
  }
  return out;
}

async function plan(
  before: ProjectFile[],
  after: ProjectFile[],
): Promise<UpdatePlan> {
  return planUpdate(
    await describeFiles(before),
    await describeFiles(after),
    after,
  );
}

describe('the difference between what is served and a new revision', () => {
  it('writes what is new or changed, removes what is gone, and leaves the rest', async () => {
    const after = replaced(BASE, {
      'src/App.tsx': 'export default () => <h1>two</h1>;',
      'src/old.tsx': null,
      'src/New.tsx': 'export const New = 2;',
    });
    const result = await plan(BASE, after);
    assert.deepEqual(result.write.map((file) => file.path).sort(), [
      'src/App.tsx',
      'src/New.tsx',
    ]);
    assert.deepEqual(result.remove, ['src/old.tsx']);
    assert.equal(result.installs, false);
  });

  it('has nothing to do for the same files', async () => {
    const result = await plan(
      BASE,
      BASE.map((file) => ({ ...file })),
    );
    assert.deepEqual(result, { write: [], remove: [], installs: false });
  });

  it('removes only what the sandbox was given, never what npm or Vite wrote', async () => {
    // node_modules, a lockfile npm wrote for itself and Vite's cache are
    // never in the record, so nothing can ask for them to be deleted.
    const result = await plan(BASE, BASE.slice(0, 3));
    assert.deepEqual(result.remove, ['src/old.tsx']);
  });

  it('installs when a dependency is added, and writes package.json first', async () => {
    const after = replaced(BASE, {
      'src/App.tsx': 'import { Chart } from "recharts";',
      'package.json': withPackage((pkg) => {
        (pkg.dependencies as Record<string, string>).recharts = '^3.0.0';
      }),
    });
    const result = await plan(BASE, after);
    assert.equal(result.installs, true);
    assert.equal(result.write[0]?.path, 'package.json');
  });

  it('installs when a version changes or a dependency goes', async () => {
    const bumped = replaced(BASE, {
      'package.json': withPackage((pkg) => {
        (pkg.devDependencies as Record<string, string>).vite = '^8.4.0';
      }),
    });
    assert.equal((await plan(BASE, bumped)).installs, true);
    const dropped = replaced(BASE, {
      'package.json': withPackage((pkg) => {
        delete (pkg.dependencies as Record<string, string>)['react-dom'];
      }),
    });
    assert.equal((await plan(BASE, dropped)).installs, true);
  });

  it('does not install for a package.json change no install reads', async () => {
    // A rename or a script is a write, not an install: the key is the
    // dependency fields, compared as values rather than as text.
    const after = replaced(BASE, {
      'package.json': withPackage((pkg) => {
        pkg.name = 'renamed';
        pkg.scripts = { ...(pkg.scripts as object), preview: 'vite preview' };
        // Same dependencies, keys in a different order.
        pkg.dependencies = { 'react-dom': '^19.3.0', react: '^19.3.0' };
      }),
    });
    const result = await plan(BASE, after);
    assert.equal(result.installs, false);
    assert.deepEqual(
      result.write.map((file) => file.path),
      ['package.json'],
    );
  });

  it('installs when the lockfile appears, changes or goes', async () => {
    const locked = [...BASE, { path: 'package-lock.json', content: '{"v":1}' }];
    assert.equal((await plan(BASE, locked)).installs, true);
    const relocked = replaced(locked, { 'package-lock.json': '{"v":2}' });
    assert.equal((await plan(locked, relocked)).installs, true);
    const unlocked = replaced(locked, { 'package-lock.json': null });
    const result = await plan(locked, unlocked);
    assert.equal(result.installs, true);
    assert.deepEqual(result.remove, ['package-lock.json']);
  });

  it('treats any change to a package.json that does not parse as an install', async () => {
    const broken = replaced(BASE, { 'package.json': '{ not json' });
    assert.equal((await plan(BASE, broken)).installs, true);
    const stillBroken = replaced(broken, { 'package.json': '{ not json!' });
    assert.equal((await plan(broken, stillBroken)).installs, true);
    assert.equal((await plan(broken, broken)).installs, false);
  });
});

describe('where an update may write', () => {
  it('refuses every path that is not a canonical one inside /workspace', () => {
    for (const path of [
      '../escape.ts',
      'src/../../escape.ts',
      '/etc/passwd',
      'C:/windows.ts',
      'src\\App.tsx',
      'src//App.tsx',
      './src/App.tsx',
      'src/.',
      '',
      'src/\u0000.ts',
      'src/line\nbreak.ts',
      `src/${'a'.repeat(MAX_UPDATE_PATH_CHARS)}.ts`,
    ]) {
      assert.ok(pathProblem(path), `accepted ${JSON.stringify(path)}`);
      assert.throws(() => workspacePath(path));
    }
  });

  it('accepts an ordinary path, and places it under /workspace', () => {
    assert.equal(pathProblem('src/components/ui/button.tsx'), undefined);
    assert.equal(
      workspacePath('src/components/ui/button.tsx'),
      '/workspace/src/components/ui/button.tsx',
    );
    // A dot inside a name is a name, not a segment.
    assert.equal(pathProblem('src/..hidden/a.ts'), undefined);
  });

  it('bounds an update as a preview start is bounded', () => {
    const many = Array.from({ length: MAX_UPDATE_FILES + 1 }, (_, i) => ({
      path: `src/f${i}.ts`,
      content: '',
    }));
    assert.match(filesProblem(many) ?? '', /at most 50 files/);
    assert.match(
      filesProblem([
        { path: 'src/big.ts', content: 'x'.repeat(MAX_UPDATE_CONTENT_CHARS) },
      ]) ?? '',
      /160000 characters or fewer/,
    );
    assert.match(filesProblem([]) ?? '', /must carry/);
    assert.match(
      filesProblem([
        { path: 'a.ts', content: '1' },
        { path: 'a.ts', content: '2' },
      ]) ?? '',
      /appears twice/,
    );
    assert.match(
      filesProblem([{ path: '../a.ts', content: '' }]) ?? '',
      /escapes the project root/,
    );
    assert.equal(filesProblem(BASE), undefined);
  });
});

interface Recorded {
  /** Everything done to the container, in order. */
  actions: string[];
  logs: { event: string; fields: Record<string, unknown> }[];
  waitedWith?: { mode: string; timeout: number };
}

function container(
  overrides: {
    listening?: boolean;
    install?: (clock: { t: number }) => Promise<ExecResultLike>;
    write?: (path: string) => Promise<void>;
    /** Whether stopping the server frees the port. */
    stops?: boolean;
    waitForPort?: () => Promise<void>;
    typecheck?: string;
  } = {},
) {
  const clock = { t: 1_000 };
  const recorded: Recorded = { actions: [], logs: [] };
  let listening = overrides.listening ?? true;
  const ok: ExecResultLike = {
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
  };
  const steps: LiveUpdateSteps = {
    exec: async (command, options) => {
      if (command === PORT_PROBE) {
        recorded.actions.push('probe');
        return { ...ok, success: listening, exitCode: listening ? 0 : 1 };
      }
      recorded.actions.push(`exec ${command} (${options.timeout})`);
      if (command.startsWith('npm install') && overrides.install) {
        return overrides.install(clock);
      }
      return ok;
    },
    write: async (path) => {
      recorded.actions.push(`write ${path}`);
      if (overrides.write) await overrides.write(path);
    },
    remove: async (path) => {
      recorded.actions.push(`remove ${path}`);
    },
    typecheck: async () => {
      recorded.actions.push('typecheck');
      return overrides.typecheck;
    },
    stopDevServer: async () => {
      recorded.actions.push('stop dev server');
      if (overrides.stops ?? true) listening = false;
    },
    startDevServer: async () => {
      recorded.actions.push(`start ${DEV_COMMAND}`);
      listening = true;
      return {
        waitForPort: async (_port, options) => {
          recorded.waitedWith = options;
          if (overrides.waitForPort) await overrides.waitForPort();
        },
        getLogs: async () => ({ stdout: 'vite crashed', stderr: '' }),
      };
    },
    wait: async (ms) => {
      clock.t += ms;
    },
    now: () => clock.t,
    log: (event, fields) => recorded.logs.push({ event, fields }),
  };
  return { steps, recorded, clock };
}

const SOURCE_ONLY: UpdatePlan = {
  write: [{ path: 'src/App.tsx', content: 'two' }],
  remove: ['src/old.tsx'],
  installs: false,
};

const WITH_DEPENDENCY: UpdatePlan = {
  write: [
    { path: 'package.json', content: '{}' },
    { path: 'src/App.tsx', content: 'two' },
  ],
  remove: ['src/old.tsx'],
  installs: true,
};

describe('applying an update to a running preview', () => {
  it('writes the changed files and removes the deleted ones, with no install', async () => {
    const { steps, recorded } = container();
    const result = await applyLiveUpdate(SOURCE_ONLY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.deepEqual(result, {
      ok: true,
      written: 1,
      removed: 1,
      installed: false,
    });
    assert.deepEqual(recorded.actions, [
      'probe',
      'write /workspace/src/App.tsx',
      'remove /workspace/src/old.tsx',
      'typecheck',
    ]);
  });

  it('carries the typecheck answer for the new files', async () => {
    const { steps } = container({ typecheck: 'src/App.tsx: error TS2304' });
    const result = await applyLiveUpdate(SOURCE_ONLY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.equal(
      result.ok && result.typecheckFailure,
      'src/App.tsx: error TS2304',
    );
  });

  it('installs against the new package.json first, then writes the rest, then restarts the dev server', async () => {
    const { steps, recorded } = container();
    const result = await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 120_000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(recorded.actions, [
      'probe',
      'write /workspace/package.json',
      `exec ${INSTALL_COMMAND} (120000)`,
      `exec ${PRUNE_COMMAND} (${PRUNE_TIMEOUT_MS})`,
      'write /workspace/src/App.tsx',
      'remove /workspace/src/old.tsx',
      'stop dev server',
      'probe',
      `start ${DEV_COMMAND}`,
      'typecheck',
    ]);
    assert.deepEqual(recorded.waitedWith, {
      mode: 'tcp',
      timeout: DEV_SERVER_READY_TIMEOUT_MS,
    });
  });

  it('touches nothing when the dev server is not running, and says so', async () => {
    const { steps, recorded } = container({ listening: false });
    const result = await applyLiveUpdate(SOURCE_ONLY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.deepEqual(result, {
      ok: false,
      error: 'The dev server was no longer running.',
      touched: false,
    });
    assert.deepEqual(recorded.actions, ['probe']);
  });

  it("reports npm's own words when the install fails, and that files were touched", async () => {
    const { steps, recorded } = container({
      install: async () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm error 404 Not Found - GET https://registry.npmjs.org/nope',
      }),
    });
    const result = await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.equal(result.ok, false);
    assert.match(
      result.ok ? '' : result.error,
      /npm install failed \(exit 1\):\nnpm error 404/,
    );
    assert.equal(result.ok ? false : result.touched, true);
    assert.ok(
      !recorded.actions.includes('write /workspace/src/App.tsx'),
      'it went on writing after the install failed',
    );
  });

  it('bounds the install by what the caller allows, and says when it ran out', async () => {
    const { steps } = container({
      install: async (clock) => {
        clock.t += 120_000;
        return { success: false, exitCode: -1, stdout: '', stderr: '' };
      },
    });
    const result = await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 120_000,
    });
    assert.match(
      result.ok ? '' : result.error,
      /did not finish within 2 minutes/,
    );
  });

  it('gives up on a dev server that will not let go of its port', async () => {
    const { steps, recorded } = container({ stops: false });
    const result = await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.match(result.ok ? '' : result.error, /did not stop/);
    assert.ok(
      !recorded.actions.some((action) => action.startsWith('start ')),
      'it started a second server beside the first',
    );
    // It waited its bound and no longer.
    const probes = recorded.actions.filter((action) => action === 'probe');
    assert.ok(probes.length <= PORT_RELEASE_TIMEOUT_MS / 500 + 2);
  });

  it("shows the dev server's own output when it does not come back", async () => {
    const { steps } = container({
      waitForPort: async () => {
        throw new Error('exited');
      },
    });
    const result = await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.match(
      result.ok ? '' : result.error,
      /did not start again[\s\S]*vite crashed/,
    );
  });

  it('never throws, and says a failed write left the files touched', async () => {
    const { steps } = container({
      write: async () => {
        throw new Error('writeFile failed');
      },
    });
    const result = await applyLiveUpdate(SOURCE_ONLY, steps, {
      installTimeoutMs: 300_000,
    });
    assert.deepEqual(result, {
      ok: false,
      error: 'writeFile failed',
      touched: true,
    });
  });

  it('refuses a path outside /workspace even from its own plan', async () => {
    const { steps, recorded } = container();
    const result = await applyLiveUpdate(
      { write: [], remove: ['../../etc/passwd'], installs: false },
      steps,
      { installTimeoutMs: 300_000 },
    );
    assert.equal(result.ok, false);
    assert.ok(!recorded.actions.some((action) => action.startsWith('remove')));
  });

  it('logs each step with its duration, and no project content', async () => {
    const { steps, recorded } = container();
    await applyLiveUpdate(WITH_DEPENDENCY, steps, {
      installTimeoutMs: 300_000,
    });
    const steps_ = recorded.logs
      .filter((log) => log.event === 'preview.step')
      .map((log) => log.fields.step);
    assert.deepEqual(steps_, [
      'update-probe',
      'update-install',
      'update-prune',
      'update-write',
      'update-dev-server',
      'update-typecheck',
    ]);
    const updated = recorded.logs.find(
      (log) => log.event === 'preview.updated',
    );
    assert.deepEqual(Object.keys(updated?.fields ?? {}).sort(), [
      'installed',
      'ms',
      'removed',
      'written',
    ]);
    assert.ok(
      !JSON.stringify(recorded.logs).includes('src/App.tsx'),
      'a path reached the logs',
    );
  });
});
