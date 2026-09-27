import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  buildErrorFor,
  forLog,
  formatBakeoff,
  joinBakeoff,
  parseBuildResults,
  parseEvalResults,
  parseRepairResults,
  selectForRepair,
} from '../src/bakeoff.ts';
import type {
  BuildRecord,
  BuildResults,
  CandidateRecord,
  EvalResults,
  RepairRecord,
  RepairResults,
} from '../src/bakeoff.ts';

/**
 * How the bakeoff's four result files add up (Chris, 2026-09-27): accepted
 * means the checks passed and the project built, and each model gets a
 * figure as generated and a figure after one repair turn.
 *
 * The fixtures are the bakeoff that prompted the change, in miniature: a
 * model whose two accepted runs include one that did not build, and a model
 * whose one accepted run did not build.
 */

function candidate(
  model: string,
  run: number,
  outcome: CandidateRecord['outcome'] = 'accepted',
  costCents: number | null = 10,
): CandidateRecord {
  const dir = `${model}/vibld-marketing/run-${run}`;
  return {
    dir: outcome === 'failed-validation' ? null : dir,
    model,
    case: 'vibld-marketing',
    run,
    outcome,
    problems:
      outcome === 'failed-expectations'
        ? ['the project never mentions "waitlist"']
        : [],
    costCents,
  };
}

function build(
  name: string,
  stage: BuildRecord['stage'],
  extra: Partial<BuildRecord> = {},
): BuildRecord {
  return {
    name,
    ok: stage === 'done',
    stage,
    detail: stage === 'done' ? '' : `${stage} said no`,
    ...extra,
  };
}

function repair(
  source: string,
  outcome: RepairRecord['outcome'],
  costCents = 4,
): RepairRecord {
  return {
    source,
    dir: outcome === 'accepted' ? source : null,
    model: source.split('/')[0]!,
    case: 'vibld-marketing',
    run: Number(source.slice(-1)),
    outcome,
    problems: [],
    costCents,
  };
}

const EVALUATED: EvalResults = {
  schema: 1,
  promptSetVersion: '1.8.0',
  provider: 'live',
  candidates: [
    candidate('gpt-6-sol', 1),
    candidate('gpt-6-sol', 2),
    candidate('gpt-6-sol', 3, 'failed-expectations'),
    candidate('deepseek-v4-pro', 1),
    candidate('deepseek-v4-pro', 2, 'failed-validation'),
    candidate('deepseek-v4-pro', 3, 'failed-expectations'),
  ],
};

const BUILT: BuildResults = {
  schema: 1,
  projects: [
    build('gpt-6-sol/vibld-marketing/run-1', 'done'),
    build('gpt-6-sol/vibld-marketing/run-2', 'build', { exitCode: 2 }),
    // Rejected on its checks, so however it builds it is not repaired.
    build('gpt-6-sol/vibld-marketing/run-3', 'build', { exitCode: 2 }),
    build('deepseek-v4-pro/vibld-marketing/run-1', 'install', {
      exitCode: 1,
    }),
    build('deepseek-v4-pro/vibld-marketing/run-3', 'done'),
  ],
};

