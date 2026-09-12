import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AA_NORMAL_TEXT,
  contrastRatio,
  meetsAA,
  parseHex,
  relativeLuminance,
} from '../src/contrast.ts';

describe('parseHex', () => {
  it('accepts 6-digit hex in either case', () => {
    assert.deepEqual(parseHex('#000000'), [0, 0, 0]);
    assert.deepEqual(parseHex('#FFFFFF'), [1, 1, 1]);
    assert.deepEqual(parseHex('  #ffffff  '), [1, 1, 1]);
  });

  it('refuses anything it cannot verify', () => {
    // Shorthand and named colours are rejected deliberately: accepting them
    // would let a value through the catalogue checks unmeasured.
    for (const bad of ['#fff', 'white', 'rgb(0,0,0)', '#12345g', '']) {
      assert.equal(parseHex(bad), null, bad);
    }
  });
});

describe('relativeLuminance', () => {
  it('matches the WCAG reference values at the extremes', () => {
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(relativeLuminance('#ffffff'), 1);
  });

  it('applies the sRGB transfer function, not a linear ramp', () => {
    // Mid-grey is ~0.2159 relative luminance, not 0.5. Getting this wrong
    // is the classic way a contrast checker silently passes failing pairs.
    const mid = relativeLuminance('#808080');
    assert.ok(mid !== null);
    assert.ok(Math.abs(mid - 0.2159) < 0.001, String(mid));
  });
});

describe('contrastRatio', () => {
  it('gives 21:1 for black on white, either way round', () => {
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  });

  it('gives 1:1 for a colour against itself', () => {
    assert.equal(contrastRatio('#3a7bd5', '#3a7bd5'), 1);
  });

  it('is null when either side is unparseable', () => {
    assert.equal(contrastRatio('#fff', '#000000'), null);
  });
});

describe('meetsAA', () => {
  it('draws the line at the documented ratio', () => {
    assert.equal(AA_NORMAL_TEXT, 4.5);
    assert.ok(meetsAA('#595959', '#ffffff')); // 7.0:1
    assert.ok(!meetsAA('#999999', '#ffffff')); // 2.8:1
  });
});
