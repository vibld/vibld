import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_CATALOGUE,
  availableModels,
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
