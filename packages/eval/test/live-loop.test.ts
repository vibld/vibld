import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The live loop, run as the command actually runs it.
 *
 * Everything here has been wrong before in a way unit tests around the pieces
 * did not catch, because the mistake was in the wiring rather than in any one
 * function. So this spawns `bin/eval.ts` for real, with only the socket
 * replaced (`test/fixtures/fake-model-service.ts`), and reads what it printed
 * and what it left on disk.
 *
 * No money is involved and nothing leaves the process: the fake answers the
 * client's own request, so an accidental real call would fail rather than
 * quietly bill someone.
 */

const PACKAGE_ROOT = join(import.meta.dirname, '..');

function runEval(out: string): { stdout: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './test/fixtures/fake-model-service.ts',
      'bin/eval.ts',
      '--case',
      'vibld-marketing',
    ],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        VIBLD_EVAL_LIVE: '1',
        VIBLD_EVAL_MODELS: 'deepseek-flash',
        VIBLD_EVAL_RUNS: '3',
        VIBLD_EVAL_OUT: out,
        DEEPSEEK_API_KEY: 'not-a-real-key',
      },
    },
  );
  return { stdout: `${result.stdout}${result.stderr}`, status: result.status };
}

describe('a live run with repeats', () => {
  it('runs each case the requested number of times, and keeps every run', () => {
    const out = mkdtempSync(join(tmpdir(), 'vibld-eval-'));
    try {
      const { stdout, status } = runEval(out);

      // Three requests for three runs. A repair loop or a retry landing here
      // later would change this number, and it should: the cost line and the
      // stability tally both assume one generation per run.
      assert.equal(
        (stdout.match(/fake-model-service call /g) ?? []).length,
        3,
        stdout,
      );

      // The point of the flag. Two runs agreed and one did not, and the table
      // says so rather than averaging it into a single score.
      assert.match(
        stdout,
        /vibld-marketing: 2\/3 accepted \(accepted, accepted, ignored the request\)/,
      );

      // Separate directories, and genuinely different content in them. The
      // failure this guards against is the runs overwriting each other, which
      // would leave the printed variance with nothing behind it -- and would
      // still pass a check that only asserted the directories exist.
      const appAt = (run: string) =>
        readFileSync(
          join(out, 'deepseek-flash', 'vibld-marketing', run, 'src/App.tsx'),
          'utf8',
        );
      assert.notEqual(appAt('run-1'), appAt('run-2'));

      // A run that failed its expectations still produced files, and they are
      // kept: looking at what a model got wrong is the reason to write any of
      // this out.
      assert.match(appAt('run-3'), /vibld-marketing/);

      // Non-zero because one run failed. A gate that passed here would report
      // an unreliable model as a good one.
      assert.equal(status, 1, stdout);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('leaves nothing behind from whatever was written there before', () => {
    // A repeat writes into run-N, so clearing only that leaf leaves the case
    // directory holding whatever it held before: an earlier single run's
    // project files beside the run directories, or run-4 and run-5 from a
    // larger count. The tree then describes a set of runs that never happened,
    // which is exactly what clearing the leaf is for, one level up.
    const out = mkdtempSync(join(tmpdir(), 'vibld-eval-'));
    const caseRoot = join(out, 'deepseek-flash', 'vibld-marketing');
    try {
      mkdirSync(join(caseRoot, 'src'), { recursive: true });
      writeFileSync(join(caseRoot, 'package.json'), '{"stale":true}', 'utf8');
      writeFileSync(join(caseRoot, 'src/App.tsx'), '// from a single run\n');
      mkdirSync(join(caseRoot, 'run-9'), { recursive: true });
      writeFileSync(join(caseRoot, 'run-9/package.json'), '{"stale":true}');

      const { stdout } = runEval(out);

      assert.equal(existsSync(join(caseRoot, 'package.json')), false, stdout);
      assert.equal(existsSync(join(caseRoot, 'src')), false, stdout);
      assert.equal(existsSync(join(caseRoot, 'run-9')), false, stdout);
      for (const run of ['run-1', 'run-2', 'run-3']) {
        assert.equal(
          existsSync(join(caseRoot, run, 'package.json')),
          true,
          run,
        );
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
