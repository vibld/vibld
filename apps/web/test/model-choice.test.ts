import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MODEL_CHOICE_KEY,
  chooseModel,
  loadModelChoice,
  saveModelChoice,
} from '../src/generation/model-choice-store.ts';
import type { ModelChoiceStorage } from '../src/generation/model-choice-store.ts';
import { applyDeploymentConfig } from '../src/useBuilderSession.ts';
import type { DeploymentConfig } from '../src/generation/remote-provider.ts';

/**
 * The picker kept going back to the default (Chris, 2026-09-28). Clerk
 * reports every token refresh as a session change, the shell re-probed the
 * deployment on each one, and the probe set the default model every time,
 * so a choice lasted about a minute. The choice now survives a re-probe and
 * a reload, and is still only a preference: the deployment's own list
 * decides whether it can be used.
 */

function memoryStorage(): ModelChoiceStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const offered = [{ id: 'deepseek-flash' }, { id: 'gpt-6-sol' }];

describe('choosing the model to show', () => {
  it('keeps a choice the deployment still offers', () => {
    assert.equal(
      chooseModel('deepseek-flash', offered, 'gpt-6-sol'),
      'deepseek-flash',
    );
  });

  it('falls back to the default for a choice no longer offered', () => {
    assert.equal(
      chooseModel('retired-model', offered, 'gpt-6-sol'),
      'gpt-6-sol',
    );
  });

  it('uses the default when nothing was chosen', () => {
    assert.equal(chooseModel(null, offered, 'gpt-6-sol'), 'gpt-6-sol');
  });
});

describe('remembering the choice', () => {
  it('saves and loads it', () => {
    const storage = memoryStorage();
    saveModelChoice('gpt-6-sol', storage);
    assert.equal(storage.map.get(MODEL_CHOICE_KEY), 'gpt-6-sol');
    assert.equal(loadModelChoice(storage), 'gpt-6-sol');
  });

  it('forgets it when the choice is cleared', () => {
    const storage = memoryStorage();
    saveModelChoice('gpt-6-sol', storage);
    saveModelChoice(null, storage);
    assert.equal(loadModelChoice(storage), null);
  });

  it('survives a storage that throws', () => {
    const throwing: ModelChoiceStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(loadModelChoice(throwing), null);
    assert.doesNotThrow(() => saveModelChoice('gpt-6-sol', throwing));
  });
});

describe('a re-probe of the deployment', () => {
  const ANSWER: DeploymentConfig = {
    generation: 'model',
    models: [
      { id: 'deepseek-flash', label: 'Flash', note: '', provider: 'd' },
      { id: 'gpt-6-sol', label: 'Sol', note: '', provider: 'o' },
    ],
    defaultModel: 'gpt-6-sol',
    isAdmin: false,
  };

  function session(): {
    model: string | null;
    setModels(): void;
    setModel(model: string | null): void;
    setIsAdmin(): void;
    setGeneration(): void;
  } {
    return {
      model: null,
      setModels() {},
      setModel(model) {
        this.model = model;
      },
      setIsAdmin() {},
      setGeneration() {},
    };
  }

  it('keeps the model this person picked', async () => {
    const s = session();
    await applyDeploymentConfig(
      s,
      async () => ANSWER,
      () => 'deepseek-flash',
    );
    assert.equal(s.model, 'deepseek-flash');
  });

  it('shows the default when nothing was picked', async () => {
    const s = session();
    await applyDeploymentConfig(
      s,
      async () => ANSWER,
      () => null,
    );
    assert.equal(s.model, 'gpt-6-sol');
  });
});
