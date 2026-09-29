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
import {
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
} from '@vibld/core';

import {
  EVAL_RESULTS_FILE,
  REPAIR_RESULTS_FILE,
  parseRepairResults,
} from '../src/bakeoff.ts';
import type {
  BuildResults,
  CandidateRecord,
  EvalResults,
} from '../src/bakeoff.ts';
import { CASES, PROMPT_SET_VERSION, stubPlan } from '../src/cases.ts';
import { writeProject } from '../src/live.ts';
import { createEvalValidator } from '../src/validator.ts';

/**
 * The repair job, run as the workflow runs it: `bin/repair-candidates.ts`
 * spawned for real against files laid out as the two jobs before it leave
 * them, with only the model's socket replaced
 * (`test/fixtures/fake-model-service.ts`). Nothing is built or installed
 * here, and nothing leaves the process.
 */

const PACKAGE_ROOT = join(import.meta.dirname, '..');
const testCase = CASES.find((entry) => entry.id === 'vibld-marketing')!;
const MODEL = 'deepseek-flash';

/** Three candidates: one to repair, one rejected on its checks, one built. */
async function layOut(
  root: string,
): Promise<{ candidates: string; build: string }> {
  const candidates = join(root, 'candidates');
  const store = new InMemoryGenerationStore();
  const accepted = await new DurableGenerationRunner(store).run(
    { prompt: testCase.prompt, projectId: 'p', runId: 'r' },
    new FakeModelProvider([stubPlan(testCase)]),
    createEvalValidator(),
  );
  const project = accepted.accepted!;
  const record = (
    run: number,
    outcome: CandidateRecord['outcome'],
  ): CandidateRecord => ({
    dir: `${MODEL}/vibld-marketing/run-${run}`,
    model: MODEL,
    case: 'vibld-marketing',
    run,
    outcome,
    problems: [],
    costCents: 1,
    revision: project.revision,
    files: project.files.map((file) => file.path),
  });
  const evaluated: EvalResults = {
    schema: 1,
    promptSetVersion: PROMPT_SET_VERSION,
    provider: 'live',
    candidates: [
      record(1, 'accepted'),
      record(2, 'failed-expectations'),
      record(3, 'accepted'),
    ],
  };
  for (const candidate of evaluated.candidates) {
    await writeProject(join(candidates, candidate.dir!), project.files);
  }
  writeFileSync(join(candidates, EVAL_RESULTS_FILE), JSON.stringify(evaluated));
  const built: BuildResults = {
    schema: 1,
    projects: [
      {
        name: `${MODEL}/vibld-marketing/run-1`,
        ok: false,
        stage: 'build',
        detail: 'src/App.tsx(3,10): error TS1484',
        exitCode: 2,
        timedOut: false,
      },
      {
        name: `${MODEL}/vibld-marketing/run-2`,
        ok: false,
        stage: 'build',
        detail: 'x',
        exitCode: 2,
        timedOut: false,
      },
      {
        name: `${MODEL}/vibld-marketing/run-3`,
        ok: true,
        stage: 'done',
        detail: '',
      },
    ],
  };
  const build = join(root, 'build-results.json');
  writeFileSync(build, JSON.stringify(built));
  return { candidates, build };
}

function repair(
  paths: { candidates: string; build: string },
  out: string,
  env: Record<string, string>,
) {
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--import',
      './test/fixtures/fake-model-service.ts',
      'bin/repair-candidates.ts',
      paths.candidates,
      paths.build,
      out,
    ],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        DEEPSEEK_API_KEY: 'not-a-real-key',
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: `${result.stdout}${result.stderr}`,
    calls: (result.stdout.match(/fake-model-service call /g) ?? []).length,
  };
}

describe('the repair job', () => {
  it('repairs only what passed the checks and did not build, once each', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibld-repair-'));
    try {
      const paths = await layOut(root);
      const out = join(root, 'repaired');
      const result = repair(paths, out, { VIBLD_EVAL_LIVE: '1' });

      assert.equal(result.status, 0, result.stdout);
      // One repair, as the product makes it: a patch in bounded steps, an
      // outline of what to change and then one group of files.
      assert.equal(result.calls, 2, result.stdout);

      const written = parseRepairResults(
        readFileSync(join(out, REPAIR_RESULTS_FILE), 'utf8'),
      );
      assert.equal(written.candidates.length, 1);
      const [record] = written.candidates;
      assert.equal(record!.source, `${MODEL}/vibld-marketing/run-1`);
      assert.equal(record!.dir, record!.source);
      assert.equal(record!.outcome, 'accepted');
      // Measured from the usage the fake reported, like a generation.
      assert.ok(record!.costCents! > 0);
      // Written under the same name, for the next build to report it by.
      for (const path of record!.files!) {
        assert.ok(existsSync(join(out, record!.dir!, path)), path);
      }
      assert.equal(
        existsSync(join(out, `${MODEL}/vibld-marketing/run-2`)),
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('spends nothing without VIBLD_EVAL_LIVE, and leaves a results file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibld-repair-'));
    try {
      const paths = await layOut(root);
      const out = join(root, 'repaired');
      const result = repair(paths, out, {});
      assert.equal(result.status, 1);
      assert.equal(result.calls, 0);
      assert.match(result.stdout, /VIBLD_EVAL_LIVE is not set/);
      assert.deepEqual(
        JSON.parse(readFileSync(join(out, REPAIR_RESULTS_FILE), 'utf8')),
        { schema: 1, candidates: [] },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a candidate whose files are not the ones generated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibld-repair-'));
    try {
      const paths = await layOut(root);
      const app = join(
        paths.candidates,
        `${MODEL}/vibld-marketing/run-1`,
        'src/App.tsx',
      );
      writeFileSync(app, `${readFileSync(app, 'utf8')}// changed\n`);
      const out = join(root, 'repaired');
      mkdirSync(out, { recursive: true });
      const result = repair(paths, out, { VIBLD_EVAL_LIVE: '1' });
      assert.equal(result.calls, 0, result.stdout);
      const [record] = parseRepairResults(
        readFileSync(join(out, REPAIR_RESULTS_FILE), 'utf8'),
      ).candidates;
      assert.equal(record!.outcome, 'failed-validation');
      assert.match(
        record!.problems[0]!,
        /not the r[0-9a-f]{8} the eval generated/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
