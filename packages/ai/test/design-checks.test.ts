import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_FINDINGS_IN_PROMPT,
  checkDesign,
  colorSpellings,
  cssRuleMatches,
  describeFindings,
  normalizeCssValue,
} from '../src/design-checks.ts';
import { renderDesignMd } from '../src/design-spec.ts';
import { SPEC } from './fixtures/design-spec.ts';

/**
 * A finished project checked against its own spec.
 *
 * `project()` is a project that meets `SPEC` exactly, and each test breaks
 * one thing about it, so every assertion is about the one check it names.
 */
function project(
  overrides: Record<string, string | null> = {},
): { path: string; content: string }[] {
  const files: Record<string, string> = {
    'index.html': `<!doctype html>
<html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head><body><div id="root"></div></body></html>`,
    'src/styles.css': `:root {
  --navy: #071722;
  --scrim-top: rgba(2, 10, 18, 0.57);
  --ink-soft: #C8D4DB;
}
h1 { font-family: 'Playfair Display', Georgia, serif; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 650px) { .signup { display: none; } }`,
    'src/App.tsx': `export function App() {
  return (
    <main>
      <h1>
        Know it{' '}
        <em>all.</em>
      </h1>
      <label htmlFor="email">Email address</label>
      <input id="email" placeholder="Enter your email" />
    </main>
  );
}`,
    'DESIGN.md': renderDesignMd(SPEC),
  };
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }
  return Object.entries(files).map(([path, content]) => ({ path, content }));
}

function checks(
  report: ReturnType<typeof checkDesign>,
  severity: 'errors' | 'warnings',
) {
  return report[severity].map((finding) => finding.check);
}

describe('a project that meets its spec', () => {
  it('passes every check', () => {
    const report = checkDesign(project());
    assert.equal(report.hasSpec, true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
  });

  it('treats spellings of the same value as the same value', () => {
    assert.equal(
      normalizeCssValue('rgba(2, 10, 18, 0.57)'),
      normalizeCssValue('rgba(2,10,18,.57)'),
    );
    assert.equal(normalizeCssValue('#FFF'), normalizeCssValue('#ffffff'));
    assert.equal(normalizeCssValue('#f008'), normalizeCssValue('#ff000088'));
    assert.equal(normalizeCssValue('#07172291'), '#07172291');
    assert.equal(
      normalizeCssValue('clamp(4.3rem,8.8vw,8.3rem)'),
      normalizeCssValue('clamp(4.3rem, 8.8vw, 8.3rem)'),
    );
    // A digit before the point is not a leading zero.
    assert.equal(normalizeCssValue('10.5px'), '10.5px');
  });

  it('spells an opaque alpha as the colour without one, both ways', () => {
    for (const opaque of ['#ffffffff', '#ffff', '#FFFF']) {
      const spellings = colorSpellings(opaque);
      assert.ok(spellings.includes('#ffffff'), opaque);
      assert.ok(spellings.includes('rgb(255,255,255)'), opaque);
    }
    assert.ok(colorSpellings('#ffffff').includes('#ffffffff'));
    assert.ok(colorSpellings('rgb(255, 255, 255)').includes('#ffffffff'));
    // A translucent alpha is not the opaque colour.
    assert.ok(!colorSpellings('#ffffff80').includes('#ffffff'));
  });
});

describe('what the spec named and the code dropped', () => {
  it('finds a colour the spec named that the CSS never uses', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: #071722; --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
    assert.match(report.errors[0]!.detail, /scrim-top.*rgba\(2,10,18,\.57\)/);
  });

  it('finds a face the spec named that is never loaded or used', () => {
    const report = checkDesign(
      project({
        'index.html': `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body></body></html>`,
        'src/styles.css': `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['font']);
    assert.match(report.errors[0]!.detail, /DM Sans/);
  });

  it('finds a breakpoint the spec named that no media query uses', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 900px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['breakpoint']);
  });

  it('accepts the breakpoint written as min-width one pixel on, or in em', () => {
    for (const media of ['(min-width: 651px)', '(max-width: 40.625em)']) {
      const report = checkDesign(
        project({
          'src/styles.css': `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media ${media} { a { color: red; } }`,
        }),
      );
      assert.deepEqual(report.errors, [], media);
    }
  });

  it('warns, and only warns, about copy and type it could not find', () => {
    // Copy can be assembled at runtime and a size written another way, so
    // neither is certain enough to buy a paid repair on its own.
    const report = checkDesign(
      project({
        'src/App.tsx': `export function App() { return <main><h1>Know everything.</h1><label htmlFor="e">Email address</label><input id="e" placeholder="Enter your email" /></main>; }`,
        'src/styles.css': `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: 6rem; }
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(checks(report, 'warnings').sort(), ['copy', 'type']);
  });

  it('reads copy the way a visitor sees it, across markup and entities', () => {
    const report = checkDesign(
      project({
        'src/App.tsx': `export function App() { return <main><h1>Know <span>it</span>{' '}<em>all.</em></h1><label htmlFor="e">Email</label><input id="e" placeholder="Enter your email" /></main>; }`,
      }),
    );
    assert.deepEqual(report.warnings, []);
  });
});

describe('the same thing written another way', () => {
  const LIVE = `h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }`;

  it('accepts a colour written as rgb() where the spec wrote hex, and back', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: rgb(7, 23, 34); --scrim-top: #020a1291; --ink-soft: rgba(200,212,219,1); }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(report.errors, []);
  });

  it("accepts CSS Color 4's space-separated rgb()", () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: rgb(7 23 34); --scrim-top: rgb(2 10 18 / 57%); --ink-soft: rgb(200 212 219 / 1); }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(report.errors, []);
    assert.equal(
      normalizeCssValue('rgb(2 10 18 / 57%)'),
      normalizeCssValue('rgba(2, 10, 18, 0.57)'),
    );
    assert.equal(
      normalizeCssValue('rgba(2, 10, 18, 57%)'),
      normalizeCssValue('rgba(2, 10, 18, 0.57)'),
    );
  });

  it('takes a CSS colour keyword for the colour it names', () => {
    const withPaper = renderDesignMd({
      ...SPEC,
      tokens: {
        ...SPEC.tokens,
        colors: [
          ...SPEC.tokens.colors,
          { name: 'paper', value: '#ffffff', use: 'card surface' },
        ],
      },
    });
    const paper = (files: Record<string, string>) =>
      checks(
        checkDesign(project({ 'DESIGN.md': withPaper, ...files })),
        'errors',
      );
    assert.deepEqual(
      paper({ 'src/card.css': '.card { background: white; }' }),
      [],
    );
    assert.deepEqual(
      paper({ 'src/card.css': '.card { border: 1px solid White; }' }),
      [],
    );
    assert.deepEqual(
      paper({
        'src/Card.tsx':
          'export const Card = () => <div className="bg-white" />;',
      }),
      [],
    );
    // Copy that says the word is not the colour, even after a colon.
    assert.deepEqual(
      paper({
        'src/Card.tsx':
          'export const Card = () => <p>Our theme: pure white</p>;',
      }),
      ['color'],
    );
    assert.deepEqual(
      paper({
        'src/Card.tsx': `export const Card = () => <div style={{ background: 'white' }} />;`,
      }),
      [],
    );
    // Copy that says the word is not the colour.
    assert.deepEqual(
      paper({
        'src/Card.tsx': 'export const Card = () => <p>A white paper.</p>;',
      }),
      ['color'],
    );
  });

  it('reads percentage channels in the comma-separated rgb() too', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: rgb(2.745%, 9.02%, 13.333%); --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(report.errors, []);
    assert.equal(
      normalizeCssValue('rgba(100%, 0%, 0%, 50%)'),
      normalizeCssValue('rgb(255 0 0 / .5)'),
    );
    // 50% is 127.5, which rounds up; 50 * 2.55 is 127.49999999999999.
    assert.equal(
      normalizeCssValue('rgb(50%, 0%, 0%)'),
      normalizeCssValue('rgb(128, 0, 0)'),
    );
  });

  it('does not count a value that survives only in a comment', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { /* --navy: #071722; */ --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
/* @media (max-width: 650px) { .signup { display: none; } } */`,
      }),
    );
    assert.deepEqual(checks(report, 'errors').sort(), ['breakpoint', 'color']);
  });

  it('does not count a value left in a script comment, and keeps strings whole', () => {
    const css = `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`;
    const commented = checkDesign(
      project({
        'src/styles.css': css,
        'src/theme.ts': `// const oldNavy = '#071722';\n/* export const navy = '#071722'; */\nexport const x = 1;`,
      }),
    );
    assert.deepEqual(checks(commented, 'errors'), ['color']);
    const inStrings = checkDesign(
      project({
        'src/styles.css': css,
        'src/theme.ts': `export const glob = 'src/**/*.ts'; export const url = "https://x.test/a"; export const sep = 'a//b', navy = '#071722';`,
      }),
    );
    assert.deepEqual(inStrings.errors, []);
  });

  it('does not count a value left in a Sass line comment', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/theme.scss': `// $navy: #071722;\n.card { background: url(https://x.test/a.png); }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('does not count a value left in a component script comment', () => {
    for (const [path, file] of [
      [
        'src/Theme.vue',
        `<script setup>\n// const navy = '#071722'\n</script>\n<template><main /></template>`,
      ],
      [
        'src/Theme.svelte',
        `<script>\n// const navy = '#071722'\n</script>\n<main></main>`,
      ],
      [
        'src/pages/index.astro',
        `---\n// const navy = '#071722'\n---\n<main></main>`,
      ],
    ] as const) {
      const report = checkDesign(
        project({
          'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
          [path]: file,
        }),
      );
      assert.deepEqual(checks(report, 'errors'), ['color'], path);
    }
  });

  it('does not count a value left in an inline script comment in HTML', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'index.html': `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet"><script>\n// const navy = '#071722'\n</script></head><body></body></html>`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('does not count a value left in a CSS comment inside a template literal', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/Theme.tsx':
          'export const Theme = () => <style>{`/* :root { --navy: #071722; } */`}</style>;',
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('does not count a value left in a CSS comment inside a markup template', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/theme.ts':
          'export const theme = html`<style>/* :root { --navy: #071722; } */</style>`;',
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('reads the script inside an HTML page with the parser too', () => {
    const page = (script: string) =>
      checks(
        checkDesign([
          {
            path: 'index.html',
            content: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script>${script}</script></body></html>`,
          },
        ]),
        'errors',
      );
    assert.deepEqual(
      page(`if (a) /'/.test(v); // root.innerHTML = '<img src=x>';`),
      [],
    );
    assert.deepEqual(page(`if (a) '<img src=x>'.length;`), []);
    assert.deepEqual(page(`root.innerHTML = '<img src=x>';`), ['alt']);
  });

  it('does not count a value left in a comment after a regular expression', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/quote.ts': `export const quote = /['"]/; // old colour: #071722;\nexport const path = /[/'"]/; // #071722;\nexport const slash = (a: number) => a / 2; // #071722`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('keeps Sass division, not a regular expression, before a comment', () => {
    // Read as a regular expression, `/1.5 'Serif'; /` would swallow the
    // first slash of the comment and keep the comment.
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/type.scss': `p { font: #{$size}/1.5 'Serif'; } // --navy: #071722;\n`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
  });

  it('does not count a colour the page only shows as copy', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
        'src/Docs.tsx':
          'export const Docs = () => <p>Our navy is <code>#071722</code>.</p>;',
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
    for (const docs of [
      "export const Docs = () => <p>{'#071722'}</p>;",
      'export const Docs = () => <>#071722</>;',
    ]) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/styles.css': `:root { --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
              'src/Docs.tsx': docs,
            }),
          ),
          'errors',
        ),
        ['color'],
        docs,
      );
    }
  });

  it('does not take the start of a longer value for the colour', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: #07172200; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
h1 { font-family: 'Playfair Display'; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
    assert.match(report.errors[0]!.detail, /navy/);
  });

  it('still finds a colour that is merely close', () => {
    const report = checkDesign(
      project({
        'src/styles.css': `:root { --navy: rgb(7, 23, 35); --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
@media (max-width: 650px) { a { color: red; } }`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['color']);
    assert.match(report.errors[0]!.detail, /navy/);
  });

  describe('a short family name', () => {
    // DM Sans swapped for Inter, whose name is inside ordinary words.
    const withInter = renderDesignMd({
      ...SPEC,
      tokens: {
        ...SPEC.tokens,
        fonts: SPEC.tokens.fonts.map((font) =>
          font.family === 'DM Sans' ? { ...font, family: 'Inter' } : font,
        ),
      },
    });
    const noLink = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"></head><body></body></html>`;
    const inter = (files: Record<string, string>) =>
      checkDesign(
        project({ 'DESIGN.md': withInter, 'index.html': noLink, ...files }),
      );

    it('is not found inside another word', () => {
      const report = inter({
        'src/Card.tsx': `interface CardProps { pointer: boolean }
export const Card = (p: CardProps) => <div style={{ cursor: 'pointer' }} />;`,
      });
      assert.deepEqual(checks(report, 'errors'), ['font']);
      assert.match(report.errors[0]!.detail, /Inter/);
    });

    it('is found in the font shorthand, unquoted', () => {
      assert.deepEqual(
        inter({ 'src/type.css': 'body { font: 16px/1.5 Inter, sans-serif; }' })
          .errors,
        [],
      );
    });

    it('is not found in copy that happens to spell it', () => {
      const report = inter({
        'src/Label.tsx': `export const Label = () => <p>{'Inter'}</p>;\nconst label = 'Inter';`,
      });
      assert.deepEqual(checks(report, 'errors'), ['font']);
      assert.deepEqual(
        inter({ 'src/theme.ts': `export const bodyFont = 'Inter';` }).errors,
        [],
      );
    });

    it('is found wherever a project names a typeface', () => {
      const places: Record<string, string>[] = [
        {
          'src/fonts.css': `body { font-family: Inter, system-ui, sans-serif; }`,
        },
        { 'src/fonts.css': `:root { --font-body: "Inter", sans-serif; }` },
        {
          'tailwind.config.ts': `export default { theme: { extend: { fontFamily: { sans: ['Inter', 'system-ui'] } } } };`,
        },
        {
          'index.html': noLink.replace(
            '</head>',
            '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;display=swap" rel="stylesheet"></head>',
          ),
        },
        { 'src/main.tsx': `import '@fontsource-variable/inter';` },
      ];
      for (const file of places) {
        assert.deepEqual(inter(file).errors, [], Object.values(file)[0]);
      }
    });

    it('is found through the custom property a font-family uses', () => {
      for (const css of [
        ':root { --heading-face: Inter, sans-serif; }\nh1 { font-family: var(--heading-face); }',
        ':root { --face: Inter; --heading: var(--face), sans-serif; }\nh1 { font-family: var(--heading); }',
        ':root { --heading-face: Inter; }\nh1 { font: 600 2rem/1.1 var(--heading-face); }',
      ]) {
        assert.deepEqual(inter({ 'src/type.css': css }).errors, [], css);
      }
      assert.deepEqual(
        inter({
          'tailwind.config.ts': `export default { theme: { extend: { fontFamily: { sans: 'var(--body-face)' } } } };`,
          'src/type.css': ':root { --body-face: Inter, sans-serif; }',
        }).errors,
        [],
      );
      // A property no font-family uses names nothing.
      assert.deepEqual(
        checks(
          inter({
            'src/type.css':
              ':root { --heading-face: Inter; }\nh1 { color: var(--heading-face); }',
          }),
          'errors',
        ),
        ['font'],
      );
      // Nor does one whose name only ends in the one used.
      assert.deepEqual(
        checks(
          inter({
            'src/type.css':
              ':root { --heading-face: Georgia; --brand--heading-face: Inter; }\nh1 { font-family: var(--heading-face); }',
          }),
          'errors',
        ),
        ['font'],
      );
    });
  });

  it('takes a matchMedia query as a breakpoint, and a max-width declaration as not one', () => {
    const css = `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}
.wrap { max-width: 650px; }`;
    const declared = checkDesign(project({ 'src/styles.css': css }));
    assert.deepEqual(checks(declared, 'errors'), ['breakpoint']);

    const queried = checkDesign(
      project({
        'src/styles.css': css,
        'src/useNarrow.ts': `export const narrow = () => window.matchMedia('(max-width: 650px)').matches;`,
      }),
    );
    assert.deepEqual(queried.errors, []);
  });

  it("reads Tailwind's prefixes as its breakpoints, only in a Tailwind project", () => {
    const spec = renderDesignMd({
      ...SPEC,
      breakpoints: [{ maxWidth: 768, changes: ['stack the columns'] }],
    });
    const app = `export function App() {
  return (
    <main className="grid md:grid-cols-2">
      <h1>
        Know it{' '}
        <em>all.</em>
      </h1>
      <label htmlFor="email">Email address</label>
      <input id="email" placeholder="Enter your email" />
    </main>
  );
}`;
    const css = `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}`;
    const withTailwind = checkDesign(
      project({
        'DESIGN.md': spec,
        'src/App.tsx': app,
        'src/styles.css': `@import "tailwindcss";\n${css}`,
      }),
    );
    assert.deepEqual(withTailwind.errors, []);

    const without = checkDesign(
      project({ 'DESIGN.md': spec, 'src/App.tsx': app, 'src/styles.css': css }),
    );
    assert.deepEqual(checks(without, 'errors'), ['breakpoint']);
  });

  it("reads Tailwind's arbitrary breakpoints, in px or rem", () => {
    // The fixture spec changes the layout at 650px.
    const css = `@import "tailwindcss";
:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}`;
    for (const variant of ['max-[650px]:hidden', 'min-[40.625rem]:flex']) {
      const report = checkDesign(
        project({
          'src/styles.css': css,
          'src/Signup.tsx': `export const Signup = () => <form className="${variant}" />;`,
        }),
      );
      assert.deepEqual(report.errors, [], variant);
    }
  });

  it('reads a Sass or Less variable in a width query', () => {
    // The fixture spec changes the layout at 650px.
    const css = `:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}`;
    for (const [path, content] of [
      [
        'src/layout.scss',
        '$mobile: 650px;\n@media (max-width: $mobile) { a { color: red; } }',
      ],
      [
        'src/layout.less',
        '@mobile: 650px;\n@media (max-width: @mobile) { a { color: red; } }',
      ],
    ] as const) {
      assert.deepEqual(
        checkDesign(project({ 'src/styles.css': css, [path]: content })).errors,
        [],
        path,
      );
    }
    // Each file against its own declarations.
    assert.deepEqual(
      checkDesign(
        project({
          'src/styles.css': css,
          'src/a.scss':
            '$mobile: 650px;\n@media (max-width: $mobile) { a { color: red; } }',
          'src/b.scss': '$mobile: 900px;\n.b { color: blue; }',
        }),
      ).errors,
      [],
    );
    // Through an import, with or without the partial prefix and namespace.
    for (const [layout, variables] of [
      [
        "@import './variables';\n@media (max-width: $mobile) { a { color: red; } }",
        'src/_variables.scss',
      ],
      [
        "@use 'variables' as vars;\n@media (max-width: vars.$mobile) { a { color: red; } }",
        'src/variables.scss',
      ],
    ] as const) {
      assert.deepEqual(
        checkDesign(
          project({
            'src/styles.css': css,
            'src/layout.scss': layout,
            [variables]: '$mobile: 650px;',
          }),
        ).errors,
        [],
        layout,
      );
    }
    // Two modules exporting the same name stay apart under their namespaces.
    assert.deepEqual(
      checkDesign(
        project({
          'src/styles.css': css,
          'src/layout.scss':
            "@use 'a' as a;\n@use 'b' as b;\n@media (max-width: a.$mobile) { a { color: red; } }",
          'src/_a.scss': '$mobile: 650px;',
          'src/_b.scss': '$mobile: 900px;',
        }),
      ).errors,
      [],
    );
    // One module under two aliases answers to both.
    assert.deepEqual(
      checkDesign(
        project({
          'src/styles.css': css,
          'src/layout.scss':
            "@use 'vars' as a;\n@use 'vars' as b;\n@media (max-width: b.$mobile) { a { color: red; } }",
          'src/_vars.scss': '$mobile: 650px;',
        }),
      ).errors,
      [],
    );
    // An import declares where it stands: a Sass import after a local
    // declaration wins, and one before it loses.
    const ordered = (layout: string, width: number) =>
      checks(
        checkDesign(
          project({
            'DESIGN.md': renderDesignMd({
              ...SPEC,
              breakpoints: [{ maxWidth: width, changes: ['stack'] }],
            }),
            'src/styles.css': css,
            'src/layout.scss': layout,
            'src/_vars.scss': '$mobile: 900px;',
          }),
        ),
        'errors',
      );
    const query = '@media (max-width: $mobile) { a { color: red; } }';
    assert.deepEqual(
      ordered(`$mobile: 650px;\n@import './vars';\n${query}`, 900),
      [],
    );
    assert.deepEqual(
      ordered(`@import './vars';\n$mobile: 650px;\n${query}`, 650),
      [],
    );
    // A module configured with `with (...)` takes the configured value.
    for (const [layout, use] of [
      [
        `@use './vars' as v with ($mobile: 650px);\n@media (max-width: v.$mobile) { a { color: red; } }`,
        'v',
      ],
      [`@use './vars' as * with ($mobile: 650px);\n${query}`, '*'],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/styles.css': css,
              'src/layout.scss': layout,
              'src/_vars.scss': '$mobile: 900px !default;',
            }),
          ),
          'errors',
        ),
        [],
        use,
      );
    }
    // And in order inside an imported file that imports another.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'DESIGN.md': renderDesignMd({
              ...SPEC,
              breakpoints: [{ maxWidth: 900, changes: ['stack'] }],
            }),
            'src/styles.css': css,
            'src/layout.scss': `@import './mid';\n${query}`,
            'src/_mid.scss': "$mobile: 650px;\n@import './vars';",
            'src/_vars.scss': '$mobile: 900px;',
          }),
        ),
        'errors',
      ),
      [],
    );
    // A Sass query reads the variable as it stands there; Less reads the
    // last definition, wherever it is.
    assert.deepEqual(
      ordered(`$mobile: 650px;\n${query}\n$mobile: 700px;`, 650),
      [],
    );
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'src/styles.css': css,
            'src/layout.less':
              '@media (max-width: @mobile) { a { color: red; } }\n@mobile: 650px;',
          }),
        ),
        'errors',
      ),
      [],
    );
    // A variable set inside a block is local to it, unless `!global`.
    for (const layout of [
      `$mobile: 650px;\n.card { $mobile: 900px; }\n${query}`,
      `$mobile: 900px;\n.card { $mobile: 650px !global; }\n${query}`,
      `.card { $mobile: 650px; @media (max-width: $mobile) { a { color: red; } } }`,
    ]) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({ 'src/styles.css': css, 'src/layout.scss': layout }),
          ),
          'errors',
        ),
        [],
        layout,
      );
    }
    // A variable set to another variable has that one's value.
    for (const [path, layout] of [
      ['src/layout.scss', `$base: 650px;\n$mobile: $base;\n${query}`],
      [
        'src/layout.less',
        '@base: 650px;\n@mobile: @base;\n@media (max-width: @mobile) { a { color: red; } }',
      ],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(project({ 'src/styles.css': css, [path]: layout })),
          'errors',
        ),
        [],
        path,
      );
    }
    // An imported stylesheet is read without its comments too.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'src/styles.css': css,
            'src/layout.scss':
              "@import './vars';\n@media (max-width: $mobile) { a { color: red; } }",
            'src/_vars.scss': '$mobile: 900px; // $mobile: 650px',
          }),
        ),
        'errors',
      ),
      ['breakpoint'],
    );
    // An unresolved name is no width.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'src/styles.css': css,
            'src/layout.scss':
              '@media (max-width: $mobile) { a { color: red; } }',
          }),
        ),
        'errors',
      ),
      ['breakpoint'],
    );
  });

  it("reads the project's own Tailwind breakpoints, from config or @theme", () => {
    // The fixture spec changes the layout at 650px.
    const css = `@import "tailwindcss";
:root { --navy: #071722; --scrim-top: rgba(2,10,18,.57); --ink-soft: #c8d4db; }
${LIVE}`;
    const signup = `export const Signup = () => <form className="mobile:hidden" />;`;
    const configs: Record<string, string>[] = [
      {
        'tailwind.config.ts': `export default { theme: { screens: { mobile: '650px', wide: { max: '1400px' } } } };`,
      },
      { 'src/theme.css': '@theme { --breakpoint-mobile: 40.625rem; }' },
      {
        'tailwind.config.cjs': `module.exports = { theme: { screens: { mobile: '650px' } } };`,
      },
      {
        'tailwind.config.ts': `const screens = { mobile: '650px' };\nexport default { theme: { screens } };`,
      },
      {
        'tailwind.config.ts': `const custom = { screens: { mobile: '650px' } };\nexport default { theme: { screens: custom.screens } };`,
      },
    ];
    for (const config of configs) {
      const report = checkDesign(
        project({ 'src/styles.css': css, 'src/Signup.tsx': signup, ...config }),
      );
      assert.deepEqual(report.errors, [], Object.keys(config)[0]);
    }
    // `theme.screens` replaces the defaults: `md:` is no longer a
    // breakpoint. `extend.screens` keeps them.
    const md = (config: string) =>
      checks(
        checkDesign(
          project({
            'DESIGN.md': renderDesignMd({
              ...SPEC,
              breakpoints: [{ maxWidth: 768, changes: ['stack'] }],
            }),
            'src/styles.css': css,
            'src/Signup.tsx': `export const Signup = () => <form className="md:grid" />;`,
            'tailwind.config.ts': config,
          }),
        ),
        'errors',
      );
    assert.deepEqual(
      md(`export default { theme: { screens: { mobile: '650px' } } };`),
      ['breakpoint'],
    );
    assert.deepEqual(
      md(
        `export default { theme: { extend: { screens: { mobile: '650px' } } } };`,
      ),
      [],
    );
    // Tailwind v4: `--breakpoint-md: initial` removes `md`; a later
    // declaration sets it again.
    const v4 = (theme: string) =>
      checks(
        checkDesign(
          project({
            'DESIGN.md': renderDesignMd({
              ...SPEC,
              breakpoints: [{ maxWidth: 768, changes: ['stack'] }],
            }),
            'src/styles.css': css,
            'src/theme.css': theme,
            'src/Signup.tsx': `export const Signup = () => <form className="md:grid" />;`,
          }),
        ),
        'errors',
      );
    assert.deepEqual(v4('@theme { --breakpoint-lg: 70rem; }'), []);
    assert.deepEqual(v4('@theme { --breakpoint-md: initial; }'), [
      'breakpoint',
    ]);
    assert.deepEqual(
      v4('@theme { --breakpoint-md: initial; --breakpoint-md: 48rem; }'),
      [],
    );
    assert.deepEqual(
      v4('@theme { --breakpoint-md: 48rem; --breakpoint-md: initial; }'),
      ['breakpoint'],
    );
    // Spreading the defaults into `theme.screens` keeps them.
    assert.deepEqual(
      md(
        `import defaultTheme from 'tailwindcss/defaultTheme';\nexport default { theme: { screens: { ...defaultTheme.screens, xs: '475px' } } };`,
      ),
      [],
    );
    // So does a binding named in its place, unless it is Tailwind's own.
    assert.deepEqual(
      md(
        `const screens = { mobile: '650px' };\nexport default { theme: { screens } };`,
      ),
      ['breakpoint'],
    );
    assert.deepEqual(
      md(
        `const custom = { mobile: '650px' };\nexport default { theme: { screens: custom } };`,
      ),
      ['breakpoint'],
    );
    assert.deepEqual(
      md(
        `import defaultTheme from 'tailwindcss/defaultTheme';\nexport default { theme: { screens: defaultTheme.screens } };`,
      ),
      [],
    );
    // A set the config does not spell out still replaces the defaults.
    assert.deepEqual(
      md(
        `import defaultTheme from 'tailwindcss/defaultTheme';\nimport screens from './screens';\nexport default { theme: { screens } };`,
      ),
      ['breakpoint'],
    );
    // A spread of anything but Tailwind's own defaults replaces them.
    assert.deepEqual(
      md(
        `const custom = { screens: { mobile: '650px' } };\nexport default { theme: { screens: { ...custom.screens } } };`,
      ),
      ['breakpoint'],
    );
    // An application object with a `screens` key is not Tailwind's.
    assert.deepEqual(
      md(
        `export default { theme: {} };\nexport const device = { screens: { home: 'main' } };`,
      ),
      [],
    );
    assert.deepEqual(
      md(
        `export default { theme: {} };\nexport const ui = { layout: { screens: { md: '650px' } } };`,
      ),
      [],
    );
    // Nor is a `theme` object anywhere but the Tailwind config.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'DESIGN.md': renderDesignMd({
              ...SPEC,
              breakpoints: [{ maxWidth: 768, changes: ['stack'] }],
            }),
            'src/styles.css': css,
            'src/Signup.tsx': `export const Signup = () => <form className="md:grid" />;`,
            'src/settings.ts': `export const settings = { theme: { screens: { compact: '650px' } } };`,
          }),
        ),
        'errors',
      ),
      [],
    );
    // A name the project never configured is no breakpoint.
    assert.deepEqual(
      checks(
        checkDesign(
          project({ 'src/styles.css': css, 'src/Signup.tsx': signup }),
        ),
        'errors',
      ),
      ['breakpoint'],
    );
  });
});

