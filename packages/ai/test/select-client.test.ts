import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  configuredProviders,
  createPlanClient,
  providerForRequest,
  defaultModelFor,
  resolveModel,
  selectProvider,
} from '../src/select-client.ts';

describe('selectProvider', () => {
  it('obeys an explicit choice', () => {
    // ADR-0007 asks for the intended provider to be configured rather than
    // resolved by an implicit default.
    assert.equal(selectProvider({ VIBLD_PROVIDER: 'deepseek' }), 'deepseek');
    assert.equal(selectProvider({ VIBLD_PROVIDER: 'anthropic' }), 'anthropic');
    assert.equal(selectProvider({ VIBLD_PROVIDER: ' DeepSeek ' }), 'deepseek');
  });

  it('refuses a name it does not know, rather than falling back silently', () => {
    // Silently running Anthropic for someone who typed "deepsek" would spend
    // forty times as much as they meant to.
    assert.throws(
      () => selectProvider({ VIBLD_PROVIDER: 'deepsek' }),
      /must be one of anthropic, deepseek, openai/,
    );
  });

  it('infers from the only key present', () => {
    assert.equal(selectProvider({ DEEPSEEK_API_KEY: 'k' }), 'deepseek');
    assert.equal(selectProvider({ ANTHROPIC_API_KEY: 'k' }), 'anthropic');
  });

  it('keeps Anthropic when both keys are set and nothing says which', () => {
    // The cheaper provider must not quietly take over a run someone is
    // measuring; choosing it has to be deliberate.
    assert.equal(
      selectProvider({ ANTHROPIC_API_KEY: 'a', DEEPSEEK_API_KEY: 'd' }),
      'anthropic',
    );
  });

  it('an explicit choice still wins over the keys present', () => {
    assert.equal(
      selectProvider({
        VIBLD_PROVIDER: 'deepseek',
        ANTHROPIC_API_KEY: 'a',
        DEEPSEEK_API_KEY: 'd',
      }),
      'deepseek',
    );
  });

  it('defaults to Anthropic with no configuration at all', () => {
    assert.equal(selectProvider({}), 'anthropic');
  });
});

describe('defaultModelFor', () => {
  it('gives each provider its own model, never the other one’s', () => {
    // Sending "claude-opus-5" to DeepSeek is a 400 that reads like an outage.
    assert.equal(defaultModelFor('deepseek'), 'deepseek-flash');
    assert.equal(defaultModelFor('anthropic'), 'claude-opus-5');
  });
});

describe('createPlanClient', () => {
  it('builds the client the selection names', () => {
    assert.equal(
      createPlanClient({ VIBLD_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k' })
        .id,
      'deepseek',
    );
    assert.equal(
      createPlanClient({ VIBLD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
        .id,
      'anthropic',
    );
  });
});

describe('resolveModel', () => {
  it('uses an override when there is one', () => {
    assert.equal(
      resolveModel({
        VIBLD_PROVIDER: 'deepseek',
        VIBLD_MODEL: 'deepseek-v4-pro',
      }),
      'deepseek-v4-pro',
    );
  });

  it('treats a blank override as unset', () => {
    // A blank optional workflow input arrives as "", not as an absent
    // variable. `??` keeps it, and the request goes out with model: "" --
    // a 400 that reads like an outage, found only once money is on the line.
    for (const blank of ['', '   ', '\n']) {
      assert.equal(
        resolveModel({ VIBLD_PROVIDER: 'deepseek', VIBLD_MODEL: blank }),
        'deepseek-flash',
      );
    }
  });

  it('falls back to the selected provider, never the other one', () => {
    assert.equal(resolveModel({ DEEPSEEK_API_KEY: 'k' }), 'deepseek-flash');
    assert.equal(resolveModel({ ANTHROPIC_API_KEY: 'k' }), 'claude-opus-5');
  });

  it('trims an override rather than sending stray whitespace', () => {
    assert.equal(
      resolveModel({ VIBLD_MODEL: ' deepseek-v4-pro ' }),
      'deepseek-v4-pro',
    );
  });
});

describe('providerForRequest', () => {
  it('lets the chosen model decide, not the deployment default', () => {
    // A run asking for deepseek-v4-pro must not be answered by Anthropic
    // because that is what the deployment happens to default to.
    assert.equal(
      providerForRequest(
        { VIBLD_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a' },
        'deepseek-v4-pro',
      ),
      'deepseek',
    );
    assert.equal(
      providerForRequest(
        { VIBLD_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' },
        'claude-opus-5',
      ),
      'anthropic',
    );
  });

  it('falls back to the deployment when no model was chosen', () => {
    assert.equal(
      providerForRequest({ VIBLD_PROVIDER: 'deepseek' }, null),
      'deepseek',
    );
    assert.equal(providerForRequest({ ANTHROPIC_API_KEY: 'a' }), 'anthropic');
  });

  it('ignores a model it does not know rather than guessing', () => {
    assert.equal(
      providerForRequest({ VIBLD_PROVIDER: 'deepseek' }, 'gpt-5'),
      'deepseek',
    );
  });
});

describe('configuredProviders', () => {
  it('reports which keys the deployment holds', () => {
    assert.deepEqual(configuredProviders({ DEEPSEEK_API_KEY: 'k' }), {
      anthropic: false,
      deepseek: true,
      openai: false,
    });
    assert.deepEqual(configuredProviders({}), {
      anthropic: false,
      deepseek: false,
      openai: false,
    });
  });
});
