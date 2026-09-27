import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contrastRatio } from '@vibld/ai/contrast';
import { oklchToHex } from '@vibld/ai/color-space';
import {
  CHALK,
  DARK,
  GRAPHITE,
  LIGHT,
  PAIRINGS,
  REFUSED,
  VERMILION,
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
    // These are the ones that look reasonable. Vermilion is the brand's
    // colour and the obvious thing to set a heading in; chalk or white is the
    // obvious thing to put on a vermilion button. If a future palette change
    // makes one of these pass, the rule in the brand guide is wrong and should
    // be removed rather than quietly left behind.
    for (const pair of REFUSED) {
      assert.ok(
        ratioFor(pair) < pair.minimum,
        `${pair.what} now measures ${ratioFor(pair).toFixed(2)}, which the brand guide says is impossible`,
      );
    }
  });

  it('measures vermilion on chalk at the figure the guide quotes', () => {
    // Quoted in the brand guide and across the stylesheets. A number in prose
    // that nothing recomputes is a number that goes stale.
    assert.equal(contrastRatio(hex(VERMILION), hex(CHALK))?.toFixed(2), '3.05');
  });

  it('refuses vermilion as text at the bar it actually fails', () => {
    // The awkward part of this palette. Vermilion on chalk clears the 3:1
    // large-text bar, so a refusal written at 3 would itself fail this suite
    // and invite somebody to delete the rule. It is refused at 4.5, which is
    // the bar it fails, and the guide refuses it at every size.
    const ratio = contrastRatio(hex(VERMILION), hex(CHALK)) ?? 0;
    assert.ok(ratio >= 3 && ratio < 4.5, `measures ${ratio.toFixed(2)}`);
    const refusal = REFUSED.find(
      (pair) => pair.foreground === VERMILION && pair.background === CHALK,
    );
    assert.equal(refusal?.minimum, 4.5);
  });

  it('keeps vermilion as the accent in both themes', () => {
    // The mark is the constant. If the accent ever differs between themes the
    // two sites are back to looking like two products.
    assert.deepEqual(LIGHT.accent, VERMILION);
    assert.deepEqual(DARK.accent, VERMILION);
  });

  it('builds the light theme from the named inks', () => {
    // Graphite on chalk is the direction; a light theme that drifted off
    // either would be a third colour nobody chose.
    assert.deepEqual(LIGHT.paper, CHALK);
    assert.deepEqual(LIGHT.ink, GRAPHITE);
    assert.deepEqual(LIGHT.markInk, GRAPHITE);
  });

  it('never lets the offset ghost be the stroke the mark depends on', () => {
    // The mark is legible because of one of its two strokes, and which one
    // changes with the ground. Getting this backwards produces a logo whose
    // shape rests on vermilion, at 3.05 against its own background, which is
    // the mistake the first cut of the previous direction made until this
    // rule failed.
    for (const theme of [LIGHT, DARK]) {
      const ink = contrastRatio(hex(theme.markInk), hex(theme.paper)) ?? 0;
      const ghost = contrastRatio(hex(theme.markOffset), hex(theme.paper)) ?? 0;
      assert.ok(
        ink > ghost,
        'the offset ghost reads more strongly than the stroke carrying the shape',
      );
    }
  });

  it('flips the link ink between themes, because the light one sinks on dark', () => {
    // The deepened vermilion that reads on chalk measures 3.41 on the dark
    // ground, so dark has to carry its own.
    assert.notDeepEqual(DARK.accentInk, LIGHT.accentInk);
    assert.ok(
      (contrastRatio(hex(LIGHT.accentInk), hex(DARK.paper)) ?? 0) < 4.5,
      'the light link ink now reads on dark, so the flip is no longer needed',
    );
  });

  it('never sets a link in the accent itself', () => {
    // The accent ink is a darker or lighter vermilion, never vermilion.
    for (const theme of [LIGHT, DARK]) {
      assert.notDeepEqual(theme.accentInk, theme.accent);
    }
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
    assert.equal(oklch(VERMILION), 'oklch(0.666 0.224 34.3)');
  });
});
