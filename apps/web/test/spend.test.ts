import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PRICES,
  PROVIDER_PRICES,
  dayKey,
  decide,
  microUsdOf,
  monthKey,
  parsePrices,
  worstCaseMicroUsd,
} from '../worker/spend.ts';
import { DEFAULT_LIMITS } from '../worker/request-guard.ts';
import { DEFAULT_MAX_TOKENS } from '@vibld/ai';

describe('spend pricing', () => {
  it('prices a run from its token counts', () => {
    assert.equal(
      microUsdOf({ inputTokens: 1_000, outputTokens: 2_000 }, DEFAULT_PRICES),
      1_000 * 5 + 2_000 * 25,
    );
  });

  it('never returns a fractional charge', () => {
    const priced = microUsdOf(
      { inputTokens: 3, outputTokens: 3 },
      { inputMicroUsd: 0.5, outputMicroUsd: 0.5 },
    );
    assert.equal(priced, 3);
    assert.ok(Number.isInteger(priced));
  });

  it('reads prices from configuration', () => {
    assert.deepEqual(
      parsePrices({
        VIBLD_USD_MICRO_PER_INPUT_TOKEN: '3',
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: '15',
      }),
      { inputMicroUsd: 3, outputMicroUsd: 15 },
    );
  });

  it('falls back to the default rather than to zero on a bad price', () => {
    // A zero or negative price would make every run free and the ceiling
    // unreachable -- the one failure mode a spend limit must not have.
    for (const bad of ['0', '-1', 'free', '', 'NaN']) {
      const prices = parsePrices({
        VIBLD_USD_MICRO_PER_INPUT_TOKEN: bad,
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: bad,
      });
      assert.deepEqual(
        prices,
        DEFAULT_PRICES,
        `rejected ${JSON.stringify(bad)}`,
      );
    }
  });

  it('bounds a run by the output cap and the prompt cap', () => {
    const worst = worstCaseMicroUsd(DEFAULT_PRICES, 16_000, 4_000);
    assert.equal(worst, Math.ceil(4_000 / 4) * 5 + 16_000 * 25);
    assert.ok(
      worst >
        microUsdOf(
          { inputTokens: 1_000, outputTokens: 16_000 },
          DEFAULT_PRICES,
        ) -
          1,
      'the worst case must not under-estimate a full-length run',
    );
  });
});

describe('spend ceiling', () => {
  const base = {
    spentMicroUsd: 0,
    inFlight: 0,
    worstCaseMicroUsd: 400_000,
    ceilingMicroUsd: 4_000_000,
    maxInFlight: 2,
  };

  it('allows a run inside the ceiling', () => {
    assert.deepEqual(decide(base), { allow: true });
  });

  it('refuses the run that would cross the ceiling, not the one after it', () => {
    // The tenth run fits exactly; the eleventh would exceed, and is refused
    // before it is started rather than after it is billed.
    assert.deepEqual(decide({ ...base, spentMicroUsd: 3_600_000 }), {
      allow: true,
    });
    assert.deepEqual(decide({ ...base, spentMicroUsd: 3_600_001 }), {
      allow: false,
      reason: 'period-ceiling',
    });
  });

  it('requires headroom for a whole run, not merely some headroom', () => {
    // Leaving a run to start on a balance that cannot cover its worst case is
    // how a ceiling gets crossed: the overspend is only discovered once the
    // bill arrives. Partial headroom is refused.
    const nearly = base.ceilingMicroUsd - base.worstCaseMicroUsd + 1;
    assert.deepEqual(decide({ ...base, spentMicroUsd: nearly }), {
      allow: false,
      reason: 'period-ceiling',
    });
    assert.deepEqual(decide({ ...base, spentMicroUsd: nearly - 1 }), {
      allow: true,
    });
  });

  it('caps concurrent runs before it looks at the money', () => {
    assert.deepEqual(decide({ ...base, inFlight: 2 }), {
      allow: false,
      reason: 'too-many-in-flight',
    });
  });

  it('refuses everything when the ceiling is smaller than one run', () => {
    assert.deepEqual(decide({ ...base, ceilingMicroUsd: 1 }), {
      allow: false,
      reason: 'period-ceiling',
    });
  });
});

describe('spend period boundaries', () => {
  it('groups by UTC day, so the account-wide ceiling resets at 00:00 UTC', () => {
    assert.equal(dayKey(Date.UTC(2026, 8, 8, 23, 59, 59)), '2026-09-08');
    assert.equal(dayKey(Date.UTC(2026, 8, 9, 0, 0, 0)), '2026-09-09');
  });

  it('groups by UTC calendar month, so a tier allowance resets on the 1st', () => {
    assert.equal(monthKey(Date.UTC(2026, 8, 30, 23, 59, 59)), '2026-09');
    assert.equal(monthKey(Date.UTC(2026, 9, 1, 0, 0, 0)), '2026-10');
  });
});

