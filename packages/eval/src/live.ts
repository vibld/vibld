import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { InMemoryGenerationStore } from '@vibld/core';
import {
  BoundedPlanProvider,
  DEFAULT_EFFORT,
  createPlanClient,
  findModel,
} from '@vibld/ai';
import type { PlanEffort } from '@vibld/ai';
import type { ModelProvider, ProjectSnapshot } from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';

/**
 * Running the set against a real model instead of the stub.
 *
 * The stub proves the machinery. It cannot say whether a model writes a good
 * website, and `bin/eval.ts` printed that caveat while offering no way to
 * find out. This is the way to find out.
 *
 * Two properties are deliberate. Spending money is opt-in and explicit, never
 * a consequence of a key happening to be in the environment, because the same
 * command runs in CI. And a live run writes what it produced to disk: the
 * point of measuring generation is to look at what came out, and a score with
 * nothing to inspect behind it is the thing this package already warns about.
 */

export interface LiveOptions {
  /** Set by the caller from `VIBLD_EVAL_LIVE`. Nothing spends without it. */
  enabled: boolean;
  /** Model ids to run. Each one runs the selected cases independently. */
  models: string[];
  /**
   * How many times each model runs each case. One unless asked otherwise.
   *
   * A single generation says whether a model can do a thing once. It cannot
   * say whether it does it reliably, and the gate proposed in internal issue 10 is stated
   * in exactly those terms (10 prompts, 3 runs each). This is the multiplier
   * that makes that measurable, and it multiplies the bill by the same
   * number, which is why `liveRuns` refuses anything it cannot read as a
   * deliberate count.
   */
  runs: number;
  /** Where to write each run's project, if anywhere. */
  outDir?: string | undefined;
  /**
   * The effort the file-writing steps are asked at, from
   * `VIBLD_WRITE_EFFORT` (D70). Absent means every step at the default.
   */
  writeEffort?: PlanEffort;
}

export interface LiveEnv {
  VIBLD_EVAL_LIVE?: string | undefined;
  VIBLD_EVAL_MODELS?: string | undefined;
  VIBLD_EVAL_RUNS?: string | undefined;
  VIBLD_EVAL_OUT?: string | undefined;
  VIBLD_WRITE_EFFORT?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  DEEPSEEK_API_KEY?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  VIBLD_PROVIDER?: string | undefined;
  VIBLD_MODEL?: string | undefined;
}

