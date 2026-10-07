import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILD_ESTIMATE_MARGIN,
  BUILD_ESTIMATE_MIN_SAMPLES,
  BUILD_ESTIMATE_SAMPLE,
  BUILD_ESTIMATE_WINDOW_DAYS,
  RECENT_BUILDS_SQL,
  buildCeilingMicroUsd,
  buildEstimates,
  draftCeilingMicroUsd,
  estimateFrom,
  percentile,
  recentBuilds,
  sampleCost,
} from '../worker/build-estimate.ts';
import {
  BOUNDED_BUILD_INPUT_CHARS,
  MOCKUP_INPUT_CHARS,
  runCeilingFor,
} from '../worker/run-ceiling.ts';
import { worstCaseMicroUsd } from '../worker/spend.ts';
import { buildEstimateText } from '../src/generation/build-estimate.ts';
import { readBuildEstimate } from '../src/generation/remote-provider.ts';
import { MAX_BASE_CONTENT_CHARS, outputTokensToCarry } from '@vibld/ai/limits';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The cost a build is expected to have, said before it is asked for
 * (Chris, 2026-10-05): the 90th percentile of recent builds on the model,
 * a quarter on top, and never more than a build can be charged.
 */

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const ENV = {};

function world() {
  const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
  const trace = (
    runId: string,
    model: string,
    cost: number,
    endedAt = '2026-10-07T10:00:00.000Z',
    tokens = { input: 0, cached: 0, output: 0 },
  ) =>
    db
      .prepare(
        `INSERT INTO generation_run_traces
           (run_id, project_id, stop, model, input_tokens, cached_input_tokens,
            output_tokens, context_window, cost_micro_usd, elapsed_ms, ended_at)
         VALUES (?1, 'p', 'completed', ?2, ?5, ?6, ?7, 0, ?3, 0, ?4)`,
      )
      .bind(
        runId,
        model,
        cost,
        endedAt,
        tokens.input,
        tokens.cached,
        tokens.output,
      )
      .run();
  return { db, trace };
}

describe('the expected cost of a build', () => {
  it('reads the nearest-rank percentile, a cost some build really had', () => {
    const costs = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    assert.equal(percentile(costs, 0.9), 9);
    assert.equal(percentile(costs, 1), 10);
    assert.equal(percentile([7], 0.9), 7);
  });

  it('inflates the 90th percentile by a quarter', () => {
    const costs = Array.from({ length: 10 }, (_, index) => (index + 1) * 1000);
    assert.deepEqual(estimateFrom(costs, 1_000_000), {
      microUsd: Math.ceil(9000 * BUILD_ESTIMATE_MARGIN),
      basis: 'history',
    });
  });

  it('never says more than a build can be charged', () => {
    const costs = Array.from({ length: 10 }, () => 900);
    assert.deepEqual(estimateFrom(costs, 1000), {
      microUsd: 1000,
      basis: 'history',
    });
  });

  it('says the ceiling, as the ceiling, with too few builds to read', () => {
    const costs = Array.from(
      { length: BUILD_ESTIMATE_MIN_SAMPLES - 1 },
      () => 10,
    );
    assert.deepEqual(estimateFrom(costs, 5000), {
      microUsd: 5000,
      basis: 'ceiling',
    });
  });

  it("is capped at the largest build's reservation and its repair's", () => {
    const ceiling = runCeilingFor(
      ENV,
      'gpt-6-luna',
      'build',
      outputTokensToCarry(MAX_BASE_CONTENT_CHARS),
    );
    assert.equal(
      buildCeilingMicroUsd(ENV, 'gpt-6-luna'),
      2 *
        worstCaseMicroUsd(
          ceiling.prices,
          ceiling.maxTokens,
          BOUNDED_BUILD_INPUT_CHARS,
        ),
    );
  });

  it('covers a follow-up, which reserves more than a first build', () => {
    // A ceiling sized for a first build said "Up to" for less than a
    // follow-up on a large project can be charged (Codex review of internal PR 383).
    for (const model of ['gpt-6-luna', 'gpt-6-sol', 'deepseek-flash']) {
      const largest = runCeilingFor(
        ENV,
        model,
        'build',
        outputTokensToCarry(MAX_BASE_CONTENT_CHARS),
      );
      for (const carry of [
        0,
        outputTokensToCarry(MAX_BASE_CONTENT_CHARS / 2),
      ]) {
        const run = runCeilingFor(ENV, model, 'build', carry);
        assert.ok(run.maxTokens <= largest.maxTokens, `${model} at ${carry}`);
        assert.ok(
          2 *
            worstCaseMicroUsd(
              run.prices,
              run.maxTokens,
              BOUNDED_BUILD_INPUT_CHARS,
            ) <=
            buildCeilingMicroUsd(ENV, model),
        );
      }
    }
  });
});

