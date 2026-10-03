import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { FakeModelProvider, InMemoryGenerationStore } from '@vibld/core';
import type { ProjectSnapshot } from '@vibld/core';
import { EVAL_RESULTS_FILE } from '../src/bakeoff.ts';
import type { CandidateRecord, EvalResults } from '../src/bakeoff.ts';
import {
  CASES,
  GALLERY_CASES,
  PROMPT_SET_VERSION,
  findCase,
  stubPlan,
} from '../src/cases.ts';
import { runCase } from '../src/harness.ts';
import type { CaseResult } from '../src/harness.ts';
import {
  acceptedProject,
  createLiveRun,
  describeEffort,
  liveProblems,
  readLiveOptions,
  runCostCents,
  selectCaseIds,
  writeProject,
} from '../src/live.ts';
import {
  formatReport,
  formatStability,
  stability,
  summarise,
} from '../src/report.ts';
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
 * Every run so far, as `src/bakeoff.ts` describes them, kept in step with
 * what is on disk.
 *
 * Rewritten after each run rather than once at the end, so a run that is
 * stopped part way (the job's time limit, a provider that hangs) leaves a
 * record of the runs it did finish and paid for. The bakeoff's later jobs
 * read this rather than the log: which candidate passed which checks, and
 * what it cost, is what decides which of them get a repair turn and how the
 * final table adds up.
 */
class ResultsFile {
  readonly #path: string | undefined;
  readonly #results: EvalResults;

  constructor(outDir: string | undefined, provider: EvalResults['provider']) {
    this.#path = outDir ? join(outDir, EVAL_RESULTS_FILE) : undefined;
    this.#results = {
      schema: 1,
      promptSetVersion: PROMPT_SET_VERSION,
      provider,
      candidates: [],
    };
  }

  async add(
    record: Omit<CandidateRecord, 'dir' | 'revision' | 'files'>,
    written?: { dir: string; project: ProjectSnapshot },
  ): Promise<void> {
    this.#results.candidates.push({
      ...record,
      dir: written?.dir ?? null,
      ...(written
        ? {
            revision: written.project.revision,
            files: written.project.files.map((file) => file.path),
          }
        : {}),
    });
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.#path) return;
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(
      this.#path,
      `${JSON.stringify(this.#results, null, 2)}\n`,
      'utf8',
    );
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
  // A blank selection is the set; the gallery (D153) runs only when named.
  const cases =
    wanted.length > 0
      ? [...new Set(wanted)].flatMap((id) => findCase(id) ?? [])
      : CASES;

  if (wanted.length > 0 && cases.length !== new Set(wanted).size) {
    const known = [...CASES, ...GALLERY_CASES].map((c) => c.id).join(', ');
    console.error(`No such case. The set contains: ${known}`);
    return 1;
  }

  const problems = liveProblems(live, env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 1;
  }

  if (!live.enabled) {
    // Said rather than silently ignored. The stub returns the same plan every
    // time, so repeating a case against it would print N identical rows and
    // measure nothing, but someone who set the variable and saw one run each
    // would reasonably conclude the flag does not work.
    if (env.VIBLD_EVAL_RUNS && env.VIBLD_EVAL_RUNS.trim() !== '1') {
      console.log(
        'VIBLD_EVAL_RUNS is ignored without VIBLD_EVAL_LIVE: the stub is deterministic, so repeating a case against it measures nothing.',
      );
    }
    const results: CaseResult[] = [];
    const recorded = new ResultsFile(live.outDir, 'stub');
    await recorded.save();
    for (const testCase of cases) {
      const plan = stubPlan(testCase);
      const provider = new FakeModelProvider([plan]);
      const store = new InMemoryGenerationStore();
      const result = await runCase(testCase, provider, { store });
      results.push(result);
      const record = {
        model: 'stub',
        case: testCase.id,
        run: 1,
        outcome: result.outcome,
        problems: result.problems,
        costCents: null,
      };
      // Written out like a live candidate, so CI can build what the stub
      // says it accepted (bin/build-candidates.ts). Until internal PR 59 nothing did,
      // and the stub's project could not build.
      const project = await store.loadAccepted(testCase.id);
      if (live.outDir && result.outcome === 'accepted' && project) {
        const dir = posix.join('stub', testCase.id);
        const root = join(live.outDir, dir);
        await writeProject(root, project.files);
        console.log(`  wrote ${project.files.length} files to ${root}`);
        await recorded.add(record, { dir, project });
      } else {
        await recorded.add(record);
      }
    }
    console.log(formatReport(summarise(results, 'stub')));
    return (await runScenarios()) &&
      results.every((r) => r.outcome === 'accepted')
      ? 0
      : 1;
  }

  // Live. One report per model, so the comparison is readable side by side
  // rather than as one pooled score that hides which model earned what.
  //
  // Repeats are the inner loop, so each case is run its full number of times
  // before the next one starts. That keeps a case's runs adjacent in the
  // report, and it means an interrupted run has finished answering the
  // reliability question for the cases it got to rather than having one
  // sample of everything.
  let allAccepted = true;
  let totalCents = 0;
  const repeated = live.runs > 1;
  const recorded = new ResultsFile(live.outDir, 'live');
  await recorded.save();
  // First, so the report of a run with the file steps at another effort
  // (D70) says so before any of its figures, and the bakeoff's summary,
  // which is this output, carries it.
  console.log(describeEffort(live.writeEffort));
  for (const model of live.models) {
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      // Whether this case's directory has been dealt with yet. Tracked rather
      // than keyed on the first attempt, because a first run that produced
      // nothing writes nothing, and the clearing is owed to whichever run
      // writes first. A single run needs none of this: it writes to the case
      // directory itself, which `writeProject` already clears.
      let caseRootCleared = live.runs === 1;
      for (let attempt = 1; attempt <= live.runs; attempt += 1) {
        const projectId = repeated
          ? `${model}:${testCase.id}#${attempt}`
          : `${model}:${testCase.id}`;
        const run = createLiveRun(env, model, projectId, testCase.style);
        const result = await runCase(testCase, run.provider, {
          store: run.store,
          projectId,
        });
        results.push(result);
        if (result.outcome !== 'accepted') allAccepted = false;

        const cents = runCostCents(model, run.usage);
        if (cents !== null) totalCents += cents;
        const record = {
          model,
          case: testCase.id,
          run: attempt,
          outcome: result.outcome,
          problems: result.problems,
          costCents: cents,
        };

        const project = live.outDir ? await acceptedProject(run) : undefined;
        if (live.outDir && project) {
          // Each repeat gets its own directory. Without that the last run
          // would clear and replace the ones before it, so the variance the
          // repeats were paid for would exist only in the printed tally and
          // the directory would hold one arbitrary sample of it. A single
          // run keeps the original path, since there is nothing to separate.
          const caseDir = posix.join(model, testCase.id);
          const dir = repeated
            ? posix.join(caseDir, `run-${attempt}`)
            : caseDir;
          const caseRoot = join(live.outDir, caseDir);
          const root = join(live.outDir, dir);
          await writeProject(
            root,
            project.files,
            caseRootCleared ? undefined : caseRoot,
          );
          caseRootCleared = true;
          console.log(`  wrote ${project.files.length} files to ${root}`);
          await recorded.add(record, { dir, project });
        } else {
          await recorded.add(record);
        }
      }
    }
    console.log(formatReport(summarise(results, model)));
    const table = formatStability(stability(results));
    if (table) console.log(table);
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
