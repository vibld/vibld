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

/**
 * Comments stripped before anything reads the file.
 *
 * Without this the guard reads a commented-out declaration as an active one,
 * so a palette edit that comments a token out while leaving its old text
 * behind passes both the value comparison and the presence check while the
 * browser has no such declaration. A drift guard a comment can satisfy is not
 * a guard.
 */
function live(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = live(
  readFileSync(join(import.meta.dirname, '..', 'src', 'brand.css'), 'utf8'),
);

/** The `:root` block, and the one inside the dark media query. */
function blockFor(theme: 'light' | 'dark', css = CSS): string {
  if (theme === 'light') return css.slice(0, css.indexOf('@media'));
  return css.slice(css.indexOf('@media'));
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

  it('does not read a commented-out declaration as a live one', () => {
    // Run against a stylesheet shaped like a half-finished palette edit: the
    // real token live, an old value left behind in a comment. Reading the
    // comment would let a token the browser never sees satisfy this guard.
    const stylesheet = `
      :root {
        --vibld-paper: oklch(0.96 0.012 90);
        /* --vibld-paper: oklch(0.5 0 0); */
      }
      @media (prefers-color-scheme: dark) {
        :root { --vibld-ink: oklch(0.96 0.012 90); }
      }
    `;

    const parsed = live(stylesheet);
    assert.equal(parsed.includes('oklch(0.5 0 0)'), false);
    assert.match(blockFor('light', parsed), /--vibld-paper: oklch\(0\.96/);
  });

  it('would notice a token that exists only in a comment', () => {
    const stylesheet = `
      :root {
        /* --vibld-surface: oklch(0.93 0.014 90); */
      }
      @media (prefers-color-scheme: dark) { :root { } }
    `;
    assert.equal(live(stylesheet).includes('--vibld-surface'), false);
  });

  it('checks enough tokens to mean something', () => {
    assert.ok(TOKENS.length >= 10);
  });
});
