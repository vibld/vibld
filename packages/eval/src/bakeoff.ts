import type { CaseOutcome } from './harness.ts';

/**
 * What the bakeoff's jobs hand each other, and the verdict they add up to.
 *
 * The bakeoff is four jobs on purpose (`.github/workflows/bakeoff.yml`). The
 * two that hold model keys generate and repair, and only ever read what a
 * model wrote as text; the two that build hold nothing, because a
 * candidate's package.json and build config are code a model wrote and
 * building runs them. Nothing but files crosses between them, so these are
 * the files: what the eval accepted, what built, what the repair turn
 * produced, and what of that built.
 *
 * Every import here is a type, so the report job can run this with Node
 * alone. It has no dependencies installed, and needs none to read four
 * JSON files and add them up.
 *
 * A project is accepted only if it passes the eval's checks *and* installs
 * and builds (Chris, 2026-09-27). Before that "accepted" meant the checks
 * alone, and the bakeoff that prompted the change scored a model 2/3 when
 * one of the two did not build. So two figures are reported per model:
 * accepted as generated, which is the first attempt passing both; and
 * accepted after one repair, which adds the projects that passed the checks,
 * failed to build, and then passed both after a single repair turn, asked
 * exactly the way the product asks one (`src/repair.ts`).
 */

/** Written by `bin/eval.ts` into `VIBLD_EVAL_OUT`. */
export const EVAL_RESULTS_FILE = 'eval-results.json';
/** Written by `bin/repair-candidates.ts` into the directory it writes to. */
export const REPAIR_RESULTS_FILE = 'repair-results.json';

export interface CandidateRecord {
  /**
   * Where the project was written, relative to the output directory and
   * with forward slashes, which is also the name `bin/build-candidates.ts`
   * gives it. Null when nothing was written, because the run produced no
   * project that passed validation.
   */
  dir: string | null;
  model: string;
  case: string;
  /** Which repeat of the case this was, from 1. */
  run: number;
  outcome: CaseOutcome;
  problems: string[];
  /**
   * Measured from the usage the provider reported and priced from the
   * catalogue. Null when there is nothing to measure: the stub reports no
   * usage, and a model with no catalogue price cannot be priced.
   */
  costCents: number | null;
  /**
   * The written project's revision and its file paths in order. The repair
   * reads the files back from `dir` in this order and checks they add up to
   * this revision, so what it repairs is provably the project that was
   * generated and not something that changed on the way.
   */
  revision?: string;
  files?: string[];
}

export interface EvalResults {
  schema: 1;
  promptSetVersion: string;
  provider: 'stub' | 'live';
  candidates: CandidateRecord[];
}

/** The stages `bin/build-candidates.ts` reports, `done` meaning it built. */
export const BUILD_STAGES = [
  'container',
  'install',
  'build',
  'time',
  'tampered',
  'cleanup',
  'halted',
  'done',
] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

export interface BuildRecord {
  /** The project's directory relative to the one that was built. */
  name: string;
  ok: boolean;
  stage: BuildStage;
  /**
   * The end of what the failing command printed, where npm and bundlers put
   * the reason: as much of it as the product's build service passes to its
   * own repair (`apps/preview`, 2000 characters). Empty when it built.
   */
  detail: string;
  /** The failing command's exit code, when it exited rather than was stopped. */
  exitCode?: number | null;
  /** Whether the failing command was stopped at its time limit. */
  timedOut?: boolean;
}

export interface BuildResults {
  schema: 1;
  projects: BuildRecord[];
}

export interface RepairRecord extends CandidateRecord {
  /** The candidate this repaired, as its `dir` in the eval's results. */
  source: string;
}

export interface RepairResults {
  schema: 1;
  candidates: RepairRecord[];
}

const OUTCOMES: readonly CaseOutcome[] = [
  'accepted',
  'failed-validation',
  'failed-provider',
  'failed-expectations',
  'budget-exceeded',
];

