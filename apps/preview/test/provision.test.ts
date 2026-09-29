import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEV_PORT,
  DEV_SERVER_READY_TIMEOUT_MS,
  INSTALL_COMMAND,
  ONLINE_INSTALL_COMMAND,
  PREVIEW_INSTALL_TIMEOUT_MS,
  PRUNE_COMMAND,
  SEED_CLEANUP,
  SEED_COMMAND,
  SEED_TIMEOUT_MS,
  WARM_MODULES,
  installDependencies,
  outputTail,
  provisionPreview,
  seedModules,
  staleCacheMiss,
} from '../worker/provision.ts';
import type {
  DevProcessLike,
  ExecResultLike,
  ProvisionSteps,
} from '../worker/provision.ts';

/**
 * That a preview's start-up ends, says where it is, and says why when it
 * does not work (2026-09-28: a preview sat on "Starting the dev server…"
 * for as long as it was watched, during what was really `npm install`).
 *
 * The clock is a counter the fakes advance, so "took too long" is a fact
 * the test sets rather than a wait it performs.
 */

interface Recorded {
  phases: string[];
  commands: { command: string; timeout?: number }[];
  /** The seed (D74) and its cleanup, kept apart from the commands above. */
  seeding: string[];
  logs: { event: string; fields: Record<string, unknown> }[];
  waitedWith?: { mode: string; timeout: number };
}

function harness(overrides: {
  install?: (clock: { t: number }) => Promise<ExecResultLike>;
  seed?: () => Promise<ExecResultLike>;
  prune?: () => Promise<ExecResultLike>;
  typecheck?: () => Promise<string | undefined>;
  waitForPort?: (clock: { t: number }) => Promise<void>;
  devLogs?: () => Promise<{ stdout: string; stderr: string }>;
}) {
  const clock = { t: 1_000 };
  const recorded: Recorded = {
    phases: [],
    commands: [],
    seeding: [],
    logs: [],
  };
  const dev: DevProcessLike = {
    waitForPort: async (_port, options) => {
      recorded.waitedWith = options;
      if (overrides.waitForPort) await overrides.waitForPort(clock);
    },
    getLogs: overrides.devLogs ?? (async () => ({ stdout: '', stderr: '' })),
  };
  const steps: ProvisionSteps = {
    writeProject: async () => {},
    setPhase: async (phase) => {
      recorded.phases.push(phase);
    },
    exec: async (command, options) => {
      if (
        command === SEED_COMMAND ||
        command === SEED_CLEANUP ||
        command === PRUNE_COMMAND
      ) {
        recorded.seeding.push(command);
        if (command === SEED_COMMAND && overrides.seed) return overrides.seed();
        if (command === PRUNE_COMMAND && overrides.prune) {
          return overrides.prune();
        }
        return { success: true, exitCode: 0, stdout: '', stderr: '' };
      }
      recorded.commands.push({ command, timeout: options.timeout });
      return overrides.install
        ? overrides.install(clock)
        : { success: true, exitCode: 0, stdout: '', stderr: '' };
    },
    typecheck: overrides.typecheck ?? (async () => undefined),
    startProcess: async (command) => {
      recorded.commands.push({ command });
      return dev;
    },
    exposePort: async (port) => ({ url: `https://${port}-preview.example` }),
    now: () => clock.t,
    log: (event, fields) => recorded.logs.push({ event, fields }),
  };
  return { steps, recorded, clock };
}

