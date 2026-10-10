import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProjectFile } from '@vibld/core';
import { PreviewSandbox } from '../worker/preview-sandbox.ts';
import type { PreviewStatus } from '../worker/preview-sandbox.ts';
import { PORT_PROBE } from '../worker/live-update.ts';
import { DEV_COMMAND, PROVISION_LOST_ERROR } from '../worker/provision.ts';
import type { ExecResultLike } from '../worker/provision.ts';

/**
 * `PreviewSandbox.updatePreview` (D74), run rather than read: which
 * revision the preview says it serves, what an update that cannot be done
 * in place leaves behind, and what it gives back.
 *
 * The container is a map of files and a flag for whether the dev server
 * is listening; the fleet records what it is given back. Storage is an
 * in-memory map with the Durable Object storage calls this class makes.
 * The input gate is not modelled, so nothing here says anything about two
 * calls interleaving; `updatePreview`'s own queue is what covers that.
 */

class MemoryStorage {
  readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.map.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put(key: string | Record<string, unknown>, value?: unknown) {
    const entries = typeof key === 'string' ? { [key]: value } : key;
    for (const [name, entry] of Object.entries(entries)) {
      this.map.set(name, structuredClone(entry));
    }
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.map.delete(key);
    }
  }
}

const OK: ExecResultLike = {
  success: true,
  exitCode: 0,
  stdout: '',
  stderr: '',
};

interface World {
  sandbox: PreviewSandbox;
  storage: MemoryStorage;
  files: Map<string, string>;
  commands: string[];
  released: number[];
  killed: string[];
  destroyed: () => number;
  container: {
    listening: boolean;
    install: () => Promise<ExecResultLike>;
    failWrite?: string;
  };
  /** Runs everything the object handed to `waitUntil`, to the end. */
  settle(): Promise<void>;
}

function world(storage = new MemoryStorage()): World {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    storage,
    waitUntil: (work: Promise<unknown>) => {
      pending.push(work);
    },
    id: { toString: () => 'sandbox-1' },
  };
  const released: number[] = [];
  const env = {
    Fleet: {
      getByName: () => ({
        enqueue: async () => ({ id: 7, active: true, position: 0 }),
        status: async () => ({ active: true, position: 0 }),
        release: async (id: number) => {
          released.push(id);
        },
      }),
    },
  };
  const sandbox = new PreviewSandbox(ctx as never, env as never);
  const files = new Map<string, string>();
  const commands: string[] = [];
  const killed: string[] = [];
  let destroyed = 0;
  let processes = 0;
  const container: World['container'] = {
    listening: false,
    install: async () => OK,
  };
  Object.assign(sandbox, {
    exec: async (command: string) => {
      if (command === PORT_PROBE) {
        return { ...OK, success: container.listening };
      }
      commands.push(command);
      if (command.startsWith('npm install')) return container.install();
      return OK;
    },
    mkdir: async () => ({ success: true }),
    writeFile: async (path: string, content: string) => {
      if (container.failWrite === path) throw new Error('writeFile failed');
      files.set(path, content);
      return { success: true };
    },
    exists: async (path: string) => ({
      success: true,
      exists: files.has(path),
    }),
    deleteFile: async (path: string) => {
      files.delete(path);
      return { success: true };
    },
    startProcess: async (command: string) => {
      commands.push(command);
      processes += 1;
      container.listening = true;
      return {
        id: `proc-${processes}`,
        waitForPort: async () => {},
        getLogs: async () => ({ stdout: '', stderr: '' }),
      };
    },
    killProcess: async (id: string) => {
      killed.push(id);
      container.listening = false;
    },
    exposePort: async () => ({
      url: 'https://5173-sandbox-1.vibld-preview.dev',
    }),
    destroy: async () => {
      destroyed += 1;
      container.listening = false;
    },
  });
  return {
    sandbox,
    storage,
    files,
    commands,
    released,
    killed,
    destroyed: () => destroyed,
    container,
    settle: async () => {
      while (pending.length > 0) await pending.shift();
    },
  };
}

const PACKAGE = JSON.stringify({
  name: 'site',
  type: 'module',
  scripts: { dev: 'vite', typecheck: 'tsc --noEmit' },
  dependencies: { react: '^19.3.0' },
});

const FIRST: ProjectFile[] = [
  { path: 'package.json', content: PACKAGE },
  { path: 'index.html', content: '<img src="/media/hero.png">' },
  { path: 'src/App.tsx', content: 'one' },
  { path: 'src/old.tsx', content: 'old' },
];