describe('the image-alt check, following a value to its sink', () => {
  const HERO = `'<img src="/hero.jpg">'`;
  const errors = (files: Record<string, string>) =>
    checks(checkDesign(project(files)), 'errors');
  const docs = (code: string) =>
    errors({ 'src/Docs.tsx': `${code}\nexport const Docs = () => <div />;` });

  it('reads a declaration whose type holds an arrow (#227)', () => {
    const TYPE = '(() => string) | string';
    // Declared and sunk in one file.
    assert.deepEqual(
      docs(`const markup: ${TYPE} = ${HERO};\nroot.innerHTML = markup;`),
      ['alt'],
    );
    // Exported every way an export can name it, and sunk by the importer.
    for (const exporter of [
      `export const markup: ${TYPE} = ${HERO};`,
      `const markup: ${TYPE} = ${HERO};\nexport { markup };`,
    ]) {
      assert.deepEqual(
        errors({
          'src/markup.ts': exporter,
          'src/Docs.tsx': `import { markup } from './markup';\nroot.innerHTML = markup;\nexport const Docs = () => <div />;`,
        }),
        ['alt'],
        exporter,
      );
    }
    assert.deepEqual(
      errors({
        'src/markup.ts': `const hero: ${TYPE} = ${HERO};\nexport default hero;`,
        'src/Docs.tsx': `import hero from './markup';\nroot.innerHTML = hero;\nexport const Docs = () => <div />;`,
      }),
      ['alt'],
    );
    assert.deepEqual(
      errors({
        'src/markup.ts': `const markup: ${TYPE} = ${HERO};\nexport { markup as hero };`,
        'src/Docs.tsx': `import { hero } from './markup';\nroot.innerHTML = hero;\nexport const Docs = () => <div />;`,
      }),
      ['alt'],
    );
    // A typed local the importer passes the import through.
    assert.deepEqual(
      errors({
        'src/markup.ts': `export const markup = ${HERO};`,
        'src/Docs.tsx': `import { markup } from './markup';\nconst html: ${TYPE} = markup;\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      }),
      ['alt'],
    );
  });

  it('reads where a sink expression ends from the grammar, not the line end', () => {
    // The text rules ended these at the line end, so the image after it
    // never counted as handed to the sink.
    for (const code of [
      `async function f() { root.innerHTML = await\n  load(${HERO}); }\nf();`,
      `root.innerHTML = x\n  instanceof Y ? '<p>ok</p>' : ${HERO};`,
      `root.innerHTML = typeof\n  x === 'string' ? x : ${HERO};`,
      // `void` binds tighter than these, so the fallback is what renders.
      `root.innerHTML = void 0 || ${HERO};`,
      `root.innerHTML = void 0 ?? ${HERO};`,
      `root.innerHTML = void x ? '<p>ok</p>' : ${HERO};`,
      `root.innerHTML = void (0) || ${HERO};`,
    ]) {
      assert.deepEqual(docs(code), ['alt'], code);
    }
    // And a value the grammar gives no image to is still clean.
    for (const code of [
      `root.innerHTML = void\n${HERO};`,
      `root.innerHTML = void (0 || ${HERO});`,
      `const views = wide ? { hero: '<p>ok</p>' } : { safe: ${HERO} };\nroot.innerHTML = views.hero;`,
      `const templates = <T,>() => ({ hero: ${HERO}, safe: '<p>ok</p>' });\nroot.innerHTML = templates<string>().safe;`,
    ]) {
      assert.deepEqual(docs(code), [], code);
    }
  });

  it('lets a parameter hide a const declared after its function (#226)', () => {
    // Inside `show`, `html` is the parameter, and the only call passes
    // safe markup, wherever the outer `html` is written.
    for (const code of [
      `function show(html) { root.innerHTML = html; }\nconst html = ${HERO};\nshow('<p>ok</p>');`,
      `const html = ${HERO};\nfunction show(html) { root.innerHTML = html; }\nshow('<p>ok</p>');`,
      `const show = (html) => { root.innerHTML = html; };\nshow('<p>ok</p>');\nconst html = ${HERO};`,
      `function show(opts) { root.innerHTML = opts.hero; }\nshow({ hero: '<p>ok</p>' });\nconst opts = { hero: ${HERO} };`,
      // A concise arrow's body ends with its expression (internal PR 249 review).
      `const show = (html) => root.innerHTML = html;\nshow('<p>ok</p>');\nconst html = ${HERO};`,
      `const show = html => (root.innerHTML = html);\nshow('<p>ok</p>');\nconst html = ${HERO};`,
    ]) {
      assert.deepEqual(docs(code), [], code);
    }
    // A const declared inside the function is still what it renders.
    assert.deepEqual(
      docs(
        `function show(html) { const inner = ${HERO}; root.innerHTML = inner; }\nshow('<p>ok</p>');`,
      ),
      ['alt'],
    );
  });
});

describe('what every generated page must hold', () => {
  it('needs a language and a viewport', () => {
    const report = checkDesign(
      project({
        'index.html': `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet"></head><body></body></html>`,
      }),
    );
    assert.deepEqual(checks(report, 'errors').sort(), ['lang', 'viewport']);
  });

  it('reads markup past its comments', () => {
    // A commented-out viewport is not a viewport; a commented-out image is
    // not an image without alt.
    const report = checkDesign(
      project({
        'index.html': `<!doctype html><html lang="en"><head><!-- <meta name="viewport" content="width=device-width"> --><link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet"></head><body></body></html>`,
        'src/Old.tsx': `export const Old = () => <div>{/* <img src="/old.jpg"> */}</div>;`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['viewport']);
  });

  it('needs the viewport to say what it is', () => {
    const fonts = `<link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet">`;
    for (const meta of [
      '<meta name="viewport">',
      '<meta name="viewport" content="user-scalable=yes">',
      '<meta name="viewport" content="initial-scale=">',
      '<meta name="viewport" content="width=device-widthish">',
      '<meta name=viewport content=foo initial-scale=1>',
    ]) {
      const report = checkDesign(
        project({
          'index.html': `<!doctype html><html lang="en"><head>${meta}${fonts}</head><body></body></html>`,
        }),
      );
      assert.deepEqual(checks(report, 'errors'), ['viewport'], meta);
    }
    assert.deepEqual(
      checkDesign(
        project({
          'index.html': `<!doctype html><html lang="en"><head><meta name="viewport" content="initial-scale=1">${fonts}</head><body></body></html>`,
        }),
      ).errors,
      [],
    );
  });

  it('reads a viewport named without quotes', () => {
    const report = checkDesign(
      project({
        'index.html': `<!doctype html><html lang="en"><head><meta name=viewport content="width=device-width"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet"></head><body></body></html>`,
      }),
    );
    assert.deepEqual(report.errors, []);
  });

  it('reads a language written without quotes', () => {
    const report = checkDesign(
      project({
        'index.html': `<!doctype html><html lang=en><head><meta name="viewport" content="width=device-width"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display&family=DM+Sans" rel="stylesheet"></head><body></body></html>`,
      }),
    );
    assert.deepEqual(report.errors, []);
  });

  it('needs alt text on every image', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `export const Hero = () => <img src="/hero.jpg" />;`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['alt']);
    assert.deepEqual(
      checkDesign(
        project({
          'src/Hero.tsx': `export const Hero = () => <img src="/hero.jpg" alt="" />;`,
        }),
      ).errors,
      [],
    );
  });

  it('does not take an <img> inside a string for an image', () => {
    const page = (tsx: string) =>
      checks(checkDesign(project({ 'src/Docs.tsx': tsx })), 'errors');
    assert.deepEqual(
      page(`export const Docs = () => <pre>{'<img src="photo.jpg">'}</pre>;`),
      [],
    );
    assert.deepEqual(
      page(
        `const sample = "<img src='photo.jpg'>";\nexport const Docs = () => <pre>{sample}</pre>;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        'const sample = `<img src="photo.jpg">`;\nexport const Docs = () => <pre>{sample}</pre>;',
      ),
      [],
    );
    // A backtick inside `${...}` does not end the literal.
    assert.deepEqual(
      page(
        'const sample = `<p>${wide ? `a` : \'b\'}</p><img src="x.jpg">`;\nexport const Docs = () => <pre>{sample}</pre>;',
      ),
      [],
    );
    // A string handed to something that parses it as markup is rendered.
    for (const sink of [
      `export const Docs = () => <div dangerouslySetInnerHTML={{ __html: '<img src="/hero.jpg">' }} />;`,
      'el.innerHTML = `<img src="/hero.jpg">`;\nexport const Docs = () => <div />;',
      `el.insertAdjacentHTML('beforeend', '<img src="/hero.jpg">');\nexport const Docs = () => <div />;`,
      // A property of an object renders what that property holds.
      `const bundle = { safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle.hero;\nexport const Docs = () => <div />;`,
      // React's shorthand property hands over the binding of that name.
      `const __html = '<img src="/hero.jpg">';\nexport const Docs = () => <div dangerouslySetInnerHTML={{ __html }} />;`,
    ]) {
      assert.deepEqual(page(sink), ['alt'], sink);
    }
    // A sink in a named function nothing refers to never runs; one that is
    // called, exported, or has no name may.
    for (const [code, expected] of [
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nview.render();`,
        ['alt'],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };`,
        [],
      ],
      // A same-named binding elsewhere does not call the method.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconst render = 'label';`,
        [],
      ],
      // A class method is called through an instance.
      [
        `class View { render() { root.innerHTML = '<img src="/hero.jpg">'; } }\nnew View().render();`,
        ['alt'],
      ],
      // A method of an exported object may be called elsewhere.
      [
        `export const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };`,
        ['alt'],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nexport { view };`,
        ['alt'],
      ],
      [
        `export default { render() { root.innerHTML = '<img src="/hero.jpg">'; } };`,
        ['alt'],
      ],
      [
        `export const view = { nested: { render() { root.innerHTML = '<img src="/hero.jpg">'; } } };`,
        ['alt'],
      ],
      [
        `const view = { nested: { render() { root.innerHTML = '<img src="/hero.jpg">'; } } };`,
        [],
      ],
      // An object handed on may have its methods called under another
      // name.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nfunction register(x) { x.render(); }\nregister(view);`,
        ['alt'],
      ],
      // A named function expression runs however it is used.
      [
        `function make() { return '<img src="/hero.jpg">'; }\n(function show() { root.innerHTML = make(); })();`,
        ['alt'],
      ],
      [
        `button.addEventListener('click', function onClick() { root.innerHTML = '<img src="/hero.jpg">'; });`,
        ['alt'],
      ],
      [
        `const run = function show() { root.innerHTML = '<img src="/hero.jpg">'; };\nrun();`,
        ['alt'],
      ],
      // A key worked out when it runs may name any method.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconst action = 'render';\nview[action]();`,
        ['alt'],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconsole.log(view['other']);`,
        [],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconsole.log(view[ 'other']);`,
        [],
      ],
      // Anywhere in what a module exports.
      [
        `export const views = [{ render() { root.innerHTML = '<img src="/hero.jpg">'; } }];`,
        ['alt'],
      ],
      [
        `export const view = { 'nested': { render() { root.innerHTML = '<img src="/hero.jpg">'; } } };`,
        ['alt'],
      ],
      [
        `const views = [{ render() { root.innerHTML = '<img src="/hero.jpg">'; } }];\nexport default views;`,
        ['alt'],
      ],
      // Not an object a local of an exported function holds: only that
      // function reaches it. One it returns reaches its callers.
      [
        `export default function App() { const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } }; return null; }`,
        [],
      ],
      [
        `export const App = () => { const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } }; return null; };`,
        [],
      ],
      [
        `export default function App() { const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } }; view.render(); return null; }`,
        ['alt'],
      ],
      [
        `export default function App() { return { render() { root.innerHTML = '<img src="/hero.jpg">'; } }; }`,
        ['alt'],
      ],
      // Each declarator of what a module exports.
      [
        `export const version = 1, view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };`,
        ['alt'],
      ],
      [
        `const version = 1, view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nexport { view };`,
        ['alt'],
      ],
      [
        `export const version = 1, other = 2;\nconst view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };`,
        [],
      ],
      // A use of the owner's name that another binding holds is not it.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nfunction inspect(view) { console.log(view); }\ninspect(1);`,
        [],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nfunction inspect() { const view = {}; console.log(view); }\ninspect();`,
        [],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nfunction inspect(view) { return view[action](); }\ninspect(1);`,
        [],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nfunction inspect() { console.log(view); }\ninspect();`,
        ['alt'],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; }, run(view) { this[view](); } };\nview.run('render');`,
        ['alt'],
      ],
      // Nor by an overload's signature.
      [
        `function never(): void;\nfunction never() { root.innerHTML = '<img src="/hero.jpg">'; }`,
        [],
      ],
      // A method called through brackets is called.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nview['render']();`,
        ['alt'],
      ],
      // A method taken out of its object is called by that name.
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconst { render } = view;\nrender();`,
        ['alt'],
      ],
      [
        `const view = { render() { root.innerHTML = '<img src="/hero.jpg">'; } };\nconst { other } = view;`,
        [],
      ],
      [`function never() { root.innerHTML = '<img src="/hero.jpg">'; }`, []],
      [
        `function shown() { root.innerHTML = '<img src="/hero.jpg">'; }\nshown();`,
        ['alt'],
      ],
      [
        `export function shown() { root.innerHTML = '<img src="/hero.jpg">'; }`,
        ['alt'],
      ],
      [
        `button.addEventListener('click', () => { root.innerHTML = '<img src="/hero.jpg">'; });`,
        ['alt'],
      ],
      [
        `const markup = '<img src="/hero.jpg">';\nfunction never() { root.innerHTML = markup; }`,
        [],
      ],
    ] as const) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        expected,
        code,
      );
    }
    // What another file exports and this one hands to a sink is rendered,
    // however it is imported and exported; an import used otherwise is not.
    const HERO = `'<img src="/hero.jpg">'`;
    for (const [exporter, importer, expected] of [
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nroot.innerHTML = markup;`,
        ['alt'],
      ],
      [
        `export const markup = ${HERO};`,
        `import { markup as html } from './markup.js';\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const hero = ${HERO};\nexport default hero;`,
        `import hero from './markup';\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const markup = ${HERO};\nexport { markup };`,
        `import { markup } from './markup';\nroot.innerHTML = markup;`,
        ['alt'],
      ],
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nconsole.log(markup.length);\nroot.innerHTML = other;`,
        [],
      ],
      // An export list that renames follows the local binding.
      [
        `const markup = ${HERO};\nexport { markup as hero };`,
        `import { hero } from './markup';\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      // React's shorthand hands over the import called `__html`.
      [
        `export const __html = ${HERO};`,
        `import { __html } from './markup';\nexport const Hero = () => <div dangerouslySetInnerHTML={{ __html }} />;`,
        ['alt'],
      ],
      // A parameter of the same name is what the sink is handed.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nexport function render(markup) { root.innerHTML = markup; }\nrender('<p>safe</p>');`,
        [],
      ],
      // Wrapped in a call or a template on the way to the sink.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nroot.innerHTML = sanitize(markup);`,
        ['alt'],
      ],
      [
        `export const markup = ${HERO};`,
        "import { markup } from './markup';\nroot.innerHTML = `<div>${markup}</div>`;",
        ['alt'],
      ],
      // Through a nested member, or destructured from the import.
      [
        `export const bundle = { section: { safe: '<p>ok</p>', example: ${HERO} } };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.section.safe;`,
        [],
      ],
      [
        `export const bundle = { section: { safe: '<p>ok</p>', example: ${HERO} } };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.section.example;`,
        ['alt'],
      ],
      [
        `export const bundle = { hero: ${HERO}, safe: '<p>ok</p>' };`,
        `import { bundle } from './markup';\nconst { hero } = bundle;\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      // A name destructured from a value written out here is not the
      // import it shadows.
      [
        `export const html = ${HERO};`,
        `import { html } from './markup';\nfunction show() {\n  const [html] = ['<p>ok</p>'];\n  root.innerHTML = html;\n}\nshow();`,
        [],
      ],
      // A shorthand property of an exported object, or one holding an
      // import.
      [
        `const hero = ${HERO};\nexport const bundle = { hero, safe: '<p>ok</p>' };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `const hero = ${HERO};\nexport const bundle = { hero, safe: '<p>ok</p>' };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.safe;`,
        [],
      ],
      [
        `export const hero = ${HERO};`,
        `import { hero } from './markup';\nconst bundle = { hero };\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `export const hero = ${HERO};`,
        `import { hero } from './markup';\nconst bundle = { hero, safe: '<p>ok</p>' };\nroot.innerHTML = bundle.safe;`,
        [],
      ],
      // An alias of an import set to something else before the sink does
      // not render the import; set to the import, it does.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nlet html = markup;\nhtml = '<p>ok</p>';\nroot.innerHTML = html;`,
        [],
      ],
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nlet html = '<p>ok</p>';\nhtml = markup;\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nconst bundle = { hero: '<p>ok</p>' };\nbundle.hero = markup;\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nconst bundle = { hero: markup };\nbundle.hero = '<p>ok</p>';\nroot.innerHTML = bundle.hero;`,
        [],
      ],
      // An element of an imported array, by index or by position.
      [
        `export const pages = ['<p>ok</p>', ${HERO}];`,
        `import { pages } from './markup';\nroot.innerHTML = pages[0];`,
        [],
      ],
      [
        `export const pages = ['<p>ok</p>', ${HERO}];`,
        `import { pages } from './markup';\nroot.innerHTML = pages[1];`,
        ['alt'],
      ],
      [
        `export const pages = ['<p>ok</p>', ${HERO}];`,
        `import { pages } from './markup';\nconst [, html] = pages;\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export const pages = ['<p>ok</p>', ${HERO}];`,
        `import { pages } from './markup';\nconst [html] = pages;\nroot.innerHTML = html;`,
        [],
      ],
      // What an imported helper called at a sink returns.
      [
        `export function render() { return ${HERO}; }`,
        `import { render } from './markup';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      // ... or from a destructuring default.
      [
        `export function make() { return ${HERO}; }`,
        `import { make } from './markup';\nconst { html = make() } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import { render } from './markup';\nconsole.log(render());\nroot.innerHTML = '<p>ok</p>';`,
        [],
      ],
      // Exported under another name, as the default, or through a namespace.
      [
        `function make() { return ${HERO}; }\nexport { make as render };`,
        `import { render } from './markup';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [
        `export default function make() { return ${HERO}; }`,
        `import render from './markup';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [
        `export default () => ${HERO};`,
        `import render from './markup';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as templates from './markup';\nroot.innerHTML = templates.render();`,
        ['alt'],
      ],
      // A namespace's helper a destructuring default calls.
      [
        `export function make() { return ${HERO}; }`,
        `import * as templates from './markup';\nconst { html = templates.make() } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export function make() { return '<p>ok</p>'; }`,
        `import * as templates from './markup';\nconst { html = templates.make() } = {};\nroot.innerHTML = html;`,
        [],
      ],
      // The part read of what an imported helper returns.
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates().hero;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates().safe;`,
        [],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nroot.innerHTML = t.templates().hero;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nroot.innerHTML = t.templates().safe;`,
        [],
      ],
      [
        `export async function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nexport async function load() { root.innerHTML = (await templates()).hero; }`,
        ['alt'],
      ],
      // A member of a namespace called by a key written out.
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t['render']();`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t["render"]();`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t[\`render\`]();`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t?.['render']();`,
        ['alt'],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t['other']();`,
        [],
      ],
      [
        `export function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t['re' + 'nder']();`,
        [],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nroot.innerHTML = t['templates']().safe;`,
        [],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nconst { html = t['templates']().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A key with brackets in it is read like any other.
      [
        `export const bundle = { 'hero()x': ${HERO}, safe: '<p>ok</p>' };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle['hero()x'];`,
        ['alt'],
      ],
      [
        `export const bundle = { 'hero()x': ${HERO}, safe: '<p>ok</p>' };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.safe;`,
        [],
      ],
      [
        `export default <T,>() => ${HERO};`,
        `import render from './markup';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      // A property of an exported helper is no call of it.
      [
        `export function templates() { return { hero: ${HERO} }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates.hero;`,
        [],
      ],
      // Not awaited, an async helper hands the sink a promise.
      [
        `export async function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates().hero;`,
        [],
      ],
      [
        `export async function render() { return ${HERO}; }`,
        `import { render } from './markup';\nroot.innerHTML = render();`,
        [],
      ],
      [
        `export async function render() { return ${HERO}; }`,
        `import * as t from './markup';\nroot.innerHTML = t.render();`,
        [],
      ],
      [
        `export async function render() { return ${HERO}; }`,
        `import * as t from './markup';\nexport async function load() { root.innerHTML = await t.render(); }`,
        ['alt'],
      ],
      [
        `export default async function () { return ${HERO}; }`,
        `import render from './markup';\nroot.innerHTML = render();`,
        [],
      ],
      [
        `export async function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nexport async function load() { const { html = (await templates()).hero } = {}; root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `export async function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nexport async function load() { const { html = (await t.templates()).hero } = {}; root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `export default async function () { return ${HERO}; }`,
        `import render from './markup';\nexport async function load() { root.innerHTML = await render(); }`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nconst { html = templates().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nconst { html = t.templates().safe } = {};\nroot.innerHTML = html;`,
        [],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nconst { html = t.templates().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates?.().hero;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nroot.innerHTML = t.templates?.().hero;`,
        ['alt'],
      ],
      [
        `export function templates() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nconst { html = templates?.().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export function templates<T>() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nroot.innerHTML = templates<string>().hero;`,
        ['alt'],
      ],
      [
        `export function templates<T>() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import * as t from './markup';\nroot.innerHTML = t.templates<string>().hero;`,
        ['alt'],
      ],
      [
        `export function templates<T>() { return { hero: ${HERO}, safe: '<p>ok</p>' }; }`,
        `import { templates } from './markup';\nconst { html = templates<string>().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A helper of this file with the import's name is not the import.
      [
        `export function make() { return ${HERO}; }`,
        `import { make } from './markup';\nfunction run() { function make() { return '<p>ok</p>'; }\nconst { html = make() } = {};\nroot.innerHTML = html; }\nrun();`,
        [],
      ],
      [
        `export function make() { return ${HERO}; }`,
        `import { make } from './markup';\nfunction run() { const make = () => '<p>ok</p>'; root.innerHTML = make(); }\nrun();`,
        [],
      ],
      [
        `export function make() { return ${HERO}; }`,
        `import * as t from './markup';\nfunction run(t) { root.innerHTML = t.make(); }\nrun({ make: () => '<p>ok</p>' });`,
        [],
      ],
      [
        `export function make() { return ${HERO}; }`,
        `import * as t from './markup';\nfunction run(t) { const { html = t.make() } = {}; root.innerHTML = html; }\nrun({ make: () => '<p>ok</p>' });`,
        [],
      ],
      // A local copy of a nested member of the import.
      [
        `export const bundle = { section: { hero: ${HERO}, safe: '<p>ok</p>' } };`,
        `import { bundle } from './markup';\nconst html = bundle.section.hero;\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `export const bundle = { section: { hero: ${HERO}, safe: '<p>ok</p>' } };`,
        `import { bundle } from './markup';\nconst html = bundle.section.safe;\nroot.innerHTML = html;`,
        [],
      ],
      // Through a local copy of the import.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nconst html = markup;\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A same-named binding later, in another function, is not the sink's.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nroot.innerHTML = markup;\nexport function helper() { const markup = '<p>safe</p>'; return markup; }`,
        ['alt'],
      ],
      // A local binding that is not a copy is what the sink is handed.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nexport function show() { const markup = '<p>' + 'safe</p>'; root.innerHTML = markup; }`,
        [],
      ],
      // Through a named import, the member it reads, not the rest.
      [
        `export const bundle = { safe: '<p>ok</p>', example: ${HERO} };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.safe;`,
        [],
      ],
      [
        `export const bundle = { safe: '<p>ok</p>', example: ${HERO} };`,
        `import { bundle } from './markup';\nroot.innerHTML = bundle.example;`,
        ['alt'],
      ],
      // A sink in a function that never runs hands over nothing.
      [
        `export const markup = ${HERO};`,
        `import { markup } from './markup';\nfunction never() { root.innerHTML = markup; }`,
        [],
      ],
      // Through a namespace, the member it reads.
      [
        `export const hero = ${HERO};`,
        `import * as templates from './markup';\nroot.innerHTML = templates.hero;`,
        ['alt'],
      ],
      [
        `export const hero = ${HERO};\nexport const safe = '<p>ok</p>';`,
        `import * as templates from './markup';\nroot.innerHTML = templates.safe;`,
        [],
      ],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/markup.ts': exporter,
              'src/Docs.tsx': `${importer}\nexport const Docs = () => <div />;`,
            }),
          ),
          'errors',
        ),
        expected,
        importer,
      );
    }
    // Through a barrel that re-exports the module as a namespace.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'src/markup.ts': `export const hero = '<img src="/hero.jpg">';\nexport const safe = '<p>ok</p>';`,
            'src/index.ts': `export * as templates from './markup';`,
            'src/Docs.tsx': `import { templates } from './index';\nroot.innerHTML = templates.hero;\nexport const Docs = () => <div />;`,
          }),
        ),
        'errors',
      ),
      ['alt'],
    );
    // Through a barrel that re-exports it, by name, renamed, or all.
    for (const barrel of [
      `export { markup } from './markup';`,
      `export { markup as hero } from './markup';`,
      `export * from './markup';`,
    ]) {
      const name = barrel.includes('hero') ? 'hero' : 'markup';
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/markup.ts': `export const markup = '<img src="/hero.jpg">';`,
              'src/index.ts': barrel,
              'src/Docs.tsx': `import { ${name} } from './index';\nroot.innerHTML = ${name};\nexport const Docs = () => <div />;`,
            }),
          ),
          'errors',
        ),
        ['alt'],
        barrel,
      );
    }
    // And one passed with a type asserted before it.
    for (const [call, expected] of [
      [`show(<Options>{ markup: '<p>safe</p>' })`, []],
      [`show(<Options>{ other: '<p>safe</p>' })`, ['alt']],
      [`show(<Options>({ markup: '<p>safe</p>' }))`, []],
      [`plain(<string>'<p>ok</p>')`, []],
      [`plain(<string>other)`, ['alt']],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/view.ts': `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nfunction plain(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n${call};`,
            }),
          ),
          'errors',
        ),
        expected,
        call,
      );
    }
    // In a script, a type asserted before a value (`<Views>{ ... }`) keeps it.
    for (const [body, read, expected] of [
      [
        `<Views>{ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }`,
        'hero',
        ['alt'],
      ],
      [
        `<Views>{ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }`,
        'safe',
        [],
      ],
      [
        `<Views>({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' })`,
        'hero',
        ['alt'],
      ],
      [
        `wide ? <Views>{ hero: '<p>ok</p>' } : <Views>{ hero: '<img src="/hero.jpg">' }`,
        'hero',
        ['alt'],
      ],
      [`<Views>view`, 'hero', []],
      [`<Views>markup`, 'hero', ['alt']],
      [`<Partial<Views>>{ hero: '<img src="/hero.jpg">' }`, 'hero', ['alt']],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/view.ts': `const view = { hero: '<p>ok</p>' };\nconst markup = { hero: '<img src="/hero.jpg">' };\nfunction templates(wide) { return ${body}; }\nroot.innerHTML = templates(true).${read};`,
            }),
          ),
          'errors',
        ),
        expected,
        body,
      );
    }
    // The part of what a helper returns, through a barrel, and of what an
    // async one returns only when it is awaited.
    for (const [read, expected] of [
      ['hero', ['alt']],
      ['safe', []],
    ] as const) {
      for (const [call, found] of [
        [`(await templates()).${read}`, expected],
        [`templates().${read}`, []],
      ] as const) {
        assert.deepEqual(
          checks(
            checkDesign(
              project({
                'src/markup.ts': `export async function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }`,
                'src/index.ts': `export { templates } from './markup';`,
                'src/Docs.tsx': `import { templates } from './index';\nexport async function load() { root.innerHTML = ${call}; }\nexport const Docs = () => <div />;`,
              }),
            ),
            'errors',
          ),
          found,
          call,
        );
      }
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/markup.ts': `export function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }`,
              'src/index.ts': `export { templates } from './markup';`,
              'src/Docs.tsx': `import { templates } from './index';\nroot.innerHTML = templates().${read};\nexport const Docs = () => <div />;`,
            }),
          ),
          'errors',
        ),
        expected,
        read,
      );
    }
    // A name inside what the sink is handed, not only the first.
    assert.deepEqual(
      page(
        `const markup = '<img src="/hero.jpg">';\nroot.innerHTML = sanitize(markup);\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `const prefix = '<p>';\nconst markup = '<img src="/hero.jpg">';\nroot.innerHTML = prefix + markup;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // What a local helper it calls returns is rendered: a literal it hands
    // back, or a name it returns.
    for (const helper of [
      `function render() { return '<img src="/hero.jpg">'; }`,
      `const render = () => '<img src="/hero.jpg">';`,
      `const markup = '<img src="/hero.jpg">';\nfunction render() { return markup; }`,
    ]) {
      assert.deepEqual(
        page(
          `${helper}\nroot.innerHTML = render();\nexport const Docs = () => <div />;`,
        ),
        ['alt'],
        helper,
      );
    }
    // A parameter a sink reads is what callers pass for it.
    assert.deepEqual(
      page(
        `function show(markup) { root.innerHTML = markup; }\nshow('<img src="/hero.jpg">');\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `function show(markup) { root.innerHTML = markup; }\nshow('<p>ok</p>');\nconst sample = '<img src="/x.jpg">';\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A component nothing renders puts no image on the page; one that is
    // rendered does.
    assert.deepEqual(
      page(
        `const Unused = () => <img src="/unused.jpg" />;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `const Hero = () => <img src="/hero.jpg" />;\nexport const Docs = () => <Hero />;`,
      ),
      ['alt'],
    );
    // A call that never runs passes nothing.
    assert.deepEqual(
      page(
        `function show(markup) { root.innerHTML = markup; }\nfunction never() { show('<img src="/x.jpg">'); }\nshow('<p>ok</p>');\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A method called on an object written out renders what it returns,
    // not the object's other methods; a method of anything else uses the
    // whole value.
    const methods = `const templates = { safe() { return '<p>ok</p>'; }, example() { return '<img src="/hero.jpg">'; }, hero: () => '<img src="/hero.jpg">' };`;
    assert.deepEqual(
      page(
        `${methods}\nroot.innerHTML = templates.safe();\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    for (const call of ['templates.example()', 'templates.hero()']) {
      assert.deepEqual(
        page(
          `${methods}\nroot.innerHTML = ${call};\nexport const Docs = () => <div />;`,
        ),
        ['alt'],
        call,
      );
    }
    assert.deepEqual(
      page(
        `const markup = '<img src="/hero.jpg">';\nroot.innerHTML = markup.trim();\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A local copy of a local binding is followed to it.
    assert.deepEqual(
      page(
        `const markup = '<img src="/hero.jpg">';\nconst html = markup;\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A helper nothing hands to a sink renders nothing.
    assert.deepEqual(
      page(
        `function render() { return '<img src="/hero.jpg">'; }\nconsole.log(render());\nroot.innerHTML = '<p>ok</p>';\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A function it calls is not what it renders: a helper that strips an
    // example image from the value renders nothing of its own.
    assert.deepEqual(
      page(
        `const strip = (html) => html.replace('<img src="x.jpg">', '');\nconst markup = '<p>ok</p>';\nroot.innerHTML = strip(markup);\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A chain of members reads the one property at its end.
    assert.deepEqual(
      page(
        `const bundle = { section: { safe: '<p>ok</p>', example: '<img src="/hero.jpg">' } };\nroot.innerHTML = bundle.section.safe;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `const bundle = { section: { safe: '<p>ok</p>', example: '<img src="/hero.jpg">' } };\nroot.innerHTML = bundle.section.example;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A destructured name is that property of the object it came from.
    assert.deepEqual(
      page(
        `const bundle = { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' };\nconst { hero } = bundle;\nroot.innerHTML = hero;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `const bundle = { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' };\nconst { safe: html } = bundle;\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A numeric index reads that element of an array written out.
    const pages = `const pages = ['<p>ok</p>', '<img src="/hero.jpg">'];`;
    for (const [sink, expected] of [
      ['pages[0]', []],
      ['pages[1]', ['alt']],
      ['pages', ['alt']],
      ['pages[2]', []],
    ] as const) {
      assert.deepEqual(
        page(
          `${pages}\nroot.innerHTML = ${sink};\nexport const Docs = () => <div />;`,
        ),
        expected,
        sink,
      );
    }
    // Through a copy, or into an object inside the array.
    assert.deepEqual(
      page(
        `${pages}\nconst html = pages[0];\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `const pages = [{ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' }];\nroot.innerHTML = pages[0].safe;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `const pages = [{ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' }];\nroot.innerHTML = pages[0].hero;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A spread before the element leaves its position unknown.
    assert.deepEqual(
      page(
        `const pages = [...['<p>a</p>', '<img src="/hero.jpg">'], '<p>ok</p>'];\nroot.innerHTML = pages[1];\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // An array pattern reads the element at its position.
    for (const [pattern, expected] of [
      ['const [html] = pages', []],
      ['const [, html] = pages', ['alt']],
      ['const [html = ""] = pages', []],
      ['const [...html] = pages', ['alt']],
      [`const [html] = ['<img src="/hero.jpg">']`, ['alt']],
      [`const [html] = ['<p>ok</p>', '<img src="/hero.jpg">']`, []],
      [`const [, html] = ['<p>ok</p>', '<img src="/hero.jpg">']`, ['alt']],
      [`const { hero: html } = { hero: '<img src="/hero.jpg">' }`, ['alt']],
      [`const { safe: html } = { safe: '<p>ok</p>', hero: '<img>' }`, []],
    ] as const) {
      assert.deepEqual(
        page(
          `${pages}\n${pattern};\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
        ),
        expected,
        pattern,
      );
    }
    // A rest of an array renumbers its elements, so it stands for all of
    // them; a pattern reads through a member chain too.
    assert.deepEqual(
      page(
        `${pages}\nconst [, ...html] = pages;\nroot.innerHTML = html[0];\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `const data = { pages: ['<p>ok</p>', '<img src="/hero.jpg">'] };\nconst [, html] = data.pages;\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A part that is only another name is that name's value: a shorthand
    // property, a property or element set to a name, or what a spread
    // brings.
    const img = `const hero = '<img src="/hero.jpg">';\nconst markup = '<p>ok</p>';`;
    for (const [value, sink, expected] of [
      ['{ hero }', 'bundle.hero', ['alt']],
      ['{ markup, hero }', 'bundle.markup', []],
      ['{ html: hero }', 'bundle.html', ['alt']],
      ['{ html: markup, hero }', 'bundle.html', []],
      ['[hero]', 'bundle[0]', ['alt']],
      ['[markup, hero]', 'bundle[0]', []],
      ['{ ...{ hero }, markup }', 'bundle.hero', ['alt']],
      ['{ section: { hero } }', 'bundle.section.hero', ['alt']],
      [`{ ...{ hero: '<img src="/a.jpg">' }, markup }`, 'bundle.hero', ['alt']],
      ['{ section: { ...{ hero } }, markup }', 'bundle.hero', []],
      // The last write of a property is the one rendered.
      [`{ hero: '<img src="/a.jpg">', hero: '<p>ok</p>' }`, 'bundle.hero', []],
      [
        `{ hero: '<p>ok</p>', hero: '<img src="/a.jpg">' }`,
        'bundle.hero',
        ['alt'],
      ],
      ["{ hero, hero: '<p>ok</p>' }", 'bundle.hero', []],
      ["{ hero: '<p>ok</p>', ...{ hero } }", 'bundle.hero', ['alt']],
      ["{ ...{ hero }, hero: '<p>ok</p>' }", 'bundle.hero', []],
      ['{ hero: markup, ...{ markup } }', 'bundle.hero', []],
    ] as const) {
      assert.deepEqual(
        page(
          `${img}\nconst bundle = ${value};\nroot.innerHTML = ${sink};\nexport const Docs = () => <div />;`,
        ),
        expected,
        `${value} ${sink}`,
      );
    }
    assert.deepEqual(
      page(
        `${img}\nconst base = { hero };\nconst bundle = { ...base, markup };\nroot.innerHTML = bundle.hero;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `${img}\nconst base = { hero };\nconst bundle = { hero: markup, ...base };\nroot.innerHTML = bundle.hero;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `${img}\nconst base = { hero };\nconst bundle = { ...base, markup };\nroot.innerHTML = bundle.markup;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A name reached through a member reads that member alone.
    assert.deepEqual(
      page(
        `const data = { safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' };\nconst bundle = { html: data.safe };\nroot.innerHTML = bundle.html;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `${img}\nconst { hero: html } = { hero };\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `${img}\nconst { hero: html } = { hero: markup, ...{ hero: '<img src="/a.jpg">' } };\nroot.innerHTML = html;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A method reached through a property written more than once is not
    // read as the first one's.
    assert.deepEqual(
      page(
        `const templates = { section: { safe() { return '<p>ok</p>'; } }, ...{ section: { safe() { return '<img src="/a.jpg">'; } } } };\nroot.innerHTML = templates.section.safe();\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A write to the member read, or to a part of the path to it, before
    // the sink replaces what the initialiser set; one to another member
    // does not.
    for (const [code, expected] of [
      [
        `const bundle = { hero: '<img src="/a.jpg">' };\nbundle.hero = '<p>ok</p>';\nroot.innerHTML = bundle.hero;`,
        [],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nbundle.hero = '<img src="/a.jpg">';\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nbundle['hero'] = '<img src="/a.jpg">';\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `const bundle = { hero: '<img src="/a.jpg">' };\nbundle['hero'] = '<p>ok</p>';\nroot.innerHTML = bundle.hero;`,
        [],
      ],
      [
        `const bundle = { hero: '<p>ok</p>', safe: '<p>ok</p>' };\nbundle.safe = '<img src="/a.jpg">';\nroot.innerHTML = bundle.hero;`,
        [],
      ],
      [
        `const bundle = { section: { hero: '<img src="/a.jpg">' } };\nbundle.section = { hero: '<p>ok</p>' };\nroot.innerHTML = bundle.section.hero;`,
        [],
      ],
      [
        `const bundle = { section: { hero: '<p>ok</p>' } };\nbundle.section = { hero: '<img src="/a.jpg">' };\nroot.innerHTML = bundle.section.hero;`,
        ['alt'],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nif (flag) bundle.hero = '<img src="/a.jpg">';\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
    ] as const) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        expected,
        code,
      );
    }
    // A parameter destructured from an argument is that part of it.
    for (const [code, expected] of [
      [
        `function render({ markup }) { root.innerHTML = markup; }\nrender({ markup: '<img src="/a.jpg">' });`,
        ['alt'],
      ],
      [
        `function render({ safe }) { root.innerHTML = safe; }\nrender({ safe: '<p>ok</p>', hero: '<img src="/a.jpg">' });`,
        [],
      ],
      [
        `function render({ hero: html }) { root.innerHTML = html; }\nrender({ hero: '<img src="/a.jpg">' });`,
        ['alt'],
      ],
      [
        `function render([html]) { root.innerHTML = html; }\nrender(['<img src="/a.jpg">']);`,
        ['alt'],
      ],
      [
        `function render([, html]) { root.innerHTML = html; }\nrender(['<img src="/a.jpg">', '<p>ok</p>']);`,
        [],
      ],
      [
        `function render(title, { markup }) { root.innerHTML = markup; }\nrender('Home', { markup: '<img src="/a.jpg">' });`,
        ['alt'],
      ],
      [
        `function render({ ...rest }) { root.innerHTML = rest.markup; }\nrender({ markup: '<img src="/a.jpg">' });`,
        ['alt'],
      ],
    ] as const) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        expected,
        code,
      );
    }
    // A rest of an object keeps its properties' names.
    assert.deepEqual(
      page(
        `const bundle = { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' };\nconst { ...rest } = bundle;\nroot.innerHTML = rest.safe;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A quoted bracket member reads that property alone.
    assert.deepEqual(
      page(
        `const bundle = { safe: '<p>ok</p>', example: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle['safe'];\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `const bundle = { safe: '<p>ok</p>', example: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle["example"];\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // Not the property beside it.
    assert.deepEqual(
      page(
        `const bundle = { safe: '<p>ok</p>', example: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle.safe;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // Anywhere in what the sink is handed, not only right after it.
    assert.deepEqual(
      page(
        `root.innerHTML = show ? '<img src="/hero.jpg">' : '';\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `const markup = show ? '<img src="/hero.jpg">' : '';\nroot.innerHTML = markup;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `document.write('<p>Hi</p>', '<img src="/hero.jpg">');\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // Past a line break the expression carries on over.
    assert.deepEqual(
      page(
        `root.innerHTML =\n  show ? '<img src="/hero.jpg">' : '';\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `root.innerHTML = show\n  ? '<img src="/hero.jpg">'\n  : '';\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    assert.deepEqual(
      page(
        `root.innerHTML = show ?\n  '<img src="/hero.jpg">' : '';\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // The binding the sink refers to, not a same-named one elsewhere.
    assert.deepEqual(
      page(
        `export function render(root) { const markup = '<p>Hi</p>'; root.innerHTML = markup; }\nfunction sample() { const markup = '<img src="/hero.jpg">'; return markup.length; }\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `function sample() { const markup = '<img src="/hero.jpg">'; return markup.length; }\nexport function render(root, markup) { root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A parameter of the function the sink is in shadows an outer binding.
    for (const render of [
      'export function render(root, markup) { root.innerHTML = markup; }',
      'export const render = (markup) => { root.innerHTML = markup; };',
      'export const render = markup => root.innerHTML = markup;',
    ]) {
      assert.deepEqual(
        page(
          `const markup = '<img src="/hero.jpg">';\n${render}\nexport const Docs = () => <div />;`,
        ),
        [],
        render,
      );
    }
    // A condition is not a parameter list.
    assert.deepEqual(
      page(
        `const markup = '<img src="/hero.jpg">';\nif (markup) { root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A brace inside a string is not the end of a block.
    assert.deepEqual(
      page(
        `export function render(root) { const markup = '<img src="/hero.jpg">'; const close = '}'; root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // What the name is set to again before the sink is rendered too.
    assert.deepEqual(
      page(
        `export function render(root) { let markup = ''; markup = '<img src="/hero.jpg">'; root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // Only what reaches the sink: an unconditional reassignment replaces
    // the value before it; a conditional one may not.
    assert.deepEqual(
      page(
        `export function render(root) { let markup = '<img src="/hero.jpg">'; markup = '<p>safe</p>'; root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        `export function render(root, wide) { let markup = '<img src="/hero.jpg">'; if (wide) markup = '<p>safe</p>'; root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // An assignment inside a function nothing calls never runs; one inside
    // a function that is called before the sink does.
    for (const [prepare, expected] of [
      [`function prepare() { markup = '<img src="/hero.jpg">'; }`, []],
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nprepare();`,
        ['alt'],
      ],
      [`const prepare = () => { markup = '<img src="/hero.jpg">'; };`, []],
      [
        `const prepare = () => { markup = '<img src="/hero.jpg">'; };\nprepare();`,
        ['alt'],
      ],
      [`const prepare = () => (markup = '<img src="/hero.jpg">');`, []],
      // A call inside a function nothing calls does not run either.
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nfunction never() { prepare(); }`,
        [],
      ],
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nfunction setup() { prepare(); }\nsetup();`,
        ['alt'],
      ],
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nfunction a() { b(); }\nfunction b() { a(); prepare(); }`,
        [],
      ],
      // An overload's signature does not run it.
      [
        `function prepare(): void;\nfunction prepare() { markup = '<img src="/hero.jpg">'; }`,
        [],
      ],
      [
        `function prepare(): void;\nfunction prepare() { markup = '<img src="/hero.jpg">'; }\nexport { prepare };`,
        [],
      ],
      // Called through brackets that only group it is called.
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\n(prepare)();`,
        ['alt'],
      ],
      // Bound but not called does not run it.
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nconst later = prepare.bind(null);`,
        [],
      ],
      [
        `function prepare(x) { markup = '<img src="/hero.jpg">'; }\nconst later = prepare.bind(null, 1);`,
        [],
      ],
      [
        `function prepare() { markup = '<img src="/hero.jpg">'; }\nprepare.apply(null, args);`,
        ['alt'],
      ],
      // Called with type arguments is called.
      [
        `function prepare<T>() { markup = '<img src="/hero.jpg">'; }\nprepare<string>();`,
        ['alt'],
      ],
    ] as const) {
      assert.deepEqual(
        page(
          `let markup = '<p>safe</p>';\n${prepare}\nroot.innerHTML = markup;\nexport const Docs = () => <div />;`,
        ),
        expected,
        prepare,
      );
    }
    // A reassignment in an unbraced loop may run no times.
    for (const loop of ['for (const item of items)', 'while (items.length)']) {
      assert.deepEqual(
        page(
          `export function render(root, items) { let markup = '<img src="/hero.jpg">'; ${loop} markup = '<p>safe</p>'; root.innerHTML = markup; }\nexport const Docs = () => <div />;`,
        ),
        ['alt'],
        loop,
      );
    }
    // A module-level constant is in scope for a function above it.
    assert.deepEqual(
      page(
        `export function render(root) { root.innerHTML = markup; }\nconst markup = '<img src="/hero.jpg">';\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A literal bound to a name that a sink is later handed is rendered too.
    assert.deepEqual(
      page(
        `const markup = '<img src="/hero.jpg">';\nroot.innerHTML = markup;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // With a type annotation between the name and the value too.
    assert.deepEqual(
      page(
        `const markup: string = '<img src="/hero.jpg">';\nroot.innerHTML = markup;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A tagged template that is not markup (CSS, Markdown, a query) is
    // data, whatever it spells.
    assert.deepEqual(
      page(
        'const Box = styled.div`&::before { content: "<img>"; }`;\nconst doc = md`Use <img src="a.jpg"> for pictures`;\nexport const Docs = () => <Box />;',
      ),
      [],
    );
    // A tagged template (lit's html``) renders its markup.
    assert.deepEqual(
      page(
        'const view = html`<img src="${src}">`;\nexport const Docs = () => <pre />;',
      ),
      ['alt'],
    );
    // A regular expression is a pattern, not markup.
    assert.deepEqual(
      page(
        'export const imageTag = /<img\\b/i;\nexport const Docs = () => <div />;',
      ),
      [],
    );
    // An apostrophe in JSX text does not open a string.
    assert.deepEqual(
      page(
        `export const Docs = () => <p>Don't miss it <img src="/a.jpg" /> it's here</p>;`,
      ),
      ['alt'],
    );
    // A member read off what a local helper returns is that member only.
    const templates = `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }`;
    for (const [member, expected] of [
      ['hero', ['alt']],
      ['safe', []],
    ] as const) {
      assert.deepEqual(
        page(
          `${templates}\nroot.innerHTML = templates().${member};\nexport const Docs = () => <div />;`,
        ),
        expected,
        member,
      );
    }
    // A bracket inside a string argument does not end the call.
    assert.deepEqual(
      page(
        `function templates(label) { return { hero: '<img src="/hero.jpg">', safe: label }; }\nroot.innerHTML = templates(')').safe;\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A helper that returns a name is read by the same part of the name.
    const aliased = `const bundle = { safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' };\nfunction templates() { return bundle; }`;
    for (const [member, expected] of [
      ['safe', []],
      ['hero', ['alt']],
    ] as const) {
      assert.deepEqual(
        page(
          `${aliased}\nroot.innerHTML = templates().${member};\nexport const Docs = () => <div />;`,
        ),
        expected,
        member,
      );
    }
    // A helper called only from a sink that never runs renders nothing.
    assert.deepEqual(
      page(
        `function render() { return '<img src="/hero.jpg">'; }\nfunction never() { root.innerHTML = render(); }\nexport const Docs = () => <div />;`,
      ),
      [],
    );
    // A default in a destructuring pattern or a parameter is what the
    // binding holds when nothing else is given.
    for (const code of [
      `const { hero = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = hero;`,
      `const { markup: hero = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = hero;`,
      `const [html = '<img src="/hero.jpg">'] = [];\nroot.innerHTML = html;`,
      `function show(markup = '<img src="/hero.jpg">') { root.innerHTML = markup; }\nshow();`,
      `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({});`,
      `const show = (markup = '<img src="/hero.jpg">') => { root.innerHTML = markup; };\nshow();`,
    ]) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        ['alt'],
        code,
      );
    }
    // A default that is safe, or one on a binding no sink reads, is not.
    for (const code of [
      `const { hero = '<p>ok</p>' } = {};\nroot.innerHTML = hero;`,
      `const { hero = '<img src="/hero.jpg">', safe = '<p>ok</p>' } = {};\nroot.innerHTML = safe;`,
      `function show(markup = '<p>ok</p>', note = '<img src="/hero.jpg">') { root.innerHTML = markup; }\nshow();`,
    ]) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        [],
        code,
      );
    }
    // A default is used only where the value can leave that part out: a
    // call that passes it, or a value written out that holds it, never
    // reaches the default.
    for (const [code, expected] of [
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(undefined);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst args = [];\nshow(...args);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nbutton.addEventListener('click', show);`,
        ['alt'],
      ],
      [
        `export function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ note: '<p>ok</p>' });`,
        ['alt'],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = { hero: '<p>ok</p>' };\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = { 'hero': '<p>ok</p>' };\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const [html = '<img src="/hero.jpg">'] = ['<p>ok</p>'];\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = { hero: undefined };\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const other = {};\nconst { hero = '<img src="/hero.jpg">' } = { ...other };\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const [html = '<img src="/hero.jpg">'] = [, '<p>ok</p>'];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const [html = '<img src="/hero.jpg">'] = [undefined];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const other = [];\nconst [html = '<img src="/hero.jpg">'] = [...other];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const other = {};\nconst { hero = '<img src="/hero.jpg">' } = { ...other, hero: '<p>ok</p>' };\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const other = {};\nconst { hero = '<img src="/hero.jpg">' } = { hero: '<p>ok</p>', ...other };\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      // `void 0`, or anything that may be `undefined`, lets it through; a
      // string that says so does not.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(void 0);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst ready = true;\nshow(ready ? '<p>ok</p>' : undefined);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>undefined</p>');`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup: void 0 });`,
        ['alt'],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = { hero: void 0 };\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const [html = '<img src="/hero.jpg">'] = [void 0];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A call from inside the function runs whenever it does.
      [
        `function show(html = '<img src="/hero.jpg">', again = false) { root.innerHTML = html; if (again) show(undefined); }\nshow('<p>ok</p>', true);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">', again = false) { root.innerHTML = html; if (again) show('<p>ok</p>'); }\nshow('<p>ok</p>', true);`,
        [],
      ],
      // A default for a whole pattern is used where the argument is left
      // out, and read by the part each name takes.
      [
        `function show({ markup } = { markup: '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow();`,
        ['alt'],
      ],
      [
        `function show({ markup }: { markup: string } = { markup: '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow();`,
        ['alt'],
      ],
      [
        `function show([html] = ['<img src="/hero.jpg">']) { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show({ markup } = { markup: '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ markup } = { note: '<img src="/hero.jpg">', markup: '<p>ok</p>' }) { root.innerHTML = markup; }\nshow();`,
        [],
      ],
      // An argument that lacks the part is still an argument: the whole
      // pattern's default is not used.
      [
        `function show({ markup } = { markup: '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ note: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' } = {}) { root.innerHTML = markup; }\nshow();`,
        ['alt'],
      ],
      // A whole pattern's default that holds the part covers the part's
      // own default for a call that leaves the argument out.
      [
        `function show({ markup = '<img src="/hero.jpg">' } = { markup: '<p>ok</p>' }) { root.innerHTML = markup; }\nshow();`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' } = { markup: '<p>ok</p>' }) { root.innerHTML = markup; }\nshow(undefined);`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' } = { markup: '<p>ok</p>' }) { root.innerHTML = markup; }\nshow({});`,
        ['alt'],
      ],
      // An optional call is a call.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow?.('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow?.();`,
        ['alt'],
      ],
      // A value not written out may be `undefined`; a literal, or a
      // `const` holding one, is not.
      [
        `const missing = undefined;\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup: missing });`,
        ['alt'],
      ],
      [
        `const safe = '<p>ok</p>';\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup: safe });`,
        [],
      ],
      [
        `const markup = '<p>ok</p>';\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ markup });`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(load());`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(\`<p>ok</p>\`);`,
        [],
      ],
      // A default naming an earlier parameter is what callers pass for it.
      [
        `function show(markup, html = markup) { root.innerHTML = html; }\nshow('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(markup, html = markup) { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function show(parts, opts = parts) { root.innerHTML = opts.safe; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        [],
      ],
      [
        `function show(parts, opts = parts) { root.innerHTML = opts.hero; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        ['alt'],
      ],
      [
        `let markup;\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ markup });`,
        ['alt'],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow({ markup() { return '<p>ok</p>'; } });`,
        [],
      ],
      // Its name in a string or as a property key is not a use of it; a
      // shorthand property hands it on.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst label = 'show';`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst counts = { show: 1 };`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst actions = { show };`,
        ['alt'],
      ],
      // Only a literal as a whole is certainly defined.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow([][0]);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow({}.hero);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst name = 'x';\nshow('<p>' + name + '</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(new String('<p>ok</p>'));`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(() => '<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(42);`,
        [],
      ],
      // A name is read by the declaration in scope where it is passed.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst safe = '<p>ok</p>';\nfunction outer() { const safe = undefined; show(safe); }\nouter();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nfunction outer() { let safe = '<p>ok</p>'; show(safe); }\nouter();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst safe = '<p>ok</p>';\nfunction outer(safe) { show(safe); }\nouter();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nfunction outer() { show(safe); }\nconst safe = '<p>ok</p>';\nouter();`,
        [],
      ],
      // A `const` source in scope that holds the part leaves its default
      // unused; one that lacks it, or may change, does not.
      [
        `const bundle = { hero: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = bundle;\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const bundle = { note: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = bundle;\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `let bundle = { hero: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = bundle;\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      // Destructuring `null` throws before any default is used.
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(null);`,
        [],
      ],
      // A default that calls something is still a parameter's default.
      [
        `function make() { return '<img src="/hero.jpg">'; }\nfunction show(html = make()) { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function make() { return '<img src="/hero.jpg">'; }\nfunction show(html = make()) { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function make() { return '<img src="/hero.jpg">'; }\nfunction show(html = String(make())) { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function make() { return '<img src="/hero.jpg">'; }\nfunction show(html = String(make()), note = ')') { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      // Destructuring an argument left out throws, unless the whole
      // pattern has a default; a named one is read where it is declared.
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow();`,
        [],
      ],
      [
        `const defaults = { markup: '<p>ok</p>' };\nfunction show({ markup = '<img src="/hero.jpg">' } = defaults) { root.innerHTML = markup; }\nshow();`,
        [],
      ],
      [
        `const defaults = { note: '<p>ok</p>' };\nfunction show({ markup = '<img src="/hero.jpg">' } = defaults) { root.innerHTML = markup; }\nshow();`,
        ['alt'],
      ],
      [
        `const show = function (html = '<img src="/hero.jpg">') { root.innerHTML = html; };\nshow('<p>ok</p>');`,
        [],
      ],
      // A default that calls a helper renders what the helper returns,
      // by the part the sink reads.
      [
        `function make() { return '<img src="/hero.jpg">'; }\nconst { html = make() } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `function make() { return '<img src="/hero.jpg">'; }\nconst { html = make() } = { html: '<p>ok</p>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { opts = templates() } = {};\nroot.innerHTML = opts.hero;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { opts = templates() } = {};\nroot.innerHTML = opts.safe;`,
        [],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nfunction show(opts = templates()) { root.innerHTML = opts.hero; }\nshow();`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nfunction show(opts = templates()) { root.innerHTML = opts.safe; }\nshow();`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview['show']();`,
        ['alt'],
      ],
      // What a function passes to itself reaches its own sink.
      [
        `function show(html, again) { root.innerHTML = html; if (again) show('<img src="/hero.jpg">', false); }\nshow('<p>ok</p>', true);`,
        ['alt'],
      ],
      // An argument is read by the part the sink reads of it.
      [
        `function show(opts) { root.innerHTML = opts.safe; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        [],
      ],
      [
        `function show(opts) { root.innerHTML = opts.hero; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        ['alt'],
      ],
      [
        `function show(html) { root.innerHTML = html; }\nshow?.('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      // A `const` object passed in is read for the part it holds.
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        [],
      ],
      [
        `const opts = { note: '<p>ok</p>' };\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        ['alt'],
      ],
      // A part read in the default itself, off what a helper returns.
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { html = templates().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { html = templates().safe } = {};\nroot.innerHTML = html;`,
        [],
      ],
      // A `const` object whose parts are written may not hold them.
      [
        `const opts = { markup: '<p>ok</p>' };\nopts.markup = undefined;\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        ['alt'],
      ],
      [
        `const defaults = { markup: '<p>ok</p>' };\ndefaults.markup = undefined;\nfunction show({ markup = '<img src="/hero.jpg">' } = defaults) { root.innerHTML = markup; }\nshow();`,
        ['alt'],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\ndelete opts.markup;\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        ['alt'],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nObject.assign(bundle, other);\nconst { hero = '<img src="/hero.jpg">' } = bundle;\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `function clear(x) { x.markup = undefined; }\nconst opts = { markup: '<p>ok</p>' };\nclear(opts);\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        ['alt'],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\nif (opts.markup === 'x') {}\nfunction show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(opts);`,
        [],
      ],
      // A method of an exported object may be called from outside, with
      // any arguments.
      [
        `export const view = { render(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };`,
        ['alt'],
      ],
      // Another function of the same name, in its own scope, is not a
      // use of this one.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nfunction outer() { function show() {} show(); }\nouter();`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nfunction outer(show) { show(); }\nouter(() => {});`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nfunction outer() { show(); }\nouter();`,
        ['alt'],
      ],
      [
        `function show(html) { root.innerHTML = html; }\nshow('<p>ok</p>');\nfunction outer() { function show(x) {} show('<img src="/hero.jpg">'); }\nouter();`,
        [],
      ],
      // A method taken out of its object is called with any arguments.
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nconst { show } = view;\nshow();`,
        ['alt'],
      ],
      // A default nested in a parameter's pattern.
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } }) { root.innerHTML = markup; }\nshow({ nested: {} });`,
        ['alt'],
      ],
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } }) { root.innerHTML = markup; }\nshow({ nested: { markup: '<p>ok</p>' } });`,
        [],
      ],
      [
        `function show([, [html = '<img src="/hero.jpg">']]) { root.innerHTML = html; }\nshow([1, []]);`,
        ['alt'],
      ],
      // A function declared inside another is not seen from a sibling.
      [
        `function a() { function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>'); }\nfunction b() { show(); }\na();\nb();`,
        [],
      ],
      // A missing or null parent part throws before a default under it,
      // unless the pattern for that part has a default of its own.
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } }) { root.innerHTML = markup; }\nshow({});`,
        [],
      ],
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } }) { root.innerHTML = markup; }\nshow({ nested: null });`,
        [],
      ],
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = markup; }\nshow({});`,
        ['alt'],
      ],
      // ... read for what the part's own default holds; `null` still throws.
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } = { markup: '<p>ok</p>' } }) { root.innerHTML = markup; }\nshow({});`,
        [],
      ],
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = markup; }\nshow({ nested: null });`,
        [],
      ],
      [
        `function show({ nested: { markup = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = markup; }\nshow({ nested: undefined });`,
        ['alt'],
      ],
      [
        `const extra = {};\nfunction show({ nested: { markup = '<img src="/hero.jpg">' } }) { root.innerHTML = markup; }\nshow({ ...extra });`,
        ['alt'],
      ],
      // An object or array is defined whatever it holds.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow({ value: undefined });`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow([undefined]);`,
        [],
      ],
      // A return type does not hide the function it belongs to.
      [
        `function show(html = '<img src="/hero.jpg">'): void { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">'): { ok: boolean } { root.innerHTML = html; return { ok: true }; }\nshow();`,
        ['alt'],
      ],
      [
        `const show = (html = '<img src="/hero.jpg">'): Promise<void> => { root.innerHTML = html; return Promise.resolve(); };\nshow();`,
        ['alt'],
      ],
      // A key written in brackets as a string is that key.
      [
        `const { ['hero']: html = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `function show({ ['markup']: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({});`,
        ['alt'],
      ],
      [
        `const { ['hero']: html = '<img src="/hero.jpg">' } = { hero: '<p>ok</p>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `function show({ ['markup']: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ markup: '<p>ok</p>' });`,
        [],
      ],
      // A same-named function in a sibling scope is another function.
      [
        `function a() { function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>'); }\nfunction b() { function show() {}\nshow(); }\na();\nb();`,
        [],
      ],
      // A return type that is a union or intersection goes on past `|`
      // and `&`: the brace after one is the type's, not the body.
      [
        `function show(html = '<img src="/hero.jpg">'): void | { ok: boolean } { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">'): { a: 1 } & { b: 2 } { root.innerHTML = html; return { a: 1, b: 2 }; }\nshow('<p>ok</p>');`,
        [],
      ],
      // So does a conditional type past `?` and `:`, and one after a word
      // a type goes on from.
      [
        `function show<T>(html = '<img src="/hero.jpg">'): T extends string ? { ok: boolean } : void { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">'): T extends string ? { ok: boolean } : void { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">'): T extends { a: 1 } ? string : void { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">'): keyof { a: 1 } { root.innerHTML = html; return 'a'; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html: any = '<img src="/hero.jpg">'): html is { a: 1 } { root.innerHTML = html; return true; }\nshow();`,
        ['alt'],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">'): T extends string ? void : { ok: boolean } { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      // A quoted key with a `.` in it is one key.
      [
        `const { 'hero.image': html = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { 'hero.image': html = '<img src="/hero.jpg">' } = { 'hero.image': '<p>ok</p>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `function show({ 'hero.image': html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ hero: { image: '<p>ok</p>' } });`,
        ['alt'],
      ],
      [
        `function show({ 'hero.image': html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ 'hero.image': '<p>ok</p>' });`,
        [],
      ],
      [
        `const { 'hero.image': html } = { 'hero.image': '<img src="/hero.jpg">' };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { 'hero.image': html } = { 'hero.image': '<p>ok</p>', other: '<img src="/hero.jpg">' };\nroot.innerHTML = html;`,
        [],
      ],
      // A generic function is named, and called with type arguments.
      [
        `function show<T>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow<string>('<p>ok</p>');`,
        [],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show<T>(html = '<p>ok</p>') { root.innerHTML = html; }\nshow<string>('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const show = <T,>(html = '<img src="/hero.jpg">') => { root.innerHTML = html; };\nshow<string>('<p>ok</p>');`,
        [],
      ],
      // A function type's own arrow is part of the return type.
      [
        `function show(html = '<img src="/hero.jpg">'): () => void { const x = 1; root.innerHTML = html; return () => {}; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">'): () => void { const x = 1; root.innerHTML = html; return () => {}; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `const show = (html = '<img src="/hero.jpg">'): (() => void) => { const x = 1; root.innerHTML = html; return () => {}; };\nshow();`,
        ['alt'],
      ],
      // Type arguments nest.
      [
        `function show<T>(html) { root.innerHTML = html; }\nshow<Array<string>>('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show<T extends Array<string>>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow<Array<string>>('<p>ok</p>');`,
        [],
      ],
      // `typeof` neither calls a function nor hands it on.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\ntype Handler = typeof show;`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nif (typeof show === 'function') console.log('ready');`,
        [],
      ],
      // A rest past the first elements of an array starts there.
      [
        `function show({ nested: [skip, ...rest] }) { root.innerHTML = rest[0]; }\nshow({ nested: ['<p>ok</p>', '<img src="/hero.jpg">'] });`,
        ['alt'],
      ],
      [
        `function show({ nested: [skip, ...rest] }) { root.innerHTML = rest[0]; }\nshow({ nested: ['<img src="/hero.jpg">', '<p>ok</p>'] });`,
        [],
      ],
      [
        `function show([skip, ...rest]) { root.innerHTML = rest[0]; }\nshow(['<p>ok</p>', '<img src="/hero.jpg">']);`,
        ['alt'],
      ],
      // An object's rest holds the other keys by their own names.
      [
        `function show({ safe, ...others }) { root.innerHTML = others.hero; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        ['alt'],
      ],
      // A local pattern with patterns in it is walked as a parameter's is.
      [
        `const { nested: { html = '<img src="/hero.jpg">' } } = { nested: {} };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { nested: { html = '<img src="/hero.jpg">' } } = { nested: { html: '<p>ok</p>' } };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { nested: { html } } = { nested: { html: '<img src="/hero.jpg">' } };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const bundle = { nested: { html: '<p>ok</p>' } };\nconst { nested: { html = '<img src="/hero.jpg">' } } = bundle;\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const bundle = { nested: {} };\nconst { nested: { html = '<img src="/hero.jpg">' } } = bundle;\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { a, nested: { b } } = { a: '<img src="/hero.jpg">', nested: { b: '<p>ok</p>' } };\nroot.innerHTML = a;`,
        ['alt'],
      ],
      [
        `const { a, nested: { b } } = { a: '<img src="/hero.jpg">', nested: { b: '<p>ok</p>' } };\nroot.innerHTML = b;`,
        [],
      ],
      [
        `const [[html = '<img src="/hero.jpg">']] = [[]];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { nested: { html = '<img src="/hero.jpg">' } = { html: '<p>ok</p>' } } = {};\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { nested: { html = '<img src="/hero.jpg">' } = {} } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { html = '<p>ok</p>' } = {};\nconst { nested: { html = '<img src="/hero.jpg">' } } = { nested: {} };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { nested: { html = '<img src="/hero.jpg">' } } = {};\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { nested: { html = '<img src="/hero.jpg">' } } = { nested: {} };\nconst { html = '<p>ok</p>' } = {};\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { a: [html = '<img src="/hero.jpg">'] } = { a: [] };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // Nor one in a function the sink is not in.
      [
        `function a() { const { html } = { html: '<img src="/hero.jpg">' }; return html; }\nfunction b(html) { root.innerHTML = html; }\na();\nb('<p>ok</p>');`,
        [],
      ],
      // A use of the name that another binding holds is not this const's.
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(opts);\nfunction other(opts) { console.log(opts); }\nother(1);`,
        [],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(opts);\nconst other = opts => console.log(opts);\nother(1);`,
        [],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(opts);\nfunction other() { const opts = {}; console.log(opts); delete opts.markup; }\nother();`,
        [],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(opts);\nfunction other() { console.log(opts); }\nother();`,
        ['alt'],
      ],
      [
        `const opts = { markup: '<p>ok</p>' };\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(opts);\nfunction other() { delete opts.markup; }\nother();`,
        ['alt'],
      ],
      [
        `const opts = 1;\nconsole.log(opts);\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nfunction clear(o) { delete o.markup; }\nfunction f() { const opts = { markup: '<p>ok</p>' }; clear(opts); show(opts); }\nf();`,
        ['alt'],
      ],
      [
        `function show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nfunction clear(o) { delete o.markup; }\nfunction f(opts) { if (opts) { const opts = { markup: '<p>ok</p>' }; clear(opts); show(opts); } }\nf(1);`,
        ['alt'],
      ],
      // A key in brackets in a value written out is that key; one that
      // could be any may be the part.
      [
        `function show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ ['markup']: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ nested: { markup: html = '<img src="/hero.jpg">' } }) { root.innerHTML = html; }\nshow({ ['nested']: { markup: '<p>ok</p>' } });`,
        [],
      ],
      [
        `const key = 'other';\nfunction show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ markup: '<p>ok</p>', [key]: undefined });`,
        ['alt'],
      ],
      [
        `const key = 'other';\nfunction show({ nested: { markup: html = '<img src="/hero.jpg">' } = { markup: '<p>ok</p>' } }) { root.innerHTML = html; }\nshow({ [key]: {} });`,
        ['alt'],
      ],
      [
        `const key = 'other';\nfunction show({ nested: { markup: html = '<img src="/hero.jpg">' } }) { root.innerHTML = html; }\nshow({ nested: { markup: '<p>ok</p>' }, [key]: {} });`,
        ['alt'],
      ],
      // A name a destructuring pattern binds hides the function too.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\n{ const { show } = handlers; show(); }`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\n{ const [show] = handlers; show(); }`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\n{ const { other } = handlers; show(); }`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\n{ const { show } = handlers; }\nshow();`,
        ['alt'],
      ],
      [
        `const { show } = handlers;\nfunction wrap() { function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(); }\nwrap();`,
        ['alt'],
      ],
      // A type written after a pattern.
      [
        `const { html = '<img src="/hero.jpg">' }: { html?: string } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const { html = '<img src="/hero.jpg">' }: { html?: string; on?: () => void } = { html: '<p>ok</p>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const { html = '<img src="/hero.jpg">' }: Record<string, () => void> = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // Brackets that only group a call, before the part read of it.
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = (templates()).hero;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = (templates()).safe;`,
        [],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">' }; }\nfunction wrap(x) { return { hero: '<p>ok</p>' }; }\nroot.innerHTML = wrap(templates()).hero;`,
        [],
      ],
      // An argument as TypeScript writes it is still that value.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>' as string);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(('<p>ok</p>'));`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>' satisfies string);`,
        [],
      ],
      [
        `const markup = '<p>ok</p>';\nfunction show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(markup!);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(undefined as unknown as string);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p> as ok</p>');`,
        [],
      ],
      // A helper called optionally is called.
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates?.().hero;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates?.().safe;`,
        [],
      ],
      [
        `function templates() { return '<img src="/hero.jpg">'; }\nconst { html = templates?.() } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { html = (templates()).hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `function templates() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { html = (templates()).safe } = {};\nroot.innerHTML = html;`,
        [],
      ],
      // An overload's signature is not a call.
      [
        `function show(html?: string): void;\nfunction show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html?: string): void;\nfunction show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html: '<img src="/hero.jpg">' | '<p>ok</p>'): void;\nfunction show(html: string) { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      // An object's rest holds nothing at the keys taken before it.
      [
        `function show({ safe, ...others } = { safe: '<img src="/hero.jpg">', hero: '<p>ok</p>' }) { root.innerHTML = others.safe; }\nshow();`,
        [],
      ],
      [
        `function show({ safe, ...others }) { root.innerHTML = others.safe; }\nshow({ safe: '<img src="/hero.jpg">', hero: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ safe, ...others }) { root.innerHTML = others.hero; }\nshow({ safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' });`,
        ['alt'],
      ],
      [
        `const { safe, ...others } = { safe: '<img src="/hero.jpg">', hero: '<p>ok</p>' };\nroot.innerHTML = others.safe;`,
        [],
      ],
      [
        `function show({ nested: { safe, ...others } }) { root.innerHTML = others.safe; }\nshow({ nested: { safe: '<img src="/hero.jpg">' } });`,
        [],
      ],
      // Type arguments that are function or literal types.
      [
        `function show<T>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow<() => string>('<p>ok</p>');`,
        [],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow<'a' | 'b'>('<p>ok</p>');`,
        [],
      ],
      [
        `function show<T>(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow<"a">('<p>ok</p>');`,
        [],
      ],
      [
        `function show<T>(html) { root.innerHTML = html; }\nshow<() => string>('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      // A named function expression may be called where it is written.
      [
        `(function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; })();`,
        ['alt'],
      ],
      // A call through brackets that only group the function is a call.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show)();`,
        ['alt'],
      ],
      [
        `function show(html) { root.innerHTML = html; }\n(show)('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nrun(show)('<p>ok</p>');`,
        ['alt'],
      ],
      // `show.call(self, ...)` passes its arguments after the first.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.call(null, '<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.call(null);`,
        ['alt'],
      ],
      [
        `function show(html) { root.innerHTML = html; }\nshow.call(null, '<img src="/hero.jpg">');`,
        ['alt'],
      ],
      // A key in brackets in an object written out, read by name.
      [
        `const bundle = { ['hero']: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle.hero;`,
        ['alt'],
      ],
      [
        `const bundle = { ["hero"]: '<p>ok</p>', other: '<img src="/hero.jpg">' };\nroot.innerHTML = bundle.hero;`,
        [],
      ],
      [
        `function t() { return { ['hero']: '<img src="/hero.jpg">' }; }\nroot.innerHTML = t().hero;`,
        ['alt'],
      ],
      // A `let` a pattern binds, set again before the sink.
      [
        `let { html = '<img src="/hero.jpg">' } = {};\nhtml = '<p>ok</p>';\nroot.innerHTML = html;`,
        [],
      ],
      [
        `let { html = '<img src="/hero.jpg">' } = {};\nif (ready) html = '<p>ok</p>';\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let { html = '<p>ok</p>' } = {};\nhtml = '<img src="/hero.jpg">';\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A quoted key that is no name, read after a call or of a name.
      [
        `function templates() { return { 'hero-image': '<img src="/hero.jpg">', 'safe-copy': '<p>ok</p>' }; }\nroot.innerHTML = templates()['hero-image'];`,
        ['alt'],
      ],
      [
        `function templates() { return { 'hero-image': '<img src="/hero.jpg">', 'safe-copy': '<p>ok</p>' }; }\nroot.innerHTML = templates()['safe-copy'];`,
        [],
      ],
      [
        `const bundle = { 'hero-image': '<img src="/hero.jpg">', 'safe-copy': '<p>ok</p>' };\nroot.innerHTML = bundle['safe-copy'];`,
        [],
      ],
      [
        `const bundle = { "hero-image": '<img src="/hero.jpg">', "safe-copy": '<p>ok</p>' };\nroot.innerHTML = bundle["safe-copy"];`,
        [],
      ],
      [
        `function templates() { return { 'hero.image': '<img src="/hero.jpg">', hero: { image: '<p>ok</p>' } }; }\nroot.innerHTML = templates()['hero.image'];`,
        ['alt'],
      ],
      // A `readonly` return type goes on past it.
      [
        `function show(html = '<img src="/hero.jpg">'): readonly { ok: boolean }[] { root.innerHTML = html; return []; }\nshow();`,
        ['alt'],
      ],
      // `show.apply(self, [...])` passes that array's elements.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.apply(null, ['<p>ok</p>']);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.apply(null, []);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.apply(null, args);`,
        ['alt'],
      ],
      [
        `function show(html) { root.innerHTML = html; }\nshow.apply(null, ['<img src="/hero.jpg">']);`,
        ['alt'],
      ],
      // A method's signature in an interface or a type is not a call.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\ninterface Handler { show(html?: string): void }`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\ntype Handler = { run(): void; show?(html?: string): void };`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst run = (ready) => { show(ready ? '<p>ok</p>' : undefined); };\nrun(true);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst shown = ready ? show() : null;`,
        ['alt'],
      ],
      // A generic helper called with type arguments.
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates<string>().hero;`,
        ['alt'],
      ],
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates<string>().safe;`,
        [],
      ],
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nconst { html = templates<string>().hero } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // A parameter's type holding a function type, before its default.
      [
        `function show({ html = '<img src="/hero.jpg">' }: { html?: string; on?: () => void } = {}) { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `function show(html: (() => void) | string = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      // A key in brackets written as a template with nothing in it.
      [
        `const { [\`html\`]: markup = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = markup;`,
        ['alt'],
      ],
      [
        `function show({ markup: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ [\`markup\`]: '<p>ok</p>' });`,
        [],
      ],
      // A function bound and called at once is passed the bound arguments
      // first.
      [
        `function show(html) { root.innerHTML = html; }\nshow.bind(null, '<img src="/hero.jpg">')();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.bind(null, '<p>ok</p>')();`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.bind(null)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.bind(null)();`,
        ['alt'],
      ],
      // Bound and kept, it is called by each call of what holds it, and
      // anywhere at all once that is handed on.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst later = show.bind(null);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconst later = show.bind(null);\nsetTimeout(later);`,
        ['alt'],
      ],
      [
        `function show(prefix, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<p>ok</p>');`,
        [],
      ],
      [
        `function show(prefix, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater();`,
        ['alt'],
      ],
      [
        `function show(prefix, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater(undefined);`,
        ['alt'],
      ],
      [
        `function show(prefix, { html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater({ html: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show(prefix, html = '<img src="/hero.jpg">') { root.innerHTML = prefix; }\nconst later = show.bind(null);\nlater('<p>ok</p>');`,
        [],
      ],
      // A method is called through its owner's own binding, not another.
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show('<p>ok</p>');\nfunction other() { const view = { show() {} }; view.show(); }\nother();`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show('<p>ok</p>');\nfunction other() { view.show(); }\nother();`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }, run(view) { this.show(); } };\nview.show('<p>ok</p>');\nview.run(1);`,
        ['alt'],
      ],
      // A plain declaration of the name elsewhere does not hide a pattern's.
      [
        `function other() { const html = '<p>ok</p>'; return html; }\nconst { html = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = html;\nother();`,
        ['alt'],
      ],
      // Bound and kept, it is passed the bound arguments whenever it is
      // called.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst later = show.bind(null, '<p>ok</p>');\nlater();`,
        [],
      ],
      [
        `function show(html) { root.innerHTML = html; }\nconst later = show.bind(null, '<img src="/hero.jpg">');\nlater();`,
        ['alt'],
      ],
      // A comma expression that only picks the function is a call of it.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(0, show)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(0, show)();`,
        ['alt'],
      ],
      // A numeric key in a value written out.
      [
        `function show({ 0: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ 0: '<p>ok</p>' });`,
        [],
      ],
      [
        `function show({ 0: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ 1: '<p>ok</p>' });`,
        ['alt'],
      ],
      // TypeScript's `this` parameter takes no argument.
      [
        `function show(this: void, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `function show(this: void, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      // A parameter property's modifiers come before its name.
      [
        `class View { constructor(public html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(private readonly html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `const markup = '<img src="/hero.jpg">';\nclass View { constructor(public html = markup) { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      // A rest parameter holds each argument from its own on.
      [
        `function show(...html) { root.innerHTML = html[1]; }\nshow('<p>ok</p>', '<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(...html) { root.innerHTML = html[0]; }\nshow('<p>ok</p>', '<img src="/hero.jpg">');`,
        [],
      ],
      [
        `function show(...html) { root.innerHTML = html.join(''); }\nshow('<p>ok</p>', '<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(lead, ...html) { root.innerHTML = html[0]; }\nshow('<img src="/hero.jpg">', '<p>ok</p>');`,
        [],
      ],
      [
        `function show(lead, ...html) { root.innerHTML = html[1]; }\nshow('<p>ok</p>', '<p>ok</p>', '<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(...html) { root.innerHTML = html[1]; }\nshow.bind(null, '<p>ok</p>')('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      // An async helper's call is a promise, what it returns only once
      // awaited; a generator's is an iterator.
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nroot.innerHTML = make();`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function load() { root.innerHTML = await make(); }\nload();`,
        ['alt'],
      ],
      [
        `const make = async () => '<img src="/hero.jpg">';\nroot.innerHTML = make();`,
        [],
      ],
      [
        `const make = async () => '<img src="/hero.jpg">';\nasync function load() { root.innerHTML = await make(); }\nload();`,
        ['alt'],
      ],
      [
        `const views = { async make() { return '<img src="/hero.jpg">'; } };\nroot.innerHTML = views.make();`,
        [],
      ],
      [
        `const views = { async make() { return '<img src="/hero.jpg">'; } };\nasync function load() { root.innerHTML = await views.make(); }\nload();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nfunction show({ html = make() }) { root.innerHTML = html; }\nshow({});`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function show({ html = await make() }) { root.innerHTML = html; }\nshow({});`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nconst { html = make() } = {};\nroot.innerHTML = html;`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function load() { const { html = await make() } = {}; root.innerHTML = html; }\nload();`,
        ['alt'],
      ],
      [
        `function* make() { return '<img src="/hero.jpg">'; }\nroot.innerHTML = make();`,
        [],
      ],
      [
        `const views = { *make() { return '<img src="/hero.jpg">'; } };\nroot.innerHTML = views.make();`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function load() { root.innerHTML = await (make()); }\nload();`,
        ['alt'],
      ],
      // An object held by a later declarator, or under a type with an
      // arrow in it, is still the owner of its methods.
      [
        `const count = 0, view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nconst other = { show() {} };\nview.show('<p>ok</p>');\nother.show();`,
        [],
      ],
      [
        `const count = 0, view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show();`,
        ['alt'],
      ],
      [
        `const count: number = 0, view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nconst other = { show() {} };\nview.show('<p>ok</p>');\nother.show();`,
        [],
      ],
      [
        `const view: Record<string, (html?: string) => void> = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nconst other = { show() {} };\nview.show('<p>ok</p>');\nother.show();`,
        [],
      ],
      // A return type that is a function type has an arrow of its own
      // before the body.
      [
        `function show(html = '<img src="/hero.jpg">'): () => void\n{\n  root.innerHTML = html;\n  return () => {};\n}\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">'): () => void\n{\n  root.innerHTML = html;\n  return () => {};\n}\nshow('<p>ok</p>');`,
        [],
      ],
      [
        `const show = (html = '<img src="/hero.jpg">'): (() => void) => {\n  root.innerHTML = html;\n  return () => {};\n};\nshow();`,
        ['alt'],
      ],
      // Any other type's arrow is the function's own, whatever follows.
      [
        `const show = (html = '<img src="/hero.jpg">'): string => {\n  root.innerHTML = html\n  return ''\n}\nconst other = () => {}\nshow()`,
        ['alt'],
      ],
      [
        `const show = (html = '<img src="/hero.jpg">'): (string) | undefined => {\n  root.innerHTML = html\n  return undefined\n}\nconst other = () => {}\nshow()`,
        ['alt'],
      ],
      // A parameter's decorators come before its name.
      [
        `class View { constructor(@Inject(TOKEN) html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(@Optional() @Inject(A, B) public html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(@Self html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(@Self @Optional() html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(@di.Inject(token(1)) html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      // The part read of what a call with type arguments returns, however
      // they are written.
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates<() => string>().hero;`,
        ['alt'],
      ],
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nroot.innerHTML = templates<() => string>().safe;`,
        [],
      ],
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nfunction show(opts = templates<() => string>()) { root.innerHTML = opts.hero; }\nshow();`,
        ['alt'],
      ],
      [
        `function templates<T>() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nfunction show(opts = templates<() => string>()) { root.innerHTML = opts.safe; }\nshow();`,
        [],
      ],
      [
        `function templates<T>(...parts) { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; }\nfunction show(opts = templates<() => string>(1, 2, 3)) { root.innerHTML = opts.hero; }\nshow();`,
        ['alt'],
      ],
      // A call through what keeps its value (`show!`, `as`, `satisfies`), or an
      // optional `.call`, `.apply` or `.bind`, passes its arguments.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show as typeof show)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show as typeof show)();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show satisfies typeof show)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow!('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow!();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show!)('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show)?.('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow?.('<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n(show || other)('<p>ok</p>');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.call?.(null, '<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.call?.(null);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow?.call(null, '<p>ok</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.apply?.(null, ['<p>ok</p>']);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.bind?.(null, '<p>ok</p>')();`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow.bind?.(null)();`,
        ['alt'],
      ],
      // Reading its `length` or `name` neither calls it nor hands it on.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconsole.log(show.length);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconsole.log(show.name);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconsole.log(show?.name);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconsole.log(show.name);\nshow();`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow('<p>ok</p>');\nconsole.log(show.length);`,
        [],
      ],
      [
        `function show() { root.innerHTML = '<img src="/hero.jpg">'; }\nconsole.log(show.length);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconsole.log(show.toString());`,
        ['alt'],
      ],
      // `typeof show`, in a type or not, does not run it.
      [
        `function make() { return '<img src="/hero.jpg">'; }\nfunction show() { root.innerHTML = make(); }\ntype Handler = typeof show;`,
        [],
      ],
      [
        `function show() { root.innerHTML = '<img src="/hero.jpg">'; }\nconst kind = typeof show;`,
        [],
      ],
      [
        `function show() { root.innerHTML = '<img src="/hero.jpg">'; }\nconst kind = typeof show;\nshow();`,
        ['alt'],
      ],
      // The part read of an object inside grouping brackets, and of each
      // branch of a conditional.
      [
        `function templates(wide) { return ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }); }\nroot.innerHTML = templates().hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }); }\nroot.innerHTML = templates().safe;`,
        [],
      ],
      [
        `const templates = () => ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }) as const;\nroot.innerHTML = templates().hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return ({ hero: '<img src="/hero.jpg">' }).hero; }\nroot.innerHTML = templates().hero;`,
        [],
      ],
      [
        `function templates(wide) { return wide ? { hero: '<img src="/hero.jpg">' } : { hero: '<p>ok</p>' }; }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return wide ? { hero: '<p>ok</p>' } : { hero: '<img src="/hero.jpg">' }; }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return wide ? { hero: '<p>ok</p>', safe: '<img src="/hero.jpg">' } : { hero: '<p>ok</p>' }; }\nroot.innerHTML = templates(true).hero;`,
        [],
      ],
      [
        `function templates(wide) { return wide?.full ?? wide ? { hero: '<p>ok</p>' } : wide ? { hero: '<p>ok</p>' } : { hero: '<img src="/hero.jpg">' }; }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return wide ? wide ? { hero: '<p>ok</p>' } : { hero: '<img src="/hero.jpg">' } : { hero: '<p>ok</p>' }; }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return wide ? { hero: '<p>ok</p>' } : ({ hero: '<img src="/hero.jpg">' }); }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      [
        `function templates(wide) { return wide?.5 : { hero: '<img src="/hero.jpg">' }; }\nroot.innerHTML = templates(true).hero;`,
        ['alt'],
      ],
      // A generic arrow helper returns what its body does.
      [
        `const templates = <T,>() => ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' });\nroot.innerHTML = templates<string>().hero;`,
        ['alt'],
      ],
      [
        `const templates = <T,>() => ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' });\nroot.innerHTML = templates<string>().safe;`,
        [],
      ],
      [
        `const templates = async <T,>() => '<img src="/hero.jpg">';\nasync function load() { root.innerHTML = await templates(); }\nload();`,
        ['alt'],
      ],
      [
        `const templates = <T extends object = {}>(x: T) => '<img src="/hero.jpg">';\nroot.innerHTML = templates({});`,
        ['alt'],
      ],
      [
        `const views = { make: <T,>() => ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }) };\nroot.innerHTML = views.make().hero;`,
        ['alt'],
      ],
      [
        `const views = { make: <T,>() => ({ hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }) };\nroot.innerHTML = views.make().safe;`,
        [],
      ],
      // The part read of what a method of an object written out here returns.
      [
        `const views = { make() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; } };\nroot.innerHTML = views.make().hero;`,
        ['alt'],
      ],
      [
        `const views = { make() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; } };\nroot.innerHTML = views.make().safe;`,
        [],
      ],
      [
        `const views = { make() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; } };\nroot.innerHTML = views?.make?.().hero;`,
        ['alt'],
      ],
      [
        `const views = { make() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; } };\nfunction show(opts = views.make()) { root.innerHTML = opts.hero; }\nshow();`,
        ['alt'],
      ],
      [
        `const views = { make() { return { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }; } };\nfunction show(opts = views.make()) { root.innerHTML = opts.safe; }\nshow();`,
        [],
      ],
      // A function bound and kept is passed, past the bound arguments, what
      // each call of what holds it passes.
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<p>ok</p>');`,
        [],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<p>ok</p>');\nlater('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(prefix, ...html) { root.innerHTML = html[1]; }\nconst later = show.bind(null, '<p>');\nlater('<p>ok</p>', '<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(prefix, ...html) { root.innerHTML = html[1]; }\nconst later = show.bind(null, '<p>');\nlater('<img src="/hero.jpg">', '<p>ok</p>');`,
        [],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>').call;\nlater('<img src="/hero.jpg">');`,
        [],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater.length;\nother('<img src="/hero.jpg">');`,
        [],
      ],
      // Under a type with an arrow in it too.
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later: (html: string) => void = show.bind(null, '<p>');\nlater('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later: (html: string) => void = show.bind(null, '<p>');\nlater('<p>ok</p>');`,
        [],
      ],
      // A declaration's type, however it is written, neither names what it holds
      // nor is a function of its own.
      [
        `const render: () => string = () => '<img src="/hero.jpg">';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [
        `const render: Render = () => '<img src="/hero.jpg">';\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [
        `const render: () => string = function () { return '<img src="/hero.jpg">'; };\nroot.innerHTML = render();`,
        ['alt'],
      ],
      [`const render: Render = () => '<img src="/hero.jpg">';`, []],
      [
        `const views: { make: () => string } = { make() { return '<img src="/hero.jpg">'; } };\nroot.innerHTML = views.make();`,
        ['alt'],
      ],
      [
        `const views: Record<string, () => string> = { make: () => '<p>ok</p>', hero: '<img src="/hero.jpg">' };\nroot.innerHTML = views.make();`,
        [],
      ],
      [
        `function show(on: (html: string) => void, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(() => {});`,
        ['alt'],
      ],
      [
        `function show(on: (html: string) => void, html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(() => {}, '<p>ok</p>');`,
        [],
      ],
      [
        `const views = { first: 1, show: (html = '<img src="/hero.jpg">') => { root.innerHTML = html; } };\nviews.show();`,
        ['alt'],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later: (html: string, level: number, options: { strict: boolean }) => void = show.bind(null, '<p>');\nlater('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      // A call of another binding of the wrapper's name passes nothing to it.
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<p>ok</p>');\nfunction other(later) { later('<img src="/hero.jpg">'); }\nother(() => {});`,
        [],
      ],
      [
        `function show(prefix, html) { root.innerHTML = html; }\nconst later = show.bind(null, '<p>');\nlater('<img src="/hero.jpg">');\nfunction other(later) { later('<p>ok</p>'); }\nother(() => {});`,
        ['alt'],
      ],
      // What a destructuring reads, inside brackets that only group it.
      [
        `const { hero = '<img src="/hero.jpg">' } = ({});\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = ({ hero: '<p>ok</p>' });\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = (bundle);\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const bundle = { safe: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = ((bundle));\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const bundle = { hero: '<p>ok</p>' };\nconst { hero = '<img src="/hero.jpg">' } = (bundle);\nclear(bundle);\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      // A class this file keeps to itself is built only by its `new View(...)`.
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View('<p>ok</p>');`,
        [],
      ],
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View();`,
        ['alt'],
      ],
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View;`,
        ['alt'],
      ],
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View('<p>ok</p>');\nregister(View);`,
        ['alt'],
      ],
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View('<p>ok</p>');\nclass Wide extends View {}\nnew Wide();`,
        ['alt'],
      ],
      [
        `export class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nnew View('<p>ok</p>');`,
        ['alt'],
      ],
      [
        `class View { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } }\nfunction never() { new View(); }\nnew View('<p>ok</p>');`,
        [],
      ],
      [
        `const View = class { constructor(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nnew View('<p>ok</p>');`,
        ['alt'],
      ],
      // What a group holds is the last of a sequence in it.
      [
        `const bundle = { inner: { hero: '<p>ok</p>' } };\nconst { hero = '<img src="/hero.jpg">' } = (bundle).inner;\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `function templates() { return ({ hero: '<p>ok</p>' }, { hero: '<img src="/hero.jpg">' }); }\nroot.innerHTML = templates().hero;`,
        ['alt'],
      ],
      [
        `function templates() { return ({ hero: '<img src="/hero.jpg">' }, { hero: '<p>ok</p>' }); }\nroot.innerHTML = templates().hero;`,
        [],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = ({ hero: '<p>ok</p>' }, {});\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = ({}, { hero: '<p>ok</p>' });\nroot.innerHTML = hero;`,
        [],
      ],
      [
        `const { hero = '<img src="/hero.jpg">' } = ({ hero: '<p>ok</p>' }).other;\nroot.innerHTML = hero;`,
        [],
      ],
      // A conditional destructured lets a default through unless every branch
      // holds the part.
      [
        `const flag = Math.random() > 0.5;\nconst { html = '<img src="/hero.jpg">' } = flag ? { html: '<p>' } : { html: '<div>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst { html = '<img src="/hero.jpg">' } = flag ? { html: '<p>' } : {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst { html = '<img src="/hero.jpg">' } = flag ? {} : { html: '<p>' };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst base = { html: '<p>' };\nconst { html = '<img src="/hero.jpg">' } = flag ? base : flag ? { html: '<b>' } : { html: '<i>' };\nroot.innerHTML = html;`,
        [],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst base = { html: '<p>' };\nconst { html = '<img src="/hero.jpg">' } = flag ? base : flag ? { html: '<b>' } : {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst { html = '<img src="/hero.jpg">' } = flag ? other : { html: '<i>' };\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `const flag = Math.random() > 0.5;\nconst { html = '<p>' } = flag ? { html: '<img src="/hero.jpg">' } : {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      // Held by a `let`, which may be set to something else, a bound function
      // is not followed through calls of that name.
      [
        `function show(prefix, html) { root.innerHTML = html; }\nlet later = show.bind(null, '<p>');\nlater = (x) => {};\nlater('<img src="/hero.jpg">');`,
        [],
      ],
      // An element passed is defined.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nexport const Page = () => { show(<b>hi</b>); return null; };`,
        [],
      ],
      // A conditional passed is defined when each of its branches is.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(flag ? '<p>a</p>' : '<p>b</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(flag ? '<p>a</p>' : undefined);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(flag ? other : '<p>b</p>');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(a ? '<p>a</p>' : b ? '<i>b</i>' : '<b>c</b>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(a ? '<p>a</p>' : b ? '<i>b</i>' : undefined);`,
        ['alt'],
      ],
      // An object passed inside brackets that only group it, or asserted a type,
      // still holds its parts.
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(({ markup: '<p>safe</p>' }) as Options);`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(({ other: '<p>safe</p>' }) as Options);`,
        ['alt'],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow((other, { markup: '<p>safe</p>' }));`,
        [],
      ],
      [
        `function show({ markup = '<img src="/hero.jpg">' }) { root.innerHTML = markup; }\nshow(({ markup: '<p>safe</p>' }, { other: 1 }));`,
        ['alt'],
      ],
      // A private method runs only by `this.show(...)` in its own class.
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { log('this.show()'); this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.show(); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this['show'](); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { setTimeout(this.show); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run(action) { this[action](); this.show('<p>safe</p>'); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } never() { this.show(); } run() { this.show('<p>safe</p>'); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.#show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.#show(); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private static readonly show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.show('<p>safe</p>'); } }\nnew View().run();`,
        ['alt'],
      ],
      // A component is given its element's attributes as its props.
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = (props) => <Show html="<p>safe</p>" {...props} />;`,
        ['alt'],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = (props) => <Show {...props} html="<p>safe</p>" />;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show html="<p>safe</p>" icon=<b /> />;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show icon=<b /> html="<p>safe</p>" />;`,
        ['alt'],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { function dead() { this.show(); } this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show html="<p>safe</p>" />;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <div><Show html='<p>safe</p>'></Show></div>;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show html={'<p>safe</p>'} />;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show html />;`,
        [],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show />;`,
        ['alt'],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show other="1" />;`,
        ['alt'],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = (props) => <Show {...props} />;`,
        ['alt'],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = (props) => <Show html={props.html} />;`,
        ['alt'],
      ],
      [
        `function Show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show html=<b /> />;`,
        ['alt'],
      ],
      [
        `function Show({ nested: { html = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show nested={{ html: '<p>safe</p>' }} />;`,
        [],
      ],
      [
        `function Show({ nested: { html = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show nested={{ other: '<p>safe</p>' }} />;`,
        ['alt'],
      ],
      [
        `function Show({ nested: { html = '<img src="/hero.jpg">' } = {} }) { root.innerHTML = html; return null; }\nexport const Page = () => <Show nested />;`,
        ['alt'],
      ],
      [
        `function Show(props = { html: '<img src="/hero.jpg">' }) { root.innerHTML = props.html; return null; }\nexport const Page = () => <Show />;`,
        [],
      ],
      [
        `function Show(props, html = '<img src="/hero.jpg">') { root.innerHTML = html; return null; }\nexport const Page = () => <Show />;`,
        ['alt'],
      ],
      // A lowercase tag is an element of the page, not a use of a function of
      // that name.
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nexport const Page = () => <show />;`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nexport const Page = () => <div><show></show></div>;`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nexport const Page = () => <show />;\nshow({});`,
        ['alt'],
      ],
      // A conditional passed holds a part when each of its branches does.
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(flag ? { html: '<p>a</p>' } : { html: '<p>b</p>' });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(flag ? { html: '<p>a</p>' } : {});`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(flag ? {} : { html: '<p>b</p>' });`,
        ['alt'],
      ],
      [
        `const base = { html: '<p>' };\nfunction show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(flag ? base : { html: '<p>b</p>' });`,
        [],
      ],
      [
        `const base = { html: '<p>' };\nfunction show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(a ? b ? base : { html: '<i>' } : {});`,
        ['alt'],
      ],
      [
        `const base = { html: '<p>' };\nfunction show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow(a ? b ? base : { html: '<i>' } : { html: '<b>' });`,
        [],
      ],
      // A pattern that sets a name again is one more value it may hold.
      [
        `let { html } = { html: '<p>' };\n({ html } = { html: '<img src="/hero.jpg">' });\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let { html } = { html: '<img src="/hero.jpg">' };\n({ html } = { html: '<p>' });\nroot.innerHTML = html;`,
        [],
      ],
      [
        `let [html] = ['<p>'];\n[html] = ['<img src="/hero.jpg">'];\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let { html } = { html: '<p>' };\n({ html = '<img src="/hero.jpg">' } = {});\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let { html } = { html: '<p>' };\n({ other: html } = { other: '<img src="/hero.jpg">' });\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let { html } = { html: '<p>' };\n({ other: html } = { html: '<img src="/hero.jpg">' });\nroot.innerHTML = html;`,
        [],
      ],
      [
        `let { html } = { html: '<p>' };\n({ ...rest } = { html: '<img src="/hero.jpg">' });\nroot.innerHTML = html;`,
        [],
      ],
      [
        `let { html } = { html: '<p>' };\nif (flag) ({ html } = { html: '<img src="/hero.jpg">' });\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [
        `let html = '<p>';\nroot.innerHTML = html;\n({ html } = { html: '<img src="/hero.jpg">' });`,
        [],
      ],
      [
        `let { html } = { html: '<p>' };\n({ html } = { html: '<img src="/hero.jpg">' });\nhtml = '<p>';\nroot.innerHTML = html;`,
        [],
      ],
      [
        `let html = { other: '<p>' };\n({ other, ...html } = { other: '<img src="/hero.jpg">' });\nroot.innerHTML = html.other;`,
        [],
      ],
      // What is awaited includes what is inside it.
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function load() { root.innerHTML = await Promise.resolve(make()); }\nload();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nroot.innerHTML = Promise.resolve(make());`,
        [],
      ],
      // A method may be named by a key written out.
      [
        `const view = { ['show'](html = '<p>') { root.innerHTML = html; } };\nview.show('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const view = { 'show'(html = '<p>') { root.innerHTML = html; } };\nview['show']('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const view = { 'show': function (html = '<p>') { root.innerHTML = html; } };\nview.show('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const view = { [\`show\`]: (html = '<p>') => { root.innerHTML = html; } };\nview.show('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const view = { ['show'](html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show('<p>');`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show('<p>');\nview.show = () => {};`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show('<p>');\nview.show = () => {};\nview.show();`,
        [],
      ],
      [
        `const view = { show() { root.innerHTML = '<img src="/hero.jpg">'; } };\nview.show = () => {};`,
        [],
      ],
      [
        `const view = { show() { root.innerHTML = '<img src="/hero.jpg">'; } };\nview.show = () => {};\nview.show();`,
        [],
      ],
      [
        `const view = { show() { root.innerHTML = '<img src="/hero.jpg">'; } };\nview.show();\nview.show = () => {};`,
        ['alt'],
      ],
      // Once a method is set to something else, calling it by that name no
      // longer runs it, and setting it is no use of it.
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show = () => {};\nview.show();`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview.show();\nview.show = () => {};`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nview['show'] = () => {};\nview.show();`,
        [],
      ],
      [
        `const view = { show(html) { root.innerHTML = html; } };\nview.show = () => {};\nview.show('<img src="/hero.jpg">');`,
        [],
      ],
      [
        `const view = { show(html) { root.innerHTML = html; } };\nview.show('<img src="/hero.jpg">');\nview.show = () => {};`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nif (view.show === other) view.show();`,
        ['alt'],
      ],
      // A class named only as a type is never made, so nothing runs its
      // methods.
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Instance = View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Many = Array<View> | null;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Multi =\n  | null\n  | View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ninterface Holder { view: View }`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nlet current: View | undefined;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(view: View) {}\nuse(null);`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(a: string, { v }: { v: number }, view?: View) {}\nuse('');`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction make(): View { return null as never; }\nmake();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst make = (): View => null as never;\nmake();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ref = useRef<View>(null);`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst map = new Map<string, View>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst x = {} as View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst x = {} satisfies Partial<View>;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Other implements Base, View {}`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Box { item?: View }`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Box { private readonly item!: View; }`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype K = keyof View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst views: View[] = [];`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst routes = { home: View };`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst pick = flag ? Other : View;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nif (count < View.limit) run();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst made = make<View>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(a = flag ? b : View) {}\nuse();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(a, b = flag ? c : View) {}\nuse();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Box { item = flag ? a : View }`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst f = call(flag ? (a) : View);`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype A = string\nconst v = new View();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype A = string;\nconst v = new View();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst make = (): View => new View();\nmake();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nswitch (k) { case 1: View.run(); }`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Later = Promise<\n  View\n>;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Instance =\n  View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use({ a, b }: View) {}\nuse({});`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(...views: View[]) {}\nuse();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nlet current: undefined | View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nlet current: (View | null)[] = [];`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Later = Promise<View>\nconst v = new View();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Make = () => View\nconst v = new View();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype A = string; const v = new View();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nexport function App() { return <View />; }`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Result<T> = T extends true\n  ? View\n  : never;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Result<T> = T extends true\n  ? never\n  : View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst holder: { current: View | null } = { current: null };`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst pair: [number, View] = [1, null as never];`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst make: () => View = () => null as never;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst make: new () => View = null as never;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nlet deep: Array<{ v: [View] }> = [];`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nfunction use(o: { v: View }) {}\nuse(null as never);`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = f<View>(1);`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst m = new Map<string, Array<View>>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst r = f<View> as never;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Box extends Base<View> {}`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst a: Array<View>[] = [];`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = x < View > 1;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = x < View >= 1;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = x < View > y;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = x < View > -1;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = f<View>[0];`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = x < { v: View } > 1;`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nif (count < View) run();`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst routes = { home: { page: View } };`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nswitch (k) { case 1: { run(View); } }`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst pick = flag ? a : { v: View };`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nclass Box { item = flag ? a : { v: View } }`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst m = new Map<View, [number]>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst m = new Map<View, Array<number>['length']>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst m = new Map<View, () => void>();`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = f(count < View) > (b);`,
        ['alt'],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nconst ok = count < View; const big = a > (b);`,
        ['alt'],
      ],
      // A private method is also called through its class, when static,
      // and through another instance of it.
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { View.show(); } }\nView.run();`,
        ['alt'],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { View.show('<p>safe</p>'); } }\nView.run();`,
        [],
      ],
      [
        `class View { static #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { View.#show(); } }\nView.run();`,
        ['alt'],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run(other: View) { other.#show(); } }\nnew View().run(new View());`,
        ['alt'],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run(other: View) { other.#show('<p>safe</p>'); } }\nnew View().run(new View());`,
        [],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.list.#show(); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { this.items[0].#show(); } }\nnew View().run();`,
        ['alt'],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run(k) { View[k](); View.show('<p>safe</p>'); } }\nView.run('show');`,
        ['alt'],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { const later = View.show.bind(View); later(); } }\nView.run();`,
        ['alt'],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { const later = View.show.bind(View); later('<p>safe</p>'); } }\nView.run();`,
        [],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { (View.show)(); } }\nView.run();`,
        ['alt'],
      ],
      [
        `class View { private static show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } static run() { (View.show)('<p>safe</p>'); } }\nView.run();`,
        [],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { const keys = ['show']; this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { private show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { log(...show); this.show('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      [
        `class View { #show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } run() { (this.list.#show)('<p>safe</p>'); } }\nnew View().run();`,
        [],
      ],
      // `??` and `||` give what they fall back to when all before is
      // `undefined`.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(maybe ?? '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(maybe || '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(a ?? b ?? '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(flag === 1 || '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(a <= b || '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow((maybe ?? '<p>safe</p>'));`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nconst safe = '<p>safe</p>';\nshow(maybe ?? safe);`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(maybe ?? other);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(maybe && '<p>safe</p>');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(x = maybe);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(x ||= maybe);`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(x = maybe ?? '<p>safe</p>');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(x ??= '<p>safe</p>');`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(f(maybe ?? '<p>safe</p>'));`,
        ['alt'],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(g(maybe) ?? '<p>safe</p>');`,
        [],
      ],
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nshow(maybe ?? { html: a || '<p>safe</p>' });`,
        [],
      ],
      // Only what an `await` is written before is awaited.
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function safe() { return 1; }\nasync function run() { root.innerHTML = (await safe(), make()); }\nrun();`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await x + make(); }\nrun();`,
        [],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await (0, make()); }\nrun();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await view.wrap<string>(make()); }\nrun();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await new Wrapper(make()).value; }\nrun();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await list[0]!.wrap?.(make()); }\nrun();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await view?.wrap(make()); }\nrun();`,
        ['alt'],
      ],
      [
        `async function make() { return '<img src="/hero.jpg">'; }\nasync function run() { root.innerHTML = await (make()); }\nrun();`,
        ['alt'],
      ],
      // What happens only in a function nothing calls does not happen.
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction never() { register(view); }\nview.show('<p>safe</p>');`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction sometimes() { register(view); }\nsometimes();\nview.show('<p>safe</p>');`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction never() { view[k](); }\nview.show('<p>safe</p>');`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction sometimes() { view[k](); }\nsometimes();\nview.show('<p>safe</p>');`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction never() { const { show } = view; show(); }\nview.show('<p>safe</p>');`,
        [],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; } };\nfunction sometimes() { const { show } = view; show(); }\nsometimes();\nview.show('<p>safe</p>');`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<p>ok</p>') { root.innerHTML = html; } };\nfunction never() { view.show = () => {}; }\nview.show('<img src="/hero.jpg">');`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<p>ok</p>') { root.innerHTML = html; } };\nfunction sometimes() { view.show = () => {}; }\nsometimes();\nview.show('<img src="/hero.jpg">');`,
        [],
      ],
      [
        `const a = { f() { b.g = () => {}; } };\nconst b = { g() { a.f = () => {}; root.innerHTML = '<img src="/hero.jpg">'; } };\nb.g();`,
        ['alt'],
      ],
      [
        `const view = { show(html = '<img src="/hero.jpg">') { root.innerHTML = html; register(view); } };\nview.show('<p>safe</p>');`,
        ['alt'],
      ],
      // A type goes on past a line that ends in a type's operator.
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Result<T> = T extends\n  View ? true : false;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Make = () =>\n  View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Key = keyof\n  View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype Pick<T> = T extends Array<infer\n  U> ? U : View;`,
        [],
      ],
      [
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\ntype A = string\nconst is = new View();`,
        ['alt'],
      ],
      // Each element of a loop is not followed, so a default in its pattern may be used.
      [
        `for (const { html = '<img src="/hero.jpg">' } of [{}]) { root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `for (const [html = '<img src="/hero.jpg">'] of list) { root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `for (const { html = '<img src="/hero.jpg">' } in list) { root.innerHTML = html; }`,
        ['alt'],
      ],
      [
        `for (const { html = '<p>ok</p>' } of list) { root.innerHTML = html; }`,
        [],
      ],
      // A getter gives what it returns; a setter alone gives nothing.
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return '<p>safe</p>'; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get ['html']() { return '<p>safe</p>'; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return maybe; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { if (x) return '<p>safe</p>'; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return { a: 1 }; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return {\n  safe: true,\n}; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return ['<p>safe</p>'][0] ?? '<p>ok</p>'; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return\n'<p>safe</p>'; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return { a: 1 }; other(); } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /*\n*/ { safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /* safe */ { safe: true }; } });`,
        [],
      ],
      [`root.innerHTML = /*\n*/ '<img src="/hero.jpg">';`, ['alt']],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return\r{ safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /*\r*/ { safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return\u2028{ safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /*\u2028*/ { safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return\u2029{ safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /*\u2029*/ { safe: true }; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return new\n  Date(); } });`,
        [],
      ],
      [`root.innerHTML = void\n'<img src="/hero.jpg">';`, []],
      [`root.innerHTML = obj.new\nfoo('<img src="/hero.jpg">');`, []],
      [`root.innerHTML = obj. new\nfoo('<img src="/hero.jpg">');`, []],
      [`root.innerHTML = obj?.await\nfoo('<img src="/hero.jpg">');`, []],
      [`root.innerHTML = renew\nfoo('<img src="/hero.jpg">');`, []],
      [
        `class View { #new = '<p>ok</p>'; show() { root.innerHTML = this.#new\nfoo('<img src="/hero.jpg">'); } }\nnew View().show();`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return { re: /{/ }.missing; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return { re: /{/ }; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /{/; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /a/gi; } });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return /a/.missing; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ re: /{/ });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ html: '<p>ok</p>', re: /[}]/g });`,
        [],
      ],
      [`root.innerHTML = /<img src=x>/.source.length;`, []],
      [`root.innerHTML = /<img src=x>/.source?.length;`, []],
      [`root.innerHTML = /<img src=x>/.source[0];`, []],
      [`root.innerHTML = /<img src=x>/.toString().length;`, []],
      [`root.innerHTML = String(/<img src=x>/).length;`, []],
      [`root.innerHTML = String(/<img src=x>/)?.length;`, []],
      [`root.innerHTML = String(/<img src=x>/)[0];`, []],
      [`root.innerHTML = String(/<img src=x>/, 1);`, []],
      [`root.innerHTML = /<img src=x>/.source.replace('x', 'y');`, []],
      [`root.innerHTML = +/<img src=x>/;`, []],
      [`root.innerHTML = typeof +/<img src=x>/;`, []],
      [`root.innerHTML = /<p>ok<\\/p>/.source;`, []],
      [`root.innerHTML = '<p>' + 'x'.replace(/<img>/g, '') + '</p>';`, []],
      [`root.innerHTML = /<img src=x>/.source - 0;`, []],
      [`root.innerHTML = /a'b/.source + '<img src=x>';`, ['alt']],
      [`const re = />[']/; // root.innerHTML = '<img src=x>';`, []],
      [`const re = />[']/;\nroot.innerHTML = '<img src=x>';`, ['alt']],
      [`root.innerHTML = foo /*\n*/ ('<img src=x>');`, ['alt']],
      [`root.innerHTML = foo\n('<img src=x>');`, ['alt']],
      [`root.innerHTML = pick\n[0] + '<img src=x>';`, ['alt']],
      ['root.innerHTML = tag\n`<img src=x>`;', ['alt']],
      [`root.innerHTML = foo;\n('<img src=x>');`, []],
      [`const n = {} / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`const n = { a: {} } / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`if (ready) {} /<img src=x>/.test(value);`, []],
      [`if (ready) /<img src=x>/.test(value);`, []],
      [`while (x) /<img src=x>/g.exec(s);`, []],
      [`root.innerHTML = '<img src=x>'; const = ;`, ['alt']],
      [`if (a) /'/.test(v); // root.innerHTML = '<img src=x>';`, []],
      [`if (a) '<img src=x>'.length;`, []],
      [`const Wrap = styled(Box)\`<img src=x>\`;`, []],
      [`root.innerHTML = styled(Box)\`<img src=x>\`;`, ['alt']],
      [`const n = value++ / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`const n = list[0]-- / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`const n = a + ++/<img src=x>/.lastIndex;`, []],
      [`if (ready) {} /'/.test(value); // root.innerHTML = '<img src=x>';`, []],
      [`{}\n/<img src=x>/.test(value);`, []],
      [`go(); {} /<img src=x>/.test(value);`, []],
      [`{ {} /<img src=x>/.test(value); }`, []],
      [`if (a) {} {} /<img src=x>/.test(value);`, []],
      [`const f = () => {}\n/<img src=x>/.test(value);`, []],
      [
        `const f = () => { return {} / (root.innerHTML = '<img src=x>') / 3; };\nf();`,
        ['alt'],
      ],
      [`function f() {}\n/<img src=x>/.test(value);`, []],
      [`if (ready) { go(); } else {} /<img src=x>/.test(value);`, []],
      [
        `function* g() { root.innerHTML = yield\n('<img src=x>'); }\ng().next();`,
        [],
      ],
      [
        `function* g() { root.innerHTML = yield x\n('<img src=x>'); }\ng().next();`,
        ['alt'],
      ],
      [`root.innerHTML = obj.yield\n('<img src=x>');`, ['alt']],
      [`root.innerHTML = this.#yield\n+ '<img src=x>';`, ['alt']],
      [`root.innerHTML = obj. yield\n('<img src=x>');`, ['alt']],
      [`done: {} /<img src=x>/.test(value);`, []],
      [`go(); done: {} /<img src=x>/.test(value);`, []],
      [`export default {} / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`export default function () {} /<img src=x>/.test(value);`, []],
      [`if (a) {} done: {} /<img src=x>/.test(value);`, []],
      [
        `const n = { done: {} / (root.innerHTML = '<img src=x>') / 3 };`,
        ['alt'],
      ],
      [`if (a) { done: {} /<img src=x>/.test(value); }`, []],
      [`switch (a) { case 1: {} /<img src=x>/.test(value); }`, []],
      [`switch (a) { default: {} /<img src=x>/.test(value); }`, []],
      [
        `const n = { done: {} } / (root.innerHTML = '<img src=x>') / 3;`,
        ['alt'],
      ],
      [`const n = a ? b : {} / (root.innerHTML = '<img src=x>') / 3;`, ['alt']],
      [`root.innerHTML = value++\n['<img src=x>'];`, []],
      [`root.innerHTML = value--\nfoo('<img src=x>');`, []],
      [`root.innerHTML = list[0]++\n('<img src=x>');`, []],
      [`root.innerHTML = x + ++\ny + '<img src=x>';`, ['alt']],
      [`const String = () => 0;\nroot.innerHTML = String(/<img src=x>/);`, []],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get html() { return; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ set html(v) { return '<p>safe</p>'; } });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ set html(v) {} });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ async html() {} });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ *html() {} });`,
        [],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get: '<p>safe</p>' });`,
        ['alt'],
      ],
      [
        `function show({ html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ get() {} });`,
        ['alt'],
      ],
      // A function nothing names, called where it is written, runs only by that call.
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; })('<p>safe</p>');`,
        [],
      ],
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; })();`,
        ['alt'],
      ],
      [
        `((html = '<img src="/hero.jpg">') => { root.innerHTML = html; })('<p>safe</p>');`,
        [],
      ],
      [
        `((html = '<img src="/hero.jpg">') => { root.innerHTML = html; })();`,
        ['alt'],
      ],
      [
        `((html = '<img src="/hero.jpg">') => (root.innerHTML = html))('<p>safe</p>');`,
        [],
      ],
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }('<p>safe</p>'));`,
        [],
      ],
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }());`,
        ['alt'],
      ],
      [
        `(async function (html = '<img src="/hero.jpg">') { root.innerHTML = html; })('<p>safe</p>');`,
        [],
      ],
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }).call(null, '<p>safe</p>');`,
        [],
      ],
      [
        `(function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }).call(null);`,
        ['alt'],
      ],
      [
        `setTimeout((function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }));`,
        ['alt'],
      ],
      [
        `const f = (function (html = '<img src="/hero.jpg">') { root.innerHTML = html; });\nf('<p>safe</p>');`,
        ['alt'],
      ],
      [
        `(function named(html = '<img src="/hero.jpg">') { root.innerHTML = html; })('<p>safe</p>');`,
        ['alt'],
      ],
      [
        `export default function (html = '<img src="/hero.jpg">') { root.innerHTML = html; }\n('<p>safe</p>');`,
        ['alt'],
      ],
      // A key a pattern works out when it runs may be any, so its default stays reachable.
      [
        `const key = 'hero';\nconst { [key]: html = '<img src="/hero.jpg">' } = {};\nroot.innerHTML = html;`,
        ['alt'],
      ],
      [`const { [key]: html = '<p>ok</p>' } = {};\nroot.innerHTML = html;`, []],
      [
        `function show({ [key]: html = '<img src="/hero.jpg">' }) { root.innerHTML = html; }\nshow({ hero: '<p>ok</p>' });`,
        ['alt'],
      ],
      [
        `const { ['hero']: html = '<img src="/hero.jpg">' } = { hero: '<p>ok</p>' };\nroot.innerHTML = html;`,
        [],
      ],
      // A tag in markup before brackets and a brace is no type parameter:
      // nothing there names a function.
      [
        `export function Page() { return <b>(new) {String(root.innerHTML = '<img src="/hero.jpg">')}</b>; }`,
        ['alt'],
      ],
      [
        `const badge = <b>(new) {String(root.innerHTML = '<img src="/hero.jpg">')}</b>;`,
        ['alt'],
      ],
      // A call that never runs leaves nothing out.
      [
        `function show(html = '<img src="/hero.jpg">') { root.innerHTML = html; }\nfunction never() { show(); }\nshow('<p>ok</p>');`,
        [],
      ],
    ] as const) {
      assert.deepEqual(
        page(`${code}\nexport const Docs = () => <div />;`),
        expected,
        code,
      );
    }
    // A name compared at the very end of the file is no type argument.
    assert.deepEqual(
      page(
        `class View { show() { root.innerHTML = '<img src="/hero.jpg">'; } }\nexport const Docs = () => <div />;\nconst ok = count < View`,
      ),
      ['alt'],
    );
    // A default is read by the part the sink reads of it, and a method
    // called on that part reads the part.
    for (const [member, expected] of [
      ['safe', []],
      ['hero', ['alt']],
      ['safe.trim()', []],
      ['hero.trim()', ['alt']],
    ] as const) {
      assert.deepEqual(
        page(
          `function show(opts = { hero: '<img src="/hero.jpg">', safe: '<p>ok</p>' }) { root.innerHTML = opts.${member}; }\nshow();\nexport const Docs = () => <div />;`,
        ),
        expected,
        member,
      );
    }
    // A default that is a name is read by the same part.
    for (const [member, expected] of [
      ['safe', []],
      ['hero', ['alt']],
    ] as const) {
      assert.deepEqual(
        page(
          `const bundle = { safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' };\nfunction show(opts = bundle) { root.innerHTML = opts.${member}; }\nshow();\nexport const Docs = () => <div />;`,
        ),
        expected,
        member,
      );
    }
    // Two sinks reading two parts of one default read both, in any order.
    for (const reads of [
      ['safe', 'hero'],
      ['hero', 'safe'],
    ]) {
      assert.deepEqual(
        page(
          `function show(opts = { safe: '<p>ok</p>', hero: '<img src="/hero.jpg">' }) { a.innerHTML = opts.${reads[0]}; b.innerHTML = opts.${reads[1]}; }\nshow();\nexport const Docs = () => <div />;`,
        ),
        ['alt'],
        reads.join(', '),
      );
    }
    assert.deepEqual(
      page(
        `function show(parts = ['<img src="/hero.jpg">', '<p>ok</p>']) { root.innerHTML = parts.join(''); }\nshow();\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A default that names an import renders what that import holds.
    for (const [importer, expected] of [
      [
        `import { markup } from './markup';\nconst { hero = markup } = {};\nroot.innerHTML = hero;`,
        ['alt'],
      ],
      [
        `import { markup } from './markup';\nfunction show(html = markup) { root.innerHTML = html; }\nshow();`,
        ['alt'],
      ],
      [
        `import { safe } from './markup';\nconst { hero = safe } = {};\nroot.innerHTML = hero;`,
        [],
      ],
    ] as const) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/markup.ts': `export const markup = '<img src="/hero.jpg">';\nexport const safe = '<p>ok</p>';`,
              'src/Docs.tsx': `${importer}\nexport const Docs = () => <div />;`,
            }),
          ),
          'errors',
        ),
        expected,
        importer,
      );
    }
  });

  it("does not take an <img> in a markup file's own script for an image", () => {
    const page = (path: string, content: string) =>
      checks(checkDesign(project({ [path]: content })), 'errors');
    assert.deepEqual(
      page(
        'src/Docs.vue',
        `<script setup>\nconst sample = '<img src="photo.jpg">';\n</script>\n<template><pre>{{ sample }}</pre></template>`,
      ),
      [],
    );
    assert.deepEqual(
      page(
        'src/Docs.astro',
        `---\nconst sample = '<img src="photo.jpg">';\n---\n<pre>{sample}</pre>`,
      ),
      [],
    );
    // Only an intrinsic <img>: not a component or a custom element, in
    // JSX or in a component template; in HTML, any case.
    for (const [path, content, expected] of [
      ['src/Hero.tsx', 'export const Hero = () => <Img src="/a.jpg" />;', []],
      [
        'src/Hero.tsx',
        'export const Hero = () => <img-carousel src="/a.jpg" />;',
        [],
      ],
      [
        'src/Hero.tsx',
        'export const Hero = () => <img src="/a.jpg" />;',
        ['alt'],
      ],
      [
        'src/Hero.tsx',
        'export const Hero = () => <img\n  src="/a.jpg"\n/>;',
        ['alt'],
      ],
      ['src/Hero.vue', '<template><Img src="/a.jpg" /></template>', []],
      ['src/Hero.html', '<IMG SRC="/a.jpg">', ['alt']],
      ['src/Hero.html', '<img-carousel src="/a.jpg"></img-carousel>', []],
    ] as const) {
      assert.deepEqual(page(path, content), expected, content);
    }
    // A class component's render is called by React, not by name.
    for (const [code, expected] of [
      [
        'export default class App extends React.Component { render() { return <img src="/a.jpg" />; } }',
        ['alt'],
      ],
      [
        'export class App extends Component { render() { return <img src="/a.jpg" />; } }',
        ['alt'],
      ],
      [
        'class App extends Component { render() { return <img src="/a.jpg" />; } }\nexport const Root = () => <App />;',
        ['alt'],
      ],
      [
        'class Unused extends Component { render() { return <img src="/a.jpg" />; } }\nexport const Root = () => <div />;',
        [],
      ],
    ] as const) {
      assert.deepEqual(page('src/App.tsx', code), expected, code);
    }
    // An image in a branch that can never render is not on the page.
    for (const [branch, expected] of [
      ['{false && <img src="/a.jpg" />}', []],
      ['{null && (<img src="/a.jpg" />)}', []],
      ['{0 && <img src="/a.jpg" />}', []],
      ['{false ? <img src="/a.jpg" /> : null}', []],
      ['{true ? null : <img src="/a.jpg" />}', []],
      ['{true && <img src="/a.jpg" />}', ['alt']],
      ['{open && <img src="/a.jpg" />}', ['alt']],
      ['{false ? null : <img src="/a.jpg" />}', ['alt']],
      ['{true ? <img src="/a.jpg" /> : null}', ['alt']],
      ['{false && <p>{open && <img src="/b.jpg" />}</p>}', []],
      ['{open && <p>{false && <img src="/b.jpg" />}</p>}', []],
      ['{open && <p>{shown && <img src="/b.jpg" />}</p>}', ['alt']],
      ['{x || false && <img src="/a.jpg" />}', ['alt']],
    ] as const) {
      assert.deepEqual(
        page('src/Hero.tsx', `export const Hero = () => <div>${branch}</div>;`),
        expected,
        branch,
      );
    }
    // An image in the markup itself is still an image.
    assert.deepEqual(
      page(
        'src/Docs.vue',
        `<script setup>\nconst n = 1;\n</script>\n<template><img src="/a.jpg"></template>`,
      ),
      ['alt'],
    );
    // A binding the template hands to a raw-HTML directive is rendered:
    // Vue's v-html and :innerHTML, Svelte's {@html}, Astro's set:html.
    const hero = `const markup = '<img src="/hero.jpg">';\nconst safe = '<p>ok</p>';`;
    for (const [path, content, expected] of [
      [
        'src/Docs.vue',
        `<script setup>\n${hero}\n</script>\n<template><div v-html="markup"></div></template>`,
        ['alt'],
      ],
      [
        'src/Docs.vue',
        `<script setup>\n${hero}\n</script>\n<template><div v-html="safe"></div></template>`,
        [],
      ],
      [
        'src/Docs.vue',
        `<script setup>\n${hero}\n</script>\n<template><div :innerHTML='markup'></div></template>`,
        ['alt'],
      ],
      [
        'src/Docs.vue',
        `<script setup>\n${hero}\n</script>\n<template><p>{{ markup }}</p></template>`,
        [],
      ],
      [
        'src/Docs.svelte',
        `<script>\n${hero}\n</script>\n{@html markup}`,
        ['alt'],
      ],
      ['src/Docs.svelte', `<script>\n${hero}\n</script>\n{@html safe}`, []],
      [
        'src/Docs.astro',
        `---\n${hero}\n---\n<div set:html={markup} />`,
        ['alt'],
      ],
      ['src/Docs.astro', `---\n${hero}\n---\n<div set:html={safe} />`, []],
    ] as const) {
      assert.deepEqual(page(path, content), expected, content);
    }
    // A quoted sink property is the same sink.
    for (const [code, expected] of [
      [
        `const markup = '<img src="/a.jpg">';\nexport const A = () => <div dangerouslySetInnerHTML={{ '__html': markup }} />;`,
        ['alt'],
      ],
      [
        `export const A = () => <div dangerouslySetInnerHTML={{ '__html': '<img src="/a.jpg">' }} />;`,
        ['alt'],
      ],
      [
        `export const A = () => <div dangerouslySetInnerHTML={{ "__html": '<p>ok</p>', title: '<img src="/a.jpg">' }} />;`,
        [],
      ],
      [`root['innerHTML'] = '<img src="/a.jpg">';`, ['alt']],
      [`root["outerHTML"] = '<img src="/a.jpg">';`, ['alt']],
      [`root[\`innerHTML\`] += '<img src="/a.jpg">';`, ['alt']],
      [`root['title'] = '<img src="/a.jpg">';`, []],
    ] as const) {
      assert.deepEqual(
        page('src/Docs.tsx', `${code}\nexport const Docs = () => <div />;`),
        expected,
        code,
      );
    }
    assert.deepEqual(
      page(
        'src/Docs.tsx',
        `const markup = '<img src="/a.jpg">';\nroot['innerHTML'] = markup;\nexport const Docs = () => <div />;`,
      ),
      ['alt'],
    );
    // A directive written inside the script (a code sample) is not one.
    assert.deepEqual(
      page(
        'src/Docs.vue',
        `<script setup>\n${hero}\nconst example = '<div v-html="markup"></div>';\n</script>\n<template><pre>{{ example }}</pre></template>`,
      ),
      [],
    );
    // Through an import, too.
    assert.deepEqual(
      checks(
        checkDesign(
          project({
            'src/markup.ts': `export const markup = '<img src="/hero.jpg">';`,
            'src/Docs.vue': `<script setup>\nimport { markup } from './markup';\n</script>\n<template><div v-html="markup"></div></template>`,
          }),
        ),
        'errors',
      ),
      ['alt'],
    );
  });

  it('takes a boolean alt in JSX for no alt, as React does', () => {
    for (const value of ['{true}', '{false}']) {
      assert.deepEqual(
        checks(
          checkDesign(
            project({
              'src/Hero.tsx': `export const Hero = () => <img src="/hero.jpg" alt=${value} />;`,
            }),
          ),
          'errors',
        ),
        ['alt'],
        value,
      );
    }
  });

  it("accepts markup's bare alt, and Vue's and Svelte's bindings, but not JSX's", () => {
    const page = (path: string, tag: string) =>
      checks(checkDesign(project({ [path]: tag })), 'errors');
    assert.deepEqual(page('src/Deco.html', '<img src="/deco.png" alt>'), []);
    assert.deepEqual(page('src/Deco.vue', '<img src="/deco.png" alt />'), []);
    assert.deepEqual(page('src/Deco.vue', '<img :src="src" :alt="alt">'), []);
    assert.deepEqual(page('src/Deco.svelte', '<img {src} {alt}>'), []);
    // A binding Vue drops (null or undefined) is no alt.
    for (const [tag, expected] of [
      ['<img src="/a.jpg" :alt="null">', ['alt']],
      ['<img src="/a.jpg" v-bind:alt=\'undefined\'>', ['alt']],
      ['<img src="/a.jpg" :alt="caption">', []],
      ['<img src="/a.jpg" :alt="nullable">', []],
      ['<img src="/a.jpg" v-bind="attrs" :alt="null">', ['alt']],
    ] as const) {
      assert.deepEqual(page('src/Deco.vue', tag), expected, tag);
    }
    // Vue's v-bind of an object may carry alt, like a spread.
    assert.deepEqual(
      page('src/Deco.vue', '<img src="/deco.png" v-bind="imageAttrs">'),
      [],
    );
    assert.deepEqual(
      page('src/Deco.vue', '<img src="/deco.png" v-bind:title="title">'),
      ['alt'],
    );
    assert.deepEqual(page('src/Deco.html', '<img src="/deco.png" alt-text>'), [
      'alt',
    ]);
    // In JSX a bare alt is alt={true}, which React drops.
    assert.deepEqual(
      page(
        'src/Deco.tsx',
        'export const D = () => <img src="/deco.png" alt />;',
      ),
      ['alt'],
    );
  });

  it('warns, and only warns, when anything animates with no reduced-motion rule', () => {
    // A warning, never an error: whether motion is stopped is a static
    // reading of CSS, markup and script together, a heuristic, and an
    // error buys a paid repair on its own.
    const moving = `@keyframes rise { from { opacity: 0 } }
.card { animation: rise 300ms var(--ease-out); }`;
    const base = project()[1]!.content;
    const report = checkDesign(
      project({ 'src/styles.css': `${base}\n${moving}` }),
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(checks(report, 'warnings'), ['reduced-motion']);
    assert.deepEqual(
      checkDesign(
        project({
          'src/styles.css': `${base}\n${moving}\n@media (prefers-reduced-motion: reduce) { .card { animation: none; } }`,
        }),
      ).warnings,
      [],
    );
  });

  it('reads a JSX image tag to its end, past an arrow in an expression', () => {
    const hero = (tag: string) =>
      checks(
        checkDesign(
          project({
            'src/Hero.tsx': `export const Hero = ({ items }) => ${tag};`,
          }),
        ),
        'errors',
      );
    assert.deepEqual(
      hero(`<img src={items.find((x) => x.active)?.url} alt="Active" />`),
      [],
    );
    assert.deepEqual(
      hero(
        `<img src={items.find((x) => x.active && x.label !== '}>')?.url} alt="Active" />`,
      ),
      [],
    );
    assert.deepEqual(hero(`<img src={items.find((x) => x.active)?.url} />`), [
      'alt',
    ]);
    // React omits a nullish alt, so it is no alt; a dynamic one is real.
    assert.deepEqual(hero(`<img src="/hero.jpg" alt={undefined} />`), ['alt']);
    assert.deepEqual(hero(`<img src="/hero.jpg" alt={null} />`), ['alt']);
    assert.deepEqual(hero(`<img src="/hero.jpg" alt={items[0].alt} />`), []);
    // A nullish alt after a spread wins over whatever the spread carried.
    assert.deepEqual(hero(`<img {...items[0]} alt={undefined} />`), ['alt']);
    assert.deepEqual(hero(`<img alt={undefined} {...items[0]} />`), []);
    // Another attribute that ends in "alt" is not alt.
    assert.deepEqual(hero(`<img src="/hero.jpg" data-alt="Hero" />`), ['alt']);
    // A spread may carry alt, and the checker cannot see into it.
    assert.deepEqual(hero(`<img {...items[0]} />`), []);
  });

  it('counts a transition that moves something as motion', () => {
    const base = project()[1]!.content;
    // Reduced motion is reported as a warning; the rest of the project
    // meets its spec, so warnings here are about motion alone.
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const lift = `.card { transition: transform 200ms ease; }
.card:hover { transform: translateY(-4px); }`;
    assert.deepEqual(motion(lift), ['reduced-motion']);
    assert.deepEqual(
      motion(
        `${lift}\n@media (prefers-reduced-motion: reduce) { .card { transition: none; } }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(`.card { transition: all .2s; }
.card:hover { transform: scale(1.02); }`),
      ['reduced-motion'],
    );
    // Colour and opacity are not movement.
    assert.deepEqual(
      motion(`.card { transition: color 200ms, opacity 200ms; }`),
      [],
    );
    assert.deepEqual(
      motion(`.card { transition: all .2s; }
.card:hover { color: red; }`),
      [],
    );
    // Tailwind: the variant moves; motion-reduce answers it.
    const tile = (className: string) => ({
      'src/Tile.tsx': `export const Tile = () => <div className="${className}" />;`,
    });
    assert.deepEqual(motion('', tile('transition hover:-translate-y-1')), [
      'reduced-motion',
    ]);
    assert.deepEqual(motion('', tile('animate-spin')), ['reduced-motion']);
    assert.deepEqual(
      motion(
        '',
        tile('transition hover:-translate-y-1 motion-reduce:transform-none'),
      ),
      [],
    );
    assert.deepEqual(motion('', tile('transition hover:bg-slate-100')), []);
    // A transition and a transform move something only on the same element.
    assert.deepEqual(
      motion(
        `.card { transition: transform 200ms; }\n.logo { transform: rotate(10deg); }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(
        `.card { transition: transform 200ms; }\n.card.is-open { transform: translateY(-4px); }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', {
        'src/Card.tsx': `export const Card = ({ open }) => <div style={{ transition: 'transform .2s', transform: open ? 'scale(1.05)' : 'none' }} />;`,
      }),
      ['reduced-motion'],
    );
    // A reduce rule stops the element it names, or everything with `*`.
    const card = `.card { animation: rise 1s ease; }`;
    assert.deepEqual(
      motion(
        `${card}\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${card}\n@media (prefers-reduced-motion: reduce) { .card { animation: none; } }`,
      ),
      [],
    );
    // A reduce rule that also asks for a wide screen leaves narrow ones
    // moving; one that is "or" something else still applies.
    assert.deepEqual(
      motion(
        `${card}\n@media (prefers-reduced-motion: reduce) and (min-width: 1024px) { .card { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${card}\n@media screen and (prefers-reduced-motion: reduce), print { .card { animation: none; } }`,
      ),
      [],
    );
    // Inline motion is answered by a read that decides it, not by a read
    // that decides something else, nor by a rule for another element.
    const inlineSpinner = (reduced: string) => ({
      'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div>${reduced}<div style={{ animation: 'spin 1s linear infinite' }} /></div>;`,
    });
    assert.deepEqual(motion('', inlineSpinner('<Card compact={reduce} />')), [
      'reduced-motion',
    ]);
    assert.deepEqual(
      motion('', {
        'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div style={{ animation: reduce ? 'none' : 'spin 1s linear infinite' }} />;`,
      }),
      [],
    );
    assert.deepEqual(
      motion('', {
        'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div style={reduce ? undefined : { animation: 'spin 1s linear infinite' }} />;`,
      }),
      [],
    );
    // Or leaves the element out for a visitor who asked, not the reverse.
    const shown = (condition: string) =>
      motion('', {
        'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div>{${condition} && <div style={{ animation: 'spin 1s linear infinite' }} />}</div>;`,
      });
    assert.deepEqual(shown('!reduce'), []);
    assert.deepEqual(shown('reduce'), ['reduced-motion']);
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .other { animation: none; } }`,
        {
          'src/Card.tsx': `export const Card = () => <div style={{ animation: 'spin 1s linear infinite' }} />;`,
        },
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`,
        {
          'src/Card.tsx': `export const Card = () => <div style={{ animation: 'spin 1s linear infinite' }} />;`,
        },
      ),
      [],
    );
    assert.deepEqual(
      motion(
        `${card}\n@media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; } }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(card, {
        'src/Card.tsx': `export const Card = () => <div className="card motion-reduce:animate-none" />;`,
      }),
      [],
    );
    // `*` inside a scope covers the scope, not the page.
    assert.deepEqual(
      motion(
        `${card}\n@media (prefers-reduced-motion: reduce) { .modal * { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    // One element in a state is still one element: stopping it by either
    // of its classes stops it.
    assert.deepEqual(
      motion(
        `.card.is-open { animation: rise 1s; }\n@media (prefers-reduced-motion: reduce) { .card { animation: none !important; } }`,
      ),
      [],
    );
    // A motion-reduce: class on a sibling does not stop the spinner.
    assert.deepEqual(
      motion('', {
        'src/Spin.tsx': `export const Spin = () => <><div className="animate-spin" /><div className="motion-reduce:animate-none" /></>;`,
      }),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', {
        'src/Spin.tsx': `export const Spin = () => <div className="animate-spin motion-reduce:animate-none" />;`,
      }),
      [],
    );
    // Each member of a selector list is its own element.
    assert.deepEqual(
      motion(
        `.card, .logo { transition: transform 200ms; }\n.logo:hover { transform: translateY(-4px); }\n@media (prefers-reduced-motion: reduce) { .logo { transition: none; } }`,
      ),
      [],
    );
    // A stopper for transitions does nothing to an animation.
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s linear infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { transition: none; } }`,
      ),
      ['reduced-motion'],
    );
    // `transition: 200ms ease` names no property, so it transitions all.
    assert.deepEqual(
      motion(
        `.card { transition: 200ms ease; }\n.card:hover { transform: scale(1.1); }`,
      ),
      ['reduced-motion'],
    );
    // Classes passed through a helper are still the element's classes.
    assert.deepEqual(
      motion('', {
        'src/Spin.tsx': `export const Spin = ({ className }) => <div className={cn('animate-spin', className)} />;`,
      }),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', {
        'src/Spin.tsx': `export const Spin = ({ className }) => <div className={cn('animate-spin motion-reduce:animate-none', className)} />;`,
      }),
      [],
    );
    // A Tailwind animation under a variant still animates.
    assert.deepEqual(motion('', tile('md:animate-spin')), ['reduced-motion']);
    assert.deepEqual(motion('', tile('hover:animate-bounce')), [
      'reduced-motion',
    ]);
    // A pseudo-element is its own element.
    const before = `.card::before { animation: spin 1s linear infinite; }`;
    assert.deepEqual(
      motion(
        `${before}\n@media (prefers-reduced-motion: reduce) { .card { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${before}\n@media (prefers-reduced-motion: reduce) { .card::before { animation: none; } }`,
      ),
      [],
    );
    // Every duration in the list has to be negligible.
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s, pulse 2s; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 0s, 2s; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s, pulse 2s; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 0s, .01ms !important; } }`,
      ),
      [],
    );
    // A motion-reduce: stopper answers only where its variants apply.
    assert.deepEqual(
      motion('', tile('animate-spin md:motion-reduce:animate-none')),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', tile('md:animate-spin md:motion-reduce:animate-none')),
      [],
    );
    // An animation's state variant is part of where it runs, on both sides.
    assert.deepEqual(
      motion('', tile('hover:animate-spin hover:motion-reduce:animate-none')),
      [],
    );
    assert.deepEqual(
      motion('', tile('animate-spin hover:motion-reduce:animate-none')),
      ['reduced-motion'],
    );
    // A transitioned transform's state is not: the stopper can sit in it.
    assert.deepEqual(
      motion(
        '',
        tile(
          'transition hover:-translate-y-1 hover:motion-reduce:translate-y-0',
        ),
      ),
      [],
    );
    // Both kinds in one class list are answered separately.
    assert.deepEqual(
      motion(
        '',
        tile(
          'animate-pulse transition-transform hover:translate-x-1 motion-reduce:animate-none',
        ),
      ),
      ['reduced-motion'],
    );
    // Every entry of an animation list has to stop.
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s, pulse 2s; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none, spin 1s; } }`,
      ),
      ['reduced-motion'],
    );
    // Motion keyed only by an attribute is still motion.
    assert.deepEqual(
      motion(
        `[data-open="false"] { transform: translateX(-100%); }\n[data-open="true"] { transition: transform .2s; transform: translateX(0); }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `[data-open="false"] { transform: translateX(-100%); }\n[data-open="true"] { transition: transform .2s; transform: translateX(0); }\n@media (prefers-reduced-motion: reduce) { [data-open] { transition: none; } }`,
      ),
      [],
    );
    // A stopper scoped or narrowed past the moving element does not stop it.
    const spinner = `.card { animation: spin 1s linear infinite; }`;
    assert.deepEqual(
      motion(
        `${spinner}\n@media (prefers-reduced-motion: reduce) { .dialog .card.special { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${spinner}\n@media (prefers-reduced-motion: reduce) { .card.special { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${spinner}\n@media (prefers-reduced-motion: reduce) { .dialog .card { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.dialog .card { animation: spin 1s linear infinite; }\n@media (prefers-reduced-motion: reduce) { .dialog .card { animation: none; } }`,
      ),
      [],
    );
    // A state rule that declares both its transition and its transform moves.
    assert.deepEqual(
      motion(
        `.card:hover { transition: transform .2s; transform: scale(1.1); }`,
      ),
      ['reduced-motion'],
    );
    // A reduce rule that only slows the animation down has not stopped it.
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s linear infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }`,
      ),
      ['reduced-motion'],
    );
    // A transition of transform with no transform to carry moves nothing.
    assert.deepEqual(motion(`.card { transition: transform 200ms ease; }`), []);
    // Without a transition a hover transform is a change of state.
    assert.deepEqual(motion('', tile('hover:scale-105')), []);
    // A reduce rule counts only when it stops the movement.
    assert.deepEqual(
      motion(
        `${lift}\n@media (prefers-reduced-motion: reduce) { body { color: red; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `${lift}\n@media (prefers-reduced-motion: reduce) { *, *::before { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(
        '',
        tile('transition hover:-translate-y-1 motion-reduce:text-red-500'),
      ),
      ['reduced-motion'],
    );
    // Script that reads the preference and adds a class answers the motion
    // that class's rules stop, and nothing else.
    const calm = {
      'src/motion.ts': `const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;\nif (calm) document.documentElement.classList.add('calm');`,
    };
    assert.deepEqual(
      motion(`${lift}\n.calm .card { transition: none; }`, calm),
      [],
    );
    assert.deepEqual(motion(lift, calm), ['reduced-motion']);
    // A read that gates one class list answers that list, not a CSS
    // spinner elsewhere.
    const gate = {
      'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div className={reduce ? 'card' : 'card animate-pulse'} />;`,
    };
    assert.deepEqual(motion('', gate), []);
    // The class a reduced-motion visitor gets has to be the still one.
    const wrongWay = (className: string) =>
      motion('', {
        'src/Card.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <div className={${className}} />;`,
      });
    assert.deepEqual(wrongWay(`reduce ? 'animate-spin' : ''`), [
      'reduced-motion',
    ]);
    assert.deepEqual(wrongWay(`!reduce ? 'animate-spin' : ''`), []);
    assert.deepEqual(wrongWay(`cn('animate-spin', reduce && 'text-red-500')`), [
      'reduced-motion',
    ]);
    assert.deepEqual(wrongWay(`cn('card', !reduce && 'animate-spin')`), []);
    assert.deepEqual(wrongWay(`cn('card', reduce && 'animate-spin')`), [
      'reduced-motion',
    ]);
    assert.deepEqual(wrongWay(`!reduce ? '' : 'animate-spin'`), [
      'reduced-motion',
    ]);
    assert.deepEqual(
      motion('.spinner { animation: spin 1s linear infinite; }', gate),
      ['reduced-motion'],
    );
    // A read of the preference that nothing uses changes nothing.
    assert.deepEqual(
      motion(lift, {
        'src/motion.ts': `window.matchMedia('(prefers-reduced-motion: reduce)');\nconst unused = useReducedMotion();`,
      }),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(lift, {
        'src/Card.tsx': `export const Card = () => { const reduce = useReducedMotion(); return <div className={reduce ? 'still' : 'card'} />; };`,
      }),
      [],
    );
    // Used, but for something other than the moving element.
    assert.deepEqual(
      motion(lift, {
        'src/Card.tsx': `export const Card = () => { const reduce = useReducedMotion(); return <div data-reduce={reduce} />; };`,
      }),
      ['reduced-motion'],
    );
    // Keyframes nothing applies move nothing.
    assert.deepEqual(
      motion(`@keyframes spin { to { transform: rotate(1turn); } }`),
      [],
    );
    // Each source is reported, so a repair is told about both.
    assert.deepEqual(
      motion(`.spinner { animation: spin 1s linear infinite; }`, {
        'src/Hero.tsx': `export const Hero = () => <video autoPlay muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      ['reduced-motion', 'reduced-motion'],
    );
    // A no-preference rule answers only for the motion inside it.
    const spin = `.spinner { animation: spin 1s linear infinite; }`;
    assert.deepEqual(
      motion(
        `${spin}\n@media (prefers-reduced-motion: no-preference) { .fade { opacity: 1; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: no-preference) { @media (min-width: 1px) { ${spin} } }`,
      ),
      [],
    );
    assert.deepEqual(motion('', tile('motion-safe:animate-spin')), []);
    assert.deepEqual(
      motion('', tile('motion-safe:animate-spin animate-bounce')),
      ['reduced-motion'],
    );
    // A video that plays itself is movement; one that waits to be played
    // is not.
    const video = (attrs: string) => ({
      'src/Hero.tsx': `export const Hero = () => <video ${attrs} src="/media/loop.mp4" />;`,
    });
    assert.deepEqual(motion('', video('autoPlay muted loop playsInline')), [
      'reduced-motion',
    ]);
    assert.deepEqual(motion('', video('autoplay muted')), ['reduced-motion']);
    assert.deepEqual(motion('', video('controls')), []);
    // A rule that stops a spinner does nothing for the video; hiding it
    // under reduce, or motion-reduce:hidden, does.
    const autoplay = video('autoPlay muted loop playsInline');
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
        autoplay,
      ),
      ['reduced-motion'],
    );
    const inHero = {
      'src/Hero.tsx': `export const Hero = () => <section className="hero"><video autoPlay muted loop playsInline src="/media/loop.mp4" /></section>;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .hero video { display: none; } }`,
        inHero,
      ),
      [],
    );
    // Scope is read in nesting order.
    const nested = {
      'src/Hero.tsx': `export const Hero = () => <div className="dialog"><div className="hero"><video autoPlay muted loop playsInline src="/media/loop.mp4" /></div></div>;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .hero .dialog { display: none; } }`,
        nested,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .dialog .hero { display: none; } }`,
        nested,
      ),
      [],
    );
    // A preference read answers a video only when script decides whether it
    // plays; one that only turns off a library animation does not.
    const reduce = `const reduce = useReducedMotion();\nexport const Card = () => <motion.div animate={reduce ? {} : { y: -4 }} />;`;
    assert.deepEqual(motion('', { ...autoplay, 'src/Card.tsx': reduce }), [
      'reduced-motion',
    ]);
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Hero = () => <video autoPlay={!reduce} muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      [],
    );
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Hero = () => (reduce ? <img src="/media/poster.jpg" alt="" /> : <video autoPlay muted loop playsInline src="/media/loop.mp4" />);`,
      }),
      [],
    );
    // Script decides, but not by the preference.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <motion.div animate={reduce ? {} : { y: -4 }} />;\nexport const Hero = ({ carouselActive }) => <video autoPlay={carouselActive} muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      ['reduced-motion'],
    );
    // The preference the wrong way round plays it for exactly the visitors
    // who asked for less motion.
    const reduced = (hero: string) =>
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\n${hero}`,
      });
    assert.deepEqual(
      reduced(
        'export const Hero = () => <video autoPlay={reduce} muted src="/media/loop.mp4" />;',
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      reduced(
        'export const Hero = () => <div>{reduce && <video autoPlay muted src="/media/loop.mp4" />}</div>;',
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      reduced(
        'export const Hero = () => <div>{!reduce && <video autoPlay muted src="/media/loop.mp4" />}</div>;',
      ),
      [],
    );
    assert.deepEqual(
      reduced(
        'export const Hero = () => { if (!reduce) videoRef.current?.pause(); return <video ref={videoRef} autoPlay muted src="/media/loop.mp4" />; };',
      ),
      ['reduced-motion'],
    );
    // The preference used nearby, but not in the condition that gates it.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `export const Hero = ({ open }) => { const reduce = useReducedMotion(); return <><Card calm={reduce} />{open && <video autoPlay muted loop playsInline src="/media/loop.mp4" />}</>; };`,
      }),
      ['reduced-motion'],
    );
    // Rendered on a condition, but not the preference.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <motion.div animate={reduce ? {} : { y: -4 }} />;${' '.repeat(240)}\nexport const Hero = ({ open }) => <div>{open && <video autoPlay muted loop playsInline src="/media/loop.mp4" />}</div>;`,
      }),
      ['reduced-motion'],
    );
    // A pause the preference does not guard.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Card = () => <motion.div animate={reduce ? {} : { y: -4 }} />;\n${' '.repeat(240)}\nexport const Hero = () => <video ref={videoRef} onClick={() => videoRef.current.pause()} autoPlay muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      ['reduced-motion'],
    );
    // A Tailwind hider under another variant leaves other screens playing.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `export const Hero = () => <video className="md:motion-reduce:hidden" autoPlay muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      ['reduced-motion'],
    );
    // A pause counts only on the video's own handle.
    assert.deepEqual(
      motion('', {
        ...autoplay,
        'src/Audio.tsx': `const reduce = useReducedMotion();\nexport const Audio = () => { if (reduce) audioRef.current.pause(); return <audio ref={audioRef} />; };`,
      }),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Hero = () => { if (reduce) videoRef.current?.pause(); return <video ref={videoRef} autoPlay muted loop playsInline src="/media/loop.mp4" />; };`,
      }),
      [],
    );
    // The guard is the pause's own condition, not a use of the preference
    // just before it.
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Hero = () => { if (reduce) stopSpinner(); if (!reduce) videoRef.current.pause(); return <video ref={videoRef} autoPlay muted src="/media/loop.mp4" />; };`,
      }),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `const reduce = useReducedMotion();\nexport const Hero = () => { useEffect(() => { if (reduce) { stopSpinner(); videoRef.current.pause(); } }, [reduce]); return <video ref={videoRef} autoPlay muted src="/media/loop.mp4" />; };`,
      }),
      [],
    );
    // querySelector('video') finds the first video only.
    const two = {
      'src/Hero.tsx': `const reduce = useReducedMotion();\nif (reduce) document.querySelector('video')?.pause();\nexport const Hero = () => <div><video autoPlay muted src="/media/a.mp4" /><video autoPlay muted src="/media/b.mp4" /></div>;`,
    };
    assert.deepEqual(motion('', two), ['reduced-motion']);
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': two['src/Hero.tsx'].replace(
          "document.querySelector('video')?.pause()",
          "document.querySelectorAll('video').forEach((v) => v.pause())",
        ),
      }),
      [],
    );
    // A hider scoped to somewhere the video is not leaves it playing.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .dialog video { display: none; } }`,
        inHero,
      ),
      ['reduced-motion'],
    );
    // A motion library told to follow the preference does not stop a
    // native video.
    assert.deepEqual(
      motion('', {
        ...autoplay,
        'src/Motion.tsx': `export const Motion = ({ children }) => <MotionConfig reducedMotion="user">{children}</MotionConfig>;`,
      }),
      ['reduced-motion'],
    );
    // Hiding something else leaves the video playing; hiding the video by
    // its own class, or its wrapper, does not.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .animated-logo { display: none; } }`,
        autoplay,
      ),
      ['reduced-motion'],
    );
    const wrapped = {
      'src/Hero.tsx': `export const Hero = () => <div className="hero-media"><video className="hero-video" autoPlay muted loop playsInline src="/media/loop.mp4" /></div>;`,
    };
    // A rule hiding something inside the wrapper does not hide the video.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .hero-media .caption { display: none; } }`,
        wrapped,
      ),
      ['reduced-motion'],
    );
    // A sibling before the video is not its wrapper.
    for (const before of [
      '<div className="animated-logo" />',
      '<div className="animated-logo"></div>',
    ]) {
      assert.deepEqual(
        motion(
          `@media (prefers-reduced-motion: reduce) { .animated-logo { display: none; } }`,
          {
            'src/Hero.tsx': `export const Hero = () => <main>${before}<video autoPlay muted loop playsInline src="/media/loop.mp4" /></main>;`,
          },
        ),
        ['reduced-motion'],
        before,
      );
    }
    // A rule for an id does not reach a class of the same name.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { #hero-video { display: none; } }`,
        wrapped,
      ),
      ['reduced-motion'],
    );
    for (const selector of ['.hero-video', '.hero-media']) {
      assert.deepEqual(
        motion(
          `@media (prefers-reduced-motion: reduce) { ${selector} { display: none; } }`,
          wrapped,
        ),
        [],
        selector,
      );
    }
    assert.deepEqual(
      motion('', {
        'src/Hero.tsx': `export const Hero = () => <video className="motion-reduce:hidden" autoPlay muted loop playsInline src="/media/loop.mp4" />;`,
      }),
      [],
    );
    assert.deepEqual(motion('', video('autoPlay={false} controls')), []);
  });

  it('weighs a reduce rule against later rules, as the cascade does (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    // A later rule as specific starts the animation again.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }\n.spinner { animation: spin 1s infinite; }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation: none; } }\n.spinner { animation: spin 1s infinite; }`,
      ),
      ['reduced-motion'],
    );
    // Unless the stop is important, or comes after.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none !important; } }\n.spinner { animation: spin 1s infinite; }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
      ),
      [],
    );
  });

  it('weighs importance on both sides of a reduce stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none !important; } }\n.spinner { animation: spin 1s infinite !important; }`,
      ),
      ['reduced-motion'],
    );
    // An important restart beats a more specific normal stop.
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { #hero .spinner { animation: none; } }\n.spinner { animation: spin 1s infinite !important; }`,
      ),
      ['reduced-motion'],
    );
  });

  it('does not count a no-preference rule as a restart (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: pulse 2s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }\n@media (prefers-reduced-motion: no-preference) { .spinner { animation: spin 1s infinite; } }`,
      ),
      [],
    );
  });

  it('reads the declaration that wins within a reduce rule (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; animation: spin 1s infinite; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none !important; animation: spin 1s infinite; } }`,
      ),
      [],
    );
  });

  it('lets a Tailwind reset stop only the transform it resets (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const card = (names: string) =>
      motion('', {
        'src/Card.tsx': `export const Card = () => <div className="${names}" />;`,
      });
    assert.deepEqual(
      card('transition-transform hover:scale-110 motion-reduce:translate-x-0'),
      ['reduced-motion'],
    );
    assert.deepEqual(
      card(
        'transition-transform hover:scale-110 hover:motion-reduce:scale-100',
      ),
      [],
    );
    assert.deepEqual(
      card(
        'transition-transform hover:scale-110 motion-reduce:transition-none',
      ),
      [],
    );
  });

  it('holds a transform reset to the state the transform moves in (#239 review)', () => {
    const base = project()[1]!.content;
    const card = (names: string) =>
      checks(
        checkDesign(
          project({
            'src/styles.css': base,
            'src/Card.tsx': `export const Card = () => <div className="${names}" />;`,
          }),
        ),
        'warnings',
      );
    assert.deepEqual(
      card('transition-transform hover:scale-110 motion-reduce:scale-100'),
      ['reduced-motion'],
    );
    assert.deepEqual(
      card('transition-transform hover:scale-110 motion-reduce:scale-100!'),
      [],
    );
  });

  it('lets an earlier, more specific rule override a reduce stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner.active { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner.active { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner.active { animation: none; } }`,
      ),
      [],
    );
  });

  it('reads the winning duration in a reduce rule (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 0s; animation-duration: 2s; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 0s !important; animation-duration: 2s; } }`,
      ),
      [],
    );
  });

  it('reads the winning declaration of a rule that might restart (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }\n.spinner { animation: spin 1s; animation: none; }`,
      ),
      [],
    );
  });

  it('accepts a trailing important on reduce utilities (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const card = (names: string) =>
      motion('', {
        'src/Card.tsx': `export const Card = () => <div className="${names}" />;`,
      });
    assert.deepEqual(
      card('transition-transform hover:scale-110 motion-reduce:scale-100!'),
      [],
    );
    assert.deepEqual(card('animate-spin motion-reduce:animate-none!'), []);
  });

  it('weighs a reduce rule that hides against rules that show (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { display: none; } }\n.spinner { display: block; }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { display: none; display: block; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.spinner { display: block; animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { display: none; } }`,
      ),
      [],
    );
  });

  it('needs an important page-wide stop over inline motion (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const spin = {
      'src/Spin.tsx': `export const Spin = () => <div style={{ animation: 'spin 1s infinite' }} />;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation: none; } }`,
        spin,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`,
        spin,
      ),
      [],
    );
  });

  it('lets a later duration undo a duration stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 0s; } }\n.spinner { animation-duration: 1s; }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.card { transition: transform 200ms; }\n.card:hover { transform: scale(1.1); }\n@media (prefers-reduced-motion: reduce) { .card { transition-duration: 0s; } }\n.card { transition-duration: 200ms; }`,
      ),
      ['reduced-motion'],
    );
  });

  it('takes importance from the declaration that stops (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .spinner { animation: none; animation-delay: 0s !important; } }\n.spinner { animation: spin 1s infinite; }`,
      ),
      ['reduced-motion'],
    );
  });

  it('reads a rule that moves by its winning declaration (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(`.spinner { animation: spin 1s; animation: none; }`),
      [],
    );
  });

  it('does not take a pseudo-element selector as page-wide (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const spin = {
      'src/Spin.tsx': `export const Spin = () => <div style={{ animation: 'spin 1s infinite' }} />;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { *::before { animation: none !important; } }`,
        spin,
      ),
      ['reduced-motion'],
    );
  });

  it('weighs cascade layers before specificity and order (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `@layer base, utilities;\n@layer utilities { .spinner { animation: spin 1s infinite; } }\n@layer base { @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `@layer base, utilities;\n@layer base { .spinner { animation: spin 1s infinite; } }\n@layer utilities { @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } } }`,
      ),
      [],
    );
  });

  it('lets a transform set again undo a transform stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const lift = `.card { transition: transform 200ms; }\n.card:hover { transform: scale(1.1); }`;
    assert.deepEqual(
      motion(
        `${lift}\n@media (prefers-reduced-motion: reduce) { .card:hover { transform: none; } }`,
      ),
      [],
    );
    assert.deepEqual(
      motion(
        `${lift}\n@media (prefers-reduced-motion: reduce) { .card:hover { transform: none; } }\n.card:hover { transform: scale(1.2); }`,
      ),
      ['reduced-motion'],
    );
  });

  it('weighs a later important rule against an inline stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const spin = {
      'src/Spin.tsx': `export const Spin = () => <div style={{ animation: 'spin 1s infinite' }} />;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }\n* { animation: spin 1s !important; }`,
        spin,
      ),
      ['reduced-motion'],
    );
  });

  it('lets only a page-wide rule undo an inline stop (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const spin = {
      'src/Spin.tsx': `export const Spin = () => <div style={{ animation: 'spin 1s infinite' }} />;`,
    };
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { * { animation-play-state: paused !important; } }\n.other { animation-play-state: running !important; }`,
        spin,
      ),
      [],
    );
  });

  it('weighs a functional pseudo-class by its argument alone (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `@media (prefers-reduced-motion: reduce) { .card:is(.active) { animation: none; } }\n.card.active { animation: spin 1s infinite; }`,
      ),
      ['reduced-motion'],
    );
  });

  it('weighs what :where() holds as nothing (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.card.active { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .card:where(.active) { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
    assert.deepEqual(
      motion(
        `.card.active { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .card.active { animation: none; } }`,
      ),
      [],
    );
  });

  it('does not let a stop in one state cover an animation in all (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.card { animation: pulse 2s infinite; }\n@media (prefers-reduced-motion: reduce) { .card:hover { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
  });

  it('reads the important modifier on Tailwind motion (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string, files: Record<string, string> = {}) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}`, ...files })),
        'warnings',
      );
    const card = (names: string) =>
      motion('', {
        'src/Card.tsx': `export const Card = () => <div className="${names}" />;`,
      });
    assert.deepEqual(card('transition-transform! hover:scale-110'), [
      'reduced-motion',
    ]);
    assert.deepEqual(card('animate-spin! motion-reduce:animate-none'), [
      'reduced-motion',
    ]);
    assert.deepEqual(card('animate-spin! motion-reduce:animate-none!'), []);
  });

  it('does not read a negated state as the state (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.card:not(:hover) { animation: pulse 2s infinite; }\n@media (prefers-reduced-motion: reduce) { .card:hover { animation: none; } }`,
      ),
      ['reduced-motion'],
    );
  });

  it('weighs display and visibility hiding each on its own (#239 review)', () => {
    const base = project()[1]!.content;
    const motion = (css: string) =>
      checks(
        checkDesign(project({ 'src/styles.css': `${base}\n${css}` })),
        'warnings',
      );
    assert.deepEqual(
      motion(
        `.spinner { animation: spin 1s infinite; }\n@media (prefers-reduced-motion: reduce) { .spinner { display: none; visibility: visible !important; } }\n.spinner { display: block; }`,
      ),
      ['reduced-motion'],
    );
  });

  it('reads attribute-driven Tailwind states as transition triggers (#239 review)', () => {
    const base = project()[1]!.content;
    const card = (names: string) =>
      checks(
        checkDesign(
          project({
            'src/styles.css': base,
            'src/Card.tsx': `export const Card = () => <div className="${names}" />;`,
          }),
        ),
        'warnings',
      );
    assert.deepEqual(
      card('transition-transform data-[state=open]:translate-x-full'),
      ['reduced-motion'],
    );
    assert.deepEqual(card('transition-transform aria-expanded:rotate-180'), [
      'reduced-motion',
    ]);
    assert.deepEqual(card('transition-transform read-only:translate-x-full'), [
      'reduced-motion',
    ]);
  });

  it('refuses an em-dash anywhere in the copy, code or docs', () => {
    const report = checkDesign(
      project({
        'README.md': `Asme ${String.fromCodePoint(0x2014)} know it all.`,
      }),
    );
    assert.deepEqual(checks(report, 'errors'), ['em-dash']);
    // In content modules and drawings too, not only in code and docs.
    for (const [path, content] of [
      [
        'src/content.json',
        `{ "tagline": "Asme ${String.fromCodePoint(0x2014)} know it all." }`,
      ],
      [
        'public/badge.svg',
        `<svg><text>Asme ${String.fromCodePoint(0x2014)} know it all.</text></svg>`,
      ],
    ] as const) {
      assert.deepEqual(
        checks(checkDesign(project({ [path]: content })), 'errors'),
        ['em-dash'],
        path,
      );
    }
  });

  it("does not hold DESIGN.md, Vibld's own record, to the page's rule", () => {
    const report = checkDesign(
      project({
        'DESIGN.md': renderDesignMd({
          ...SPEC,
          intent: `Quiet ${String.fromCodePoint(0x2014)} then loud.`,
        }),
      }),
    );
    assert.deepEqual(report.errors, []);
  });

  it('warns about an input with no label', () => {
    const report = checkDesign(
      project({
        'src/App.tsx': `export function App() { return <main><h1>Know it all.</h1><input placeholder="Enter your email" /></main>; }`,
      }),
    );
    assert.ok(checks(report, 'warnings').includes('label'));
    // An image button needs alt text; with it, it is named.
    const button = (input: string) =>
      checks(
        checkDesign(
          project({
            'src/App.tsx': `export function App() { return <main><h1>Know it all.</h1>${input}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(button('<input type="image" src="/go.png" />').includes('label'));
    assert.ok(
      !button('<input type="image" src="/go.png" alt="Search" />').includes(
        'label',
      ),
    );
    // React drops a boolean alt, so it names nothing.
    assert.ok(
      button('<input type="image" src="/go.png" alt={true} />').includes(
        'label',
      ),
    );
  });

  it("does not take an <img> in a markup file's CSS string for an image", () => {
    const page = (content: string) =>
      checks(checkDesign(project({ 'src/Docs.html': content })), 'errors');
    assert.deepEqual(
      page('<style>.example::before { content: "<img>"; }</style><p>Hi</p>'),
      [],
    );
    assert.deepEqual(
      page('<style>p { color: red; }</style><img src="/a.jpg">'),
      ['alt'],
    );
  });

  it('asks each input for a label of its own', () => {
    const labels = (body: string) =>
      checks(
        checkDesign(
          project({
            'src/App.tsx': `export function App() { return <main><h1>Know it all.</h1>${body}</main>; }`,
          }),
        ),
        'warnings',
      ).filter((check) => check === 'label');
    // A name on another element does not name this input.
    assert.deepEqual(
      labels(`<button aria-label="Menu" /><input placeholder="Email" />`),
      ['label'],
    );
    assert.deepEqual(
      labels(`<label>Name</label><input placeholder="Email" />`),
      ['label'],
    );
    assert.deepEqual(labels(`<label>Email <input /></label>`), []);
    assert.deepEqual(
      labels(`<label htmlFor="e">Email</label><input id="e" />`),
      [],
    );
    assert.deepEqual(labels(`<input aria-label="Email" />`), []);
    // A name that names nothing is no name.
    assert.deepEqual(labels(`<input aria-label="" />`), ['label']);
    for (const empty of ['{undefined}', '{null}', "{''}"]) {
      assert.deepEqual(
        labels(`<input aria-labelledby=${empty} />`),
        ['label'],
        empty,
      );
    }
    assert.deepEqual(labels(`<input aria-labelledby={nameId} />`), []);
    for (const empty of ['{undefined}', '{null}', "{' '}"]) {
      assert.deepEqual(
        labels(`<input aria-label=${empty} />`),
        ['label'],
        empty,
      );
    }
    assert.deepEqual(labels(`<input aria-labelledby="missing" />`), ['label']);
    assert.deepEqual(
      labels(
        `<span id="email-name">Email</span><input aria-labelledby="email-name" />`,
      ),
      [],
    );
    assert.deepEqual(labels(`<input type="submit" />`), []);
  });

  it('lets a use clear a name the wrapper spreads over (#239 review)', () => {
    const labels = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/App.tsx': `function SearchField(props: object) { return <input aria-label="Search" {...props} />; }
export function App() { return <main><h1>Know it all.</h1>${use}</main>; }`,
          }),
        ),
        'warnings',
      ).filter((check) => check === 'label');
    assert.deepEqual(labels('<SearchField aria-label={undefined} />'), [
      'label',
    ]);
    assert.deepEqual(labels('<SearchField />'), []);
    assert.deepEqual(labels('<SearchField aria-label="Find" />'), []);
  });
});

/**
 * Generated projects on Tailwind v4, shadcn/ui and Motion (internal PR 74).
 *
 * Each of these was a false finding on a correct project before the
 * checker read the stack: a colour written as a utility with an opacity
 * modifier was an error (and an error buys a paid repair), Motion's
 * animation was invisible to the reduced-motion check, and shadcn's own
 * `<input {...props}>` was an unlabelled input on every project.
 */
describe('the Tailwind, shadcn/ui and Motion stack', () => {
  const TAILWIND_CSS = `@import 'tailwindcss';
:root { --navy: #071722; --deep: #020a12; --ink-soft: #c8d4db; }
@theme inline { --color-navy: var(--navy); --color-deep: var(--deep); --font-display: 'Playfair Display', Georgia, serif; }
h1 { font-family: 'Playfair Display', Georgia, serif; font-size: clamp(4.3rem, 8.8vw, 8.3rem); }
@media (max-width: 650px) { .signup { display: none; } }`;

  function withColors(
    colors: { name: string; value: string; use: string }[],
    app: string,
    css = TAILWIND_CSS,
  ) {
    return checkDesign(
      project({
        'src/styles.css': css,
        'src/App.tsx': app,
        'DESIGN.md': renderDesignMd({
          ...SPEC,
          tokens: { ...SPEC.tokens, colors },
        }),
      }),
    );
  }

  const APP = (classes: string) => `export function App() {
  return (
    <main className="${classes}">
      <h1>
        Know it{' '}
        <em>all.</em>
      </h1>
      <label htmlFor="email">Email address</label>
      <input id="email" placeholder="Enter your email" />
    </main>
  );
}`;

  it('reads a keyword with an opacity modifier as the colour it draws', () => {
    const scrim = [{ name: 'scrim', value: 'rgba(0,0,0,.6)', use: 'overlay' }];
    assert.deepEqual(
      checks(withColors(scrim, APP('bg-black/60')), 'errors'),
      [],
    );
    assert.deepEqual(checks(withColors(scrim, APP('bg-black/50')), 'errors'), [
      'color',
    ]);
  });

  it("reads the project's own token, through @theme, with its opacity", () => {
    // Nowhere is rgba(2,10,18,.57) written: `bg-deep/57` draws it, in a
    // cva() variant rather than a className, as shadcn/ui writes them.
    const report = withColors(
      SPEC.tokens.colors,
      `import { cva } from 'class-variance-authority';
const panel = cva('rounded-lg', { variants: { tone: { dim: 'bg-deep/57 text-white' } } });
${APP('bg-navy text-[#c8d4db]')}`,
    );
    assert.deepEqual(checks(report, 'errors'), []);
  });

  it('counts each theme a token is given, not only the last (#239 review)', () => {
    // shadcn/ui declares --primary in :root and again in .dark. The spec's
    // light value, written as hex while the CSS writes oklch(), is drawn
    // by bg-primary in the default theme.
    const css = `${TAILWIND_CSS}
:root { --primary: oklch(0.205 0 0); }
.dark { --primary: oklch(0.922 0 0); }
@theme inline { --color-primary: var(--primary); }`;
    for (const value of ['#171717', '#e5e5e5']) {
      assert.deepEqual(
        checks(
          withColors(
            [{ name: 'primary', value, use: 'buttons' }],
            APP('bg-primary'),
            css,
          ),
          'errors',
        ),
        [],
        value,
      );
    }
    assert.deepEqual(
      checks(
        withColors(
          [{ name: 'primary', value: '#3eb489', use: 'buttons' }],
          APP('bg-primary'),
          css,
        ),
        'errors',
      ),
      ['color'],
    );
  });

  it("reads v4's trailing important modifier (#239 review)", () => {
    const css = `${TAILWIND_CSS}
:root { --primary: oklch(0.205 0 0); }
@theme inline { --color-primary: var(--primary); }`;
    for (const utility of ['bg-primary!', 'bg-primary/100!', '!bg-primary']) {
      assert.deepEqual(
        checks(
          withColors(
            [{ name: 'primary', value: '#171717', use: 'buttons' }],
            APP(utility),
            css,
          ),
          'errors',
        ),
        [],
        utility,
      );
    }
  });

  it('reads a functional arbitrary colour as one utility (#239 review)', () => {
    const red = [{ name: 'alarm', value: '#ff0000', use: 'alerts' }];
    for (const utility of ['bg-[rgb(255,0,0)]', 'bg-[rgb(255_0_0)]']) {
      assert.deepEqual(
        checks(withColors(red, APP(utility)), 'errors'),
        [],
        utility,
      );
    }
  });

  it('reads a utility behind a selector or named-group variant (#239 review)', () => {
    const css = `${TAILWIND_CSS}
:root { --primary: oklch(0.205 0 0); }
@theme inline { --color-primary: var(--primary); }`;
    for (const utility of [
      '[&>a]:bg-primary',
      'group-hover/item:bg-primary',
      'data-[state=open]:bg-primary',
      'md:[&:hover]:bg-primary!',
    ]) {
      assert.deepEqual(
        checks(
          withColors(
            [{ name: 'primary', value: '#171717', use: 'buttons' }],
            APP(utility),
            css,
          ),
          'errors',
        ),
        [],
        utility,
      );
    }
    const red = [{ name: 'alarm', value: '#ff0000', use: 'alerts' }];
    assert.deepEqual(
      checks(withColors(red, APP('[&>a]:bg-[#ff0000]')), 'errors'),
      [],
    );
  });

  it('lets a later declaration in the same block win (#239 review)', () => {
    const css = `${TAILWIND_CSS}
:root { --primary: oklch(0.205 0 0); }
:root { --primary: #3eb489; }
@theme inline { --color-primary: var(--primary); }`;
    // #171717 was overridden in the same scope, so bg-primary draws mint.
    assert.deepEqual(
      checks(
        withColors(
          [{ name: 'primary', value: '#171717', use: 'buttons' }],
          APP('bg-primary'),
          css,
        ),
        'errors',
      ),
      ['color'],
    );
    assert.deepEqual(
      checks(
        withColors(
          [{ name: 'primary', value: '#3eb489', use: 'buttons' }],
          APP('bg-primary'),
          css,
        ),
        'errors',
      ),
      [],
    );
  });

  it('compares an oklch() spec colour by what it draws', () => {
    const scrim = [
      { name: 'scrim', value: 'oklch(0 0 0 / 0.6)', use: 'overlay' },
    ];
    assert.deepEqual(
      checks(withColors(scrim, APP('bg-black/60')), 'errors'),
      [],
    );
  });

  it('warns rather than errs when the colour may be a palette utility', () => {
    const ink = [
      { name: 'ink', value: 'oklch(20.8% 0.042 265.755)', use: 'footer' },
    ];
    const withPalette = withColors(ink, APP('bg-slate-900 text-white'));
    assert.deepEqual(checks(withPalette, 'errors'), []);
    assert.ok(checks(withPalette, 'warnings').includes('color'));
    // With no palette utility on the page, nothing could explain it.
    assert.deepEqual(
      checks(withColors(ink, APP('bg-navy text-white')), 'errors'),
      ['color'],
    );
  });

  it('errs when there are more missing colours than palette utilities (#239 review)', () => {
    const two = [
      { name: 'ink', value: '#101820', use: 'footer' },
      { name: 'mint', value: '#3eb489', use: 'accent' },
    ];
    // One palette utility can be at most one of the two.
    assert.deepEqual(
      checks(withColors(two, APP('bg-slate-900 text-white')), 'errors'),
      ['color', 'color'],
    );
    // Two can be both, so neither is certain.
    assert.deepEqual(
      checks(withColors(two, APP('bg-slate-900 text-emerald-500')), 'errors'),
      [],
    );
  });

  it('counts each opacity of a palette colour as its own (#239 review)', () => {
    const two = [
      { name: 'tint', value: 'rgba(1,2,3,.2)', use: 'wash' },
      { name: 'veil', value: 'rgba(4,5,6,.6)', use: 'overlay' },
    ];
    assert.deepEqual(
      checks(withColors(two, APP('bg-red-500/20 text-red-500/60')), 'errors'),
      [],
    );
  });

  it("counts only palette utilities of a colour's own opacity (#239 review)", () => {
    const opaque = [{ name: 'brand', value: '#123456', use: 'buttons' }];
    assert.deepEqual(
      checks(withColors(opaque, APP('bg-red-500/20')), 'errors'),
      ['color'],
    );
    assert.deepEqual(
      checks(withColors(opaque, APP('bg-red-500')), 'errors'),
      [],
    );
  });

  it('counts a palette colour once however its opacity is spelled (#239 review)', () => {
    const two = [
      { name: 'ink', value: '#101820', use: 'footer' },
      { name: 'mint', value: '#3eb489', use: 'accent' },
    ];
    for (const classes of [
      'bg-red-500 text-red-500/100',
      'bg-red-500/20 text-red-500/[20%]',
    ]) {
      assert.deepEqual(
        checks(withColors(two, APP(classes)), 'errors'),
        ['color', 'color'],
        classes,
      );
    }
  });

  it('resolves bg-[var(--token)] like its shorthand (#239 review)', () => {
    const css = `${TAILWIND_CSS}
:root { --accent: oklch(0.205 0 0); }`;
    assert.deepEqual(
      checks(
        withColors(
          [{ name: 'accent', value: '#171717', use: 'links' }],
          APP('bg-[var(--accent)]'),
          css,
        ),
        'errors',
      ),
      [],
    );
  });

  it("reads v4's custom-property shorthand (#239 review)", () => {
    const css = `${TAILWIND_CSS}
:root { --accent: oklch(0.205 0 0); }`;
    for (const utility of ['bg-(--accent)', 'text-(--accent)/100']) {
      assert.deepEqual(
        checks(
          withColors(
            [{ name: 'accent', value: '#171717', use: 'links' }],
            APP(utility),
            css,
          ),
          'errors',
        ),
        [],
        utility,
      );
    }
  });

  it('tells a Tailwind project to map the colour in @theme', () => {
    const report = withColors(
      [{ name: 'mint', value: '#3eb489', use: 'accent' }],
      APP('bg-navy'),
    );
    assert.match(report.errors[0]!.detail, /@theme as --color-mint/);
  });

  const MOTION_APP = (
    body: string,
  ) => `import { motion, MotionConfig, useReducedMotion, useScroll, useTransform } from 'motion/react';
export function App() {
${body}
}`;
  const reducedMotion = (report: ReturnType<typeof checkDesign>) =>
    report.warnings
      .filter((finding) => finding.check === 'reduced-motion')
      .map((finding) => finding.detail);

  it('sees Motion animation that ignores the preference', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': MOTION_APP(
          `  return <motion.h2 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h2>;`,
        ),
      }),
    );
    assert.equal(reducedMotion(report).length, 1);
    assert.match(
      reducedMotion(report)[0]!,
      /MotionConfig reducedMotion="user"/,
    );
  });

  it('accepts MotionConfig for declarative animation', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': MOTION_APP(
          `  return <MotionConfig reducedMotion="user"><motion.h2 whileInView={{ opacity: 1, y: 0 }}>Hi</motion.h2></MotionConfig>;`,
        ),
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('holds scroll-linked values to a read of the preference', () => {
    const linked = (gate: string) =>
      checkDesign(
        project({
          'src/Hero.tsx': MOTION_APP(`  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -120]);
${gate}
  return <MotionConfig reducedMotion="user"><motion.div style={{ y: still ? 0 : y }} /></MotionConfig>;`),
        }),
      );
    // MotionConfig alone does not stop a value driven by scroll.
    assert.match(
      reducedMotion(linked('  const still = false;'))[0] ?? '',
      /useReducedMotion/,
    );
    assert.deepEqual(
      reducedMotion(linked('  const still = useReducedMotion();')),
      [],
    );
  });

  it('asks for both fixes when both kinds of Motion ignore the preference (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': MOTION_APP(`  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -120]);
  return <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} style={{ y }} />;`),
      }),
    );
    const details = reducedMotion(report);
    assert.equal(details.length, 2);
    assert.ok(
      details.some((detail) => /MotionConfig reducedMotion/.test(detail)),
    );
    assert.ok(
      details.some((detail) => /Read useReducedMotion\(\)/.test(detail)),
    );
  });

  it('counts MotionConfig only where it covers the animation (#239 review)', () => {
    const animated = `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} />; }`;
    const wrapped = (children: string) =>
      `import { MotionConfig } from 'motion/react';
export function Hero() { return <MotionConfig reducedMotion="user">${children}</MotionConfig>; }`;
    // A provider around one subtree does not govern a sibling component.
    assert.equal(
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': wrapped('<h1>Hi</h1>'),
            'src/Card.tsx': animated,
          }),
        ),
      ).length,
      1,
    );
    // At the app's root it covers everything the app renders.
    assert.deepEqual(
      reducedMotion(
        checkDesign(
          project({
            'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);`,
            'src/Card.tsx': animated,
          }),
        ),
      ),
      [],
    );
  });

  it('holds animate() and useAnimate() to a read of the preference (#239 review)', () => {
    const imperative = (gate: string) =>
      checkDesign(
        project({
          'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);`,
          'src/Hero.tsx': `import { useAnimate, useReducedMotion } from 'motion/react';
export function Hero() {
  const [scope, animate] = useAnimate();
${gate}
  useEffect(() => { if (!still) animate(scope.current, { x: 100 }); }, []);
  return <div ref={scope} />;
}`,
        }),
      );
    // MotionConfig at the root does not reach a call made from script.
    assert.match(
      reducedMotion(imperative('  const still = false;'))[0] ?? '',
      /animation started from script/,
    );
    assert.deepEqual(
      reducedMotion(imperative('  const still = useReducedMotion();')),
      [],
    );
  });

  it('holds a read of the preference to the file it is in (#239 review)', () => {
    const gatedHero = `import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const still = useReducedMotion();
  return <motion.h1 animate={still ? {} : { y: 0 }} />;
}`;
    const ungated = checkDesign(
      project({
        'src/Hero.tsx': gatedHero,
        'src/Card.tsx': `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`,
      }),
    );
    assert.equal(reducedMotion(ungated).length, 1);
    // The same, for a value linked to scroll in another file.
    const linked = checkDesign(
      project({
        'src/Hero.tsx': gatedHero,
        'src/Parallax.tsx': `import { motion, useScroll } from 'motion/react';
export function Parallax() { const { scrollY } = useScroll(); return <motion.div style={{ y: scrollY }} />; }`,
      }),
    );
    assert.match(reducedMotion(linked).join(' '), /linked to scroll/);
    assert.deepEqual(
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': gatedHero }))),
      [],
    );
  });

  it('counts only a literal reducedMotion on MotionConfig (#239 review)', () => {
    const card = `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`;
    for (const value of ['{userSetting}', '{alwaysOn}', '"never"']) {
      const report = checkDesign(
        project({
          'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(<MotionConfig reducedMotion=${value}><App /></MotionConfig>);`,
          'src/Card.tsx': card,
        }),
      );
      assert.equal(reducedMotion(report).length, 1, value);
    }
  });

  it('counts reducedMotion only on MotionConfig (#239 review)', () => {
    const card = `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`;
    const root = (element: string) =>
      checkDesign(
        project({
          'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(${element});`,
          'src/Card.tsx': card,
        }),
      );
    assert.equal(
      reducedMotion(root('<Settings reducedMotion="user"><App /></Settings>'))
        .length,
      1,
    );
    assert.deepEqual(
      reducedMotion(
        root('<MotionConfig reducedMotion="user"><App /></MotionConfig>'),
      ),
      [],
    );
  });

  it('counts MotionConfig under an alias or a namespace (#239 review)', () => {
    const card = `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`;
    for (const main of [
      `import { MotionConfig as Config } from 'motion/react';
createRoot(root).render(<Config reducedMotion="user"><App /></Config>);`,
      `import * as Motion from 'motion/react';
createRoot(root).render(<Motion.MotionConfig reducedMotion="user"><App /></Motion.MotionConfig>);`,
    ]) {
      const report = checkDesign(
        project({ 'src/main.tsx': main, 'src/Card.tsx': card }),
      );
      assert.deepEqual(reducedMotion(report), [], main);
    }
  });

  it('counts an app-root MotionConfig only when it wraps what renders (#239 review)', () => {
    const app = (body: string) =>
      checkDesign(
        project({
          'src/App.tsx': `import { MotionConfig, motion } from 'motion/react';
import { Hero } from './Hero';
export function App() {
  return (
    ${body}
  );
}`,
          'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
          'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);`,
        }),
      );
    const sibling = app(
      '<main><MotionConfig reducedMotion="user"><Hero /></MotionConfig><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} /></main>',
    );
    assert.match(
      reducedMotion(sibling).join(' '),
      /MotionConfig reducedMotion/,
    );
    const wrapping = app(
      '<MotionConfig reducedMotion="user"><main><Hero /><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} /></main></MotionConfig>',
    );
    assert.deepEqual(reducedMotion(wrapping), []);
  });

  it("counts only React's render calls as roots (#239 review)", () => {
    const report = checkDesign(
      project({
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
const renderer = new WebGLRenderer();
function loop() { renderer.render(scene, camera); requestAnimationFrame(loop); }`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('counts hydrateRoot only as react-dom exports it (#239 review)', () => {
    const entry = (main: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/main.tsx': main,
            'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
          }),
        ),
      );
    // A helper of the file's own by that name is not a root.
    assert.deepEqual(
      entry(`import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
function hydrateRoot(target: Element, markup: string) { target.innerHTML = markup; }
hydrateRoot(document.body, '<p>Loading</p>');
createRoot(document.getElementById('root')!).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);`),
      [],
    );
    // react-dom's, imported among other names, is.
    assert.deepEqual(
      entry(`import { createRoot, hydrateRoot, version } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
hydrateRoot(document.getElementById('root')!, <MotionConfig reducedMotion="user"><App /></MotionConfig>);`),
      [],
    );
  });

  it('follows a component the entry declares itself (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { Hero } from './Hero';
function Root() {
  return (
    <MotionConfig reducedMotion="user"><Hero /></MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<Root />);`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('counts a root provider only when it wraps what the root renders (#239 review)', () => {
    const root = (render: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';
createRoot(document.getElementById('root')!).render(${render});`,
            'src/Providers.tsx': `import { MotionConfig } from 'motion/react';
export function Providers({ children }: { children?: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  );
}`,
            'src/App.tsx': `import { motion } from 'motion/react';
export function App() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
          }),
        ),
      );
    assert.match(
      root('<><Providers /><App /></>').join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(root('<Providers><App /></Providers>'), []);
    assert.deepEqual(
      root('<StrictMode><Providers><App /></Providers></StrictMode>'),
      [],
    );
  });

  it('follows the same wrapper from more than one return (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/App.tsx': `import { Providers } from './Providers';
import { Hero } from './Hero';
export function App({ ready }: { ready: boolean }) {
  if (!ready) return <Providers><p>Loading</p></Providers>;
  return <Providers><Hero /></Providers>;
}`,
        'src/Providers.tsx': `import { MotionConfig } from 'motion/react';
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">{children}</MotionConfig>
  );
}`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App ready />);`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('follows the root provider through wrapper components (#239 review)', () => {
    const app = (providers: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/App.tsx': `import { Providers } from './Providers';
import { Hero } from './Hero';
export function App() {
  return (
    <Providers><Hero /></Providers>
  );
}`,
            'src/Providers.tsx': `import { MotionConfig } from 'motion/react';
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    ${providers}
  );
}`,
            'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
            'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { App } from './App';
createRoot(document.getElementById('root')!).render(<App />);`,
          }),
        ),
      );
    assert.deepEqual(
      app('<MotionConfig reducedMotion="user">{children}</MotionConfig>'),
      [],
    );
    assert.match(
      app('<div>{children}</div>').join(' '),
      /MotionConfig reducedMotion/,
    );
  });

  it('follows a provider only through what the root render is handed (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Preview } from './Preview';
const preview = <Preview />;
createRoot(document.getElementById('root')!).render(<App />);`,
        'src/Preview.tsx': `import { MotionConfig } from 'motion/react';
export function Preview() {
  return (
    <MotionConfig reducedMotion="user"><div /></MotionConfig>
  );
}`,
        'src/App.tsx': `import { motion } from 'motion/react';
export function App() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('holds every animation in a file to the preference, not the first (#239 review)', () => {
    const hero = (second: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  return (
    <main>
      <motion.div animate={reduce ? {} : { x: 1 }} />
      ${second}
    </main>
  );
}`,
          }),
        ),
      );
    assert.match(
      hero('<motion.div animate={{ x: 1 }} />').join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(
      hero('{!reduce && <motion.div animate={{ x: 1 }} />}'),
      [],
    );
  });

  it('counts a linked value only when it reaches rendered motion (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { useScroll } from 'motion/react';
export function Hero() { const { scrollY } = useScroll(); return <div />; }`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('follows a component created with Motion into the module that animates it (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/components/motion-card.tsx': `import { motion } from 'motion/react';
export const MotionCard = motion.div;`,
        'src/App.tsx': `import { MotionCard as Card } from './components/motion-card';
export function App() { return <Card animate={{ x: 100 }} />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('follows a default-exported Motion component too (#239 review)', () => {
    for (const card of [
      `import { motion } from 'motion/react';
const MotionCard = motion.div;
export default MotionCard;`,
      `import { motion } from 'motion/react';
export default motion.div;`,
    ]) {
      const report = checkDesign(
        project({
          'src/components/card.tsx': card,
          'src/App.tsx': `import Card from './components/card';
export function App() { return <Card animate={{ x: 100 }} />; }`,
        }),
      );
      assert.match(
        reducedMotion(report).join(' '),
        /MotionConfig reducedMotion/,
        card,
      );
    }
  });

  it('follows a Motion component through a barrel (#239 review)', () => {
    for (const barrel of [
      `export { MotionCard } from './motion-card';`,
      `export * from './motion-card';`,
    ]) {
      const report = checkDesign(
        project({
          'src/components/motion-card.tsx': `import { motion } from 'motion/react';
export const MotionCard = motion.div;`,
          'src/components/index.ts': barrel,
          'src/App.tsx': `import { MotionCard } from './components';
export function App() { return <MotionCard animate={{ x: 100 }} />; }`,
        }),
      );
      assert.match(
        reducedMotion(report).join(' '),
        /MotionConfig reducedMotion/,
        barrel,
      );
    }
  });

  it('reads transform as movement, and an animate() that only fades as none (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file })));
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() { return <motion.div animate={{ transform: 'translateX(100px)' }} />; }`).join(
        ' ',
      ),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(
      one(`import { useAnimate } from 'motion/react';
export function Hero() {
  const [scope, animate] = useAnimate();
  useEffect(() => { animate(scope.current, { opacity: 1 }); }, []);
  return <div ref={scope} />;
}`),
      [],
    );
  });

  it('ties a name to the preference only where that binding is in scope (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { motion, useReducedMotion } from 'motion/react';
const reduce = useReducedMotion();
function Card({ reduce = false }: { reduce?: boolean }) {
  return <motion.div animate={reduce ? {} : { x: 100 }} />;
}
export function Hero() { return <Card />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('resolves the preference hook itself in scope (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { motion, useReducedMotion } from 'motion/react';
export function Card(useReducedMotion = () => false) {
  const reduce = useReducedMotion();
  return <motion.div animate={reduce ? {} : { x: 100 }} />;
}`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('follows a Motion component through a namespace import (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/components/motion-card.tsx': `import { motion } from 'motion/react';
export const MotionCard = motion.div;`,
        'src/App.tsx': `import * as Cards from './components/motion-card';
export function App() { return <Cards.MotionCard animate={{ x: 100 }} />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('holds every React root to a provider of its own (#239 review)', () => {
    const files = (main: string) => ({
      'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import { Widget } from './Widget';
${main}`,
      'src/App.tsx': `export function App() { return <main />; }`,
      'src/Widget.tsx': `import { motion } from 'motion/react';
export function Widget() { return <motion.div initial={{ y: 24 }} animate={{ y: 0 }} />; }`,
    });
    assert.match(
      reducedMotion(
        checkDesign(
          project(
            files(`createRoot(a).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
createRoot(b).render(<Widget />);`),
          ),
        ),
      ).join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(
      reducedMotion(
        checkDesign(
          project(
            files(`createRoot(a).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
createRoot(b).render(<MotionConfig reducedMotion="user"><Widget /></MotionConfig>);`),
          ),
        ),
      ),
      [],
    );
  });

  it('resolves MotionConfig and a namespace animate() in scope (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file })));
    assert.match(
      one(`import { motion, MotionConfig } from 'motion/react';
export function App({ MotionConfig }: { MotionConfig: any }) {
  return <MotionConfig reducedMotion="user"><motion.div animate={{ x: 100 }} /></MotionConfig>;
}`).join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(
      one(`import * as Motion from 'motion/react';
export function run(Motion: any, el: Element) { Motion.animate(el, { x: 100 }); }`),
      [],
    );
    assert.match(
      one(`import * as Motion from 'motion/react';
export function run(el: Element) { Motion.animate(el, { x: 100 }); }`).join(
        ' ',
      ),
      /started from script/,
    );
  });

  it('resolves a root MotionConfig in scope, and covers only what it stops (#239 review)', () => {
    const app = `import { motion } from 'motion/react';
export function App() { return <motion.div initial={{ y: 24 }} animate={{ y: 0 }} />; }`;
    assert.match(
      reducedMotion(
        checkDesign(
          project({
            'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
function mount(MotionConfig: any) {
  createRoot(root).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
}`,
            'src/App.tsx': app,
          }),
        ),
      ).join(' '),
      /MotionConfig reducedMotion/,
    );
    const provided = (animate: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, MotionConfig } from 'motion/react';
export function Hero() {
  return <MotionConfig reducedMotion="user"><motion.path animate={${animate}} /></MotionConfig>;
}`,
          }),
        ),
      );
    assert.match(provided('{ pathLength: 1 }').join(' '), /MotionConfig/);
    assert.deepEqual(provided('{ x: 100 }'), []);
  });

  it('covers variants under a provider only when they are transforms (#239 review)', () => {
    const hero = (element: string, head = '') =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, MotionConfig } from 'motion/react';
${head}
export function Hero() {
  return <MotionConfig reducedMotion="user">${element}</MotionConfig>;
}`,
          }),
        ),
      );
    assert.match(
      hero(
        '<motion.div variants={{ open: { width: 200 } }} animate="open" />',
      ).join(' '),
      /MotionConfig/,
    );
    assert.deepEqual(
      hero('<motion.div variants={{ open: { x: 100 } }} animate="open" />'),
      [],
    );
    assert.deepEqual(
      hero(
        '<motion.div variants={fade} initial="hidden" animate="show" />',
        'const fade = { hidden: { y: 24, opacity: 0 }, show: { y: 0, opacity: 1 } };',
      ),
      [],
    );
    assert.match(
      hero('<motion.div variants={outside} animate="show" />').join(' '),
      /MotionConfig/,
    );
  });

  it('reads the keyframes of animate(), not its options (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { useAnimate, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate();
  useEffect(() => { animate(scope.current, { x: 100 }, reduce ? {} : { repeat: Infinity }); }, []);
  return <div ref={scope} />;
}`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /started from script/);
  });

  it('follows aliases, sequences, frame-guard order and margins (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    // A linked value under a local alias still drives movement.
    assert.match(
      one(`import { motion, useScroll } from 'motion/react';
