import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AA_NORMAL_TEXT,
  contrastRatio,
  findContrastFailures,
  meetsAA,
  parseHex,
  readRootTokens,
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

describe('readRootTokens', () => {
  it('reads declarations out of a :root block', () => {
    const tokens = readRootTokens(
      ':root {\n  --primary: #2563EB;\n  --primary-foreground: #FFFFFF;\n}',
    );
    assert.equal(tokens.get('--primary'), '#2563EB');
    assert.equal(tokens.get('--primary-foreground'), '#FFFFFF');
  });

  it('ignores declarations outside :root', () => {
    const tokens = readRootTokens('.card { --primary: #000000; }');
    assert.equal(tokens.size, 0);
  });

  it('lets a later declaration win, as the cascade does', () => {
    const tokens = readRootTokens(
      ':root { --bg: #000000; }\n:root { --bg: #FFFFFF; }',
    );
    assert.equal(tokens.get('--bg'), '#FFFFFF');
  });
});

describe('findContrastFailures', () => {
  it('finds a failing pair by the -foreground convention', () => {
    const findings = findContrastFailures(
      ':root { --primary: #FF385C; --primary-foreground: #FFFFFF; }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].foreground, '--primary-foreground');
    assert.ok(findings[0].ratio < 4.5);
  });

  it('pairs --foreground with --background', () => {
    const findings = findContrastFailures(
      ':root { --background: #FFFFFF; --foreground: #AAAAAA; }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].background, '--background');
  });

  it('says nothing about a passing pair', () => {
    assert.deepEqual(
      findContrastFailures(
        ':root { --primary: #1D4ED8; --primary-foreground: #FFFFFF; }',
      ),
      [],
    );
  });

  it('skips a value it cannot measure rather than guessing', () => {
    // oklch(), rgb() and var() are all legitimate. Reporting an unmeasured
    // pair as passing would be worse than reporting nothing about it.
    assert.deepEqual(
      findContrastFailures(
        ':root { --primary: oklch(0.7 0.2 310); --primary-foreground: #FFFFFF; }',
      ),
      [],
    );
  });

  it('leaves hairlines alone', () => {
    // A --border against a surface is nowhere near 4.5:1 by design, and
    // holding it to that produces output no design system ships.
    assert.deepEqual(
      findContrastFailures(
        ':root { --background: #FFFFFF; --border: #E5E5E5; }',
      ),
      [],
    );
  });
});

describe('readRootTokens on hostile input', () => {
  /**
   * The inputs CodeQL named when it flagged the regex versions of this:
   * many repetitions of ':root', of ':root{{|', and of '--'. Each was
   * quadratic. A generated project's CSS is model output, and model output
   * is untrusted input, so this is a way to pin the Worker with one
   * plausible-looking file.
   */
  const HOSTILE = [
    ':root'.repeat(40_000),
    ':root{{|'.repeat(20_000),
    '--'.repeat(80_000),
    `:root { ${'--'.repeat(40_000)} }`,
    `:root { --a: ${'x'.repeat(200_000)} }`,
  ];

  it('stays fast on every shape that made the regex version quadratic', () => {
    for (const css of HOSTILE) {
      const started = performance.now();
      readRootTokens(css);
      const elapsed = performance.now() - started;
      assert.ok(
        elapsed < 250,
        `${css.slice(0, 12)}... took ${elapsed.toFixed(0)}ms`,
      );
    }
  });

  it('and findContrastFailures does too, since it is the real entry point', () => {
    for (const css of HOSTILE) {
      const started = performance.now();
      findContrastFailures(css);
      assert.ok(performance.now() - started < 250);
    }
  });

  it('still reads a real block that follows a hostile prefix', () => {
    // Fast is not enough: it has to remain correct on the same input.
    const tokens = readRootTokens(
      `${':root'.repeat(5_000)}\n:root { --primary: #2563EB; }`,
    );
    assert.equal(tokens.get('--primary'), '#2563EB');
  });

  it('skips a malformed declaration rather than storing garbage', () => {
    const tokens = readRootTokens(
      ':root { --ok: #000000; --bad name: #fff; no-dashes: #fff; --: #fff; --empty: ; }',
    );
    assert.deepEqual([...tokens.keys()], ['--ok']);
  });
});
