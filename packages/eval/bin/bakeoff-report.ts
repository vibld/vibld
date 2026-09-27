import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  forLog,
  formatBakeoff,
  joinBakeoff,
  parseBuildResults,
  parseEvalResults,
  parseRepairResults,
} from '../src/bakeoff.ts';

/**
 * The bakeoff's verdict: one row per model, from the four files its jobs
 * wrote, to the job summary and the log.
 *
 * The last job of `.github/workflows/bakeoff.yml`. It holds nothing and runs
 * with Node alone, because it only reads JSON and adds it up
 * (`src/bakeoff.ts`, whose every import is a type).
 *
 * Usage: node --experimental-strip-types bin/bakeoff-report.ts
 *   --eval <file> [--build <file>] [--repair <file>] [--rebuild <file>]
 *
 * Only the eval's results are required. A missing build, repair or rebuild
 * file is a job that did not run or wrote nothing, and the runs it would
 * have spoken for are reported as rejected for want of that evidence rather
 * than passed without it.
 *
 * Exits non-zero unless every run was accepted after at most one repair.
 * That is the gate the bakeoff has always had, failing when any run was
 * rejected, moved to where the final answer is known: a run the repair
 * rescued does not fail it, and a run that passed its checks and did not
 * build now does, where before the build was never asked.
 */

function read<T>(file: string | undefined, parse: (text: string) => T) {
  if (file === undefined || !existsSync(file)) return undefined;
  return parse(readFileSync(file, 'utf8'));
}

function main(): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        eval: { type: 'string' },
        build: { type: 'string' },
        repair: { type: 'string' },
        rebuild: { type: 'string' },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { values } = parsed;
  const evaluated = read(values.eval, parseEvalResults);
  if (!evaluated) {
    console.error(
      'No eval results to report on. The run that generates the candidates did not write any.',
    );
    return 1;
  }
  const inputs = {
    build: read(values.build, parseBuildResults),
    repair: read(values.repair, parseRepairResults),
    rebuild: read(values.rebuild, parseBuildResults),
  };
  const report = joinBakeoff(
    evaluated,
    inputs.build,
    inputs.repair,
    inputs.rebuild,
  );

  const missing = Object.entries(inputs)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  const text = [
    formatBakeoff(report),
    ...(missing.length > 0
      ? [
          '',
          `Not found: the ${missing.join(', ')} results. Every run they would have decided is counted as rejected.`,
        ]
      : []),
  ].join('\n');

  console.log(text);
  // What each run got wrong, in the log only. These quote paths a model
  // chose, so they are kept out of the summary and made safe to print.
  const troubled = report.runs.filter((run) => run.problems.length > 0);
  if (troubled.length > 0) console.log('\nProblems');
  for (const run of troubled) {
    console.log(`  ${run.model} ${run.case} run ${run.run}`);
    for (const problem of run.problems) {
      console.log(`    - ${forLog(problem)}`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
  return report.allAccepted ? 0 : 1;
}

process.exitCode = main();
