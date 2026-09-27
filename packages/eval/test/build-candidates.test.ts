import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  carriesCredentials,
  candidateWorstCaseMs,
  canStart,
  containerStart,
  digest,
  findProjects,
  isEntry,
  passedEnv,
  readArguments,
  run,
} from '../bin/build-candidates.ts';

const SCRIPT = fileURLToPath(
  new URL('../bin/build-candidates.ts', import.meta.url),
);

describe('building what an eval run wrote', () => {
  it('finds every project, one per run directory, and never looks inside node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'candidates-'));
    const project = (path: string) => {
      mkdirSync(join(root, path), { recursive: true });
      writeFileSync(join(root, path, 'package.json'), '{}');
    };
    project('gpt-6-sol/coffee-roaster');
    project('claude-opus-5-5/recipe-box/run-1');
    project('claude-opus-5-5/recipe-box/run-2');
    // A dependency's manifest is not a candidate, and neither is anything
    // below a project that has its own package.json.
    project('gpt-6-sol/coffee-roaster/node_modules/vite');
    project('gpt-6-sol/coffee-roaster/examples/nested');

    assert.deepEqual(
      findProjects(root).map((path) => path.slice(root.length + 1)),
      [
        'claude-opus-5-5/recipe-box/run-1',
        'claude-opus-5-5/recipe-box/run-2',
        'gpt-6-sol/coffee-roaster',
      ],
    );
  });

  it('hands npm no key, token or secret from the caller', () => {
    // A candidate's build config is code a model wrote, and it runs with
    // whatever environment this passes.
    const env = passedEnv({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      HTTPS_PROXY: 'http://proxy.internal:3128',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      OPENAI_API_KEY: 'sk-secret',
      DEEPSEEK_API_KEY: 'sk-secret',
      GITHUB_TOKEN: 'ghs_secret',
      ACTIONS_RUNTIME_TOKEN: 'secret',
      NPM_TOKEN: 'npm_secret',
    });
    assert.deepEqual(env, {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      HTTPS_PROXY: 'http://proxy.internal:3128',
    });
  });
});

describe('the time a run may take (#237 review)', () => {
  it('starts a candidate only if its worst case fits before the deadline', () => {
    const now = 1_000_000;
    for (const container of [false, true]) {
      const worst = candidateWorstCaseMs(container);
      assert.ok(canStart(now, now + worst, container));
      assert.ok(!canStart(now, now + worst - 1, container));
      assert.ok(canStart(now, Number.POSITIVE_INFINITY, container));
    }
  });

  it("reserves a container's start and removal as well", () => {
    // docker run and docker rm have limits of their own, and a candidate
    // started with only the install and build limits left could overrun
    // the deadline by both.
    assert.equal(
      candidateWorstCaseMs(true) - candidateWorstCaseMs(false),
      3 * 60_000,
    );
  });

  it('marks a candidate it never started as not built, and fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'budget-'));
    try {
      mkdirSync(join(root, 'a'));
      writeFileSync(join(root, 'a', 'package.json'), '{}');
      // A budget shorter than one candidate's worst case starts nothing.
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', SCRIPT, root, '1'],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stdout, /a \(not built: out of time\)/);
      assert.match(result.stdout, /0\/1 projects build/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a budget that is not a number of minutes', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', SCRIPT, tmpdir(), 'soon'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a number of minutes/);
  });
});

describe('knowing it was run', () => {
  it('matches its own URL, without import.meta.main', () => {
    // import.meta.main is undefined before Node 22.18 and 24.2, which the
    // repository's engines range allows; the script then built nothing and
    // exited 0.
    assert.ok(isEntry(pathToFileURL(SCRIPT).href, SCRIPT));
    assert.ok(!isEntry(pathToFileURL(SCRIPT).href, '/elsewhere/other.ts'));
    assert.ok(!isEntry(pathToFileURL(SCRIPT).href, undefined));
  });
});

