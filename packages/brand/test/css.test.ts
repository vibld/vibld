import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DARK, LIGHT, oklch } from '../src/palette.ts';
import type { Theme } from '../src/palette.ts';

/**
 * The stylesheet and the palette, checked against each other.
 *
 * Two representations of one decision is a drift risk by construction, and
 * the palette's whole value is that its claims are measured. A CSS file that
 * has quietly moved away from the values the contrast tests check is worse
 * than no tests at all, because it looks covered.
 */

const CSS = readFileSync(
  join(import.meta.dirname, '..', 'src', 'brand.css'),
  'utf8',
);

/** The `:root` block, and the one inside the dark media query. */
function blockFor(theme: 'light' | 'dark'): string {
  if (theme === 'light') return CSS.slice(0, CSS.indexOf('@media'));
  return CSS.slice(CSS.indexOf('@media'));
}

function tokenIn(block: string, name: string): string | undefined {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return match?.[1]?.trim();
}

/** Dark redefines only what changes, so an absent token means "same as light". */
function resolved(theme: 'light' | 'dark', name: string): string | undefined {
  if (theme === 'light') return tokenIn(blockFor('light'), name);
  return tokenIn(blockFor('dark'), name) ?? tokenIn(blockFor('light'), name);
}

const TOKENS: [keyof Theme, string][] = [
  ['paper', 'vibld-paper'],
  ['surface', 'vibld-surface'],
  ['surfaceStrong', 'vibld-surface-strong'],
  ['ink', 'vibld-ink'],
  ['inkMuted', 'vibld-ink-muted'],
  ['accent', 'vibld-accent'],
  ['accentInk', 'vibld-accent-ink'],
  ['onAccent', 'vibld-on-accent'],
  ['markInk', 'vibld-mark-ink'],
  ['markOffset', 'vibld-mark-offset'],
];

describe('brand.css', () => {
  it('flips the blend mode with the theme', () => {
    // A blend baked in at render time cannot follow the ground, and the wrong
    // one erases the mark rather than looking slightly off.
    assert.equal(
      tokenIn(blockFor('light'), 'vibld-mark-blend'),
      LIGHT.markBlend,
    );
    assert.equal(tokenIn(blockFor('dark'), 'vibld-mark-blend'), DARK.markBlend);
  });

  for (const [theme, source] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    it(`matches the ${theme} palette on every token`, () => {
      const wrong = TOKENS.filter(
        ([key, name]) => resolved(theme, name) !== oklch(source[key]),
      ).map(
        ([key, name]) =>
          `--${name} is ${resolved(theme, name)}, palette says ${oklch(source[key])} (${key})`,
      );
      assert.deepEqual(wrong, []);
    });
  }

  it('declares every token in the light block, not only under a media query', () => {
    // A token defined only inside `prefers-color-scheme: dark` is undefined
    // for every reader who is not in dark mode, which renders one theme's
    // text on the other theme's ground.
    const light = blockFor('light');
    for (const [, name] of TOKENS) {
      assert.ok(tokenIn(light, name), `--${name} has no light value`);
    }
  });

  it('checks enough tokens to mean something', () => {
    assert.ok(TOKENS.length >= 10);
  });
});
