import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contrastRatio } from '../src/contrast.ts';
import {
  hexToHsl,
  hslToHex,
  normaliseHue,
  readableOn,
  shadeAgainst,
  shadeMeeting,
  shiftLightness,
} from '../src/color-space.ts';

describe('hex and HSL', () => {
  it('round-trips a colour without drift', () => {
    // Drift here would move every derived palette slightly off the hue its
    // seed names, which is the kind of error nobody sees and everybody
    // inherits.
    for (const hex of [
      '#ff8b3d',
      '#74e2c0',
      '#5b3be8',
      '#151210',
      '#faf6ef',
      '#ffffff',
      '#000000',
      '#7f7f7f',
    ]) {
      const hsl = hexToHsl(hex);
      assert.ok(hsl, hex);
      assert.equal(hslToHex(hsl), hex.toLowerCase(), hex);
    }
  });

  it('refuses anything that is not a six-digit hex', () => {
    for (const value of ['#fff', 'red', 'rgb(1,2,3)', '', '#gggggg']) {
      assert.equal(hexToHsl(value), null, value);
    }
  });

  it('wraps a hue in both directions', () => {
    assert.equal(normaliseHue(370), 10);
    assert.equal(normaliseHue(-30), 330);
    assert.equal(normaliseHue(0), 0);
  });
});

describe('shadeMeeting', () => {
  it('returns a shade that actually clears the ratio it was given', () => {
    // The regression that matters. The first version named its two search
    // bounds "far" and "near" and then updated each with the other's value,
    // so a passing probe moved the failing bound. It still returned a
    // colour, and the colour failed: eight of twelve hues came back below
    // 4.5:1 against a near-white ground while the function reported success.
    for (const ground of ['#faf8f5', '#14120f', '#7a7a7a']) {
      for (let hue = 0; hue < 360; hue += 15) {
        for (const saturation of [30, 70, 95]) {
          const shade = shadeAgainst(hue, saturation, ground, 4.5);
          assert.ok(
            shade,
            `no shade for hue ${hue}/${saturation} on ${ground}`,
          );
          const ratio = contrastRatio(shade, ground);
          assert.ok(
            ratio !== null && ratio >= 4.5,
            `hue ${hue}/${saturation} on ${ground} came back at ${ratio}`,
          );
        }
      }
    }
  });

  it('finds the least extreme shade that passes, not the most', () => {
    // What keeps a derived palette from being black text and nothing else:
    // muted text is solved at exactly the floor, so it sits as close to the
    // page as it is allowed to.
    const shade = shadeAgainst(24, 70, '#faf8f5', 4.5);
    assert.ok(shade);
    const ratio = contrastRatio(shade, '#faf8f5');
    assert.ok(
      ratio !== null && ratio >= 4.5 && ratio < 5.2,
      `ratio was ${ratio}`,
    );
  });

  it('says so when a hue cannot reach the ratio at all', () => {
    // Nothing yellow is dark enough to clear 12:1 against white while still
    // being yellow. Returning null is what lets `derivePalette` refuse a
    // seed instead of shipping a page nobody can read.
    assert.equal(shadeMeeting(60, 95, '#ffffff', 12, 'lighter'), null);
  });
});

describe('readableOn', () => {
  it('picks the side that reads and reports the ratio', () => {
    const onLight = readableOn('#f4f1e8');
    assert.ok(onLight);
    assert.equal(onLight.color, '#12100e');
    const onDark = readableOn('#151210');
    assert.ok(onDark);
    assert.equal(onDark.color, '#fdfcfa');
  });

  it('returns null when neither near-black nor near-white passes', () => {
    // A mid-tone fill has no readable label, which is a fact about the fill
    // and has to be reported rather than rounded off.
    assert.equal(readableOn('#767676', 4.5), null);
  });
});

describe('shiftLightness', () => {
  it('moves lightness and holds the hue', () => {
    const lifted = shiftLightness('#1c1612', 4);
    assert.ok(lifted);
    const before = hexToHsl('#1c1612');
    const after = hexToHsl(lifted);
    assert.ok(before && after);
    assert.ok(after.lightness > before.lightness);
    // Three degrees, not zero. A near-black has very few distinct 8-bit
    // values to land on, so round-tripping one through a lightness change
    // moves the reported hue by a degree or two. That is quantisation, not
    // drift, and it is invisible at a lightness this low; a tolerance tight
    // enough to reject it would be a test that fails on correct code.
    assert.ok(
      Math.abs(after.hue - before.hue) < 3,
      `hue moved ${Math.abs(after.hue - before.hue)} degrees`,
    );
  });

  it('clamps rather than wrapping past the ends', () => {
    const floored = shiftLightness('#050505', -40);
    assert.equal(floored, '#000000');
    const ceiling = shiftLightness('#fafafa', 40);
    assert.equal(ceiling, '#ffffff');
  });
});
