import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { configuredProviders, resolveModel } from '@vibld/ai';
import {
  decideModel,
  grantedFor,
  pickerEntries,
  unservableConfiguredModel,
} from '../worker/model-access.ts';
import { parseModel } from '../worker/request-guard.ts';
import { runCeilingFor } from '../worker/run-ceiling.ts';
import { parsePrices, worstCaseMicroUsd } from '../worker/spend.ts';
import {
  CHECK_FAILED,
  CHECK_UNFINISHED,
  LOCAL_CHECK_ADVICE,
  checkProblem,
} from '../src/generation/build-check.ts';

/** A copy that builds with a model on its own machine (D124, D138). */

const LOCAL = {
  VIBLD_LOCAL_BASE_URL: 'http://localhost:11434/v1',
  VIBLD_LOCAL_MODEL: 'qwen3-coder:30b',
};

describe('a copy with only a local model', () => {
  it('offers it, by its own name, to everybody on a copy that sells no plans', () => {
    const granted = grantedFor(LOCAL, 'owner', null);
    assert.deepEqual(
      granted.map((model) => model.id),
      ['local'],
    );
    assert.deepEqual(pickerEntries(LOCAL, granted), [
      {
        id: 'local',
        label: 'Local: qwen3-coder:30b',
        note: granted[0]?.note,
        provider: 'local',
      },
    ]);
  });

  it('builds with it by default', () => {
    assert.equal(resolveModel(LOCAL), 'local');
    const decided = decideModel(
      LOCAL,
      'owner',
      null,
      null,
      resolveModel(LOCAL),
    );
    assert.deepEqual(decided.ok && decided.model, 'local');
  });

  it('takes it from the picker, and refuses it on a copy without one', () => {
    const chosen = parseModel(
      { prompt: 'x', model: 'local' },
      configuredProviders(LOCAL),
    );
    assert.deepEqual(chosen, { ok: true, value: 'local' });
    const refused = parseModel(
      { prompt: 'x', model: 'local' },
      configuredProviders({ OPENAI_API_KEY: 'o' }),
    );
    assert.equal(refused.ok, false);
  });

  it('says which settings are missing when VIBLD_MODEL names it without them', () => {
    assert.match(
      unservableConfiguredModel({
        VIBLD_MODEL: 'local',
        OPENAI_API_KEY: 'o',
      }) ?? '',
      /no VIBLD_LOCAL_BASE_URL and VIBLD_LOCAL_MODEL/,
    );
    assert.equal(
      unservableConfiguredModel({ ...LOCAL, VIBLD_MODEL: 'local' }),
      null,
    );
  });

  it('refuses to build elsewhere when told to build locally without the settings', () => {
    // A hosted key is present, so the first hosted model would otherwise
    // answer, and charge, a copy that chose its own machine.
    const env = {
      VIBLD_PROVIDER: 'local',
      VIBLD_LOCAL_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_API_KEY: 'o',
    };
    const decided = decideModel(env, 'owner', null, null, resolveModel(env));
    assert.equal(decided.ok, false);
    if (!decided.ok) {
      assert.equal(decided.status, 503);
      assert.match(decided.error, /VIBLD_PROVIDER is local/);
      assert.match(decided.error, /VIBLD_LOCAL_MODEL/);
    }
    // With both settings it builds locally.
    const local = { ...env, VIBLD_LOCAL_MODEL: 'qwen3-coder:30b' };
    const ok = decideModel(local, 'owner', null, null, resolveModel(local));
    assert.deepEqual(ok.ok && ok.model, 'local');
  });

  it('leaves hosted models labeled as they were', () => {
    const granted = grantedFor(
      { ...LOCAL, OPENAI_API_KEY: 'o' },
      'owner',
      null,
    );
    const entries = pickerEntries({ ...LOCAL, OPENAI_API_KEY: 'o' }, granted);
    assert.ok(entries.some((entry) => entry.label === 'GPT-6 Luna'));
    assert.equal(
      entries.filter((entry) => entry.label.startsWith('Local: ')).length,
      1,
    );
  });
});

describe('what a local run costs', () => {
  it('nothing, whatever an operator set for hosted models', () => {
    const prices = parsePrices(
      {
        VIBLD_USD_MICRO_PER_INPUT_TOKEN: '3',
        VIBLD_USD_MICRO_PER_OUTPUT_TOKEN: '15',
      },
      'local',
    );
    assert.deepEqual(prices, {
      inputMicroUsd: 0,
      outputMicroUsd: 0,
      cachedInputMicroUsd: 0,
      cacheWriteMicroUsd: 0,
    });
  });

  it('reserves nothing, and still bounds what it may ask for', () => {
    for (const kind of ['build', 'mockups', 'chat'] as const) {
      const ceiling = runCeilingFor(LOCAL, 'local', kind);
      assert.ok(Number.isFinite(ceiling.maxTokens), kind);
      assert.ok(ceiling.maxTokens > 0, kind);
      assert.equal(
        worstCaseMicroUsd(ceiling.prices, ceiling.maxTokens, 400_000),
        0,
        kind,
      );
    }
  });
});

describe('a local build that does not build', () => {
  it('says so, and says a larger model usually helps', () => {
    assert.equal(checkProblem('failed', 'gpt-6-luna'), CHECK_FAILED);
    assert.equal(checkProblem('failed', null), CHECK_FAILED);
    assert.equal(
      checkProblem('failed', 'local'),
      `${CHECK_FAILED} ${LOCAL_CHECK_ADVICE}`,
    );
    assert.match(
      LOCAL_CHECK_ADVICE,
      /a larger model usually writes code that builds/,
    );
    // A check that did not finish is not the model's doing.
    assert.equal(checkProblem('unchecked', 'local'), CHECK_UNFINISHED);
    assert.equal(checkProblem('passed', 'local'), undefined);
  });
});