function fail(what: string, why: string): never {
  throw new Error(`${what} is not readable: ${why}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function readCandidate(value: unknown, what: string): CandidateRecord {
  if (!isObject(value)) fail(what, 'a candidate is not an object');
  const { dir, model, run, outcome, problems, costCents, revision, files } =
    value;
  const id = value.case;
  if (dir !== null && typeof dir !== 'string') fail(what, 'bad dir');
  if (typeof model !== 'string') fail(what, 'bad model');
  if (typeof id !== 'string') fail(what, 'bad case');
  if (typeof run !== 'number' || !Number.isInteger(run) || run < 1) {
    fail(what, 'bad run');
  }
  if (!OUTCOMES.includes(outcome as CaseOutcome)) fail(what, 'bad outcome');
  if (!isStrings(problems)) fail(what, 'bad problems');
  if (costCents !== null && typeof costCents !== 'number') {
    fail(what, 'bad costCents');
  }
  if (revision !== undefined && typeof revision !== 'string') {
    fail(what, 'bad revision');
  }
  if (files !== undefined && !isStrings(files)) fail(what, 'bad files');
  return {
    dir,
    model,
    case: id,
    run,
    outcome: outcome as CaseOutcome,
    problems,
    costCents,
    ...(revision !== undefined ? { revision } : {}),
    ...(files !== undefined ? { files } : {}),
  };
}

/**
 * Each reader checks the shape rather than trusting it. The build results
 * in particular come from a job that ran code a model wrote, and the repair
 * job that reads them holds the model keys: what it takes from them is data
 * of a known shape, and anything else is refused.
 */
export function parseEvalResults(text: string): EvalResults {
  const what = EVAL_RESULTS_FILE;
  const value: unknown = JSON.parse(text);
  if (!isObject(value) || value.schema !== 1) fail(what, 'unknown schema');
  if (typeof value.promptSetVersion !== 'string') {
    fail(what, 'bad promptSetVersion');
  }
  if (value.provider !== 'stub' && value.provider !== 'live') {
    fail(what, 'bad provider');
  }
  if (!Array.isArray(value.candidates)) fail(what, 'no candidates');
  return {
    schema: 1,
    promptSetVersion: value.promptSetVersion,
    provider: value.provider,
    candidates: value.candidates.map((entry) => readCandidate(entry, what)),
  };
}

export function parseBuildResults(text: string): BuildResults {
  const what = 'the build results';
  const value: unknown = JSON.parse(text);
  if (!isObject(value) || value.schema !== 1) fail(what, 'unknown schema');
  if (!Array.isArray(value.projects)) fail(what, 'no projects');
  return {
    schema: 1,
    projects: value.projects.map((entry) => {
      if (!isObject(entry)) fail(what, 'a project is not an object');
      const { name, ok, stage, detail, exitCode, timedOut } = entry;
      if (typeof name !== 'string') fail(what, 'bad name');
      if (typeof ok !== 'boolean') fail(what, 'bad ok');
      if (!BUILD_STAGES.includes(stage as BuildStage)) fail(what, 'bad stage');
      if (typeof detail !== 'string') fail(what, 'bad detail');
      if (
        exitCode !== undefined &&
        exitCode !== null &&
        (typeof exitCode !== 'number' || !Number.isInteger(exitCode))
      ) {
        fail(what, 'bad exitCode');
      }
      if (timedOut !== undefined && typeof timedOut !== 'boolean') {
        fail(what, 'bad timedOut');
      }
      return {
        name,
        ok,
        stage: stage as BuildStage,
        detail,
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(timedOut !== undefined ? { timedOut } : {}),
      };
    }),
  };
}

export function parseRepairResults(text: string): RepairResults {
  const what = REPAIR_RESULTS_FILE;
  const value: unknown = JSON.parse(text);
  if (!isObject(value) || value.schema !== 1) fail(what, 'unknown schema');
  if (!Array.isArray(value.candidates)) fail(what, 'no candidates');
  return {
    schema: 1,
    candidates: value.candidates.map((entry) => {
      const record = readCandidate(entry, what);
      const source = (entry as Record<string, unknown>).source;
      if (typeof source !== 'string') fail(what, 'bad source');
      return { ...record, source };
    }),
  };
}

/**
 * The error a repair turn is sent, worded the way the product's build
 * service words it (`apps/preview/worker/preview-sandbox.ts`): the command,
 * its exit code, and the end of what it printed.
 */
export function buildErrorFor(record: BuildRecord): string {
  const command = record.stage === 'install' ? 'npm install' : 'npm run build';
  const code =
    typeof record.exitCode === 'number' ? String(record.exitCode) : 'unknown';
  return `${command} failed (exit ${code}): ${record.detail}`;
}

/**
 * Whether a failed build says something about the project, which is what
 * the product asks before it buys a repair (`ABOUT_THE_PROJECT` in
 * `apps/web/worker/generation-run.ts`): an install or a build that ran and
 * failed. A command stopped at its time limit is the product's `sandbox`
 * reason and buys nothing there, so it buys nothing here. Neither does a
 * candidate that was never started, or whose container misbehaved: none of
 * that is the model's to fix.
 */
export function repairable(record: BuildRecord): boolean {
  return (
    !record.ok &&
    (record.stage === 'install' || record.stage === 'build') &&
    record.timedOut !== true
  );
}

export interface RepairJob {
  candidate: CandidateRecord & { dir: string };
  build: BuildRecord;
  /** What the repair turn is told, from `buildErrorFor`. */
  error: string;
}

/**
 * Which candidates get their one repair turn: those that passed every check
 * the eval applies and then failed to install or build.
 *
 * A candidate that failed the checks is not repaired. It is rejected
 * whether or not it builds, and a repair is sent the build error, which is
 * not what is wrong with it.
 */
export function selectForRepair(
  evaluated: EvalResults,
  built: BuildResults,
): RepairJob[] {
  const byName = new Map(built.projects.map((record) => [record.name, record]));
  const jobs: RepairJob[] = [];
  for (const candidate of evaluated.candidates) {
    if (candidate.outcome !== 'accepted' || candidate.dir === null) continue;
    const build = byName.get(candidate.dir);
    if (!build || !repairable(build)) continue;
    jobs.push({
      candidate: { ...candidate, dir: candidate.dir },
      build,
      error: buildErrorFor(build),
    });
  }
  return jobs;
}

/** How one run ended. */
export type Verdict =
  | { accepted: 'as-generated' }
  | { accepted: 'after-repair' }
  | { accepted: false; reason: string };

/** Why a build that did not succeed did not, in a few words. */
function buildFailure(record: BuildRecord | undefined): string {
  if (!record) return 'no build result';
  if (record.stage === 'time' || record.timedOut) return 'out of time';
  if (record.stage === 'install') return 'install failed';
  if (record.stage === 'build') return 'build failed';
  // A container that did not start or could not be removed, a snapshot that
  // changed before its turn, or a candidate not started because of either.
  return 'build infrastructure';
}

const CHECK_FAILURE: Record<CaseOutcome, string> = {
  accepted: 'accepted',
  'failed-validation': 'checks (validation)',
  'failed-expectations': 'checks (ignored the request)',
  'failed-provider': 'provider error',
  'budget-exceeded': 'budget exceeded',
};

/**
 * The verdict on one run, from what each job recorded about it.
 *
 * Missing evidence is never read as success. A candidate with no build
 * result was not shown to build, and a repair nobody built was not shown to
 * work, so both are rejections with the reason saying which evidence is
 * missing.
 */
export function verdictFor(
  candidate: CandidateRecord,
  builds: ReadonlyMap<string, BuildRecord>,
  repairs: ReadonlyMap<string, RepairRecord>,
  rebuilds: ReadonlyMap<string, BuildRecord>,
): Verdict {
  if (candidate.outcome !== 'accepted') {
    return { accepted: false, reason: CHECK_FAILURE[candidate.outcome] };
  }
  if (candidate.dir === null) {
    return { accepted: false, reason: 'no project written' };
  }
  const build = builds.get(candidate.dir);
  if (build?.ok) return { accepted: 'as-generated' };
  const first = buildFailure(build);
  if (!build || !repairable(build)) return { accepted: false, reason: first };

  const repair = repairs.get(candidate.dir);
  if (!repair) return { accepted: false, reason: `${first}; repair not run` };
  if (repair.outcome === 'failed-provider') {
    return { accepted: false, reason: `${first}; repair provider error` };
  }
  if (repair.outcome !== 'accepted') {
    return { accepted: false, reason: `${first}; repair failed checks` };
  }
  if (repair.dir === null) {
    return { accepted: false, reason: `${first}; repair not written` };
  }
  const rebuild = rebuilds.get(repair.dir);
  if (rebuild?.ok) return { accepted: 'after-repair' };
  return {
    accepted: false,
    reason: `${first}; repaired project: ${buildFailure(rebuild)}`,
  };
}

export interface ModelRow {
  model: string;
  runs: number;
  /** Passed the checks and built, first time. */
  asGenerated: number;
  /** The above, plus those accepted after one repair turn. */
  afterRepair: number;
  /** Every run not accepted after repair, counted by reason. */
  rejected: Record<string, number>;
  generationCents: number;
  repairCents: number;
  /** Whether any run or repair could not be priced, so the sums are low. */
  unpriced: boolean;
}

export interface RunRow {
  model: string;
  case: string;
  run: number;
  verdict: Verdict;
  problems: string[];
}

export interface BakeoffReport {
  promptSetVersion: string;
  provider: 'stub' | 'live';
  models: ModelRow[];
  runs: RunRow[];
  /** Accepted after one repair, every run. What the workflow gates on. */
  allAccepted: boolean;
}

/**
 * Join the four result files into one row per model, in the order the
 * models first appear. Any of the last three may be missing (a job that did
 * not run, or wrote nothing), and every run it would have spoken for is
 * then rejected for want of the evidence.
 */
export function joinBakeoff(
  evaluated: EvalResults,
  built?: BuildResults,
  repaired?: RepairResults,
  rebuilt?: BuildResults,
): BakeoffReport {
  const builds = new Map(
    (built?.projects ?? []).map((record) => [record.name, record]),
  );
  const repairs = new Map(
    (repaired?.candidates ?? []).map((record) => [record.source, record]),
  );
  const rebuilds = new Map(
    (rebuilt?.projects ?? []).map((record) => [record.name, record]),
  );

  const rows = new Map<string, ModelRow>();
  const runs: RunRow[] = [];
  for (const candidate of evaluated.candidates) {
    let row = rows.get(candidate.model);
    if (!row) {
      row = {
        model: candidate.model,
        runs: 0,
        asGenerated: 0,
        afterRepair: 0,
        rejected: {},
        generationCents: 0,
        repairCents: 0,
        unpriced: false,
      };
      rows.set(candidate.model, row);
    }
    row.runs += 1;
    // Every run is paid for, accepted or not, and so is every repair.
    if (candidate.costCents === null) row.unpriced = true;
    else row.generationCents += candidate.costCents;
    const repair =
      candidate.dir === null ? undefined : repairs.get(candidate.dir);
    if (repair) {
      if (repair.costCents === null) row.unpriced = true;
      else row.repairCents += repair.costCents;
    }

    const verdict = verdictFor(candidate, builds, repairs, rebuilds);
    if (verdict.accepted === 'as-generated') {
      row.asGenerated += 1;
      row.afterRepair += 1;
    } else if (verdict.accepted === 'after-repair') {
      row.afterRepair += 1;
    } else {
      row.rejected[verdict.reason] = (row.rejected[verdict.reason] ?? 0) + 1;
    }
    runs.push({
      model: candidate.model,
      case: candidate.case,
      run: candidate.run,
      verdict,
      problems: [...candidate.problems, ...(repair?.problems ?? [])],
    });
  }

  const models = [...rows.values()];
  return {
    promptSetVersion: evaluated.promptSetVersion,
    provider: evaluated.provider,
    models,
    runs,
    allAccepted: models.every((row) => row.afterRepair === row.runs),
  };
}

function cents(value: number, unpriced: boolean, provider: string): string {
  if (provider === 'stub') return 'n/a';
  return `${value.toFixed(3)}c${unpriced ? ' (incomplete)' : ''}`;
}

function verdictLabel(verdict: Verdict): string {
  if (verdict.accepted === 'as-generated') return 'accepted as generated';
  if (verdict.accepted === 'after-repair') return 'accepted after one repair';
  return `rejected: ${verdict.reason}`;
}

/**
 * The report as Markdown, for the job summary and the log alike.
 *
 * Nothing a model wrote is in it. Model ids and case ids are the caller's
 * own, and every reason is one of the phrases above; the problems each run
 * had, which quote file paths a model chose, are printed separately by the
 * caller where they cannot be mistaken for the report's own words.
 */
export function formatBakeoff(report: BakeoffReport): string {
  const lines = [
    '## Bakeoff',
    '',
    `Prompt set ${report.promptSetVersion}. Accepted means the project passed the eval's checks and \`npm install\` and \`npm run build\` succeeded. "After one repair" includes the runs accepted as generated.`,
    '',
    '| Model | Runs | Accepted as generated | Accepted after one repair | Rejected | Generation | Repair | Total |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of report.models) {
    const rejected = row.runs - row.afterRepair;
    lines.push(
      `| \`${row.model}\` | ${row.runs} | ${row.asGenerated}/${row.runs} | ${row.afterRepair}/${row.runs} | ${rejected} | ${cents(row.generationCents, row.unpriced, report.provider)} | ${cents(row.repairCents, row.unpriced, report.provider)} | ${cents(row.generationCents + row.repairCents, row.unpriced, report.provider)} |`,
    );
  }
  if (report.provider === 'stub') {
    lines.push(
      '',
      'This run used the deterministic stub, not a model. It measures the machinery, not generation quality.',
    );
  }

  const withRejections = report.models.filter(
    (row) => Object.keys(row.rejected).length > 0,
  );
  if (withRejections.length > 0) {
    lines.push('', '### Rejected, by reason', '');
    for (const row of withRejections) {
      const reasons = Object.entries(row.rejected)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reason, count]) => `${count} ${reason}`)
        .join(', ');
      lines.push(`- \`${row.model}\`: ${reasons}`);
    }
  }

  lines.push('', '### Every run', '', '| Model | Case | Run | Result |');
  lines.push('| --- | --- | ---: | --- |');
  for (const run of report.runs) {
    lines.push(
      `| \`${run.model}\` | \`${run.case}\` | ${run.run} | ${verdictLabel(run.verdict)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Text a model had a hand in, made safe to print in a GitHub Actions log.
 *
 * The runner reads a line beginning `::` as a workflow command, and the jobs
 * that print these (the repair job among them) hold model keys. No command
 * reachable that way discloses a secret, but none of them is anything a
 * model's text should be able to issue either, and breaking the `::` costs
 * the reader nothing.
 */
export function forLog(text: string): string {
  return text.replace(/:(?=:)/g, ': ');
}