const SECOND: ProjectFile[] = [
  { path: 'package.json', content: PACKAGE },
  { path: 'index.html', content: '<img src="/media/team.png">' },
  { path: 'src/App.tsx', content: 'two' },
  { path: 'src/New.tsx', content: 'new' },
];

const WITH_DEPENDENCY: ProjectFile[] = [
  {
    path: 'package.json',
    content: JSON.stringify({
      ...JSON.parse(PACKAGE),
      dependencies: { react: '^19.3.0', recharts: '^3.0.0' },
    }),
  },
  ...SECOND.slice(1),
];

async function running(files = FIRST, revision = 'r1'): Promise<World> {
  const w = world();
  await w.sandbox.startPreview(
    files,
    'vibld-preview.dev',
    'user_1',
    'user_1',
    revision,
  );
  await w.settle();
  const status = await w.sandbox.getPreviewStatus();
  assert.equal(status.status, 'ready', 'the preview never started');
  assert.equal(status.revision, revision);
  w.commands.length = 0;
  return w;
}

function readyUrl(status: PreviewStatus): string | undefined {
  return status.status === 'ready' ? status.url : undefined;
}

describe('a follow-up applied to a running preview', () => {
  it('writes only what changed, removes what went, and says which revision it serves', async () => {
    const w = await running();
    const writes: string[] = [];
    const write = (w.sandbox as unknown as { writeFile: Function }).writeFile;
    Object.assign(w.sandbox, {
      writeFile: async (path: string, content: string) => {
        writes.push(path);
        return write(path, content);
      },
    });

    const result = await w.sandbox.updatePreview(SECOND, 'r2');

    assert.equal(result.outcome, 'applied');
    const status = result.outcome === 'applied' ? result.status : undefined;
    assert.equal(status?.status, 'ready');
    assert.equal(status?.revision, 'r2');
    assert.equal(
      status && readyUrl(status),
      'https://5173-sandbox-1.vibld-preview.dev',
      'the preview moved address',
    );
    assert.deepEqual(writes.sort(), [
      '/workspace/index.html',
      '/workspace/src/App.tsx',
      '/workspace/src/New.tsx',
    ]);
    assert.equal(w.files.has('/workspace/src/old.tsx'), false);
    assert.equal(w.files.get('/workspace/src/App.tsx'), 'two');
    assert.ok(
      !w.commands.some((command) => command.startsWith('npm install')),
      'it installed for a change that needed none',
    );
    assert.equal((await w.sandbox.getPreviewStatus()).revision, 'r2');
  });

  it('moves the media allowlist to what the new code references', async () => {
    const w = await running();
    assert.deepEqual(w.storage.map.get('media-allowed'), ['media/hero.png']);
    await w.sandbox.updatePreview(SECOND, 'r2');
    assert.deepEqual(w.storage.map.get('media-allowed'), ['media/team.png']);
  });

  it('keeps its fleet ticket and its clock', async () => {
    const w = await running();
    const before = await w.sandbox.getPreviewStatus();
    await w.sandbox.updatePreview(SECOND, 'r2');
    const after = await w.sandbox.getPreviewStatus();
    assert.deepEqual(w.released, [], 'it gave its slot back while running');
    assert.equal(
      after.expiresAt,
      before.expiresAt,
      'an update moved the hard lifetime',
    );
  });

  it('records the new name without touching the container when nothing changed', async () => {
    const w = await running();
    const result = await w.sandbox.updatePreview(
      FIRST.map((file) => ({ ...file })),
      'r1b',
    );
    assert.equal(result.outcome, 'applied');
    assert.equal((await w.sandbox.getPreviewStatus()).revision, 'r1b');
    assert.deepEqual(w.commands, []);
  });

  it('refuses a path outside /workspace before it touches anything', async () => {
    const w = await running();
    const result = await w.sandbox.updatePreview(
      [{ path: '../../etc/cron.d/x', content: 'x' }],
      'r2',
    );
    assert.equal(result.outcome, 'invalid');
    assert.equal((await w.sandbox.getPreviewStatus()).revision, 'r1');
  });
});