describe('provisionPreview', () => {
  it('says "installing" through the install and "starting" only for the dev server', async () => {
    const { steps, recorded } = harness({});
    const result = await provisionPreview(steps);
    assert.deepEqual(result, {
      ok: true,
      url: `https://${DEV_PORT}-preview.example`,
    });
    assert.deepEqual(recorded.phases, ['installing', 'starting']);
    assert.equal(
      recorded.commands[0]?.command,
      'npm install --prefer-offline --no-audit --no-fund',
      'the install does not prefer what npm already has (D74)',
    );
    assert.match(
      recorded.commands[1]?.command ?? '',
      /^npm run dev -- --host 0\.0\.0\.0 --port 5173 --strictPort$/,
    );
  });

  it('bounds the install and the wait for the dev server', async () => {
    const { steps, recorded } = harness({});
    await provisionPreview(steps);
    assert.equal(recorded.commands[0]?.timeout, PREVIEW_INSTALL_TIMEOUT_MS);
    assert.deepEqual(recorded.waitedWith, {
      mode: 'tcp',
      timeout: DEV_SERVER_READY_TIMEOUT_MS,
    });
  });

  it('fails with a sentence when the install runs out of time, whichever way the SDK reports it', async () => {
    for (const install of [
      async (clock: { t: number }) => {
        clock.t += PREVIEW_INSTALL_TIMEOUT_MS;
        return { success: false, exitCode: -1, stdout: '', stderr: '' };
      },
      async (clock: { t: number }) => {
        clock.t += PREVIEW_INSTALL_TIMEOUT_MS;
        throw new Error('command timed out');
      },
    ]) {
      const { steps, recorded } = harness({ install });
      const result = await provisionPreview(steps);
      assert.equal(result.ok, false);
      assert.match(
        result.ok ? '' : result.error,
        /did not finish within 5 minutes/,
      );
      assert.deepEqual(
        recorded.phases,
        ['installing'],
        'it never claimed to be starting the server',
      );
      assert.ok(
        recorded.logs.some(
          (l) => l.event === 'preview.failed' && l.fields.step === 'install',
        ),
      );
    }
  });

  it("shows npm's own error when the install fails", async () => {
    const { steps } = harness({
      install: async () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr:
          'npm error 404 Not Found - GET https://registry.npmjs.org/not-a-package',
      }),
    });
    const result = await provisionPreview(steps);
    assert.equal(result.ok, false);
    assert.match(
      result.ok ? '' : result.error,
      /npm install failed \(exit 1\):\nnpm error 404/,
    );
  });

  it("shows the dev server's own output when it never starts listening", async () => {
    const { steps } = harness({
      waitForPort: async (clock) => {
        clock.t += DEV_SERVER_READY_TIMEOUT_MS;
        throw new Error('timed out');
      },
      devLogs: async () => ({
        stdout: '  VITE v8.3.1  ready\n  Local: http://localhost:3000/',
        stderr: '',
      }),
    });
    const result = await provisionPreview(steps);
    assert.equal(result.ok, false);
    const error = result.ok ? '' : result.error;
    assert.match(
      error,
      /did not start listening on port 5173 within 90 seconds/,
    );
    assert.match(
      error,
      /localhost:3000/,
      'the reader can see it chose another port',
    );
  });

  it('says the server stopped when it exits early, and survives unreadable logs', async () => {
    const { steps } = harness({
      waitForPort: async () => {
        throw new Error('Process exited with code 1 before ready');
      },
      devLogs: async () => {
        throw new Error('gone');
      },
    });
    const result = await provisionPreview(steps);
    assert.equal(result.ok, false);
    assert.match(
      result.ok ? '' : result.error,
      /^The dev server stopped before it was ready \(Process exited with code 1 before ready\)\.$/,
    );
  });

  it('carries the typecheck answer onto a successful start', async () => {
    const { steps } = harness({
      typecheck: async () => 'src/App.tsx(3,1): error TS2304',
    });
    const result = await provisionPreview(steps);
    assert.deepEqual(result, {
      ok: true,
      url: `https://${DEV_PORT}-preview.example`,
      typecheckFailure: 'src/App.tsx(3,1): error TS2304',
    });
  });

  it('logs each step with its duration and no project content', async () => {
    const { steps, recorded } = harness({
      install: async (clock) => {
        clock.t += 42_000;
        return {
          success: true,
          exitCode: 0,
          stdout: 'added 312 packages',
          stderr: '',
        };
      },
    });
    await provisionPreview(steps);
    const install = recorded.logs.find(
      (l) => l.event === 'preview.step' && l.fields.step === 'install',
    );
    assert.equal(install?.fields.ms, 42_000);
    assert.ok(recorded.logs.some((l) => l.event === 'preview.ready'));
    assert.ok(
      !JSON.stringify(recorded.logs).includes('added 312 packages'),
      'command output stays out of the logs',
    );
  });

  it('never throws: an unexpected error becomes a failure', async () => {
    const { steps } = harness({});
    steps.writeProject = async () => {
      throw new Error('writeFile failed');
    };
    const result = await provisionPreview(steps);
    assert.deepEqual(result, { ok: false, error: 'writeFile failed' });
  });
});

