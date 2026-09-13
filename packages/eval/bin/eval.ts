import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FakeModelProvider } from '@vibld/core';
import { CASES, stubPlan } from '../src/cases.ts';
import { runCase } from '../src/harness.ts';
import type { CaseResult } from '../src/harness.ts';
import {
  acceptedProject,
  createLiveRun,
  liveProblems,
  planWrites,
  readLiveOptions,
  runCostCents,
  selectCaseIds,
} from '../src/live.ts';
import { formatReport, summarise } from '../src/report.ts';
import { SCENARIOS, runScenario } from '../src/scenarios.ts';

/**
 * Run the versioned set and the injected failures, then print what happened.
 *
 * Exits non-zero when a case or a scenario fails, so this is usable as a gate
 * rather than only as a thing someone reads.
 *
 * Against the deterministic stub by default. `VIBLD_EVAL_LIVE=1` with
 * `VIBLD_EVAL_MODELS` runs the same cases against real models instead, which
 * spends real money and so is never reached by a key merely being present.
 */

/**
 * Write a generated project out so it can be read, run and ported.
 *
 * Planned in full before anything happens, so a snapshot that cannot be
 * written truthfully (an escaping path, or two paths that are the same file on
 * a case-insensitive volume) is refused while the previous candidate is still
 * intact. Clearing first and discovering the problem halfway through would
 * destroy the run it was meant to be compared against.
 *
 * The directory is cleared once the plan holds. Overwriting in place would
 * leave files from a previous run that this generation did not produce, so the
 * directory would stop matching the project being reported and could build or
 * render from a stale config absent from the snapshot.
 */
async function writeProject(
  root: string,
  files: { path: string; content: string }[],
): Promise<void> {
  const plan = planWrites(root, files);
  if (!plan.ok) throw new Error(plan.error);

  await rm(root, { recursive: true, force: true });
  const byTarget = new Map(
    plan.writes.map((write) => [write.path, write.target]),
  );
  for (const file of files) {
    const target = byTarget.get(file.path)!;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

async function main(): Promise<number> {
  const env = process.env;
  const live = readLiveOptions(env);
  const selection = selectCaseIds(process.argv.slice(2));
  if (!selection.ok) {
    console.error(selection.error);
    return 1;
  }
  const wanted = selection.ids;
  const cases =
    wanted.length > 0 ? CASES.filter((c) => wanted.includes(c.id)) : CASES;

  if (wanted.length > 0 && cases.length !== wanted.length) {
    const known = CASES.map((c) => c.id).join(', ');
    console.error(`No such case. The set contains: ${known}`);
    return 1;
  }

  const problems = liveProblems(live, env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 1;
  }

  if (!live.enabled) {
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      const provider = new FakeModelProvider([stubPlan(testCase)]);
      results.push(await runCase(testCase, provider));
    }
    console.log(formatReport(summarise(results, 'stub')));
    return (await runScenarios()) &&
      results.every((r) => r.outcome === 'accepted')
      ? 0
      : 1;
  }

  // Live. One report per model, so the comparison is readable side by side
  // rather than as one pooled score that hides which model earned what.
  let allAccepted = true;
  let totalCents = 0;
  for (const model of live.models) {
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      const projectId = `${model}:${testCase.id}`;
      const run = createLiveRun(env, model, projectId);
      const result = await runCase(testCase, run.provider, {
        store: run.store,
        projectId,
      });
      results.push(result);
      if (result.outcome !== 'accepted') allAccepted = false;

      const cents = runCostCents(model, run.usage);
      if (cents !== null) totalCents += cents;

      if (live.outDir) {
        const project = await acceptedProject(run);
        if (project) {
          const root = join(live.outDir, model, testCase.id);
          await writeProject(root, project.files);
          console.log(`  wrote ${project.files.length} files to ${root}`);
        }
      }
    }
    console.log(formatReport(summarise(results, model)));
  }
  console.log(`\nMeasured spend across all models: ${totalCents.toFixed(3)}c`);

  const scenariosOk = await runScenarios();
  return allAccepted && scenariosOk ? 0 : 1;
}

async function runScenarios(): Promise<boolean> {
  console.log('\nInjected failures');
  let passed = 0;
  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    if (result.passed) passed += 1;
    console.log(
      `  ${result.id}: ${result.passed ? 'behaved correctly' : 'MISBEHAVED'} -- ${result.detail}`,
    );
  }
  console.log(
    `${passed}/${SCENARIOS.length} injected failures behaved correctly`,
  );
  return passed === SCENARIOS.length;
}

process.exitCode = await main();