describe('an update that cannot be done in place', () => {
  it('is a restart when no preview is running', async () => {
    const w = world();
    const result = await w.sandbox.updatePreview(SECOND, 'r2');
    assert.deepEqual(result, {
      outcome: 'restart',
      reason: 'The preview was not running.',
    });
  });

  it('is a restart, with nothing written, when the dev server has died', async () => {
    const w = await running();
    w.container.listening = false;
    const result = await w.sandbox.updatePreview(SECOND, 'r2');
    assert.deepEqual(result, {
      outcome: 'restart',
      reason: 'The dev server was no longer running.',
    });
    assert.equal(w.files.get('/workspace/src/App.tsx'), 'one');
    // Still what it was, so the builder's restart notice is still true.
    assert.equal((await w.sandbox.getPreviewStatus()).revision, 'r1');
  });

  it('stops claiming the old revision when it broke off part way', async () => {
    const w = await running();
    w.container.failWrite = '/workspace/src/New.tsx';
    const result = await w.sandbox.updatePreview(SECOND, 'r2');
    assert.equal(result.outcome, 'restart');
    const status = await w.sandbox.getPreviewStatus();
    assert.equal(status.status, 'ready', 'the dev server is still up');
    assert.equal(
      status.revision,
      undefined,
      'a half-written sandbox still said it served r1',
    );
    // And it will not be diffed against a record that is no longer true.
    w.container.failWrite = undefined;
    assert.deepEqual(await w.sandbox.updatePreview(SECOND, 'r2'), {
      outcome: 'restart',
      reason: 'The preview does not know which files it is serving.',
    });
  });
});

describe('an update that brings new dependencies', () => {
  it('installs under "installing", restarts the dev server, and ends ready on the new revision', async () => {
    const w = await running();
    let finishInstall: (result: ExecResultLike) => void = () => {};
    w.container.install = () =>
      new Promise((resolve) => {
        finishInstall = resolve;
      });

    const result = await w.sandbox.updatePreview(WITH_DEPENDENCY, 'r2');
    assert.deepEqual(result, { outcome: 'installing' });
    // Not mistaken for a start-up lost with an earlier instance.
    const installing = await w.sandbox.getPreviewStatus();
    assert.equal(installing.status, 'installing');
    // Still serving r1 until the install ends, and saying where it is going.
    assert.equal(installing.updatingTo, 'r2');
    // A second update waits rather than writing underneath the install.
    assert.deepEqual(await w.sandbox.updatePreview(SECOND, 'r3'), {
      outcome: 'busy',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    finishInstall(OK);
    await w.settle();

    const status = await w.sandbox.getPreviewStatus();
    assert.equal(status.status, 'ready');
    assert.equal(status.revision, 'r2');
    assert.equal(status.updatingTo, undefined);
    assert.equal(readyUrl(status), 'https://5173-sandbox-1.vibld-preview.dev');
    assert.deepEqual(
      w.killed,
      ['proc-1'],
      'the old dev server was not stopped',
    );
    assert.deepEqual(
      w.commands.filter((command) => !command.startsWith('npm run typecheck')),
      [
        'npm install --prefer-offline --no-audit --no-fund',
        'npm prune --no-audit --no-fund',
        DEV_COMMAND,
      ],
    );
    // The next restart stops the server that is running now.
    assert.equal(w.storage.map.get('vibld:preview-dev'), 'proc-2');
    assert.deepEqual(w.released, []);
  });

  it('ends the preview, gives its slot back and says why, when the install fails', async () => {
    const w = await running();
    w.container.install = async () => ({
      success: false,
      exitCode: 1,
      stdout: '',
      stderr:
        'npm error 404 Not Found - GET https://registry.npmjs.org/recharts',
    });
    assert.deepEqual(await w.sandbox.updatePreview(WITH_DEPENDENCY, 'r2'), {
      outcome: 'installing',
    });
    await w.settle();

    const status = await w.sandbox.getPreviewStatus();
    assert.equal(status.status, 'failed');
    assert.match(status.error ?? '', /could not take the new dependencies/);
    assert.match(status.error ?? '', /404 Not Found/);
    assert.deepEqual(w.released, [7]);
    assert.equal(w.destroyed(), 1);
  });

  it('does not bring a preview back that was stopped while it installed', async () => {
    const w = await running();
    let finishInstall: (result: ExecResultLike) => void = () => {};
    w.container.install = () =>
      new Promise((resolve) => {
        finishInstall = resolve;
      });
    await w.sandbox.updatePreview(WITH_DEPENDENCY, 'r2');
    await w.sandbox.stopPreview();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishInstall(OK);
    await w.settle();

    assert.deepEqual(await w.sandbox.getPreviewStatus(), {
      status: 'failed',
      error: 'No preview has been started.',
    });
  });

  it('is settled as lost by the next instance when its own was replaced mid-install', async () => {
    // internal PR 307's rule, for an update: `installing` stored with nothing running
    // it here is a failure, and the slot goes back.
    const w = await running();
    w.container.install = () => new Promise(() => {});
    await w.sandbox.updatePreview(WITH_DEPENDENCY, 'r2');

    const next = world(w.storage);
    const status = await next.sandbox.getPreviewStatus();
    assert.deepEqual(status, { status: 'failed', error: PROVISION_LOST_ERROR });
    assert.deepEqual(next.released, [7]);
  });
});
