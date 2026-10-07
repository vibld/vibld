/**
 * What a build is expected to cost, said before it is asked for.
 *
 * Chris asked for an expected spend beside the build that "should be
 * inflated a bit to ensure we never underestimate" (2026-10-05). The
 * reservation already answers the other question, the most a build may
 * cost, and that figure is several times what a build usually spends:
 * shown alone it would put people off a build that costs cents. So the estimate is read from what
 * builds on the same model have actually cost:
 *
 *   - the 90th percentile of the recent builds on that model, so nine in
 *     ten builds cost no more than the figure before any margin;
 *   - a quarter on top, the inflation Chris asked for;
 *   - never more than the most any build can be charged, its own
 *     reservation plus the one its repair turn may hold, because a figure
 *     above what the ledger can take is not an estimate of anything.
 *
 * A build is its row and, where the check failed, its repair's
 * (`runId:repair`), which holds a reservation of its own and is billed on
 * top. Summed per build, because the person pays for both.
 *
 * With too few builds on a model to read a percentile from, the figure is
 * the most a build can cost and says so, rather than a guess from three.
 *
 * A project's first build also draws a draft while it runs, paid from the
 * same credit and not traced with the build. Its worst case is sent beside
 * the estimate (`draftMicroUsd`), and the builder adds it to a first build:
 * a worst case rather than history, because no draft is traced to read.
 *
 * Metadata only (D20): costs and model ids, across everyone's builds,
 * never whose they were or what they built.
 */

import {
  BOUNDED_BUILD_INPUT_CHARS,
  MOCKUP_INPUT_CHARS,
  runCeilingFor,
} from './run-ceiling.ts';
import type { RunCeilingEnv } from './run-ceiling.ts';
import { MAX_BASE_CONTENT_CHARS, outputTokensToCarry } from '@vibld/ai/limits';
import { worstCaseMicroUsd } from './spend.ts';
import type { TokenPrices } from './spend.ts';

/** The share of recent builds the estimate covers before its margin. */
export const BUILD_ESTIMATE_PERCENTILE = 0.9;

/** What the estimate adds on top, so it errs high (Chris, 2026-10-05). */
export const BUILD_ESTIMATE_MARGIN = 1.25;

/** How many of a model's builds the percentile is read from, newest first. */
export const BUILD_ESTIMATE_SAMPLE = 200;

/** Fewer builds than this on a model, and the estimate is the ceiling. */
export const BUILD_ESTIMATE_MIN_SAMPLES = 10;

/** How far back a build still describes what one costs now. */
export const BUILD_ESTIMATE_WINDOW_DAYS = 30;

export interface BuildEstimate {
  /** Micro-USD. */
  microUsd: number;
  /**
   * `history`: read from recent builds on the model. `ceiling`: too few of
   * them, so the most a build can cost.
   */
  basis: 'history' | 'ceiling';
  /**
   * The most the draft a first build draws can cost, in micro-USD: added
   * to `microUsd` for a project not yet built, and to nothing else.
   */
  draftMicroUsd: number;
}

/** The most one draft on `model` can be charged: its reservation. */
export function draftCeilingMicroUsd(
  env: RunCeilingEnv,
  model: string,
): number {
  const ceiling = runCeilingFor(env, model, 'mockups');
  return worstCaseMicroUsd(
    ceiling.prices,
    ceiling.maxTokens,
    MOCKUP_INPUT_CHARS,
  );
}

/**
 * The most any build on `model` can be charged: its reservation, and the
 * same again for the repair turn that may follow it.
 *
 * Sized for the largest follow-up there can be, a project at the size
 * limit carried back out (`carryTokensFor`), rather than for a first build:
 * a follow-up reserves more than a first build does, so a first build's
 * ceiling would say "Up to" for less than a follow-up can cost, and cap the
 * percentile below costs builds really had (Codex review of internal PR 383).
 */
export function buildCeilingMicroUsd(
  env: RunCeilingEnv,
  model: string,
): number {
  const ceiling = runCeilingFor(
    env,
    model,
    'build',
    outputTokensToCarry(MAX_BASE_CONTENT_CHARS),
  );
  return (
    2 *
    worstCaseMicroUsd(
      ceiling.prices,
      ceiling.maxTokens,
      BOUNDED_BUILD_INPUT_CHARS,
    )
  );
}

/**
 * The nearest-rank percentile: the smallest cost at least `share` of the
 * builds did not exceed. Nearest-rank rather than interpolated, so the
 * figure is always one a build really cost.
 */
export function percentile(costs: readonly number[], share: number): number {
  const sorted = [...costs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(share * sorted.length));
  return sorted[rank - 1]!;
}

/** The estimate from a model's recent build costs and its ceiling. */
export function estimateFrom(
  costs: readonly number[],
  ceilingMicroUsd: number,
): Omit<BuildEstimate, 'draftMicroUsd'> {
  if (costs.length < BUILD_ESTIMATE_MIN_SAMPLES) {
    return { microUsd: ceilingMicroUsd, basis: 'ceiling' };
  }
  const inflated = Math.ceil(
    percentile(costs, BUILD_ESTIMATE_PERCENTILE) * BUILD_ESTIMATE_MARGIN,
  );
  return { microUsd: Math.min(inflated, ceilingMicroUsd), basis: 'history' };
}

