import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_CATALOGUE,
  availableModels,
  findModel,
  isKnownModel,
} from '../src/model-catalogue.ts';
import { DEFAULT_MODELS } from '../src/select-client.ts';

describe('the catalogue', () => {
  it('gives every model a distinct id', () => {
    const ids = MODEL_CATALOGUE.map((model) => model.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('prices every model, above zero', () => {
    // A zero price makes a run free and the spend ceiling unreachable.
    for (const model of MODEL_CATALOGUE) {
      assert.ok(model.inputMicroUsd > 0, model.id);
      assert.ok(model.outputMicroUsd > 0, model.id);
      assert.ok(model.label.length > 0);
      assert.ok(model.note.length > 0);
    }
  });

  it('contains each provider default, so a default is always selectable', () => {
    for (const id of Object.values(DEFAULT_MODELS)) {
      assert.ok(findModel(id), `${id} is a default but not in the catalogue`);
    }
  });
});

describe('isKnownModel', () => {
  it('accepts what it publishes and nothing else', () => {
    for (const model of MODEL_CATALOGUE) {
      assert.equal(isKnownModel(model.id), true);
    }
    for (const value of [
      'gpt-5',
      'Claude Opus 5',
      '',
      null,
      undefined,
      42,
      { id: 'claude-opus-5' },
      'toString',
      '__proto__',
    ]) {
      assert.equal(isKnownModel(value), false, JSON.stringify(value));
    }
  });
});

describe('availableModels', () => {
  it('offers only what the deployment holds a key for', () => {
    // Offering a model whose provider has no key produces a run that fails
    // after the user has already waited for it.
    const deepseekOnly = availableModels({ anthropic: false, deepseek: true });
    assert.ok(deepseekOnly.length > 0);
    assert.ok(deepseekOnly.every((model) => model.provider === 'deepseek'));

    const anthropicOnly = availableModels({ anthropic: true, deepseek: false });
    assert.ok(anthropicOnly.every((model) => model.provider === 'anthropic'));
  });

  it('offers nothing when nothing is configured', () => {
    assert.deepEqual(
      availableModels({ anthropic: false, deepseek: false }),
      [],
    );
  });

  it('offers everything when both are configured', () => {
    assert.equal(
      availableModels({ anthropic: true, deepseek: true }).length,
      MODEL_CATALOGUE.length,
    );
  });
});
