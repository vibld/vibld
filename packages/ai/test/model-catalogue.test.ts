import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LEGACY_MODEL_IDS,
  MODEL_CATALOGUE,
  CATALOGUE_VERIFIED_ON,
  MAX_CATALOGUE_AGE_DAYS,
  availableModels,
  cacheRatesFor,
  catalogueAgeDays,
  canonicalModelId,
  findModel,
  isKnownModel,
} from '../src/model-catalogue.ts';
import { DEFAULT_MODELS, PROVIDER_NAMES } from '../src/select-client.ts';
import { DEFAULT_MAX_TOKENS } from '../src/plan-provider.ts';

describe('the model catalogue', () => {
  it('has distinct ids and a provider for each', () => {
    const ids = MODEL_CATALOGUE.map((model) => model.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const model of MODEL_CATALOGUE) {
      assert.ok(PROVIDER_NAMES.includes(model.provider), model.id);
      assert.ok(model.label.length > 0 && model.note.length > 0, model.id);
    }
  });

  it('can produce a whole project on every model it offers', () => {
    // DEFAULT_MAX_TOKENS is what a multi-file project needs. A model that
    // cannot reach it truncates every run, which is a worse outcome than not
    // offering it at all.
    for (const model of MODEL_CATALOGUE) {
      assert.ok(
        model.maxOutputTokens >= DEFAULT_MAX_TOKENS,
        `${model.id} caps output at ${model.maxOutputTokens}, below the ${DEFAULT_MAX_TOKENS} a project needs`,
      );
    }
  });

  it('leaves room for the largest prompt it will ever be sent', () => {
    // Prompt, base project, standing instructions and reference text, plus
    // the output ceiling, all have to fit inside the context window.
    const LARGEST_INPUT_TOKENS = Math.ceil((160_000 + 2_000 + 6_000) / 4);
    for (const model of MODEL_CATALOGUE) {
      assert.ok(
        model.contextWindow >= LARGEST_INPUT_TOKENS + DEFAULT_MAX_TOKENS,
        `${model.id} cannot hold the largest request plus its own output`,
      );
    }
  });

  it('prices every model above zero, since the budget gate divides by these', () => {
    for (const model of MODEL_CATALOGUE) {
      assert.ok(model.inputMicroUsd > 0, model.id);
      assert.ok(model.outputMicroUsd > model.inputMicroUsd, model.id);
    }
  });

  it('offers no Claude model that is dearer than a newer one in its tier', () => {
    // The catalogue comment records this as the reason Opus 4.x and Sonnet 4.6
    // are absent. If one is ever added back, this says so.
    const claude = MODEL_CATALOGUE.filter((m) => m.provider === 'anthropic');
    for (const model of claude) {
      assert.ok(
        !/-4-[678]$/.test(model.id) && model.id !== 'claude-sonnet-4-6',
        `${model.id} is superseded at the same or lower price`,
      );
    }
  });

  it('keeps every default model in the catalogue', () => {
    // A default that is not in the closed set is a run that fails after the
    // user has waited for it. This is exactly what went wrong with the old
    // DeepSeek default.
    for (const [provider, id] of Object.entries(DEFAULT_MODELS)) {
      const model = findModel(id);
      assert.ok(
        model,
        `default for ${provider} is "${id}", not in the catalogue`,
      );
      assert.equal(model.provider, provider);
    }
  });
});

describe('effort support', () => {
  it('marks Haiku as rejecting it, and the 1M-context Claudes as accepting', () => {
    assert.equal(findModel('claude-haiku-4-5')?.supportsEffort, false);
    for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1']) {
      assert.equal(findModel(id)?.supportsEffort, true, id);
    }
  });
});

describe('availableModels', () => {
  it('offers only what the deployment holds a key for', () => {
    const anthropicOnly = availableModels({
      anthropic: true,
      deepseek: false,
      openai: false,
    });
    assert.ok(anthropicOnly.length >= 4);
    assert.ok(anthropicOnly.every((m) => m.provider === 'anthropic'));

    const deepseekOnly = availableModels({
      anthropic: false,
      deepseek: true,
      openai: false,
    });
    assert.ok(deepseekOnly.every((m) => m.provider === 'deepseek'));

    assert.deepEqual(
      availableModels({ anthropic: false, deepseek: false, openai: false }),
      [],
    );
  });
});