describe('which candidates get a repair turn', () => {
  it('those that passed the checks and then did not install or build', () => {
    assert.deepEqual(
      selectForRepair(EVALUATED, BUILT).map((job) => job.candidate.dir),
      [
        'gpt-6-sol/vibld-marketing/run-2',
        'deepseek-v4-pro/vibld-marketing/run-1',
      ],
    );
  });

  it('not one that failed the checks, whether or not it built', () => {
    // The repair is sent the build error, which is not what is wrong with a
    // project that ignored the request.
    const jobs = selectForRepair(EVALUATED, BUILT);
    assert.ok(jobs.every((job) => job.candidate.outcome === 'accepted'));
  });

  it('not one stopped at its time limit, never started, or failed by its container', () => {
    // The product buys a repair only for a failure that is the project's
    // (ABOUT_THE_PROJECT): a timeout is its `sandbox` reason and buys none.
    const evaluated: EvalResults = {
      ...EVALUATED,
      candidates: [1, 2, 3, 4].map((run) => candidate('m', run)),
    };
    const built: BuildResults = {
      schema: 1,
      projects: [
        build('m/vibld-marketing/run-1', 'build', { timedOut: true }),
        build('m/vibld-marketing/run-2', 'time'),
        build('m/vibld-marketing/run-3', 'container'),
        build('m/vibld-marketing/run-4', 'tampered'),
      ],
    };
    assert.deepEqual(selectForRepair(evaluated, built), []);
  });

  it('not one with no build result, which nobody showed to fail', () => {
    assert.deepEqual(
      selectForRepair(EVALUATED, { schema: 1, projects: [] }),
      [],
    );
  });

  it('sends the error worded as the product words it', () => {
    const [first, second] = selectForRepair(EVALUATED, BUILT);
    assert.equal(first!.error, 'npm run build failed (exit 2): build said no');
    assert.equal(second!.error, 'npm install failed (exit 1): install said no');
    assert.equal(
      buildErrorFor(build('x', 'build', { exitCode: null })),
      'npm run build failed (exit unknown): build said no',
    );
  });
});

