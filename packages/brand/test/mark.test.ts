import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DARK, LIGHT, oklch } from '../src/palette.ts';
import {
  CHEVRON,
  MIN_OVERPRINT_SIZE,
  REGISTER_OFFSET,
  WORDMARK,
  markSvg,
} from '../src/mark.ts';

describe('the mark', () => {
  it('prints the same chevron twice, out of register', () => {
    const svg = markSvg({ size: 32 });
    assert.ok(svg.includes(CHEVRON), 'the first impression is not the chevron');
    assert.ok(
      svg.includes(`M${6 + REGISTER_OFFSET} ${9 + REGISTER_OFFSET}l9 15 9-15`),
      'the second impression is not the same shape, offset',
    );
  });

  it('overprints rather than covering', () => {
    // Without multiply the second ink simply hides the first where they
    // cross, and the whole direction is gone.
    assert.match(markSvg({ size: 32 }), /mix-blend-mode:multiply/);
  });

  it('draws the ghost first, so the load-bearing ink is on top', () => {
    const svg = markSvg({ size: 32 });
    assert.ok(
      svg.indexOf(oklch(LIGHT.markOffset)) < svg.indexOf(oklch(LIGHT.markInk)),
      'the ghost is painted over the stroke that carries the shape',
    );
  });

  it('falls back to the ink, never to the ghost', () => {
    // A monochrome favicon throws the overprint away. Falling back to coral
    // would leave a mark at 2.60 against its own paper.
    const mono = markSvg({ size: 16, mono: true });
    assert.ok(mono.includes(oklch(LIGHT.markInk)));
    assert.ok(!mono.includes(oklch(LIGHT.markOffset)));
    assert.ok(!mono.includes('multiply'), 'nothing to blend with one ink');
  });

  it('takes its inks from the theme it is drawn for', () => {
    assert.ok(markSvg({ size: 32, theme: DARK }).includes(oklch(DARK.markInk)));
  });

  it('is hidden from assistive technology unless it is given a name', () => {
    // It sits next to the wordmark almost everywhere, and a mark announced
    // twice is worse than one announced not at all.
    assert.match(markSvg({ size: 24 }), /aria-hidden="true"/);
    const named = markSvg({ size: 24, title: 'Vibld' });
    assert.match(named, /<title>Vibld<\/title>/);
    assert.ok(!named.includes('aria-hidden'));
  });

  it('keeps the wordmark lowercase', () => {
    assert.equal(WORDMARK, WORDMARK.toLowerCase());
  });

  it('knows the size below which the overprint stops reading', () => {
    // Two units of offset in a 32-unit box is under half a pixel below this.
    assert.ok(MIN_OVERPRINT_SIZE >= 16);
  });
});