/** Truthy only for values a person clearly meant as yes. */
function optedIn(value: string | undefined): boolean {
  const flag = value?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * The most runs per case this will do without the number being changed here.
 *
 * Not a judgement that eleven runs is never worth it. It is that the question
 * repeated runs answer is settled at three, the difference between three and
 * ten is small, and the difference between ten and a mistyped three hundred
 * is the whole budget. A ceiling that has to be raised on purpose costs an
 * edit to this line; the absence of one costs whatever the typo was.
 */
export const MAX_RUNS = 10;

/**
 * How many runs per case, or null if the value is not a count.
 *
 * Strict by the same reasoning as everywhere else in this file: this number
 * multiplies what a live run costs, so "3 " is fine, "3.0", "3x", "-1" and
 * "1e2" are not. `Number()` would read the last of those as a hundred.
 */
export function liveRuns(value: string | undefined): number | null {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return 1;
  if (!/^\d+$/.test(raw)) return null;
  const runs = Number(raw);
  if (runs < 1 || runs > MAX_RUNS) return null;
  return runs;
}

/** Every effort `VIBLD_WRITE_EFFORT` may name, in the order they rise. */
export const WRITE_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly PlanEffort[];

/**
 * The effort the file-writing steps are asked at (D70): undefined when
 * `VIBLD_WRITE_EFFORT` is unset or blank, which leaves every step at the
 * default, and null when it names something that is not an effort.
 *
 * Strict for the same reason `liveRuns` is. This is one arm of the D70
 * comparison, decided on a margin of two points, so a mistyped
 * value must stop the run rather than quietly measure the default and be
 * reported as the other arm. Surrounding space is forgiven; case is not,
 * since every effort is spelled in lower case wherever it is used.
 */
export function liveWriteEffort(
  value: string | undefined,
): PlanEffort | undefined | null {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return undefined;
  return (WRITE_EFFORTS as readonly string[]).includes(raw)
    ? (raw as PlanEffort)
    : null;
}

/** Why a `VIBLD_WRITE_EFFORT` that `liveWriteEffort` refused was refused. */
function writeEffortProblem(value: string | undefined): string {
  return `VIBLD_WRITE_EFFORT must be one of ${WRITE_EFFORTS.join(', ')}, or unset, not "${value}".`;
}

/**
 * The line a live run prints about effort, so two runs that differ only in
 * `VIBLD_WRITE_EFFORT` can be told apart from their reports alone.
 */
export function describeEffort(writeEffort: PlanEffort | undefined): string {
  return writeEffort === undefined
    ? `Effort: every step at the default, ${DEFAULT_EFFORT}.`
    : `Effort: the outline at the default, ${DEFAULT_EFFORT}; the file-writing steps at ${writeEffort} (VIBLD_WRITE_EFFORT).`;
}

/**
 * What a live run would do, read from the environment.
 *
 * Returns `enabled: false` rather than throwing when the opt-in is absent, so
 * the default path stays the stub and CI is unaffected by a key being present.
 */
export function readLiveOptions(env: LiveEnv): LiveOptions {
  const enabled = optedIn(env.VIBLD_EVAL_LIVE);
  const models = (env.VIBLD_EVAL_MODELS ?? env.VIBLD_MODEL ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  // An unreadable value is left out here and refused by `liveProblems`, as
  // an unreadable run count is.
  const writeEffort = liveWriteEffort(env.VIBLD_WRITE_EFFORT);
  return {
    enabled,
    models,
    // Falls back to one so the shape is always valid; `liveProblems` is what
    // refuses the run, so an unreadable value is reported rather than
    // silently treated as a single run someone did not ask for.
    runs: liveRuns(env.VIBLD_EVAL_RUNS) ?? 1,
    ...(env.VIBLD_EVAL_OUT ? { outDir: env.VIBLD_EVAL_OUT } : {}),
    ...(writeEffort ? { writeEffort } : {}),
  };
}

/**
 * Refuse a live run that would not measure what it claims to.
 *
 * Every one of these is cheaper to catch here than after a model has been
 * paid: an unknown id is a 400 at the provider, and a model whose provider
 * has no key configured fails the same way but only once the run is underway.
 */
export function liveProblems(options: LiveOptions, env: LiveEnv): string[] {
  if (!options.enabled) return [];
  const problems: string[] = [];
  if (options.models.length === 0) {
    problems.push(
      'VIBLD_EVAL_LIVE is set but VIBLD_EVAL_MODELS names no model.',
    );
  }
  if (liveRuns(env.VIBLD_EVAL_RUNS) === null) {
    problems.push(
      `VIBLD_EVAL_RUNS must be a whole number from 1 to ${MAX_RUNS}, not "${env.VIBLD_EVAL_RUNS}".`,
    );
  }
  if (liveWriteEffort(env.VIBLD_WRITE_EFFORT) === null) {
    problems.push(writeEffortProblem(env.VIBLD_WRITE_EFFORT));
  }
  // Refused rather than quietly deduplicated. A repeated id pays for the whole
  // selected set twice, and with VIBLD_EVAL_OUT the second pass clears and
  // replaces the first at the same destination, so the spend buys output that
  // no longer exists. Repeated runs for variance are what VIBLD_EVAL_RUNS is
  // for, and it keeps each run's output; a repeated id is a mistake, and
  // guessing which was meant is the widening this file exists to avoid.
  const seen = new Set<string>();
  for (const id of options.models) {
    if (seen.has(id)) {
      problems.push(
        `VIBLD_EVAL_MODELS names ${id} more than once. Use VIBLD_EVAL_RUNS to run a model repeatedly.`,
      );
      break;
    }
    seen.add(id);
  }
  for (const id of options.models) {
    const model = findModel(id);
    if (!model) {
      problems.push(`"${id}" is not a model in the catalogue.`);
      continue;
    }
    // Named by the variable rather than by the provider, so the message says
    // what to set rather than leaving that to be looked up.
    const variable = {
      anthropic: 'ANTHROPIC_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY',
    }[model.provider];
    if (!env[variable as keyof LiveEnv]) {
      problems.push(`${id} needs ${variable}, and it is not set.`);
    }
  }
  return problems;
}

/** A provider bound to one model, plus the store its output can be read from. */
export interface LiveRun {
  provider: ModelProvider;
  store: InMemoryGenerationStore;
  projectId: string;
  /** Real usage, reported by the provider rather than estimated. */
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * A live run is built the way the product builds: in bounded steps
 * (`@vibld/ai`'s `bounded-build.ts`), an outline and then a few files per
 * call, with a follow-up or a repair as a patch. A bakeoff measured through
 * a single response would be measuring a path the product no longer takes.
 * `onUsage` is told once per generation, with every call summed.
 *
 * `VIBLD_WRITE_EFFORT`, when set, is the effort of the file-writing steps
 * (`writeEffort`, D70); the outline stays at the default. A repair turn is
 * made here too, so it is held to the same effort. A value that is not an
 * effort throws rather than falling back to the default, because a run
 * reported as one arm of the comparison must not measure the other.
 */
export function createLiveRun(
  env: LiveEnv,
  model: string,
  projectId: string,
  style?: StylePresetId,
  /**
   * For a repair turn: keep the project's spec rather than ask for one, as
   * the product's repair does (`keepSpec`), so the bakeoff measures the
   * repair the product makes.
   */
  options: { keepSpec?: boolean } = {},
): LiveRun {
  const writeEffort = liveWriteEffort(env.VIBLD_WRITE_EFFORT);
  if (writeEffort === null) {
    throw new Error(writeEffortProblem(env.VIBLD_WRITE_EFFORT));
  }
  const usage = { inputTokens: 0, outputTokens: 0 };
  const provider = new BoundedPlanProvider(createPlanClient(env, model), {
    model,
    ...(style ? { style } : {}),
    ...(options.keepSpec ? { keepSpec: true } : {}),
    ...(writeEffort ? { writeEffort } : {}),
    onUsage: (reported) => {
      usage.inputTokens += reported.inputTokens;
      usage.outputTokens += reported.outputTokens;
    },
  });
  return {
    provider,
    store: new InMemoryGenerationStore(),
    projectId,
    usage,
  };
}

/**
 * What a run actually cost, from the prices in the catalogue.
 *
 * Reported in cents rather than dollars because the cheapest model in the
 * catalogue can finish a case for well under a cent, and a dollar figure
 * rounded to two places would print every such run as $0.00.
 */
export function runCostCents(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const choice = findModel(model);
  if (!choice) return null;
  const perToken = (microUsdPerMillion: number, tokens: number) =>
    (microUsdPerMillion * tokens) / 1_000_000;
  return (
    (perToken(choice.inputMicroUsd, usage.inputTokens) +
      perToken(choice.outputMicroUsd, usage.outputTokens)) *
    100
  );
}

export async function acceptedProject(
  run: LiveRun,
): Promise<ProjectSnapshot | undefined> {
  return run.store.loadAccepted(run.projectId);
}

export type CaseSelection =
  { ok: true; ids: string[] } | { ok: false; error: string };

/**
 * Which cases `--case` asked for.
 *
 * Anything this does not understand is an error. That is the whole design,
 * and the first attempt at it was not enough: rejecting only a missing value
 * still let `--case=vibld-marketing`, `--cases x`, or a plain typo fall
 * through to "no selection", and no selection means the full set. Against the
 * stub that is merely wrong. Live it is every case against every configured
 * model, billed, for what was meant to be one generation.
 *
 * So the rule is not "reject the mistakes we thought of". It is that a flag
 * deciding how much work gets paid for refuses every token it cannot account
 * for, and widening is never a fallback. `--case=<id>` is accepted because it
 * is a normal spelling of the same intent, not because the parser tolerates
 * unknowns.
 */
export function selectCaseIds(argv: string[]): CaseSelection {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (token.startsWith('--case=')) {
      const value = token.slice('--case='.length).trim();
      if (value === '') return { ok: false, error: '--case needs a case id.' };
      ids.push(value);
      continue;
    }

    if (token === '--case') {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === '' || value.startsWith('-')) {
        return { ok: false, error: '--case needs a case id.' };
      }
      ids.push(value);
      i += 1;
      continue;
    }

    // Still refused, but named: pnpm forwards a literal "--" to the script
    // rather than eating it, so the documented `run eval -- --case x` arrived
    // here as an extra argument. This package's own README taught that
    // spelling, so the message says what to do rather than leaving someone to
    // work out which of their arguments was the unrecognised one.
    if (token === '--') {
      return {
        ok: false,
        error:
          'Remove the "--": pnpm passes it through to the script, so write `pnpm --filter @vibld/eval run eval --case <id>`.',
      };
    }
    return {
      ok: false,
      error: `Unrecognised argument "${token}". Only --case <id> is understood.`,
    };
  }
  return { ok: true, ids };
}

/**
 * Where a generated file may be written, or null if it may not be.
 *
 * Compared with `relative` rather than by string prefix. A prefix check has to
 * name a separator, and naming "/" rejects every path on a platform that
 * resolves to backslashes -- a check that reads as strict while actually
 * being broken, and broken only after the models have been paid.
 */
export function containedPath(root: string, filePath: string): string | null {
  const base = resolve(root);
  const target = resolve(base, filePath);
  const rel = relative(base, target);
  if (rel === '' || isAbsolute(rel)) return null;
  // Split rather than `startsWith("..")`, so a file honestly named "..rc" is
  // kept while a real "../" escape is refused.
  if (rel.split(sep)[0] === '..') return null;
  return target;
}

export interface PlannedWrite {
  path: string;
  target: string;
}

export type WritePlan =
  { ok: true; writes: PlannedWrite[] } | { ok: false; error: string };

/**
 * Every destination a snapshot would write to, refused as a whole if any of
 * them is unsafe or if two of them are the same file.
 *
 * Two paths that differ only in case are distinct to the validator upstream,
 * which compares exactly, and the same file on a case-insensitive volume,
 * which is what macOS and Windows give you by default. Writing both would let
 * the second silently replace the first while the run still reports the full
 * file count, so the directory on disk would not be the project being
 * reported. Since the point of writing candidates out is to compare what the
 * models actually produced, a directory that quietly disagrees with the
 * report is worse than a refusal.
 *
 * Planned before anything is written, and before the directory is cleared,
 * so a snapshot that cannot be written truthfully destroys nothing.
 */
export function planWrites(
  root: string,
  files: readonly { path: string; content: string }[],
): WritePlan {
  const writes: PlannedWrite[] = [];
  const claimed = new Map<string, string>();
  for (const file of files) {
    const target = containedPath(root, file.path);
    if (target === null) {
      return {
        ok: false,
        error: `refusing to write outside ${root}: ${file.path}`,
      };
    }
    // Lower-cased only to detect the collision, never to write by.
    const key = target.toLowerCase();
    const claimant = claimed.get(key);
    if (claimant !== undefined) {
      return {
        ok: false,
        error: `"${file.path}" and "${claimant}" are the same file on a case-insensitive volume.`,
      };
    }
    claimed.set(key, file.path);
    writes.push({ path: file.path, target });
  }

  // One destination being a directory on the way to another is the same kind
  // of unwritable snapshot, and it is not caught above because "src" and
  // "src/App.tsx" are genuinely different keys. Left to the write loop it
  // fails with ENOTDIR or EISDIR partway through, which is precisely what
  // planning ahead is meant to prevent: by then the previous candidate has
  // already been cleared.
  //
  // Walked ancestor by ancestor rather than by comparing sorted neighbours.
  // Sorting does not put an ancestor next to its descendant: "src.txt" sorts
  // between "src" and "src/App.tsx", because "." precedes "/", so a
  // neighbour check silently misses the very conflict it is looking for.
  const base = resolve(root).toLowerCase();
  for (const key of claimed.keys()) {
    let parent = dirname(key);
    while (parent.length > base.length && parent.startsWith(base)) {
      const ancestor = claimed.get(parent);
      if (ancestor !== undefined) {
        return {
          ok: false,
          error: `"${ancestor}" is a file and a parent directory of "${claimed.get(key)!}".`,
        };
      }
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }

  return { ok: true, writes };
}

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
 *
 * `alsoClear` is for the first write of a repeated set, which has a second
 * directory to answer for. Repeats write into `run-N` below the case
 * directory, and clearing only the leaf leaves whatever the case directory
 * held before: a previous single-run invocation's project files sitting beside
 * the run directories, or `run-4` and `run-5` from a larger count. Either way
 * the candidate tree stops matching the stability report that describes it,
 * which is the same defect clearing the leaf exists to prevent, one level up.
 *
 * It is cleared here rather than before the loop so it is still governed by
 * the plan: a first run that cannot be written truthfully must destroy
 * nothing, including the previous candidate it would have replaced.
 */
export async function writeProject(
  root: string,
  files: { path: string; content: string }[],
  alsoClear?: string,
): Promise<void> {
  const plan = planWrites(root, files);
  if (!plan.ok) throw new Error(plan.error);

  if (alsoClear) await rm(alsoClear, { recursive: true, force: true });
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