describe('isKnownModel', () => {
  it('is the closed-set check the wire value is tested against', () => {
    assert.ok(isKnownModel('claude-sonnet-5'));
    assert.ok(!isKnownModel('claude-opus-5-20260401'));
    assert.ok(!isKnownModel('deepseek-v4-flash'));
    assert.ok(!isKnownModel(42));
  });
});

describe('legacy model ids', () => {
  it('every alias resolves to a model that is actually in the catalogue', () => {
    // A dangling alias is worse than no alias: it reads as handled and still
    // filters a policy to nothing. This is the check that fails if a future
    // removal renames the replacement out from under an entry here.
    for (const [legacy, current] of Object.entries(LEGACY_MODEL_IDS)) {
      assert.ok(
        findModel(current),
        `${legacy} points at ${current}, which is not in the catalogue`,
      );
    }
  });

  it('never aliases an id that is still live', () => {
    // An alias for a model that still exists would silently redirect real
    // traffic away from the model someone asked for.
    for (const legacy of Object.keys(LEGACY_MODEL_IDS)) {
      assert.equal(findModel(legacy), null, `${legacy} is still a real model`);
    }
  });

  it('passes unknown and current ids through untouched', () => {
    assert.equal(canonicalModelId('claude-opus-5'), 'claude-opus-5');
    assert.equal(canonicalModelId('not-a-model'), 'not-a-model');
  });
});

describe('cache rates', () => {
  it('prices a cached read at a tenth of the model own input rate', () => {
    const haiku = findModel('claude-haiku-4-5');
    assert.ok(haiku);
    assert.equal(
      cacheRatesFor(haiku).cachedInputMicroUsd,
      haiku.inputMicroUsd * 0.1,
    );
  });

  it('prices an Anthropic cache write above an ordinary input token', () => {
    // The half of caching that is easy to forget: writing a prefix into the
    // cache costs more than not caching it. A breakpoint on content that
    // changes every run pays this and matches nothing.
    const opus = findModel('claude-opus-5');
    assert.ok(opus);
    assert.ok(cacheRatesFor(opus).cacheWriteMicroUsd > opus.inputMicroUsd);
  });

  it('charges nothing extra to write where the provider caches automatically', () => {
    for (const id of ['gpt-6-astra', 'deepseek-flash']) {
      const model = findModel(id);
      assert.ok(model, id);
      assert.equal(
        cacheRatesFor(model).cacheWriteMicroUsd,
        model.inputMicroUsd,
        id,
      );
    }
  });

  it('has rates for every provider a catalogue entry names', () => {
    // A model whose provider is missing here would price its cached tokens
    // as NaN, and a NaN charge settles a reservation at nothing.
    for (const model of MODEL_CATALOGUE) {
      const rates = cacheRatesFor(model);
      assert.ok(Number.isFinite(rates.cachedInputMicroUsd), model.id);
      assert.ok(Number.isFinite(rates.cacheWriteMicroUsd), model.id);
    }
  });
});

describe('how old the catalogue figures are', () => {
  it('fails once the figures have gone unchecked for too long', () => {
    // A deliberate tripwire. Every number in the catalogue is a fact about
    // somebody else's product, and nothing in this repository finds out when
    // they reprice. If this test is what brought you here: open each
    // vendor's pricing and model reference, correct anything that moved,
    // then move CATALOGUE_VERIFIED_ON. Moving the date alone defeats the
    // only mechanism there is.
    const age = catalogueAgeDays();
    assert.ok(
      age <= MAX_CATALOGUE_AGE_DAYS,
      `the model catalogue was last verified ${age} days ago (${CATALOGUE_VERIFIED_ON}); re-check each vendor's pricing and move the date`,
    );
  });

  it('counts the age from the recorded date', () => {
    assert.equal(catalogueAgeDays(new Date('2026-09-13T00:00:00Z')), 0);
    assert.equal(catalogueAgeDays(new Date('2026-09-23T00:00:00Z')), 10);
  });

  it('is not dated in the future', () => {
    // A date ahead of today would hold the tripwire open indefinitely, which
    // is the one way to disable it without deleting anything.
    assert.ok(catalogueAgeDays() >= 0, CATALOGUE_VERIFIED_ON);
  });
});
