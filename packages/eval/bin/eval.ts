import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { FakeModelProvider } from '@vibld/core';
import { CASES, stubPlan } from '../src/cases.ts';
import { runCase } from '../src/harness.ts';
import type { CaseResult } from '../src/harness.ts';
import {
  acceptedProject,
  createLiveRun,
  liveProblems,
  readLiveOptions,
  runCostCents,
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

/** `--case <id>` narrows the set. Anything else is left for the env to say. */
function selectedCaseIds(argv: string[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--case' && argv[i + 1]) {
      ids.push(argv[i + 1]!);
      i += 1;
    }
  }
  return ids;
}

/**
 * Write a generated project out so it can be read, run and ported.
 *
 * Paths are joined and then checked to still sit under the target directory.
 * The validator already refuses an escaping path before promotion, so this is
 * the second of two checks rather than the only one, but a function that
 * writes model output to a filesystem should not rely on that.
 */
async function writeProject(
  root: string,
  files: { path: string; content: string }[],
): Promise<void> {
  const base = resolve(root);
  for (const file of files) {
    const target = resolve(join(base, file.path));
    if (target !== base && !target.startsWith(`${base}/`)) {
      throw new Error(`refusing to write outside ${base}: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

async function main(): Promise<number> {
  const env = process.env;
  const live = readLiveOptions(env);
  const wanted = selectedCaseIds(process.argv.slice(2));
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
