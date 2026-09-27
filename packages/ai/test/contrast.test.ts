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
    // rgb(), var() and a translucent colour are all legitimate. Reporting
    // an unmeasured pair as passing would be worse than reporting nothing.
    for (const primary of [
      'rgb(250 250 250)',
      'var(--brand)',
      'oklch(0.97 0 0 / 0.5)',
    ]) {
      assert.deepEqual(
        findContrastFailures(
          `:root { --primary: ${primary}; --primary-foreground: #FFFFFF; }`,
        ),
        [],
        primary,
      );
    }
  });

  it('measures oklch(), which is how shadcn/ui writes every token', () => {
    const findings = findContrastFailures(
      ':root { --primary: oklch(0.7 0.2 310); --primary-foreground: oklch(1 0 0); }',
    );
    assert.equal(findings.length, 1);
    assert.ok(findings[0].ratio < 4.5);
    assert.deepEqual(
      findContrastFailures(
        ':root { --primary: oklch(0.205 0 0); --primary-foreground: oklch(98.5% 0 0); }',
      ),
      [],
    );
  });

  it('checks the .dark theme over :root, and names it', () => {
    const findings = findContrastFailures(
      ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
        '.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].theme, 'dark');
  });

  it('keeps a theme conditional on @media out of it, but reads @layer (#239 review)', () => {
    const findings = findContrastFailures(
      ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
        '.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }\n' +
        '@media (min-width: 1000px) { .dark { --foreground: oklch(1 0 0); } :root { --foreground: oklch(0.9 0 0); } }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].theme, 'dark');
    const layered = findContrastFailures(
      '@layer base { :root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
        '.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); } }',
    );
    assert.equal(layered.length, 1);
    assert.equal(layered[0].theme, 'dark');
  });

  it('reads neither .scope :root as the root nor misses html:root.dark (#239 review)', () => {
    assert.equal(
      findContrastFailures(
        ':root { --background: #FFFFFF; --foreground: #AAAAAA; }\n' +
          '.scope :root { --foreground: #000000; }',
      ).length,
      1,
    );
    const dark = findContrastFailures(
      ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
        'html:root.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
  });

  it('reads no body:root or body:host as the dark root (#239 review)', () => {
    for (const dead of ['body:root.dark', 'body:host.dark']) {
      const findings = findContrastFailures(
        ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
          '.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }\n' +
          `${dead} { --foreground: oklch(1 0 0); }`,
      );
      assert.equal(findings.length, 1, dead);
      assert.equal(findings[0].theme, 'dark', dead);
    }
  });

  it('weighs a dark list by the members on the root (#239 review)', () => {
    const dark = findContrastFailures(
      'html:root { --foreground: #666666; }\n' +
        ':root { --background: #FFFFFF; }\n' +
        '.dark, body.dark { --foreground: #FFFFFF; --background: #000000; }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
    assert.equal(dark[0].foregroundValue, '#666666');
  });

  it('reads !important as the cascade does (#239 review)', () => {
    // Over a later declaration in the same block, and read without the flag.
    const dark = findContrastFailures(
      ':root { --background: #FFFFFF; --foreground: #000000; }\n' +
        '.dark { --foreground: #999999 !important; --foreground: #000000; --background: #FFFFFF; }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
    assert.equal(dark[0].foregroundValue, '#999999');
    // Over a more specific normal declaration.
    assert.equal(
      findContrastFailures(
        ':root { --foreground: #AAAAAA !important; --background: #FFFFFF; }\n' +
          'html:root { --foreground: #000000; }',
      ).length,
      1,
    );
    // Among important ones, an earlier layer holds.
    assert.equal(
      findContrastFailures(
        '@layer base { :root { --foreground: #AAAAAA !important; --background: #FFFFFF; } }\n' +
          '@layer overrides { :root { --foreground: #000000 !important; } }',
      ).length,
      1,
    );
  });

  it('orders tokens by cascade layer before specificity (#239 review)', () => {
    const later = findContrastFailures(
      '@layer base { html:root { --foreground: #000000; --background: #FFFFFF; } }\n' +
        '@layer overrides { :root { --foreground: #AAAAAA; } }',
    );
    assert.equal(later.length, 1);
    assert.equal(later[0].foregroundValue, '#AAAAAA');
    // Outside any layer holds over every layer.
    assert.equal(
      findContrastFailures(
        ':root { --foreground: #AAAAAA; }\n' +
          '@layer base { html:root { --foreground: #000000; --background: #FFFFFF; } }',
      ).length,
      1,
    );
    // The order the statement names, not the order the blocks come in.
    assert.deepEqual(
      findContrastFailures(
        '@layer overrides, base;\n' +
          '@layer base { html:root { --foreground: #000000; --background: #FFFFFF; } }\n' +
          '@layer overrides { :root { --foreground: #AAAAAA; } }',
      ),
      [],
    );
  });

  it("keeps a more specific root's tokens over .dark (#239 review)", () => {
    const dark = findContrastFailures(
      'html:root { --foreground: #666666; }\n' +
        ':root { --background: #FFFFFF; }\n' +
        '.dark { --foreground: #FFFFFF; --background: #000000; }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
    assert.equal(dark[0].foregroundValue, '#666666');
    // body.dark sets them on body, over what it inherits.
    assert.deepEqual(
      findContrastFailures(
        'html:root { --foreground: #000000; }\n' +
          ':root { --background: #FFFFFF; }\n' +
          'body.dark { --foreground: #FFFFFF; --background: #000000; }',
      ),
      [],
    );
  });

  it("keeps the more specific selector's tokens, as the cascade does (#239 review)", () => {
    const dark = findContrastFailures(
      ':root { --background: #FFFFFF; --foreground: #000000; }\n' +
        'html.dark { --foreground: #666666; }\n' +
        '.dark { --background: #000000; --foreground: #FFFFFF; }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
    assert.equal(dark[0].foregroundValue, '#666666');
    assert.equal(
      findContrastFailures(
        'html:root { --foreground: #AAAAAA; }\n' +
          ':root { --background: #FFFFFF; --foreground: #000000; }',
      ).length,
      1,
    );
  });

  it('reads no chain of root compounds as the root (#239 review)', () => {
    for (const chain of [':root :root', 'html:root > :root']) {
      assert.equal(
        findContrastFailures(
          ':root { --background: #FFFFFF; --foreground: #AAAAAA; }\n' +
            `${chain} { --foreground: #000000; }`,
        ).length,
        1,
        chain,
      );
    }
  });

  it('reads html:root as the root (#239 review)', () => {
    assert.equal(
      findContrastFailures(
        'html:root { --background: #FFFFFF; --foreground: #AAAAAA; }',
      ).length,
      1,
    );
  });

  it('does not count a brace inside a string as a block (#239 review)', () => {
    const findings = findContrastFailures(
      '@media (min-width: 1px) { .icon::before { content: "{"; } }\n' +
        ':root { --background: #FFFFFF; --foreground: #AAAAAA; }',
    );
    assert.equal(findings.length, 1);
  });

  it('does not start a comment inside a CSS string (#239 review)', () => {
    for (const quoted of ['"/*"', "'/*'", '"a\\"/*"']) {
      const findings = findContrastFailures(
        `a::before { content: ${quoted}; }\n` +
          ':root { --background: #FFFFFF; --foreground: #AAAAAA; }',
      );
      assert.equal(findings.length, 1, quoted);
    }
  });

  it('reads .dark as one member of a selector list (#239 review)', () => {
    for (const selector of [
      '.dark, [data-theme="dark"]',
      '[data-theme="dark"], .dark',
    ]) {
      const findings = findContrastFailures(
        ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
          `${selector} { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }`,
      );
      assert.equal(findings.length, 1, selector);
      assert.equal(findings[0].theme, 'dark', selector);
    }
    assert.deepEqual(
      findContrastFailures(
        ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
          '.card .dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }',
      ),
      [],
    );
    for (const selector of ['html.dark', ':root.dark']) {
      const findings = findContrastFailures(
        ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
          `${selector} { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }`,
      );
      assert.equal(findings.length, 1, selector);
      assert.equal(findings[0].theme, 'dark', selector);
    }
    // A condition on the root holds only some of the time: it does not
    // replace the dark theme's values (#239 review).
    for (const state of ['.dark:hover', '.dark.compact', 'html.dark:focus']) {
      const findings = findContrastFailures(
        ':root { --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); }\n' +
          '.dark { --background: oklch(0.145 0 0); --foreground: oklch(0.3 0 0); }\n' +
          `${state} { --foreground: oklch(1 0 0); }`,
      );
      assert.equal(findings.length, 1, state);
      assert.equal(findings[0].theme, 'dark', state);
    }
  });

  it('reads a block setting the --color-* property over @theme (#239 review)', () => {
    const dark = findContrastFailures(
      '@theme { --color-surface: #FFFFFF; --color-surface-foreground: #000000; }\n' +
        '.dark { --color-surface-foreground: #EEEEEE; }',
    );
    assert.equal(dark.length, 1);
    assert.equal(dark[0].theme, 'dark');
    assert.equal(dark[0].foregroundValue, '#EEEEEE');
    const light = findContrastFailures(
      '@theme { --color-surface: #FFFFFF; --color-surface-foreground: #000000; }\n' +
        ':root { --color-surface-foreground: #EEEEEE; }',
    );
    assert.equal(light.length, 1);
    assert.equal(light[0].theme, undefined);
  });

  it('reports a pair failing in both themes once', () => {
    const findings = findContrastFailures(
      ':root { --background: #FFFFFF; --foreground: #AAAAAA; }\n' +
        '.dark { --card: #000000; }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].theme, undefined);
  });

  it('reads literal colours from a Tailwind v4 @theme block', () => {
    const findings = findContrastFailures(
      '@theme { --color-primary: #FF385C; --color-primary-foreground: #FFFFFF; --color-muted: var(--muted); }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].foreground, '--primary-foreground');
  });

  it('measures the literal @theme value a utility draws, over :root (#239 review)', () => {
    // bg-primary reads --color-primary, so the failing @theme pair is what
    // renders, whatever the passing :root pair of the same name says.
    const findings = findContrastFailures(
      ':root { --primary: #000000; --primary-foreground: #FFFFFF; }\n' +
        '@theme { --color-primary: #FF385C; --color-primary-foreground: #FFFFFF; }',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].foreground, '--primary-foreground');
    // A `var()` in @theme hands the token to :root, which is measured.
    assert.deepEqual(
      findContrastFailures(
        ':root { --primary: #000000; --primary-foreground: #FFFFFF; }\n' +
          '@theme inline { --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground); }',
      ),
      [],
    );
  });

  it('ignores a commented-out block (#239 review)', () => {
    assert.deepEqual(
      findContrastFailures(
        ':root { --primary: #000000; --primary-foreground: #FFFFFF; }\n' +
          '/* @theme { --color-primary: #FF385C; --color-primary-foreground: #FFFFFF; } */',
      ),
      [],
    );
    // An unclosed comment runs to the end, as in CSS.
    assert.deepEqual(
      findContrastFailures(
        ':root { --background: #FFFFFF; --foreground: #111111; }\n/* :root { --foreground: #EEEEEE; }',
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
    // Fast is not enough: it has to remain correct on the same input. The
    // prefix ends at a `;`: without one it would run into the selector,
    // `:root:root… :root`, a chain that selects nothing (#239 review).
    const tokens = readRootTokens(
      `${':root'.repeat(5_000)};\n:root { --primary: #2563EB; }`,
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
