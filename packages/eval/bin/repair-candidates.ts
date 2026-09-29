import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  EVAL_RESULTS_FILE,
  REPAIR_RESULTS_FILE,
  forLog,
  parseBuildResults,
  parseEvalResults,
  selectForRepair,
} from '../src/bakeoff.ts';
import type { RepairRecord, RepairResults } from '../src/bakeoff.ts';
import { CASES } from '../src/cases.ts';
import {
  containedPath,
  createLiveRun,
  describeEffort,
  liveProblems,
  readLiveOptions,
  runCostCents,
  writeProject,
} from '../src/live.ts';
import { repairCandidate } from '../src/repair.ts';

/**
 * Give every candidate that passed the eval's checks and then failed to
 * install or build its one repair turn, and write what came back.
 *
 * The bakeoff's third job, and the second that holds model keys
 * (`.github/workflows/bakeoff.yml`). It reads three things: the eval's
 * results and candidates, written by the job that generated them, and the
 * build results, written by the job that built them. It sends each selected
 * candidate's files and build error to the same model, with the product's
 * repair prompt (`src/repair.ts`), checks the answer the way the eval checked
 * the first attempt, and writes the repaired projects and a results file to
 * `<out>` for the next job to build.
 *
 * It never builds, installs or runs anything a model wrote. A candidate's
 * files are read as text and a repaired project is written as text, and
 * whether it builds is the next job's question, asked in a job that holds
 * no keys. The build results come from a job that did run model-written
 * code, so they are read as data of a known shape (`parseBuildResults`)
 * and what a build printed is only ever sent to the model, as the product
 * sends it, or printed made safe for the log (`forLog`).
 *
 * Usage: node --experimental-strip-types bin/repair-candidates.ts
 *   <candidates> <build-results> <out>
 * Spends money, so, like a live eval, only with `VIBLD_EVAL_LIVE=1` and the
 * keys of the models whose candidates it repairs.
 *
 * Exits non-zero only when it could not do its job: unreadable input, a
 * refusal to spend, or a candidate it could not read back. A repair that
 * fails its checks is a result, recorded for the report to judge.
 */

const USAGE = 'Usage: repair-candidates.ts <candidates> <build-results> <out>';

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {},
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const [candidates, buildFile, out, ...rest] = parsed.positionals;
  if (!candidates || !buildFile || !out || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }

  const evaluated = parseEvalResults(
    readFileSync(join(candidates, EVAL_RESULTS_FILE), 'utf8'),
  );
  const built = parseBuildResults(readFileSync(buildFile, 'utf8'));
  const jobs = selectForRepair(evaluated, built);

  // Written before anything is spent, so the next job always finds a
  // results file, empty when nothing needed repairing.
  const results: RepairResults = { schema: 1, candidates: [] };
  mkdirSync(out, { recursive: true });
  const save = () =>
    writeFileSync(
      join(out, REPAIR_RESULTS_FILE),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
  save();

  console.log(
    `${jobs.length} candidate${jobs.length === 1 ? '' : 's'} passed the checks and did not build.`,
  );
  if (jobs.length === 0) return 0;

  const env = process.env;
  const models = [...new Set(jobs.map((job) => job.candidate.model))];
  const live = { ...readLiveOptions(env), models, runs: 1 };
  if (!live.enabled) {
    console.error(
      'A repair turn is a paid model call, and VIBLD_EVAL_LIVE is not set.',
    );
    return 1;
  }
  const problems = liveProblems(live, env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 1;
  }
  // A repair's file steps are asked at VIBLD_WRITE_EFFORT too (D70), which
  // the bakeoff sets to what the candidates were generated at, so its log
  // says which effort that was, as the eval's does.
  console.log(describeEffort(live.writeEffort));

  let unreadable = 0;
  let totalCents = 0;
  for (const { candidate, error } of jobs) {
    const label = `${candidate.model} ${candidate.case} run ${candidate.run}`;
    const testCase = CASES.find((entry) => entry.id === candidate.case);
    const root = join(candidates, candidate.dir);
    const files = (candidate.files ?? []).map((path) => {
      const at = containedPath(root, path);
      if (at === null) return null;
      try {
        return { path, content: readFileSync(at, 'utf8') };
      } catch {
        return null;
      }
    });
    if (
      !testCase ||
      files.length === 0 ||
      files.some((file) => file === null)
    ) {
      // A candidate that cannot be read back is not repaired on a guess.
      // It fails this job, because it means the files handed between the
      // jobs are not what they should be.
      console.error(`${forLog(label)}: could not read the candidate back`);
      unreadable += 1;
      continue;
    }

    const projectId = `${candidate.model}:${candidate.case}#${candidate.run}`;
    const run = createLiveRun(env, candidate.model, projectId, testCase.style, {
      keepSpec: true,
    });
    const repaired = await repairCandidate({
      testCase,
      files: files as { path: string; content: string }[],
      error,
      provider: run.provider,
      projectId,
      ...(candidate.revision !== undefined
        ? { revision: candidate.revision }
        : {}),
    });
    const cents = runCostCents(candidate.model, run.usage);
    if (cents !== null) totalCents += cents;

    // Written to the candidate's own path below `<out>`, so the build of
    // the repaired projects names each one the way the eval did.
    if (repaired.project) {
      await writeProject(join(out, candidate.dir), repaired.project.files);
    }
    const record: RepairRecord = {
      source: candidate.dir,
      dir: repaired.project ? candidate.dir : null,
      model: candidate.model,
      case: candidate.case,
      run: candidate.run,
      outcome: repaired.result.outcome,
      problems: repaired.result.problems,
      costCents: cents,
      ...(repaired.project
        ? {
            revision: repaired.project.revision,
            files: repaired.project.files.map((file) => file.path),
          }
        : {}),
    };
    results.candidates.push(record);
    save();

    console.log(
      `${label}: repair ${repaired.result.outcome === 'accepted' ? 'passed the checks' : `did not pass the checks (${repaired.result.outcome})`}, ${cents === null ? 'cost unknown' : `${cents.toFixed(3)}c`}`,
    );
    for (const problem of repaired.result.problems) {
      console.log(`    - ${forLog(problem)}`);
    }
  }
  console.log(`\nMeasured repair spend: ${totalCents.toFixed(3)}c`);
  return unreadable === 0 ? 0 : 1;
}

process.exitCode = await main();