describe('the report join', () => {
  const REPAIRED: RepairResults = {
    schema: 1,
    candidates: [
      repair('gpt-6-sol/vibld-marketing/run-2', 'accepted'),
      repair('deepseek-v4-pro/vibld-marketing/run-1', 'accepted'),
    ],
  };
  const REBUILT: BuildResults = {
    schema: 1,
    projects: [
      build('gpt-6-sol/vibld-marketing/run-2', 'done'),
      build('deepseek-v4-pro/vibld-marketing/run-1', 'build', {
        exitCode: 2,
      }),
    ],
  };

  it('gives each model both figures, the second including the first', () => {
    const report = joinBakeoff(EVALUATED, BUILT, REPAIRED, REBUILT);
    const [gpt, deepseek] = report.models;
    assert.equal(gpt!.model, 'gpt-6-sol');
    assert.equal(gpt!.runs, 3);
    assert.equal(gpt!.asGenerated, 1);
    assert.equal(gpt!.afterRepair, 2);
    assert.deepEqual(gpt!.rejected, { 'checks (ignored the request)': 1 });
    assert.equal(deepseek!.asGenerated, 0);
    assert.equal(deepseek!.afterRepair, 0);
    assert.deepEqual(deepseek!.rejected, {
      'install failed; repaired project: build failed': 1,
      'checks (validation)': 1,
      'checks (ignored the request)': 1,
    });
    assert.equal(report.allAccepted, false);
  });

  it('counts a failed build as a rejection, which "accepted" never did', () => {
    // The headline defect: before 1.8.0 gpt-6-sol scored 2/3 here.
    const report = joinBakeoff(EVALUATED, BUILT);
    assert.equal(report.models[0]!.asGenerated, 1);
    assert.equal(report.models[0]!.afterRepair, 1);
    assert.deepEqual(report.models[0]!.rejected, {
      'build failed; repair not run': 1,
      'checks (ignored the request)': 1,
    });
  });

  it('counts generation and repair spend, failures included', () => {
    const [gpt, deepseek] = joinBakeoff(
      EVALUATED,
      BUILT,
      REPAIRED,
      REBUILT,
    ).models;
    assert.equal(gpt!.generationCents, 30);
    assert.equal(gpt!.repairCents, 4);
    // The repair that did not build was still paid for.
    assert.equal(deepseek!.repairCents, 4);
    assert.equal(gpt!.unpriced, false);
  });

  it('says why a repair did not rescue a run', () => {
    const evaluated: EvalResults = {
      ...EVALUATED,
      candidates: [1, 2, 3, 4, 5].map((run) => candidate('m', run)),
    };
    const built: BuildResults = {
      schema: 1,
      projects: [1, 2, 3, 4, 5].map((run) =>
        build(`m/vibld-marketing/run-${run}`, 'build', { exitCode: 2 }),
      ),
    };
    const repaired: RepairResults = {
      schema: 1,
      candidates: [
        repair('m/vibld-marketing/run-1', 'failed-expectations'),
        repair('m/vibld-marketing/run-2', 'failed-provider'),
        repair('m/vibld-marketing/run-3', 'accepted'),
        repair('m/vibld-marketing/run-4', 'accepted'),
      ],
    };
    const rebuilt: BuildResults = {
      schema: 1,
      projects: [build('m/vibld-marketing/run-3', 'time')],
    };
    assert.deepEqual(
      joinBakeoff(evaluated, built, repaired, rebuilt).runs.map((run) =>
        run.verdict.accepted === false ? run.verdict.reason : 'accepted',
      ),
      [
        'build failed; repair failed checks',
        'build failed; repair provider error',
        'build failed; repaired project: out of time',
        'build failed; repaired project: no build result',
        'build failed; repair not run',
      ],
    );
  });

  it('never reads missing evidence as a pass', () => {
    const report = joinBakeoff(EVALUATED);
    assert.equal(report.models[0]!.asGenerated, 0);
    assert.equal(report.runs[0]!.verdict.accepted, false);
    assert.equal(report.allAccepted, false);
  });

  it('passes the gate only when every run is accepted after repair', () => {
    const evaluated: EvalResults = {
      ...EVALUATED,
      candidates: [candidate('m', 1), candidate('m', 2)],
    };
    const report = joinBakeoff(
      evaluated,
      {
        schema: 1,
        projects: [
          build('m/vibld-marketing/run-1', 'done'),
          build('m/vibld-marketing/run-2', 'build', { exitCode: 2 }),
        ],
      },
      {
        schema: 1,
        candidates: [repair('m/vibld-marketing/run-2', 'accepted')],
      },
      {
        schema: 1,
        projects: [build('m/vibld-marketing/run-2', 'done')],
      },
    );
    assert.equal(report.allAccepted, true);
  });

  it('prints both figures, the reasons, and the spend', () => {
    const text = formatBakeoff(
      joinBakeoff(EVALUATED, BUILT, REPAIRED, REBUILT),
    );
    assert.match(
      text,
      /\| `gpt-6-sol` \| 3 \| 1\/3 \| 2\/3 \| 1 \| 30\.000c \| 4\.000c \| 34\.000c \|/,
    );
    assert.match(
      text,
      /`deepseek-v4-pro`: 1 checks \(ignored the request\), 1 checks \(validation\), 1 install failed; repaired project: build failed/,
    );
    assert.match(text, /Prompt set 1\.8\.0/);
  });

  it('says the stub is not a model, and prices nothing for it', () => {
    const text = formatBakeoff(
      joinBakeoff({
        schema: 1,
        promptSetVersion: '1.8.0',
        provider: 'stub',
        candidates: [candidate('stub', 1, 'accepted', null)],
      }),
    );
    assert.match(text, /deterministic stub, not a model/);
    assert.match(text, /\| n\/a \| n\/a \| n\/a \|/);
  });
});

describe('the result files', () => {
  it('round-trip through their readers', () => {
    assert.deepEqual(parseEvalResults(JSON.stringify(EVALUATED)), EVALUATED);
    assert.deepEqual(parseBuildResults(JSON.stringify(BUILT)), BUILT);
    const repaired: RepairResults = {
      schema: 1,
      candidates: [repair('m/vibld-marketing/run-1', 'accepted')],
    };
    assert.deepEqual(parseRepairResults(JSON.stringify(repaired)), repaired);
  });

  it('refuse a shape they do not know', () => {
    // The build results come from a job that ran a model's code, and the
    // job that reads them holds the keys.
    assert.throws(() => parseBuildResults('{"schema":2,"projects":[]}'));
    assert.throws(() =>
      parseBuildResults(
        JSON.stringify({
          schema: 1,
          projects: [{ name: 'a', ok: false, stage: 'rm -rf', detail: '' }],
        }),
      ),
    );
    assert.throws(() =>
      parseBuildResults(
        JSON.stringify({
          schema: 1,
          projects: [{ name: 'a', ok: 'no', stage: 'build', detail: '' }],
        }),
      ),
    );
    assert.throws(() =>
      parseEvalResults(
        JSON.stringify({ ...EVALUATED, candidates: [{ dir: 1 }] }),
      ),
    );
  });
});

