import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEV_PORT,
  DEV_SERVER_READY_TIMEOUT_MS,
  PREVIEW_INSTALL_TIMEOUT_MS,
  outputTail,
  provisionPreview,
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
  logs: { event: string; fields: Record<string, unknown> }[];
  waitedWith?: { mode: string; timeout: number };
}

function harness(overrides: {
  install?: (clock: { t: number }) => Promise<ExecResultLike>;
  typecheck?: () => Promise<string | undefined>;
  waitForPort?: (clock: { t: number }) => Promise<void>;
  devLogs?: () => Promise<{ stdout: string; stderr: string }>;
}) {
  const clock = { t: 1_000 };
  const recorded: Recorded = { phases: [], commands: [], logs: [] };
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
      'npm install --no-audit --no-fund',
    );
    assert.match(
      recorded.commands[1]?.command ?? '',
      /^npm run dev -- --host 0\.0\.0\.0 --port 5173$/,
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
