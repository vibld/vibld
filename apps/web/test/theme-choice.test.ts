import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyThemeChoice,
  nextChoice,
  readThemeChoice,
  showingDark,
  writeThemeChoice,
} from '../src/theme/theme-choice.ts';

/** A `Storage` that can also be made to throw, the way a private window does. */
function storage(options: { throws?: boolean; seed?: string } = {}) {
  const values = new Map<string, string>();
  if (options.seed) values.set('vibld.theme', options.seed);
  return {
    getItem(key: string) {
      if (options.throws) throw new Error('blocked');
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options.throws) throw new Error('blocked');
      values.set(key, value);
    },
    removeItem(key: string) {
      if (options.throws) throw new Error('blocked');
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key: () => null,
    length: 0,
    read: () => values.get('vibld.theme') ?? null,
  } as unknown as Storage & { read: () => string | null };
}

function root() {
  const attributes = new Map<string, string>();
  return {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    get: (name: string) => attributes.get(name) ?? null,
  };
}

describe('remembering a theme', () => {
  it('defaults to following the system', () => {
    assert.equal(readThemeChoice(storage()), 'system');
  });

  it('reads back what was chosen', () => {
    const store = storage();
    writeThemeChoice('dark', store);
    assert.equal(readThemeChoice(store), 'dark');
  });

  it('forgets the choice rather than storing "system"', () => {
    // The absence is what the stylesheet's media query keys on. Storing the
    // word would be a third value for something with two stored states.
    const store = storage({ seed: 'dark' });
    writeThemeChoice('system', store);
    assert.equal(store.read(), null);
  });

  it('ignores a stored value it does not recognise', () => {
    assert.equal(readThemeChoice(storage({ seed: 'neon' })), 'system');
  });

  it('survives storage that throws, which is a private window', () => {
    // Reading a preference must never be what stops the builder rendering.
    assert.equal(readThemeChoice(storage({ throws: true })), 'system');
    assert.doesNotThrow(() =>
      writeThemeChoice('dark', storage({ throws: true })),
    );
  });

  it('survives having no storage at all', () => {
    assert.equal(readThemeChoice(null), 'system');
    assert.doesNotThrow(() => writeThemeChoice('dark', null));
  });
});

describe('putting the choice on the document', () => {
  it('stamps an explicit choice', () => {
    const element = root();
    applyThemeChoice('dark', element);
    assert.equal(element.get('data-theme'), 'dark');
    applyThemeChoice('light', element);
    assert.equal(element.get('data-theme'), 'light');
  });

  it('removes the attribute for system rather than naming it', () => {
    // `data-theme="system"` matches neither selector, which leaves the page
    // on whatever the bare :root defines instead of following the OS.
    const element = root();
    applyThemeChoice('dark', element);
    applyThemeChoice('system', element);
    assert.equal(element.get('data-theme'), null);
  });
});

describe('pressing the toggle', () => {
  it('takes the opposite of what is on screen', () => {
    // From "system" the control has to act on what the person can see, not
    // on the stored value, or the first press appears to do nothing.
    assert.equal(nextChoice('system', true), 'light');
    assert.equal(nextChoice('system', false), 'dark');
  });

  it('flips an explicit choice', () => {
    assert.equal(nextChoice('dark', false), 'light');
    assert.equal(nextChoice('light', true), 'dark');
  });

  it('never lands on system, which nobody could predict', () => {
    for (const from of ['system', 'light', 'dark'] as const) {
      for (const dark of [true, false]) {
        assert.notEqual(nextChoice(from, dark), 'system');
      }
    }
  });
});

describe('what is on screen', () => {
  it('follows the system when nothing was chosen', () => {
    assert.equal(showingDark('system', true), true);
    assert.equal(showingDark('system', false), false);
  });

  it('follows the choice over the system, both ways', () => {
    assert.equal(showingDark('light', true), false);
    assert.equal(showingDark('dark', false), true);
  });
});
