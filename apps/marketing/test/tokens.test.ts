import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { contrastRatio } from '@vibld/ai/contrast';
import { DARK, LIGHT } from '@vibld/brand/palette';
import type { Theme } from '@vibld/brand/palette';

import { blend } from './blend.ts';

/**
 * Every text pair the Live Build design introduces, measured.
 *
 * The brand (packages/brand) proves the pairs it lists. This design sets
 * text on surfaces the brand's list does not cover (muted ink on the raised
 * surface, the link ink on a card, ink on six pale tints, highlighted code
 * on a dark block), and a pairing nobody measured is a claim nobody checked.
 *
 * The tints and code colours are read out of app.css itself, so this cannot
 * pass while the stylesheet ships something else. The brand's side is read
 * from @vibld/brand/palette, so when the brand is recoloured these are
 * measured again against the new ink without anyone having to remember.
 */

const CSS = readFileSync(
  join(import.meta.dirname, '..', 'app', 'app.css'),
  'utf8',
);

/** The --mk-* declarations inside the first block that `opener` starts. */
function block(opener: string): Map<string, string> {
  const start = CSS.indexOf(opener);
  assert.notEqual(start, -1, `app.css has no block ${opener}`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return new Map(
    [...body.matchAll(/--mk-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );
}

const THEMES: { name: string; brand: Theme; mk: Map<string, string> }[] = [
  { name: 'light', brand: LIGHT, mk: block(':root {\n  color-scheme') },
  {
    name: 'dark',
    brand: DARK,
    mk: block(":root:not([data-theme='light']) {"),
  },
];

const TINTS = ['peach', 'mint', 'sun', 'sky', 'rose', 'sand'];
const CODE_INKS = ['ink', 'dim', 'key', 'str', 'tag', 'num', 'ok', 'bad'];

function ratio(foreground: string, background: string): number {
  const value = contrastRatio(foreground, background);
  assert.ok(value !== null, `unparseable: ${foreground} on ${background}`);
  return value;
}

describe('the marketing-local tokens', () => {
  it('declares every token in both themes, identically in both dark blocks', () => {
    const forced = block(":root[data-theme='dark'] {");
    for (const theme of THEMES) {
      for (const tint of TINTS) {
        assert.ok(theme.mk.has(`tint-${tint}`), `${theme.name}: tint-${tint}`);
      }
      for (const ink of CODE_INKS) {
        assert.ok(theme.mk.has(`code-${ink}`), `${theme.name}: code-${ink}`);
      }
      assert.ok(theme.mk.has('code'), `${theme.name}: code`);
      assert.ok(theme.mk.has('ok'), `${theme.name}: ok`);
    }
    // The system's dark and the chosen dark are one decision written twice,
    // because CSS cannot apply one block from two conditions.
    assert.deepEqual(forced, THEMES[1]!.mk);
  });

  for (const theme of THEMES) {
    it(`sets the brand's ink and muted ink on every tint at 4.5:1, ${theme.name}`, () => {
      for (const tint of TINTS) {
        const fill = theme.mk.get(`tint-${tint}`)!;
        for (const [what, ink] of [
          ['ink', theme.brand.ink.hex],
          ['muted ink', theme.brand.inkMuted.hex],
        ] as const) {
          const value = ratio(ink, fill);
          assert.ok(
            value >= 4.5,
            `${theme.name}: ${what} on tint-${tint} is ${value.toFixed(2)}`,
          );
        }
      }
    });

    it(`highlights code at 4.5:1 on the code ground, ${theme.name}`, () => {
      const ground = theme.mk.get('code')!;
      for (const ink of CODE_INKS) {
        const value = ratio(theme.mk.get(`code-${ink}`)!, ground);
        assert.ok(
          value >= 4.5,
          `${theme.name}: code-${ink} is ${value.toFixed(2)}`,
        );
      }
      // The file tab: code ink on a 10% wash of itself over the ground.
      const tab = blend(theme.mk.get('code-ink')!, 0.1, ground);
      assert.ok(ratio(theme.mk.get('code-ink')!, tab) >= 4.5);
    });

    it(`sets "passed" green as text at 4.5:1 on paper and surface, ${theme.name}`, () => {
      for (const fill of [theme.brand.paper, theme.brand.surface]) {
        const value = ratio(theme.mk.get('ok')!, fill.hex);
        assert.ok(value >= 4.5, `${theme.name}: ok is ${value.toFixed(2)}`);
      }
    });
  }
});

describe('the brand pairs the design relies on', () => {
  for (const theme of THEMES) {
    it(`measures each at 4.5:1, ${theme.name}`, () => {
      const b = theme.brand;
      const pairs: [string, string, string][] = [
        ['ink on paper', b.ink.hex, b.paper.hex],
        ['ink on surface', b.ink.hex, b.surface.hex],
        ['ink on the raised surface', b.ink.hex, b.surfaceStrong.hex],
        ['muted ink on paper', b.inkMuted.hex, b.paper.hex],
        ['muted ink on surface', b.inkMuted.hex, b.surface.hex],
        [
          'muted ink on the raised surface',
          b.inkMuted.hex,
          b.surfaceStrong.hex,
        ],
        ['link ink on paper', b.accentInk.hex, b.paper.hex],
        ['link ink on surface', b.accentInk.hex, b.surface.hex],
        ['paper on ink (a pressed chip)', b.paper.hex, b.ink.hex],
        ['ink on a vermilion fill', b.onAccent.hex, b.accent.hex],
      ];
      for (const [what, foreground, background] of pairs) {
        const value = ratio(foreground, background);
        assert.ok(
          value >= 4.5,
          `${theme.name}: ${what} is ${value.toFixed(2)}`,
        );
      }
    });

    it(`keeps the header legible over whatever scrolls under it, ${theme.name}`, () => {
      // The header is 94% paper over the page, blurred. The darkest thing
      // that passes under it in light mode is a code block, and the lightest
      // in dark mode is a white card inside a miniature site.
      const live = readFileSync(
        join(import.meta.dirname, '..', 'app', 'styles', 'live.css'),
        'utf8',
      );
      const header = live.slice(live.indexOf('.lb-nav__in {'));
      assert.match(
        header.slice(0, header.indexOf('}')),
        /var\(--color-paper\) 94%/,
        'the header wash changed; measure the new one here',
      );
      const under = theme.name === 'light' ? theme.mk.get('code')! : '#FFFFFF';
      const wash = blend(theme.brand.paper.hex, 0.94, under);
      for (const [what, ink] of [
        ['muted ink', theme.brand.inkMuted.hex],
        ['link ink', theme.brand.accentInk.hex],
      ] as const) {
        const value = ratio(ink, wash);
        assert.ok(
          value >= 4.5,
          `${theme.name}: ${what} is ${value.toFixed(2)}`,
        );
      }
    });
  }
});
