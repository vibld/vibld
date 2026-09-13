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