describe('the worst case counts the project sent with the prompt', () => {
  it('grows with the base project, not just the typed prompt', () => {
    // The base project's file contents go to the model now. Counting the
    // prompt alone under-counted the input side of a follow-up run by about
    // forty times, and a worst case that under-estimates is not a worst case.
    const promptOnly = worstCaseMicroUsd(DEFAULT_PRICES, 64_000, 4_000);
    const withProject = worstCaseMicroUsd(
      DEFAULT_PRICES,
      64_000,
      4_000 + 160_000,
    );
    assert.ok(withProject > promptOnly);
    assert.equal(withProject - promptOnly, Math.ceil(160_000 / 4) * 5);
  });

  it('is the ceiling the endpoint actually enforces', () => {
    // Guard limits and provider cap in, dollars out. If either moves, this
    // number moves with it rather than silently going stale.
    assert.equal(
      worstCaseMicroUsd(
        DEFAULT_PRICES,
        DEFAULT_MAX_TOKENS,
        DEFAULT_LIMITS.maxPromptChars + DEFAULT_LIMITS.maxTotalContentChars,
      ),
      Math.ceil(
        (DEFAULT_LIMITS.maxPromptChars + DEFAULT_LIMITS.maxTotalContentChars) /
          4,
      ) *
        DEFAULT_PRICES.inputMicroUsd +
        DEFAULT_MAX_TOKENS * DEFAULT_PRICES.outputMicroUsd,
    );
  });
});

describe('prices follow the selected provider', () => {
  it("falls back to that provider's own rates, not the other one's", () => {
    // Pricing DeepSeek runs at Anthropic's rates over-estimates, so it is
    // safe -- but a dollar figure wrong by forty times is not a ceiling
    // anyone can reason about.
    const anthropic = parsePrices({}, 'anthropic');
    const deepseek = parsePrices({}, 'deepseek');
    assert.deepEqual(anthropic, DEFAULT_PRICES);
    assert.ok(deepseek.outputMicroUsd < anthropic.outputMicroUsd);
    assert.deepEqual(deepseek, PROVIDER_PRICES.deepseek);
  });

  it("is conservative across DeepSeek's peak and model spread", () => {
    // Peak is double off-peak and v4-pro is triple v4-flash, so one default
    // covers four combinations. It has to be the most expensive of them:
    // a worst case that under-estimates is not a worst case.
    assert.equal(PROVIDER_PRICES.deepseek!.inputMicroUsd, 1.32);
    assert.equal(PROVIDER_PRICES.deepseek!.outputMicroUsd, 3.96);
  });

  it('still lets an explicit price win for either provider', () => {
    const explicit = parsePrices(
      {
        VIBLD_USD_MICRO_PER_INPUT_TOKEN: '0.22',
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: '0.66',
      },
      'deepseek',
    );
    assert.deepEqual(explicit, { inputMicroUsd: 0.22, outputMicroUsd: 0.66 });
  });

  it('defaults to Anthropic when no provider is named', () => {
    assert.deepEqual(parsePrices({}), DEFAULT_PRICES);
  });

  it('falls back safely for a provider it has no prices for', () => {
    assert.deepEqual(parsePrices({}, 'nonesuch'), DEFAULT_PRICES);
  });
});

describe('the chosen model prices its own run', () => {
  it('uses the model rate over the provider default', () => {
    // A run on Opus must not be ceilinged at DeepSeek's rate because the
    // deployment happens to default to DeepSeek.
    const opus = parsePrices({}, 'deepseek', {
      inputMicroUsd: 5,
      outputMicroUsd: 25,
    });
    assert.deepEqual(opus, { inputMicroUsd: 5, outputMicroUsd: 25 });
  });

  it('still lets an operator override win over the model rate', () => {
    const forced = parsePrices(
      {
        VIBLD_USD_MICRO_PER_INPUT_TOKEN: '9',
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: '99',
      },
      'deepseek',
      { inputMicroUsd: 5, outputMicroUsd: 25 },
    );
    assert.deepEqual(forced, { inputMicroUsd: 9, outputMicroUsd: 99 });
  });

  it('falls back to the provider default when no model was chosen', () => {
    assert.deepEqual(
      parsePrices({}, 'deepseek', undefined),
      PROVIDER_PRICES.deepseek,
    );
  });
});