/** One traced build, its repair's tokens and cost added in. */
export interface BuildSample {
  costMicroUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * What a traced build would cost at today's rates, or what it was charged
 * if that is more.
 *
 * Charged amounts alone go stale: after a price rise, a percentile read
 * from builds charged at the old rate understates every build to come
 * (Codex review of internal PR 383). So each build is priced again from its tokens.
 * A trace does not say how many of its input tokens were written to cache,
 * so every uncached one is priced at the dearer of the input and the
 * cache-write rate, the same rule `worstCaseMicroUsd` follows. The larger
 * of the two figures is kept: a price cut never lowers a build below what
 * it was charged, and a build that reported no tokens, charged its whole
 * reservation, keeps that charge.
 */
export function sampleCost(sample: BuildSample, prices: TokenPrices): number {
  const cached = Math.min(sample.cachedInputTokens, sample.inputTokens);
  const uncached = Math.max(0, sample.inputTokens - cached);
  const repriced = Math.ceil(
    uncached * Math.max(prices.inputMicroUsd, prices.cacheWriteMicroUsd) +
      cached * prices.cachedInputMicroUsd +
      sample.outputTokens * prices.outputMicroUsd,
  );
  return Math.max(sample.costMicroUsd, repriced);
}

/**
 * One model's newest builds in the window (`?1` the model, `?2` the start
 * of the window, `?3` how many), each with its repair added in.
 *
 * Only builds a model ran for. A run refused before any call (a revision
 * that moved, a project too large to send: `preflightRun`) is traced with
 * no tokens and no charge; counted, a burst of them would pull the
 * percentile to nothing and hide the estimate before a build that will be
 * charged (Codex review of internal PR 383). A run that ran and reported no usage is
 * charged its reservation, so it is never mistaken for one of these.
 */
export const RECENT_BUILDS_SQL = `SELECT b.cost_micro_usd + COALESCE(r.cost_micro_usd, 0) AS cost,
              b.input_tokens + COALESCE(r.input_tokens, 0) AS input,
              b.cached_input_tokens + COALESCE(r.cached_input_tokens, 0)
                AS cached,
              b.output_tokens + COALESCE(r.output_tokens, 0) AS output
         FROM (
           SELECT run_id, cost_micro_usd, input_tokens, cached_input_tokens,
                  output_tokens
             FROM generation_run_traces
            WHERE model = ?1
              AND ended_at >= ?2
              AND run_id NOT LIKE '%:%'
              AND (cost_micro_usd > 0 OR input_tokens > 0 OR output_tokens > 0)
            ORDER BY ended_at DESC
            LIMIT ?3
         ) AS b
         LEFT JOIN generation_run_traces AS r
           ON r.run_id = b.run_id || ':repair'`;

/**
 * The recent builds for each of `models`, a build's repair counted with
 * it, newest `BUILD_ESTIMATE_SAMPLE` per model.
 *
 * One query a model, each limited before its repairs are joined, so the
 * index on (model, ended_at) stops the read at the newest builds rather
 * than numbering every build in the window first: `/api/config` waits on
 * this every time the builder loads (Codex review of internal PR 383).
 *
 * A repair row's model is not trusted to say whose build it was: the build
 * row's is. A repair whose build row is outside the window is left out
 * rather than counted as a build of its own, which would read a repair's
 * cost as what a whole build costs.
 */
export async function recentBuilds(
  db: D1Database,
  models: readonly string[],
  now: number,
): Promise<Map<string, BuildSample[]>> {
  const since = new Date(
    now - BUILD_ESTIMATE_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const statement = db.prepare(RECENT_BUILDS_SQL);
  const rows = await Promise.all(
    models.map((model) =>
      statement
        .bind(model, since, BUILD_ESTIMATE_SAMPLE)
        .all<{ cost: number; input: number; cached: number; output: number }>(),
    ),
  );
  return new Map(
    models.map((model, index) => [
      model,
      (rows[index]!.results ?? []).map((row) => ({
        costMicroUsd: row.cost,
        inputTokens: row.input,
        cachedInputTokens: row.cached,
        outputTokens: row.output,
      })),
    ]),
  );
}

/**
 * Each model's estimate, for the picker (`/api/config`). `draftModel` is
 * the model this caller's drafts are drawn on (`draftModelFor`), or null
 * where they are drawn on the model chosen for the build.
 */
export async function buildEstimates(
  env: RunCeilingEnv,
  db: D1Database,
  models: readonly string[],
  draftModel: string | null,
  now: number,
): Promise<Map<string, BuildEstimate>> {
  const builds = await recentBuilds(db, models, now);
  return new Map(
    models.map((model) => {
      const { prices } = runCeilingFor(env, model, 'build');
      const costs = (builds.get(model) ?? []).map((sample) =>
        sampleCost(sample, prices),
      );
      return [
        model,
        {
          ...estimateFrom(costs, buildCeilingMicroUsd(env, model)),
          draftMicroUsd: draftCeilingMicroUsd(env, draftModel ?? model),
        },
      ];
    }),
  );
}
