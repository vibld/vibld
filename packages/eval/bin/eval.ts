import { FakeModelProvider } from '@vibld/core';
import { CASES, stubPlan } from '../src/cases.ts';
import { runCase } from '../src/harness.ts';
import type { CaseResult } from '../src/harness.ts';
import { formatReport, summarise } from '../src/report.ts';
import { SCENARIOS, runScenario } from '../src/scenarios.ts';

/**
 * Run the versioned set and the injected failures, then print what happened.
 *
 * Exits non-zero when a case or a scenario fails, so this is usable as a gate
 * rather than only as a thing someone reads.
 */
async function main(): Promise<number> {
  const results: CaseResult[] = [];
  for (const testCase of CASES) {
    const provider = new FakeModelProvider([stubPlan(testCase)]);
    results.push(await runCase(testCase, provider));
  }

  const report = summarise(results, 'stub');
  console.log(formatReport(report));

  console.log('\nInjected failures');
  let scenariosPassed = 0;
  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    if (result.passed) scenariosPassed += 1;
    console.log(
      `  ${result.id}: ${result.passed ? 'behaved correctly' : 'MISBEHAVED'} — ${result.detail}`,
    );
  }
  console.log(
    `${scenariosPassed}/${SCENARIOS.length} injected failures behaved correctly`,
  );

  const ok =
    report.accepted === report.total && scenariosPassed === SCENARIOS.length;
  return ok ? 0 : 1;
}

process.exitCode = await main();