export function Hero() {
  const { scrollYProgress } = useScroll();
  const progress = scrollYProgress;
  return <motion.div style={{ x: progress }} />;
}`),
      /linked to scroll/,
    );
    // A sequence carries its keyframes in the first argument.
    assert.match(
      one(`import { useAnimate } from 'motion/react';
export function Hero() {
  const [scope, animate] = useAnimate();
  useEffect(() => { animate([[scope.current, { x: 100 }]], { duration: 1 }); }, []);
  return <div ref={scope} />;
}`),
      /started from script/,
    );
    // A guard after the frame has moved stops nothing.
    assert.match(
      one(`import { useAnimationFrame, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useAnimationFrame(() => { ref.current!.style.transform = 'rotate(1deg)'; if (reduce) return; });
  return <div ref={ref} />;
}`),
      /linked to scroll/,
    );
    // A margin moves the element.
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() { return <motion.div animate={{ marginLeft: 200 }} />; }`),
      /MotionConfig reducedMotion/,
    );
  });

  it('traces Motion components through project import aliases (#239 review)', () => {
    const card = `import { motion } from 'motion/react';
export const MotionCard = motion.div;`;
    const hero = (from: string) => `import { ${'MotionCard'} } from '${from}';
export function Hero() { return <MotionCard animate={{ x: 100 }} />; }`;
    // The generated stack's @/ with no config, and one tsconfig declares.
    const conventional = checkDesign(
      project({
        'src/components/motion-card.tsx': card,
        'src/Hero.tsx': hero('@/components/motion-card'),
      }),
    );
    assert.match(
      reducedMotion(conventional).join(' '),
      /MotionConfig reducedMotion/,
    );
    const configured = checkDesign(
      project({
        'tsconfig.json': `{
  // Paths for the app.
  "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["./app/*"], } },
}`,
        'app/ui/motion-card.tsx': card,
        'src/Hero.tsx': hero('~/ui/motion-card'),
      }),
    );
    assert.match(
      reducedMotion(configured).join(' '),
      /MotionConfig reducedMotion/,
    );
  });

  it('treats a component that forwards props to Motion as Motion (#239 review)', () => {
    const box = `import { motion } from 'motion/react';
export function MotionBox(props: object) { return <motion.div {...props} />; }`;
    const across = (use: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/components/MotionBox.tsx': box,
            'src/Hero.tsx': `import { MotionBox } from './components/MotionBox';
export function Hero() { return ${use}; }`,
          }),
        ),
      ).join(' ');
    assert.match(
      across('<MotionBox animate={{ x: 100 }} />'),
      /MotionConfig reducedMotion/,
    );
    assert.equal(across('<MotionBox className="card" />'), '');
    assert.equal(across('<MotionBox animate={{ opacity: 1 }} />'), '');
  });

  it('treats a forwarding component declared in the same file as Motion (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion } from 'motion/react';
const MotionBox = (props: object) => <motion.div {...props} />;
export function Hero() { return <MotionBox animate={{ x: 100 }} />; }`),
      /MotionConfig reducedMotion/,
    );
  });

  it('follows a local name given to animate through a namespace (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import * as Motion from 'motion/react';
export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const run = Motion.animate;
  useEffect(() => { run(ref.current!, { x: 100 }); }, []);
  return <div ref={ref} />;
}`),
      /started from script/,
    );
  });

  it('follows a local name given to animate (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { animate } from 'motion/react';
export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const run = animate;
  useEffect(() => { run(ref.current!, { x: 100 }); }, []);
  return <div ref={ref} />;
}`),
      /started from script/,
    );
  });

  it('does not count a linked value that only fades (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion, useScroll, useTransform } from 'motion/react';
export function Hero() {
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  return <motion.div style={{ opacity }} />;
}`),
      '',
    );
  });

  it('lets a provider cover a transform target declared first (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { MotionConfig, motion } from 'motion/react';
export function Hero() {
  const slide = { x: 100 };
  return (
    <MotionConfig reducedMotion="user"><motion.div animate={slide} /></MotionConfig>
  );
}`),
      '',
    );
  });

  it('follows a style object through an alias (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion, useScroll } from 'motion/react';
export function Hero() {
  const { scrollY } = useScroll();
  const base = { y: scrollY };
  const style = base;
  return <motion.div style={style} />;
}`),
      /linked to scroll/,
    );
  });

  it('follows the preference through an alias (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const calm = reduce;
  return <motion.div animate={calm ? {} : { x: 100 }} />;
}`),
      '',
    );
  });

  it('reads a fade declared first for a script animation (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { animate } from 'motion/react';
export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const fade = { opacity: 1 };
  useEffect(() => { animate(ref.current!, fade); }, []);
  return <div ref={ref} />;
}`),
      '',
    );
  });

  it('does not read a reassignable target where it is declared (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() {
  let target = { opacity: 1 };
  target = { x: 100 };
  return <motion.div animate={target} />;
}`),
      /MotionConfig reducedMotion/,
    );
  });

  it('reads a preference gate in a target declared first (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const target = { x: reduce ? 0 : 100 };
  return <motion.div animate={target} />;
}`),
      '',
    );
  });

  it('reads a still branch declared first (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const calm = { x: 0 };
  return <motion.div animate={reduce ? calm : { x: 100 }} />;
}`),
      '',
    );
  });

  it('does not read a const object as declared once it is written (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion, useScroll } from 'motion/react';
export function Hero() {
  const { scrollY } = useScroll();
  const style = {};
  style.y = scrollY;
  return <motion.div style={style} />;
}`),
      /linked to scroll/,
    );
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() {
  const target = { opacity: 1 };
  Object.assign(target, { x: 100 });
  return <motion.div animate={target} />;
}`),
      /MotionConfig reducedMotion/,
    );
  });

  it('reads an object written through Reflect as written (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() {
  const target = { opacity: 1 };
  Reflect.set(target, 'x', 100);
  return <motion.div animate={target} />;
}`),
      /MotionConfig reducedMotion/,
    );
  });

  it('does not read a const list as declared once it is written (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { animate } from 'motion/react';
export function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sequence = [[ref.current!, { opacity: 1 }]];
    sequence.push([ref.current!, { x: 100 }]);
    animate(sequence);
  }, []);
  return <div ref={ref} />;
}`),
      /started from script/,
    );
  });

  it('counts an initial key only where a target animates it (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion } from 'motion/react';
export function Hero() { return <motion.div initial={{ x: 100, opacity: 0 }} animate={{ opacity: 1 }} />; }`),
      '',
    );
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero() { return <motion.div initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} />; }`),
      /MotionConfig reducedMotion/,
    );
  });

  it('reads a target declared first (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion } from 'motion/react';
export function Hero() {
  const fade = { opacity: 1 };
  return <motion.div animate={fade} />;
}`),
      '',
    );
  });

  it('follows a linked value through a style declared first (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion, useScroll } from 'motion/react';
export function Hero() {
  const { scrollY } = useScroll();
  const style = { y: scrollY };
  return <motion.div style={style} />;
}`),
      /linked to scroll/,
    );
  });

  it('does not count initial alone as animation (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.equal(
      one(`import { motion } from 'motion/react';
export function Hero() { return <motion.div initial={{ x: 100 }} />; }`),
      '',
    );
    // A spread may carry the target.
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero(props: object) { return <motion.div initial={{ x: 100 }} {...props} />; }`),
      /MotionConfig reducedMotion/,
    );
  });

  it('counts an SVG shape morph as movement (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    assert.match(
      one(`import { motion } from 'motion/react';
export function Hero({ next }: { next: string }) { return <svg><motion.path animate={{ d: next }} /></svg>; }`),
      /MotionConfig reducedMotion/,
    );
  });

  it('does not count fade-only keyframe lists or sequences (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    const script = (call: string) =>
      one(`import { useAnimate } from 'motion/react';
export function Hero() {
  const [scope, animate] = useAnimate();
  useEffect(() => { ${call} }, []);
  return <div ref={scope} />;
}`);
    for (const still of [
      'animate(scope.current, [{ opacity: 0 }, { opacity: 1 }]);',
      'animate([[scope.current, { opacity: 1 }], "end", [scope.current, { color: "#fff" }]]);',
      'const seq = [[scope.current, { opacity: 1 }]]; animate(seq, { duration: 1 });',
    ]) {
      assert.equal(script(still), '', still);
    }
    for (const moving of [
      'animate(scope.current, [{ x: 0 }, { x: 100 }]);',
      'animate([[scope.current, { opacity: 1 }], [scope.current, { y: 40 }]]);',
    ]) {
      assert.match(script(moving), /started from script/, moving);
    }
  });

  it('reads a sequence held in a variable from the first argument (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    for (const call of [
      'const seq = [[scope.current, { x: 100 }]]; animate(seq, { duration: 1 });',
      'animate(steps, { duration: 1 });',
    ]) {
      assert.match(
        one(`import { useAnimate } from 'motion/react';
export function Hero({ steps }: { steps: never[] }) {
  const [scope, animate] = useAnimate();
  useEffect(() => { ${call} }, []);
  return <div ref={scope} />;
}`),
        /started from script/,
        call,
      );
    }
  });

  it("does not take a hook's options for its value (#239 review)", () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    // Options chosen on the preference leave the spring following scroll.
    assert.match(
      one(`import { motion, useScroll, useSpring, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useSpring(scrollY, reduce ? {} : { stiffness: 100 });
  return <motion.div style={{ y }} />;
}`),
      /linked to scroll/,
    );
    // An output range chosen on it still settles the value.
    assert.equal(
      one(`import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, 200]);
  return <motion.div style={{ y }} />;
}`),
      '',
    );
  });

  it('lets the nearest MotionConfig decide (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    // A nearer MotionConfig that turns reduced motion off wins.
    assert.match(
      one(`import { MotionConfig, motion } from 'motion/react';
export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <MotionConfig reducedMotion="never"><motion.div animate={{ x: 100 }} /></MotionConfig>
    </MotionConfig>
  );
}`),
      /MotionConfig reducedMotion/,
    );
    // One that sets nothing about it inherits the configured provider.
    assert.equal(
      one(`import { MotionConfig, motion } from 'motion/react';
export function Hero() {
  return (
    <MotionConfig reducedMotion="user">
      <MotionConfig transition={{ duration: 0.3 }}><motion.div animate={{ x: 100 }} /></MotionConfig>
    </MotionConfig>
  );
}`),
      '',
    );
  });

  it('does not count a frame guard after a declaration that moves (#239 review)', () => {
    const one = (file: string) =>
      reducedMotion(checkDesign(project({ 'src/Hero.tsx': file }))).join(' ');
    // A declaration before the guard that moves the element.
    const frame = (declaration: string) =>
      one(`import { useAnimationFrame, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useAnimationFrame((t) => { ${declaration} if (reduce) return; ref.current!.style.transform = \`rotate(\${t}deg)\`; });
  return <div ref={ref} />;
}`);
    assert.match(
      frame("const next = (ref.current!.style.transform = 'rotate(1deg)');"),
      /linked to scroll|started from script/,
    );
    assert.equal(frame('const turn = Math.sin(t / 1000);'), '');
  });

  it('counts a useAnimationFrame callback as motion (#239 review)', () => {
    const spin = (head: string, body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Spin.tsx': `${head}
export function Spin() {
  const ref = useRef<HTMLDivElement>(null);
  ${body}
  return <div ref={ref} />;
}`,
          }),
        ),
      );
    assert.match(
      spin(
        `import { useAnimationFrame } from 'motion/react';`,
        'useAnimationFrame((t) => { ref.current!.style.transform = `rotate(${t}deg)`; });',
      ).join(' '),
      /linked to scroll/,
    );
    assert.deepEqual(
      spin(
        `import { useAnimationFrame, useReducedMotion } from 'motion/react';`,
        `const reduce = useReducedMotion();
  useAnimationFrame((t) => { if (reduce) return; ref.current!.style.transform = \`rotate(\${t}deg)\`; });`,
      ),
      [],
    );
  });

  it('follows a Motion component exported under an alias (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/components/card.tsx': `import { motion } from 'motion/react';
const Card = motion.div;
export { Card as MotionCard };`,
        'src/App.tsx': `import { MotionCard } from './components/card';
export function App() { return <MotionCard animate={{ x: 100 }} />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('holds each moving property to the preference, not the prop (#239 review)', () => {
    const hero = (animate: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, useReducedMotion } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  return <motion.div animate={${animate}} />;
}`,
          }),
        ),
      );
    assert.match(
      hero('{ x: 200, opacity: reduce ? 0 : 1 }').join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(hero('{ x: reduce ? 0 : 200, opacity: 1 }'), []);
    assert.deepEqual(hero('reduce ? { opacity: 1 } : { x: 200 }'), []);
  });

  it('leaves an element that only fades to MotionConfig, which keeps fades (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Card.tsx': `import { motion } from 'motion/react';
export function Card() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} />; }`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('checks which branch the preference takes, in props, styles and calls (#239 review)', () => {
    const hero = (body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, useReducedMotion, useScroll, useTransform, useAnimate } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const [scope, animate] = useAnimate();
  ${body}
}`,
          }),
        ),
      );
    // The branch a visitor who asked is given has to be the still one.
    for (const wrong of [
      'return <motion.div animate={reduce ? { x: 100 } : {}} />;',
      'return <motion.div animate={reduce && { x: 100 }} />;',
    ]) {
      assert.match(hero(wrong).join(' '), /MotionConfig reducedMotion/, wrong);
    }
    for (const right of [
      'return <motion.div animate={reduce ? {} : { x: 100 }} />;',
      'return <motion.div animate={!reduce && { x: 100 }} />;',
      'return <motion.div animate={{ x: reduce ? 0 : 100 }} />;',
    ]) {
      assert.deepEqual(hero(right), [], right);
    }
    // A linked style: each linked value, not any read in the style.
    assert.match(
      hero(
        'return <motion.div style={{ y, opacity: reduce ? 0 : 1 }} />;',
      ).join(' '),
      /linked to scroll/,
    );
    assert.deepEqual(
      hero('return <motion.div style={{ y: reduce ? 0 : y }} />;'),
      [],
    );
    // A call: the keyframes, not any argument that mentions the preference.
    assert.match(
      hero(`useEffect(() => { animate(scope.current, { x: 100, opacity: reduce ? 0 : 1 }); }, []);
  return <div ref={scope} />;`).join(' '),
      /started from script/,
    );
    assert.deepEqual(
      hero(`useEffect(() => { animate(scope.current, { x: reduce ? 0 : 100 }); }, []);
  return <div ref={scope} />;`),
      [],
    );
  });

  it('counts useAnimate() only when the animate it returns is called (#239 review)', () => {
    const hero = (body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { useAnimate } from 'motion/react';
export function Hero() {
  ${body}
  return <div ref={scope} />;
}`,
          }),
        ),
      );
    assert.deepEqual(hero('const [scope] = useAnimate();'), []);
    assert.deepEqual(hero('const [scope, animate] = useAnimate();'), []);
    assert.match(
      hero(`const [scope, animate] = useAnimate();
  useEffect(() => { animate(scope.current, { x: 100 }); }, []);`).join(' '),
      /started from script/,
    );
  });

  it('ties a root provider to what the entry renders (#239 review)', () => {
    const app = `import { motion } from 'motion/react';
export function App() { return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} />; }`;
    const helper = checkDesign(
      project({
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
function Preview() { return <MotionConfig reducedMotion="user"><PreviewBody /></MotionConfig>; }
createRoot(document.getElementById('root')!).render(<App />);`,
        'src/App.tsx': app,
      }),
    );
    assert.match(reducedMotion(helper).join(' '), /MotionConfig reducedMotion/);
    const hydrated = checkDesign(
      project({
        'src/main.tsx': `import { hydrateRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
hydrateRoot(document.getElementById('root')!, <MotionConfig reducedMotion="user"><App /></MotionConfig>);`,
        'src/App.tsx': app,
      }),
    );
    assert.deepEqual(reducedMotion(hydrated), []);
  });

  it('takes the app root from the entry, not any index.tsx (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/components/index.tsx': `import { MotionConfig, motion } from 'motion/react';
export function Panel() {
  return (
    <MotionConfig reducedMotion="user"><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} /></MotionConfig>
  );
}`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }}>Hi</motion.h1>; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('counts MotionConfig only as imported from Motion (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/App.tsx': `import { motion } from 'motion/react';
function MotionConfig({ children }: { children: React.ReactNode; reducedMotion: string }) { return <>{children}</>; }
export function App() { return <MotionConfig reducedMotion="user"><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: 0 }} /></MotionConfig>; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /MotionConfig reducedMotion/);
  });

  it('sees animation on a component Motion wraps (#239 review)', () => {
    for (const factory of [
      'motion.create(Button)',
      'motion(Button)',
      'motion.button',
    ]) {
      const report = checkDesign(
        project({
          'src/Hero.tsx': `import { motion } from 'motion/react';
const MotionButton = ${factory};
export function Hero() { return <MotionButton animate={{ x: 100 }}>Go</MotionButton>; }`,
        }),
      );
      assert.match(
        reducedMotion(report).join(' '),
        /MotionConfig reducedMotion/,
        factory,
      );
    }
  });

  it('follows an imported alias of the Motion factory (#239 review)', () => {
    for (const body of [
      `import { motion as animated } from 'motion/react';
export function Hero() { return <animated.div animate={{ x: 100 }} />; }`,
      `import { m as lazy } from 'motion/react';
const Box = lazy.create(Card);
export function Hero() { return <Box animate={{ x: 100 }} />; }`,
    ]) {
      assert.match(
        reducedMotion(checkDesign(project({ 'src/Hero.tsx': body }))).join(' '),
        /MotionConfig reducedMotion/,
        body,
      );
    }
  });

  it('classifies Motion file by file (#239 review)', () => {
    // A Motion import in Hero.tsx does not make util.ts's own animate()
    // a Motion call.
    const report = checkDesign(
      project({
        'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
export function Hero() { return <motion.h1 animate={{ opacity: 1 }} />; }`,
        'src/util.ts': `export function animate(el: HTMLElement) { el.classList.add('in'); }
animate(document.body);`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('follows an imported alias of a Motion hook (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { motion, useScroll as usePageScroll } from 'motion/react';
export function Hero() { const { scrollY } = usePageScroll(); return <motion.div style={{ y: scrollY }} />; }`,
      }),
    );
    assert.match(reducedMotion(report).join(' '), /linked to scroll/);
  });

  it("reads only Motion's own useReducedMotion, in the block it returns from (#239 review)", () => {
    const hero = (head: string, body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `${head}
export function Hero() {
  const reduce = useReducedMotion();
  ${body}
}`,
          }),
        ),
      );
    const gated = 'return <motion.div animate={reduce ? {} : { x: 100 }} />;';
    assert.match(
      hero(
        `import { motion } from 'motion/react';
function useReducedMotion() { return false; }`,
        gated,
      ).join(' '),
      /MotionConfig reducedMotion/,
    );
    const imported = `import { motion, useReducedMotion } from 'motion/react';`;
    assert.deepEqual(hero(imported, gated), []);
    // Returning from an effect does not stop what the component renders.
    assert.match(
      hero(
        imported,
        `useEffect(() => { if (reduce) return; }, []);
  return <motion.div animate={{ x: 100 }} />;`,
      ).join(' '),
      /MotionConfig reducedMotion/,
    );
    assert.deepEqual(
      hero(
        imported,
        `if (reduce) return <div />;
  return <motion.div animate={{ x: 100 }} />;`,
      ),
      [],
    );
  });

  it('counts a guard only when the motion runs without the preference (#239 review)', () => {
    const hero = (body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, useReducedMotion, useAnimate } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate();
  useEffect(() => { ${body} }, []);
  return <div ref={scope} />;
}`,
          }),
        ),
      );
    for (const wrong of [
      'if (reduce) animate(scope.current, { x: 100 });',
      'if (reduce) { animate(scope.current, { x: 100 }); }',
      'reduce && animate(scope.current, { x: 100 });',
      '!reduce || animate(scope.current, { x: 100 });',
      'reduce ? animate(scope.current, { x: 100 }) : null;',
    ]) {
      assert.match(hero(wrong).join(' '), /started from script/, wrong);
    }
    for (const right of [
      'if (!reduce) animate(scope.current, { x: 100 });',
      '!reduce && animate(scope.current, { x: 100 });',
      'reduce || animate(scope.current, { x: 100 });',
      'reduce ? null : animate(scope.current, { x: 100 });',
    ]) {
      assert.deepEqual(hero(right), [], right);
    }
  });

  it('holds a read of the preference to the motion it decides (#239 review)', () => {
    const hero = (body: string) =>
      reducedMotion(
        checkDesign(
          project({
            'src/Hero.tsx': `import { motion, useReducedMotion, useScroll, useTransform, useAnimate } from 'motion/react';
export function Hero() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const [scope, animate] = useAnimate();
  ${body}
}`,
          }),
        ),
      );
    // A label is not the motion.
    assert.match(
      hero(`const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  return <motion.div style={{ y }}>{reduce ? 'Still' : 'Moving'}</motion.div>;`).join(
        ' ',
      ),
      /linked to scroll/,
    );
    for (const gated of [
      `const y = useTransform(
    scrollYProgress,
    [0, 1],
    reduce ? [0, 0] : [0, 200],
  );
  return <motion.div ref={scope} style={{ y }} />;`,
      `const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  useEffect(() => { if (!reduce) animate(scope.current, { x: 100 }); }, []);
  return <motion.div ref={scope} style={{ y: reduce ? 0 : y }} />;`,
      `const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  useEffect(() => { if (reduce) return; animate(scope.current, { x: 100 }); }, []);
  return <motion.div ref={scope} style={reduce ? undefined : { y }} />;`,
    ]) {
      assert.deepEqual(hero(gated), [], gated);
    }
  });

  it('reads an aliased useReducedMotion as a read of the preference (#239 review)', () => {
    const report = checkDesign(
      project({
        'src/Hero.tsx': `import { motion, useReducedMotion as usePrefersReduced, useScroll, useTransform } from 'motion/react';