describe('seeding node_modules from the image (D74)', () => {
  it('puts the installed stack in place before the install, and prunes after it', async () => {
    const { steps, recorded } = harness({});
    const order: string[] = [];
    const exec = steps.exec;
    steps.exec = async (command, options) => {
      order.push(command === SEED_COMMAND ? 'seed' : command.split(' ')[1]!);
      return exec(command, options);
    };
    await provisionPreview(steps);
    assert.deepEqual(order.slice(0, 3), ['seed', 'install', 'prune']);
    assert.deepEqual(recorded.seeding, [SEED_COMMAND, PRUNE_COMMAND]);
    const seed = recorded.logs.find(
      (l) => l.event === 'preview.step' && l.fields.step === 'seed',
    );
    assert.equal(seed?.fields.ok, true);
  });

  it('moves the image copy only into an empty place, through a staging name', () => {
    // A retry in the same container keeps the node_modules it has, and a
    // move that fails part way never leaves half a tree named node_modules.
    assert.match(SEED_COMMAND, /\[ ! -e \/workspace\/node_modules \]/);
    assert.ok(
      SEED_COMMAND.indexOf(`mv ${WARM_MODULES} /workspace/.node_modules-seed`) <
        SEED_COMMAND.indexOf(
          'mv /workspace/.node_modules-seed /workspace/node_modules',
        ),
    );
  });

  it('cleans up after a seed that failed, and still installs', async () => {
    for (const seed of [
      async () => ({ success: false, exitCode: 1, stdout: '', stderr: '' }),
      async (): Promise<ExecResultLike> => {
        throw new Error('exec failed');
      },
    ]) {
      const { steps, recorded } = harness({ seed });
      const result = await provisionPreview(steps);
      assert.equal(result.ok, true, 'a failed seed failed the start');
      // No prune either: an install from nothing has nothing undeclared.
      assert.deepEqual(recorded.seeding, [SEED_COMMAND, SEED_CLEANUP]);
      assert.equal(recorded.commands[0]?.command, INSTALL_COMMAND);
      const logged = recorded.logs.find(
        (l) => l.event === 'preview.step' && l.fields.step === 'seed',
      );
      assert.equal(logged?.fields.ok, false);
    }
  });

  it('starts the preview even when the prune fails, and says so in the log', async () => {
    const { steps } = harness({
      prune: async () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: '',
      }),
    });
    const logs: { event: string; fields: Record<string, unknown> }[] = [];
    const log = steps.log;
    steps.log = (event, fields) => {
      logs.push({ event, fields });
      log(event, fields);
    };
    const result = await provisionPreview(steps);
    assert.equal(result.ok, true);
    assert.equal(
      logs.find((l) => l.event === 'preview.step' && l.fields.step === 'prune')
        ?.fields.ok,
      false,
    );
  });

  it('is bounded', async () => {
    const timeouts: number[] = [];
    await seedModules(async (_command, options) => {
      timeouts.push(options.timeout);
      return { success: true, exitCode: 0, stdout: '', stderr: '' };
    });
    assert.deepEqual(timeouts, [SEED_TIMEOUT_MS]);
  });
});

