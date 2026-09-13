import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { InMemoryGenerationStore } from '@vibld/core';
import { PlanProvider, createPlanClient, findModel } from '@vibld/ai';
import type { ModelProvider, ProjectSnapshot } from '@vibld/core';

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
  /** Where to write each run's project, if anywhere. */
  outDir?: string | undefined;
}

export interface LiveEnv {
  VIBLD_EVAL_LIVE?: string | undefined;
  VIBLD_EVAL_MODELS?: string | undefined;
  VIBLD_EVAL_OUT?: string | undefined;
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
  return {
    enabled,
    models,
    ...(env.VIBLD_EVAL_OUT ? { outDir: env.VIBLD_EVAL_OUT } : {}),
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
  // Refused rather than quietly deduplicated. A repeated id pays for the whole
  // selected set twice, and with VIBLD_EVAL_OUT the second pass clears and
  // replaces the first at the same destination, so the spend buys output that
  // no longer exists. Repeated runs for variance are a real thing to want
  // (#9/#10 asks for three per prompt) and will need a flag that says so:
  // until then a duplicate is a mistake, and guessing which was meant is the
  // widening this file exists to avoid.
  const seen = new Set<string>();
  for (const id of options.models) {
    if (seen.has(id)) {
      problems.push(
        `VIBLD_EVAL_MODELS names ${id} more than once. Each model runs the set once.`,
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

export function createLiveRun(
  env: LiveEnv,
  model: string,
  projectId: string,
): LiveRun {
  const usage = { inputTokens: 0, outputTokens: 0 };
  const provider = new PlanProvider(createPlanClient(env, model), {
    model,
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