export function Hero() {
  const reduce = usePrefersReduced();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [0, 200]);
  return <motion.div style={{ y }} />;
}`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('reads Motion hooks and the factory only as the file imports them (#239 review)', () => {
    const own = checkDesign(
      project({
        'src/main.tsx': `import { MotionConfig } from 'motion/react';
createRoot(root).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);`,
        'src/Hero.tsx': `import { motion } from 'motion/react';
function animate(el: HTMLElement) { return el; }
function useScroll() { return 0; }
export function Hero() { useScroll(); animate(document.body); return <motion.div animate={{ x: 100 }} />; }`,
      }),
    );
    assert.deepEqual(reducedMotion(own), []);
    const spaced = checkDesign(
      project({
        'src/Hero.tsx': `import * as Motion from 'motion/react';
export function Hero() { const { scrollY } = Motion.useScroll(); return <Motion.motion.div animate={{ x: 100 }} style={{ y: scrollY }} />; }`,
      }),
    );
    const warnings = reducedMotion(spaced).join(' ');
    assert.match(warnings, /MotionConfig reducedMotion/);
    assert.match(warnings, /linked to scroll/);
  });

  it('does not read the word animate as Motion without the library', () => {
    const report = checkDesign(
      project({
        'src/util.ts': `export function animate(el: HTMLElement) { return el; }