describe('installDependencies (D74, cache first)', () => {
  function execs(
    answers: ((clock: { t: number }) => Promise<ExecResultLike>)[],
  ) {
    const clock = { t: 0 };
    const commands: { command: string; timeout: number }[] = [];
    let call = 0;
    const exec = async (
      command: string,
      options: { cwd: string; timeout: number },
    ) => {
      commands.push({ command, timeout: options.timeout });
      const answer = answers[call++];
      assert.ok(answer, `an unexpected command: ${command}`);
      return answer(clock);
    };
    return { exec, clock, commands, now: () => clock.t };
  }
  const ok = async () => ({
    success: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
  });

  it('installs from the cache first and asks the registry only for what is missing', async () => {
    const { exec, now, commands } = execs([ok]);
    const result = await installDependencies(exec, now, 60_000);
    assert.deepEqual(result, { ok: true, retriedOnline: false });
    assert.deepEqual(commands, [{ command: INSTALL_COMMAND, timeout: 60_000 }]);
  });

  it('retries online, inside what is left of the bound, when the cache is stale', async () => {
    // npm uses a cached package document as it is under --prefer-offline,
    // so a version published since it was cached is ETARGET rather than a
    // fetch. That is the cache's fault, not the project's.
    const { exec, now, commands } = execs([
      async (clock) => {
        clock.t += 10_000;
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr:
            'npm error code ETARGET\nnpm error notarget No matching version found for react@^19.9.0.',
        };
      },
      ok,
    ]);
    const result = await installDependencies(exec, now, 60_000);
    assert.deepEqual(result, { ok: true, retriedOnline: true });
    assert.deepEqual(commands, [
      { command: INSTALL_COMMAND, timeout: 60_000 },
      { command: ONLINE_INSTALL_COMMAND, timeout: 50_000 },
    ]);
  });

  it("does not retry a failure that is the project's own", async () => {
    const { exec, now, commands } = execs([
      async () => ({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'npm error 404 Not Found - GET https://registry.npmjs.org/nope',
      }),
    ]);
    const result = await installDependencies(exec, now, 60_000);
    assert.equal(result.ok, false);
    assert.equal(commands.length, 1);
    assert.match(result.ok ? '' : result.output, /404 Not Found/);
  });

  it('does not retry once the bound is spent', async () => {
    const { exec, now, commands } = execs([
      async (clock) => {
        clock.t += 60_000;
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'npm error code ETARGET',
        };
      },
    ]);
    const result = await installDependencies(exec, now, 60_000);
    assert.deepEqual(result, {
      ok: false,
      timedOut: true,
      exitCode: -1,
      output: '',
    });
    assert.equal(commands.length, 1);
  });

  it('tells a stale cache from any other failure', () => {
    assert.equal(staleCacheMiss('npm error code ETARGET'), true);
    assert.equal(
      staleCacheMiss('No matching version found for vite@^9.0.0'),
      true,
    );
    assert.equal(staleCacheMiss('npm error code E404'), false);
    assert.equal(staleCacheMiss('npm error code ERESOLVE'), false);
  });
});

describe('outputTail', () => {
  it('keeps the end of long output, stderr first', () => {
    const tail = outputTail('out', `${'x'.repeat(3000)}END`);
    assert.ok(tail.startsWith('…'));
    assert.ok(tail.endsWith('out'));
    assert.ok(tail.length <= 1501);
  });
});

describe('provisionLost', () => {
  it('is lost only when a start-up phase has nothing running it here', async () => {
    const { provisionLost } = await import('../worker/provision.ts');
    assert.equal(provisionLost('installing', false), true);
    assert.equal(provisionLost('starting', false), true);
    assert.equal(provisionLost('installing', true), false);
    assert.equal(provisionLost('starting', true), false);
    for (const phase of ['queued', 'ready', 'failed'] as const) {
      assert.equal(provisionLost(phase, false), false);
    }
  });
});