describe('what the report job needs', () => {
  it('imports nothing at run time, so Node alone can run it', () => {
    // The report job installs no dependencies. A value import here would
    // pass every test in this checkout and fail only in that job.
    for (const file of ['src/bakeoff.ts', 'bin/bakeoff-report.ts']) {
      const source = readFileSync(
        join(import.meta.dirname, '..', file),
        'utf8',
      );
      for (const [, what, from] of source.matchAll(
        /^import (type )?[^;]*? from '([^']+)';/gms,
      )) {
        assert.ok(
          what === 'type ' ||
            from!.startsWith('node:') ||
            from === '../src/bakeoff.ts',
          `${file} imports ${from} at run time`,
        );
      }
    }
  });

  it('breaks a workflow command out of text a model wrote', () => {
    assert.equal(forLog('::add-mask::x'), ': :add-mask: :x');
    assert.equal(forLog(':::'), ': : :');
    assert.doesNotMatch(forLog('a :: b :::: c'), /::/);
  });
});

describe('the report job', () => {
  const SCRIPT = join(import.meta.dirname, '..', 'bin', 'bakeoff-report.ts');

  function report(files: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'vibld-report-'));
    try {
      const args: string[] = [];
      for (const [flag, content] of Object.entries(files)) {
        const path = join(dir, `${flag}.json`);
        writeFileSync(path, JSON.stringify(content));
        args.push(`--${flag}`, path);
      }
      // Named but absent, as when the job that writes it did not run.
      if (!('rebuild' in files)) {
        args.push('--rebuild', join(dir, 'missing.json'));
      }
      const summary = join(dir, 'summary.md');
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', SCRIPT, ...args],
        {
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: summary },
        },
      );
      return {
        status: result.status,
        stdout: result.stdout,
        summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('writes the table to the summary and the log, and fails on a rejection', () => {
    const result = report({ eval: EVALUATED, build: BUILT });
    assert.equal(result.status, 1);
    assert.match(result.summary, /\| `gpt-6-sol` \| 3 \| 1\/3 \| 1\/3 \|/);
    assert.match(result.stdout, /\| `gpt-6-sol` \| 3 \| 1\/3 \| 1\/3 \|/);
    assert.match(result.summary, /Not found: the repair, rebuild results/);
    // The problems quote a model's paths: in the log, not the summary.
    assert.match(result.stdout, /never mentions "waitlist"/);
    assert.doesNotMatch(result.summary, /never mentions/);
  });

  it('passes when every run was accepted after at most one repair', () => {
    const evaluated: EvalResults = {
      ...EVALUATED,
      candidates: [candidate('m', 1), candidate('m', 2)],
    };
    const result = report({
      eval: evaluated,
      build: {
        schema: 1,
        projects: [
          build('m/vibld-marketing/run-1', 'done'),
          build('m/vibld-marketing/run-2', 'install', { exitCode: 1 }),
        ],
      },
      repair: {
        schema: 1,
        candidates: [repair('m/vibld-marketing/run-2', 'accepted')],
      },
      rebuild: {
        schema: 1,
        projects: [build('m/vibld-marketing/run-2', 'done')],
      },
    });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.summary, /\| `m` \| 2 \| 1\/2 \| 2\/2 \| 0 \|/);
  });

  it('fails, saying so, when there are no eval results at all', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', SCRIPT, '--eval', '/nonexistent.json'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No eval results/);
  });
});