/**
 * Whether a process is still running. A killed process whose parent is gone
 * stays a zombie until init reaps it, and some containers' init never does,
 * so a zombie counts as not running: it holds no CPU, memory or files.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return (
      stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z'
    );
  } catch {
    return true;
  }
}

describe('what one candidate can do to the next (#237 review)', () => {
  it('hashes a project by path and content, ignoring node_modules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'digest-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"name":"a"}');
      const before = digest(dir);
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', 'x.js'), 'x');
      assert.equal(digest(dir), before);
      writeFileSync(join(dir, 'package.json'), '{"name":"b"}');
      assert.notEqual(digest(dir), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills what a command started when it times out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'group-'));
    try {
      const result = await run(
        'sh',
        ['-c', 'sleep 30 & echo $! > child.pid; wait'],
        dir,
        300,
        { PATH: process.env.PATH ?? '' },
      );
      assert.equal(result.ok, false);
      assert.match(result.output, /timed out/);
      const pid = Number(readFileSync(join(dir, 'child.pid'), 'utf8'));
      await new Promise((settle) => setTimeout(settle, 100));
      assert.equal(alive(pid), false, 'the grandchild outlived the timeout');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills what a command left running when it finished', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'group-'));
    try {
      const started = Date.now();
      const result = await run(
        'sh',
        ['-c', 'sleep 30 & echo $! > child.pid'],
        dir,
        10_000,
        { PATH: process.env.PATH ?? '' },
      );
      assert.equal(result.ok, true);
      assert.ok(Date.now() - started < 5_000, 'waited on the leftover');
      const pid = Number(readFileSync(join(dir, 'child.pid'), 'utf8'));
      await new Promise((settle) => setTimeout(settle, 100));
      assert.equal(alive(pid), false, 'the leftover outlived its command');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the command line and the container (#237 review)', () => {
  it('reads a directory, an optional budget and an optional image', () => {
    assert.deepEqual(readArguments(['out']), {
      ok: true,
      root: 'out',
      minutes: undefined,
      container: undefined,
    });
    assert.deepEqual(
      readArguments(['out', '170', '--container', 'node:24-bookworm-slim']),
      {
        ok: true,
        root: 'out',
        minutes: 170,
        container: 'node:24-bookworm-slim',
      },
    );
    assert.equal(readArguments([]).ok, false);
    assert.equal(readArguments(['out', 'soon']).ok, false);
    assert.equal(readArguments(['out', '1', 'extra']).ok, false);
    assert.equal(readArguments(['out', '--container', 'a b']).ok, false);
    assert.equal(readArguments(['out', '--unknown']).ok, false);
  });

  it('gives a candidate only its own snapshot, read-only, as an unprivileged user', () => {
    const args = containerStart('c1', 'node:24-bookworm-slim', '/stage/0', {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      HTTPS_PROXY: 'http://proxy:3128',
    });
    const joined = args.join(' ');
    assert.match(joined, /--volume \/stage\/0:\/candidate:ro/);
    assert.equal(args.filter((arg) => arg === '--volume').length, 1);
    // Nothing written inside reaches the runner's disk (#237 review): a
    // read-only image, and a size-bounded tmpfs for each writable path.
    assert.ok(args.includes('--read-only'));
    const tmpfs = args.flatMap((arg, i) =>
      arg === '--tmpfs' ? [args[i + 1]!] : [],
    );
    assert.deepEqual(
      tmpfs.map((mount) => mount.split(':')[0]),
      ['/home/node', '/tmp'],
    );
    for (const mount of tmpfs) {
      assert.match(mount, /size=\d+[mg]/);
      assert.match(mount, /nr_inodes=\d+/);
    }
    assert.match(joined, /--user node/);
    assert.match(joined, /--cap-drop ALL/);
    assert.match(joined, /--security-opt no-new-privileges/);
    assert.match(joined, /--pids-limit \d+/);
    assert.match(joined, /--memory \w+/);
    assert.match(joined, /--rm/);
    // The runner's own PATH and HOME are not the container's, and only
    // proxy settings are passed in.
    assert.match(joined, /--env HTTPS_PROXY=http:\/\/proxy:3128/);
    assert.doesNotMatch(joined, /\/home\/runner|PATH=/);
  });
});

describe('proxy settings a candidate is given (#237 review)', () => {
  it('passes a plain proxy and never one with credentials in it', () => {
    const args = containerStart('c1', 'img', '/stage/0', {
      HTTPS_PROXY: 'http://user:secret@proxy.internal:3128',
      https_proxy: 'http://:secret@proxy.internal:3128',
      HTTP_PROXY: 'http://proxy.internal:3128',
      NO_PROXY: 'localhost,.internal',
    }).join(' ');
    assert.doesNotMatch(args, /secret/);
    assert.match(args, /--env HTTP_PROXY=http:\/\/proxy\.internal:3128/);
    assert.match(args, /--env NO_PROXY=localhost,\.internal/);
  });

  it('reads credentials in a URL, and in what is not one', () => {
    assert.equal(carriesCredentials('http://proxy:3128'), false);
    assert.equal(carriesCredentials('http://u@proxy:3128'), true);
    assert.equal(carriesCredentials('http://u:p@proxy:3128'), true);
    assert.equal(carriesCredentials('u:p@proxy:3128'), true);
  });
});

describe('keeping what a command said (#237 review)', () => {
  it('keeps the end of verbose output, where the reason is', async () => {
    const result = await run(
      'sh',
      [
        '-c',
        'head -c 3000000 /dev/zero | tr "\\0" x; echo; echo THE-REASON; exit 1',
      ],
      tmpdir(),
      30_000,
      { PATH: process.env.PATH ?? '' },
    );
    assert.equal(result.ok, false);
    assert.match(result.output.trimEnd(), /THE-REASON$/);
    assert.ok(result.output.length <= 2_000_000);
  });
});

describe('a container that is not removed (#237 review)', () => {
  /**
   * Runs the script with a stand-in `docker` first on PATH, which succeeds
   * at everything except what `rm` is told to do.
   */
  function withDocker(rm: string) {
    const root = mkdtempSync(join(tmpdir(), 'rm-'));
    const bin = mkdtempSync(join(tmpdir(), 'docker-'));
    try {
      for (const name of ['a', 'b']) {
        mkdirSync(join(root, name));
        writeFileSync(join(root, name, 'package.json'), '{}');
      }
      const docker = join(bin, 'docker');
      writeFileSync(
        docker,
        `#!/bin/sh\nif [ "$1" = rm ]; then ${rm}; fi\nexit 0\n`,
        { mode: 0o755 },
      );
      return spawnSync(
        process.execPath,
        ['--experimental-strip-types', SCRIPT, root, '--container', 'img'],
        {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  }

  it('fails that candidate and starts no other', () => {
    const result = withDocker('echo "Error: removal stuck" >&2; exit 1');
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL {2}a \(failed: its container could not be removed\)/,
    );
    assert.match(result.stdout, /removal stuck/);
    assert.match(
      result.stdout,
      /FAIL {2}b \(not built: an earlier container was left\)/,
    );
  });

  it('counts a container that is already gone as removed', () => {
    const result = withDocker(
      'echo "Error response from daemon: No such container: x" >&2; exit 1',
    );
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /2\/2 projects build/);
  });
});
