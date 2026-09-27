import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_KNOWLEDGE_CHARS } from '@vibld/ai/limits';
import {
  KNOWLEDGE_KEY,
  loadKnowledge,
  saveKnowledge,
} from '../src/generation/knowledge-store.ts';

/** A localStorage stand-in that can be made to behave badly. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const THROWING = {
  getItem() {
    throw new Error('The operation is insecure.');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('loadKnowledge', () => {
  it('returns what was stored', () => {
    const storage = memoryStorage({ [KNOWLEDGE_KEY]: 'Keep it dark.' });
    assert.equal(loadKnowledge(storage), 'Keep it dark.');
  });

  it('returns nothing when there is nothing', () => {
    assert.equal(loadKnowledge(memoryStorage()), '');
    assert.equal(loadKnowledge(null), '');
  });

  it('survives a storage that throws on read', () => {
    // Private windows and browsers set to block site data throw here rather
    // than returning null. A builder that will not start because it could
    // not read a preference is worse than one that forgets it.
    assert.equal(loadKnowledge(THROWING), '');
  });

  it('truncates a value larger than the current cap', () => {
    // A stored value over the cap can only come from an older, larger limit.
    // Keeping what fits beats discarding someone's instructions entirely.
    const storage = memoryStorage({
      [KNOWLEDGE_KEY]: 'z'.repeat(MAX_KNOWLEDGE_CHARS + 500),
    });
    assert.equal(loadKnowledge(storage).length, MAX_KNOWLEDGE_CHARS);
  });
});

describe('saveKnowledge', () => {
  it('round-trips through the store', () => {
    const storage = memoryStorage();
    saveKnowledge('No rounded corners.', storage);
    assert.equal(loadKnowledge(storage), 'No rounded corners.');
  });

  it('clears the key rather than storing emptiness', () => {
    const storage = memoryStorage({ [KNOWLEDGE_KEY]: 'old' });
    saveKnowledge('   ', storage);
    assert.equal(storage.map.has(KNOWLEDGE_KEY), false);
  });

  it('survives a full or blocked store', () => {
    // Not worth failing a generation over.
    assert.doesNotThrow(() => saveKnowledge('anything', THROWING));
    assert.doesNotThrow(() => saveKnowledge('anything', null));
  });

  it('never stores more than the cap', () => {
    const storage = memoryStorage();
    saveKnowledge('q'.repeat(MAX_KNOWLEDGE_CHARS + 100), storage);
    assert.equal(storage.map.get(KNOWLEDGE_KEY)!.length, MAX_KNOWLEDGE_CHARS);
  });
});