animate(document.body);`,
      }),
    );
    assert.deepEqual(reducedMotion(report), []);
  });

  it('does not excuse a spread whose label is cleared after it (#239 review)', () => {
    const search = (attribute: string) =>
      checkDesign(
        project({
          'src/components/ui/input.tsx': `export function Input(props: InputProps) {
  return <input {...props} ${attribute} />;
}`,
          'src/App.tsx': `import { Input } from './components/ui/input';
export function App() { return <main><Input aria-label="Search" /></main>; }`,
        }),
      );
    for (const cleared of [
      'aria-label={undefined}',
      'aria-labelledby={null}',
      'id={undefined}',
      'aria-label=""',
      "aria-labelledby=''",
      'id={""}',
    ]) {
      assert.ok(checks(search(cleared), 'warnings').includes('label'), cleared);
    }
    // Set before the spread, the spread's own value wins.
    assert.ok(
      !checks(
        checkDesign(
          project({
            'src/components/ui/input.tsx': `export function Input(props: InputProps) {
  return <input aria-label={undefined} {...props} />;
}`,
            'src/App.tsx': `import { Input } from './components/ui/input';
export function App() { return <main><Input aria-label="Search" /></main>; }`,
          }),
        ),
        'warnings',
      ).includes('label'),
    );
  });

  it('reads the uses of a spread wrapper by any name (#239 review)', () => {
    const wrapper = `export function TextField(props: InputProps) {
  return <input {...props} />;
}`;
    const withUse = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/components/text-field.tsx': wrapper,
            'src/App.tsx': `import { TextField } from './components/text-field';
