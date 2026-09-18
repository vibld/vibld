import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MODEL_CATALOGUE,
  RUN_OUTPUT_RESERVE_MICRO_USD,
  maxTokensFor,
  mockupMaxTokensFor,
} from '@vibld/ai';

import { runCeilingFor } from '../worker/run-ceiling.ts';
import { worstCaseMicroUsd } from '../worker/spend.ts';

/**
 * One derivation for what a run may emit and what that costs.
 *
 * The truncation this whole change came from was two numbers that had to
 * agree and did not. Closing it by deriving tokens from the catalogue price
 * left one more way for them to part company: `VIBLD_USD_MICRO_PER_OUTPUT_TOKEN`
 * moves what the reservation charges, and a ceiling read off the catalogue
 * behind it is the same bug in a different place. These pin the two
 * together, including under an override.
 */

const FLASH = 'deepseek-flash';

function flash() {
  const model = MODEL_CATALOGUE.find((entry) => entry.id === FLASH);
  assert.ok(model, `${FLASH} left the catalogue`);
  return model;
}

describe('what one run may ask for', () => {
  it('asks for what the price actually in force affords', () => {
    // The catalogue rate would clamp Flash at its own 384000 cap. An
    // operator correcting a stale rate upward has to move the ceiling down
    // with it, or the run reserves more than the run is allowed to hold.
    const dear = flash().outputMicroUsd * 40;
    const { maxTokens, prices } = runCeilingFor(
      {
        VIBLD_PROVIDER: 'deepseek',
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: `${dear}`,
      },
      FLASH,
    );

    assert.equal(prices.outputMicroUsd, dear, 'the override did not take');
    assert.ok(
      maxTokens < flash().maxOutputTokens,
      `a ${dear} micro-USD token still bought the whole ${flash().maxOutputTokens}`,
    );
    assert.ok(
      maxTokens * dear <= RUN_OUTPUT_RESERVE_MICRO_USD,
      `reserves ${maxTokens * dear} against a ceiling of ${RUN_OUTPUT_RESERVE_MICRO_USD}`,
    );
  });

  it('gives back the room a corrected-down price pays for', () => {
    // The other direction, and the one that truncates: a model the dollar
    // reserve binds (rather than its own cap) should widen when its price
    // falls, instead of holding a ceiling bought at a rate nobody charges.
    const bound = MODEL_CATALOGUE.find(
      (entry) =>
        Math.floor(RUN_OUTPUT_RESERVE_MICRO_USD / entry.outputMicroUsd) <
        entry.maxOutputTokens,
    );
    assert.ok(
      bound,
      'no model in the catalogue is bound by the dollar reserve',
    );

    const cheap = bound.outputMicroUsd / 2;
    const { maxTokens } = runCeilingFor(
      { VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: `${cheap}` },
      bound.id,
    );

    assert.ok(
      maxTokens > maxTokensFor(bound.id),
      `${bound.id} held its dearer ceiling at half the price`,
    );
  });

  it('holds every model inside the reserve whatever the price is corrected to', () => {
    // Walked over the catalogue rather than one model, because the way this
    // breaks is somebody adding a model and not this file.
    for (const model of MODEL_CATALOGUE) {
      for (const factor of [0.1, 1, 7, 50]) {
        const override = model.outputMicroUsd * factor;
        const { maxTokens, prices } = runCeilingFor(
          { VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: `${override}` },
          model.id,
        );
        const reserved = worstCaseMicroUsd(prices, maxTokens, 0);
        assert.ok(
          reserved >= maxTokens * prices.outputMicroUsd,
          `${model.id} at x${factor}: reserves ${reserved} but may emit ${
            maxTokens * prices.outputMicroUsd
          }`,
        );
        assert.ok(
          maxTokens <= model.maxOutputTokens,
          `${model.id} at x${factor}: asked for ${maxTokens}, past its own ${model.maxOutputTokens}`,
        );
      }
    }
  });

  it('never lets an unusable override reach the ceiling', () => {
    // `parsePrices` refuses a value that is not a price, and this pins that
    // the ceiling is derived after that refusal rather than from the raw
    // setting. A zero taken at face value makes the reservation free and
    // the ceiling unreachable. (What `maxTokensFor` does when handed such a
    // number directly is its own test, in packages/ai.)
    for (const bad of ['0', '-3', 'free', '']) {
      const { maxTokens } = runCeilingFor(
        { VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: bad },
        FLASH,
      );
      assert.equal(
        maxTokens,
        maxTokensFor(FLASH),
        `"${bad}" was treated as a price`,
      );
    }
  });

  it('hands back a ceiling derived from the price it hands back with it', () => {
    // The pair is the point: a caller takes both or neither, so the
    // reservation cannot price one number while the request asks for
    // another. Checked under an override, because without one the
    // catalogue and the effective price are the same figure and this
    // asserts nothing at all.
    for (const model of MODEL_CATALOGUE) {
      const override = model.outputMicroUsd * 30;
      const { maxTokens, prices } = runCeilingFor(
        { VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: `${override}` },
        model.id,
      );
      assert.notEqual(
        maxTokensFor(model.id, override),
        maxTokensFor(model.id),
        `${model.id}: the override moved nothing, so this test proves nothing`,
      );
      assert.equal(
        maxTokens,
        maxTokensFor(model.id, prices.outputMicroUsd),
        `${model.id}: the ceiling was not derived from the price returned with it`,
      );
    }
  });
});