/** The charged costs `recentBuilds` read, per model. */
async function recentBuildCosts(
  db: D1Database,
  models: string[],
  now: number,
): Promise<Map<string, number[]>> {
  const builds = await recentBuilds(db, models, now);
  return new Map(
    [...builds].map(([model, samples]) => [
      model,
      samples.map((sample) => sample.costMicroUsd),
    ]),
  );
}

describe("recent builds' costs, from the traces", () => {
  it('counts a repair with its build, and the build row decides the model', async () => {
    const w = world();
    await w.trace('a', 'gpt-6-luna', 100);
    await w.trace('a:repair', 'something-else', 40);
    await w.trace('b', 'gpt-6-luna', 70);
    const costs = await recentBuildCosts(w.db, ['gpt-6-luna'], NOW);
    assert.deepEqual(
      [...costs.get('gpt-6-luna')!].sort((x, y) => x - y),
      [70, 140],
    );
  });

  it('keeps each model to its own builds, and answers every model asked', async () => {
    const w = world();
    await w.trace('a', 'gpt-6-luna', 100);
    await w.trace('b', 'gpt-6-sol', 900);
    const costs = await recentBuildCosts(
      w.db,
      ['gpt-6-luna', 'gpt-6-sol', 'never-run'],
      NOW,
    );
    assert.deepEqual(costs.get('gpt-6-luna'), [100]);
    assert.deepEqual(costs.get('gpt-6-sol'), [900]);
    assert.deepEqual(costs.get('never-run'), []);
  });

  it('leaves out runs refused before any model call', async () => {
    const w = world();
    await w.trace('built', 'gpt-6-luna', 100, '2026-10-06T10:00:00.000Z');
    await w.trace('free', 'gpt-6-free', 0, '2026-10-06T10:00:00.000Z', {
      input: 900,
      cached: 0,
      output: 300,
    });
    for (let index = 0; index < BUILD_ESTIMATE_SAMPLE; index++) {
      await w.trace(`refused-${index}`, 'gpt-6-luna', 0);
    }
    const costs = await recentBuildCosts(
      w.db,
      ['gpt-6-luna', 'gpt-6-free'],
      NOW,
    );
    assert.deepEqual(costs.get('gpt-6-luna'), [100]);
    assert.deepEqual(costs.get('gpt-6-free'), [0]);
  });

  it('leaves out a repair whose build is not counted, and old builds', async () => {
    const w = world();
    const old = new Date(
      NOW - (BUILD_ESTIMATE_WINDOW_DAYS + 1) * 86_400_000,
    ).toISOString();
    await w.trace('old', 'gpt-6-luna', 100, old);
    await w.trace('old:repair', 'gpt-6-luna', 50);
    const costs = await recentBuildCosts(w.db, ['gpt-6-luna'], NOW);
    assert.deepEqual(costs.get('gpt-6-luna'), []);
  });

  it(`reads the newest ${BUILD_ESTIMATE_SAMPLE} builds per model`, async () => {
    const w = world();
    for (let index = 0; index < BUILD_ESTIMATE_SAMPLE + 5; index += 1) {
      const endedAt = new Date(NOW - (index + 1) * 60_000).toISOString();
      // The five oldest cost more, so counting them would show.
      const cost = index >= BUILD_ESTIMATE_SAMPLE ? 999 : 1;
      await w.trace(`r${index}`, 'gpt-6-luna', cost, endedAt);
    }
    const costs = (await recentBuildCosts(w.db, ['gpt-6-luna'], NOW)).get(
      'gpt-6-luna',
    )!;
    assert.equal(costs.length, BUILD_ESTIMATE_SAMPLE);
    assert.ok(costs.every((cost) => cost === 1));
  });

  it("adds a repair's tokens to its build's", async () => {
    const w = world();
    await w.trace('a', 'gpt-6-luna', 100, undefined, {
      input: 1000,
      cached: 400,
      output: 50,
    });
    await w.trace('a:repair', 'gpt-6-luna', 40, undefined, {
      input: 200,
      cached: 100,
      output: 10,
    });
    assert.deepEqual(
      (await recentBuilds(w.db, ['gpt-6-luna'], NOW)).get('gpt-6-luna'),
      [
        {
          costMicroUsd: 140,
          inputTokens: 1200,
          cachedInputTokens: 500,
          outputTokens: 60,
        },
      ],
    );
  });

  it('gives every model an estimate, from history or from the ceiling', async () => {
    const w = world();
    for (let index = 0; index < BUILD_ESTIMATE_MIN_SAMPLES; index += 1) {
      await w.trace(`r${index}`, 'gpt-6-luna', 1000);
    }
    const estimates = await buildEstimates(
      ENV,
      w.db,
      ['gpt-6-luna', 'gpt-6-sol'],
      null,
      NOW,
    );
    assert.deepEqual(estimates.get('gpt-6-luna'), {
      microUsd: 1250,
      basis: 'history',
      draftMicroUsd: draftCeilingMicroUsd(ENV, 'gpt-6-luna'),
    });
    assert.deepEqual(estimates.get('gpt-6-sol'), {
      microUsd: buildCeilingMicroUsd(ENV, 'gpt-6-sol'),
      basis: 'ceiling',
      draftMicroUsd: draftCeilingMicroUsd(ENV, 'gpt-6-sol'),
    });
  });

  it("prices a first build's draft on the model drafts are drawn on", async () => {
    const w = world();
    const estimates = await buildEstimates(
      ENV,
      w.db,
      ['gpt-6-sol'],
      'deepseek-flash',
      NOW,
    );
    const draft = estimates.get('gpt-6-sol')!.draftMicroUsd;
    assert.equal(draft, draftCeilingMicroUsd(ENV, 'deepseek-flash'));
    const ceiling = runCeilingFor(ENV, 'deepseek-flash', 'mockups');
    assert.equal(
      draft,
      worstCaseMicroUsd(ceiling.prices, ceiling.maxTokens, MOCKUP_INPUT_CHARS),
    );
    assert.ok(draft > 0);
  });

  it('reads a model through its index, limited before repairs are joined', async () => {
    // Codex review of internal PR 383: numbering every build in the window before
    // keeping the newest would read a month of traffic each time the
    // builder loads.
    const db = new SqliteD1Database(schemaSql()) as unknown as D1Database;
    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${RECENT_BUILDS_SQL}`)
      .bind('gpt-6-luna', '2026-09-07T00:00:00.000Z', BUILD_ESTIMATE_SAMPLE)
      .all<{ detail: string }>();
    const details = (plan.results ?? []).map((row) => row.detail);
    const said = details.join('\n');
    assert.ok(
      details.some((detail) =>
        detail.startsWith(
          'SEARCH generation_run_traces USING INDEX idx_generation_run_traces_model',
        ),
      ),
      said,
    );
    assert.ok(
      details.some(
        (detail) =>
          detail.startsWith('SEARCH r USING INDEX') &&
          detail.includes('(run_id=?)'),
      ),
      said,
    );
    assert.ok(!details.some((detail) => detail.includes('TEMP B-TREE')), said);
    assert.ok(
      !details.some((detail) =>
        detail.startsWith('SCAN generation_run_traces'),
      ),
      said,
    );
  });
});

describe('the estimate, as the composer says it', () => {
  it('rounds up to the cent, never down', () => {
    assert.equal(
      buildEstimateText(
        { microUsd: 120_001, basis: 'history', draftMicroUsd: 0 },
        false,
      )?.text,
      'About $0.13 a build',
    );
    assert.equal(
      buildEstimateText(
        { microUsd: 120_000, basis: 'history', draftMicroUsd: 0 },
        false,
      )?.text,
      'About $0.12 a build',
    );
    assert.equal(
      buildEstimateText(
        { microUsd: 1, basis: 'history', draftMicroUsd: 0 },
        false,
      )?.text,
      'About $0.01 a build',
    );
  });

  it('says a ceiling is the most a build can cost', () => {
    assert.equal(
      buildEstimateText(
        { microUsd: 2_500_000, basis: 'ceiling', draftMicroUsd: 0 },
        false,
      )?.text,
      'Up to $2.50 a build',
    );
  });

  it("adds the draft's worst case to a first build, and only to one", () => {
    const estimate = {
      microUsd: 100_000,
      basis: 'history' as const,
      draftMicroUsd: 30_000,
    };
    assert.equal(
      buildEstimateText(estimate, true)?.text,
      'About $0.13 a build',
    );
    assert.equal(
      buildEstimateText(estimate, false)?.text,
      'About $0.10 a build',
    );
  });

  it('says nothing for no estimate, or a model that costs nothing', () => {
    assert.equal(buildEstimateText(null, true), null);
    assert.equal(buildEstimateText(undefined, true), null);
    assert.equal(
      buildEstimateText(
        { microUsd: 0, basis: 'ceiling', draftMicroUsd: 5 },
        true,
      ),
      null,
    );
  });

  it('reads only the shape the Worker sends', () => {
    assert.deepEqual(
      readBuildEstimate({ microUsd: 5, basis: 'history', draftMicroUsd: 2 }),
      { microUsd: 5, basis: 'history', draftMicroUsd: 2 },
    );
    // Without the draft's share the figure could be too low for a first
    // build, so it is not shown at all.
    assert.equal(readBuildEstimate({ microUsd: 5, basis: 'history' }), null);
    assert.equal(readBuildEstimate(null), null);
    assert.equal(readBuildEstimate({ microUsd: '5', basis: 'history' }), null);
    assert.equal(readBuildEstimate({ microUsd: -1, basis: 'history' }), null);
    assert.equal(readBuildEstimate({ microUsd: 5, basis: 'guess' }), null);
  });
});

describe('a traced build, priced at the rates in force now', () => {
  const prices = {
    inputMicroUsd: 2,
    outputMicroUsd: 10,
    cachedInputMicroUsd: 0.2,
    cacheWriteMicroUsd: 2.5,
  };

  it('prices uncached input at the dearer of input and cache write', () => {
    // 600 uncached at 2.5, 400 cached at 0.2, 50 output at 10.
    assert.equal(
      sampleCost(
        {
          costMicroUsd: 0,
          inputTokens: 1000,
          cachedInputTokens: 400,
          outputTokens: 50,
        },
        prices,
      ),
      600 * 2.5 + 400 * 0.2 + 50 * 10,
    );
  });

  it('keeps what a build was charged when that is more', () => {
    // A price cut, or a run that reported no tokens and paid its whole
    // reservation: neither is read as cheaper than it was.
    assert.equal(
      sampleCost(
        {
          costMicroUsd: 9_999,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
        },
        prices,
      ),
      9_999,
    );
  });

  it('follows a price rise into the estimate (Codex review of #383)', async () => {
    const w = world();
    for (let index = 0; index < BUILD_ESTIMATE_MIN_SAMPLES; index += 1) {
      // Charged 1,000 at the old rate for 100 output tokens.
      await w.trace(`r${index}`, 'gpt-6-luna', 1000, undefined, {
        input: 0,
        cached: 0,
        output: 100,
      });
    }
    const raised = { VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: '40' };
    const estimate = (
      await buildEstimates(raised, w.db, ['gpt-6-luna'], null, NOW)
    ).get('gpt-6-luna')!;
    assert.equal(estimate.basis, 'history');
    assert.equal(estimate.microUsd, Math.ceil(100 * 40 * 1.25));
  });
});