export function App() { return <main>${use}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(withUse('<TextField />').includes('label'));
    assert.ok(!withUse('<TextField aria-label="Search" />').includes('label'));
    assert.ok(
      !withUse('<label>Search <TextField /></label>').includes('label'),
    );
  });

  it('holds a wrapper use to a label its id or aria-labelledby names (#239 review)', () => {
    const wrapper = `export function TextField(props: InputProps) {
  return <input {...props} />;
}`;
    const withUse = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/components/text-field.tsx': wrapper,
            'src/App.tsx': `import { TextField } from './components/text-field';
export function App() { return <main>${use}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(withUse('<TextField id="q" />').includes('label'));
    assert.ok(
      !withUse(
        '<label htmlFor="q">Search</label><TextField id="q" />',
      ).includes('label'),
    );
    assert.ok(
      withUse('<TextField aria-labelledby="q-label" />').includes('label'),
    );
    assert.ok(
      !withUse(
        '<span id="q-label">Search</span><TextField aria-labelledby="q-label" />',
      ).includes('label'),
    );
  });

  it('follows a label through a chain of pass-through wrappers (#239 review)', () => {
    const withUse = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/components/text-input.tsx': `export function TextInput(props: InputProps) { return <input {...props} />; }`,
            'src/components/text-field.tsx': `import { TextInput } from './text-input';
export function TextField(props: InputProps) { return <TextInput {...props} />; }`,
            'src/App.tsx': `import { TextField } from './components/text-field';
export function App() { return <main>${use}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(withUse('<TextField />').includes('label'));
    assert.ok(!withUse('<TextField aria-label="Search" />').includes('label'));
  });

  it('reads the uses of a spread wrapper under an imported alias (#239 review)', () => {
    for (const [wrapper, app] of [
      [
        `export function TextField(props: InputProps) { return <input {...props} />; }`,
        `import { TextField as Field } from './components/text-field';
export function App() { return <main><Field /></main>; }`,
      ],
      [
        `export default function TextField(props: InputProps) { return <input {...props} />; }`,
        `import Field from './components/text-field';
export function App() { return <main><Field /></main>; }`,
      ],
    ]) {
      const report = checkDesign(
        project({
          'src/components/text-field.tsx': wrapper!,
          'src/App.tsx': app!,
        }),
      );
      assert.ok(checks(report, 'warnings').includes('label'), app);
    }
  });

  it('reads the uses of a spread wrapper through a namespace import (#239 review)', () => {
    const withUse = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/components/text-field.tsx': `export function TextField(props: InputProps) { return <input {...props} />; }`,
            'src/App.tsx': `import * as Fields from './components/text-field';
export function App() { return <main>${use}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(withUse('<Fields.TextField />').includes('label'));
    assert.ok(
      !withUse('<Fields.TextField aria-label="Search" />').includes('label'),
    );
  });

  it('does not excuse a call-site spread whose label is cleared after it (#239 review)', () => {
    const withUse = (use: string) =>
      checks(
        checkDesign(
          project({
            'src/components/text-field.tsx': `export function TextField(props: InputProps) { return <input {...props} />; }`,
            'src/App.tsx': `import { TextField } from './components/text-field';
export function App(props: InputProps) { return <main>${use}</main>; }`,
          }),
        ),
        'warnings',
      );
    assert.ok(!withUse('<TextField {...props} />').includes('label'));
    for (const cleared of [
      'aria-label={undefined}',
      'aria-labelledby={null}',
      'id=""',
    ]) {
      assert.ok(
        withUse(`<TextField {...props} ${cleared} />`).includes('label'),
        cleared,
      );
    }
  });

  it("leaves shadcn's <input {...props}> to the <Input> that uses it", () => {
    const input = `import * as React from 'react';
export function Input(props: React.ComponentProps<'input'>) {
  return <input data-slot="input" {...props} />;
}`;
    const labelled = checkDesign(
      project({
        'src/components/ui/input.tsx': input,
        'src/App.tsx': APP('').replace(
          '<input id="email"',
          '<Input id="email"',
        ),
      }),
    );
    assert.ok(!checks(labelled, 'warnings').includes('label'));
    const unlabelled = checkDesign(
      project({
        'src/components/ui/input.tsx': input,
        'src/App.tsx': APP('').replace(
          '<label htmlFor="email">Email address</label>\n      <input id="email"',
          '<Input',
        ),
      }),
    );
    assert.ok(checks(unlabelled, 'warnings').includes('label'));
  });
});

describe('a project without a spec', () => {
  it('gets the universal checks and nothing it was never asked to meet', () => {
    const report = checkDesign(project({ 'DESIGN.md': null }));
    assert.equal(report.hasSpec, false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
  });

  it('treats a hand-written DESIGN.md as no spec', () => {
    const report = checkDesign(
      project({ 'DESIGN.md': '---\nrounded: 4px\n---\n\n# Design\n' }),
    );
    assert.equal(report.hasSpec, false);
  });
});

describe('what a repair prompt is told', () => {
  it('lists errors before warnings, each with its check', () => {
    const text = describeFindings({
      hasSpec: true,
      errors: [{ severity: 'error', check: 'lang', detail: 'No lang.' }],
      warnings: [{ severity: 'warning', check: 'copy', detail: 'Copy.' }],
    });
    assert.equal(text, '- [lang] No lang.\n- [copy] Copy.');
  });

  it('never lists more than the cap', () => {
    const many = Array.from({ length: 100 }, (_, at) => ({
      severity: 'error' as const,
      check: 'color',
      detail: `Colour ${at}.`,
    }));
    const lines = describeFindings({
      hasSpec: true,
      errors: many,
      warnings: [],
    }).split('\n');
    assert.equal(lines.length, MAX_FINDINGS_IN_PROMPT);
  });
});

describe('media the page references', () => {
  const withVideo = (src: string) =>
    project({
      'src/Hero.tsx': `export const Hero = () => <video className="motion-reduce:hidden" autoPlay muted loop playsInline src="${src}" poster="/media/loop-poster.jpg" />;`,
    });

  it('passes when every /media/ path is in the library', () => {
    const report = checkDesign(withVideo('/media/loop.mp4'), {
      mediaPaths: ['media/loop.mp4', 'media/loop-poster.jpg'],
    });
    assert.deepEqual(report.errors, []);
  });

  it('fails a path nobody uploaded, and says what does exist', () => {
    const report = checkDesign(withVideo('/media/hero.mp4'), {
      mediaPaths: ['media/loop.mp4', 'media/loop-poster.jpg'],
    });
    assert.deepEqual(checks(report, 'errors'), ['media']);
    assert.match(report.errors[0]!.detail, /\/media\/hero\.mp4/);
    assert.match(report.errors[0]!.detail, /\/media\/loop\.mp4/);
  });

  it('fails every /media/ path when the library is empty', () => {
    const report = checkDesign(withVideo('/media/loop.mp4'), {
      mediaPaths: [],
    });
    assert.equal(report.errors.length, 2);
    assert.match(report.errors[0]!.detail, /library is empty/);
  });

  it('leaves alone a /media/ path inside another URL, or one the project ships', () => {
    const library = { mediaPaths: ['media/loop.mp4', 'media/loop-poster.jpg'] };
    assert.deepEqual(
      checkDesign(withVideo('https://cdn.example.com/media/photo.mp4'), library)
        .errors,
      [],
    );
    assert.deepEqual(
      checkDesign(withVideo('/assets/media/photo.mp4'), library).errors,
      [],
    );
    assert.deepEqual(
      checkDesign(
        [
          ...withVideo('/media/shipped.mp4'),
          { path: 'public/media/shipped.mp4', content: '' },
        ],
        library,
      ).errors,
      [],
    );
  });

  it('checks nothing when the caller does not know the library', () => {
    assert.deepEqual(checkDesign(withVideo('/media/hero.mp4')).errors, []);
  });
});

/**
 * The rule scanner that replaced `/([^{}]+)\{([^{}]*)\}/g` (internal PR 75).
 *
 * The regex was quadratic on a long run with no brace in it, and it ran over
 * the source as well as the stylesheets: one generated page with a 66 KB
 * class list held the checks for 8.6 seconds. The scanner has to find
 * exactly what the regex found, or every check built on it would move.
 */
describe('reading CSS rules', () => {
  const byRegex = (text: string) =>
    [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      selector: match[1]!,
      body: match[2]!,
    }));

  it('finds exactly what the regex it replaced found', () => {
    const cases = [
      '',
      'a{b}',
      '{}',
      'a{}',
      '{b}',
      'a{b{c}}',
      '.x { color: red } .y{}',
      '@media (x) { .a { b: c } }',
      'a}b{c}',
      'a{b{c',
      '}}}a{b}',
    ];
    // And random text over the characters that decide it.
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 500; n++) {
      let text = '';
      const length = Math.floor(random() * 40);
      for (let i = 0; i < length; i++)
        text += 'ab {} ;'[Math.floor(random() * 7)];
      cases.push(text);
    }
    for (const text of cases) {
      assert.deepEqual(
        cssRuleMatches(text),
        byRegex(text),
        JSON.stringify(text),
      );
    }
  });

  it('stays fast on the shapes that made the regex quadratic', () => {
    for (const text of [
      'x'.repeat(200_000),
      `<div className="${'bg-a text-b '.repeat(20_000)}" />`,
      '{'.repeat(100_000),
      'a{'.repeat(100_000),
    ]) {
      const started = performance.now();
      cssRuleMatches(text);
      const elapsed = performance.now() - started;
      assert.ok(
        elapsed < 250,
        `${text.slice(0, 12)}... took ${elapsed.toFixed(0)}ms`,
      );
    }
  });

  it('keeps checkDesign fast on a page with a very long class list', () => {
    const started = performance.now();
    checkDesign(
      project({
        'src/App.tsx': `export function App() { return <main className="${'bg-a text-b '.repeat(10_000)}"><h1>Know it{' '}<em>all.</em></h1><label htmlFor="email">Email address</label><input id="email" placeholder="Enter your email" /></main>; }`,
      }),
    );
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2_000, `took ${elapsed.toFixed(0)}ms`);
  });
});