/**
 * Looking before building is only worth offering if it is actually cheap
 * (#185). The dispatch lives in `runCeilingFor` rather than at the call
 * sites, for the same reason the rest of this file exists: a second place
 * that decides a ceiling is a second place that can disagree with the
 * reservation it is supposed to match.
 */
describe('what a run is for decides what it may ask for', () => {
  const env = {} as Parameters<typeof runCeilingFor>[0];

  it('asks for a sketch-sized ceiling when the run is mockups', () => {
    assert.equal(
      runCeilingFor(env, FLASH, 'mockups').maxTokens,
      mockupMaxTokensFor(FLASH),
    );
  });

  it('reserves markedly less than a build', () => {
    // The whole argument for offering this at all. If three mockups cost
    // what a build costs, nobody should be asked to spend a build on them.
    //
    // This compared ceilings at a factor of ten until #190, which measured
    // what the two actually cost and made the comparison unsound in both
    // directions. A look really is about a tenth of a build in money:
    // $0.026 against $0.30 on the production model. But a ceiling is not a
    // budget -- two thirds of a mockup run's tokens are reasoning, so the
    // ceiling has to be several times what the documents suggest, and any
    // guard with headroom over the measured 24,322 fails a factor of ten
    // against flash's 252,000.
    //
    // So the property is stated where it holds. The ratio that is enforced
    // is the one `mockupMaxTokensFor` guarantees for every model: a look
    // may never reserve more than half a build. The cost claim lives in
    // the measurement, not in an arithmetic proxy for it.
    const build = runCeilingFor(env, FLASH, 'build');
    const mockups = runCeilingFor(env, FLASH, 'mockups');
    assert.ok(
      mockups.maxTokens * 2 <= build.maxTokens,
      `mockups (${mockups.maxTokens}) reserve more than half a build (${build.maxTokens})`,
    );
  });

  it('holds that ratio for every model, not just the production one', () => {
    // The clamp exists because the flat guard alone does not hold it: on
    // the smaller-ceilinged models a 64,000 look would have been allowed
    // to reserve twice a whole build (#190).
    for (const model of MODEL_CATALOGUE) {
      const build = runCeilingFor(env, model.id, 'build');
      const mockups = runCeilingFor(env, model.id, 'mockups');
      assert.ok(
        mockups.maxTokens * 2 <= build.maxTokens,
        `${model.id}: mockups (${mockups.maxTokens}) reserve more than half a build (${build.maxTokens})`,
      );
    }
  });

  it('still builds when nothing says otherwise', () => {
    // Every existing caller passes no kind, and a default that quietly
    // made them cheap would truncate every project in production.
    assert.equal(
      runCeilingFor(env, FLASH).maxTokens,
      runCeilingFor(env, FLASH, 'build').maxTokens,
    );
  });

  it('prices both kinds the same way, because the model is the same', () => {
    assert.deepEqual(
      runCeilingFor(env, FLASH, 'mockups').prices,
      runCeilingFor(env, FLASH, 'build').prices,
    );
  });
});
