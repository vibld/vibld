import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contrastRatio } from '@vibld/ai/contrast';
import { oklchToHex } from '@vibld/ai/color-space';
import {
  CORAL,
  DARK,
  LIGHT,
  NEWSPRINT,
  PAIRINGS,
  REFUSED,
  ULTRAMARINE,
  oklch,
} from '../src/palette.ts';
import type { Oklch, Pairing } from '../src/palette.ts';

/**
 * The palette's claims, recomputed.
 *
 * A palette is a set of claims about legibility, and in a stylesheet they are
 * unfalsifiable: nobody notices a token nudged two points of lightness until
 * somebody cannot read a page. These run the same contrast checker the
 * generator already uses on model output, against the brand's own colours.
 */

function hex({ l, c, h }: Oklch): string {
  return oklchToHex(l, c, h);
}

function ratioFor(pair: Pairing): number {
  const ratio = contrastRatio(hex(pair.foreground), hex(pair.background));
  assert.ok(ratio !== null, `could not measure ${pair.what}`);
  return ratio;
}

describe('the Vibld palette', () => {
  it('clears its own bar on every pairing it claims', () => {
    const failures = PAIRINGS.filter(
      (pair) => ratioFor(pair) < pair.minimum,
    ).map(
      (pair) => `${pair.what}: ${ratioFor(pair).toFixed(2)} < ${pair.minimum}`,
    );
    assert.deepEqual(failures, []);
  });

  it('checks a list long enough to cover both themes', () => {
    // The rule above passes trivially on an empty list, which is what a
    // refactor that drops a token would leave behind.
    assert.ok(PAIRINGS.length >= 12, `only ${PAIRINGS.length} pairings`);
  });

  it('still refuses the pairings it says are illegible', () => {
    // These are the ones that look reasonable. Coral is the brand's colour
    // and the obvious thing to set a heading in; newsprint is the obvious
    // thing to put on a coral button. If a future palette change makes one of
    // these pass, the rule in the brand guide is wrong and should be removed
    // rather than quietly left behind.
    for (const pair of REFUSED) {
      assert.ok(
        ratioFor(pair) < pair.minimum,
        `${pair.what} now measures ${ratioFor(pair).toFixed(2)}, which the brand guide says is impossible`,
      );
    }
  });

  it('measures coral on newsprint at the figure the guide quotes', () => {
    // Quoted in the brand guide and on the marketing page. A number in prose
    // that nothing recomputes is a number that goes stale.
    assert.equal(contrastRatio(hex(CORAL), hex(NEWSPRINT))?.toFixed(2), '2.60');
  });

  it('keeps coral as the accent in both themes', () => {
    // The mark is the constant. If the accent ever differs between themes the
    // two sites are back to looking like two products.
    assert.deepEqual(LIGHT.accent, CORAL);
    assert.deepEqual(DARK.accent, CORAL);
  });

  it('never lets the offset ghost be the stroke the mark depends on', () => {
    // The mark is legible because of one of its two strokes, and which one
    // changes with the ground. Getting this backwards produces a logo at
    // 2.60 against its own background, which is what the first cut did until
    // the rule above failed.
    for (const theme of [LIGHT, DARK]) {
      const ink = contrastRatio(hex(theme.markInk), hex(theme.paper)) ?? 0;
      const ghost = contrastRatio(hex(theme.markOffset), hex(theme.paper)) ?? 0;
      assert.ok(
        ink > ghost,
        'the offset ghost reads more strongly than the stroke carrying the shape',
      );
    }
  });

  it('flips the link ink between themes, because ultramarine cannot survive dark', () => {
    assert.deepEqual(LIGHT.accentInk, ULTRAMARINE);
    assert.notDeepEqual(DARK.accentInk, ULTRAMARINE);
  });

  it('carries a hex that is the same colour, for renderers without oklch', () => {
    // Not a second decision, a second encoding. The first social card this
    // palette produced was entirely black, because librsvg does not parse
    // oklch() and falls back to black instead of failing.
    const seen = new Set<string>();
    for (const theme of [LIGHT, DARK]) {
      for (const value of Object.values(theme)) {
        // A theme carries the blend mode as well as its colours.
        if (typeof value !== 'object') continue;
        const colour = value;
        const key = `${colour.l} ${colour.c} ${colour.h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assert.equal(
          colour.hex,
          oklchToHex(colour.l, colour.c, colour.h),
          `hex for oklch(${key}) is wrong`,
        );
      }
    }
    assert.ok(seen.size >= 8, `only checked ${seen.size} colours`);
  });

  it('emits a css colour a browser will accept', () => {
    assert.equal(oklch(CORAL), 'oklch(0.7 0.18 25)');
  });
});
