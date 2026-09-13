import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildUserPrompt } from '../src/plan-provider.ts';
import { paletteFailures } from '../src/palette-derive.ts';
import {
  dominantBrandColor,
  paletteFromPage,
  readColorLiterals,
  readPageColors,
  sameOriginStylesheets,
} from '../src/palette-extract.ts';

describe('reading colour literals', () => {
  it('reads hex, shorthand hex, rgb and oklch', () => {
    const found = readColorLiterals(
      'a #ff6600 b #f60 c rgb(255, 102, 0) d rgba(255 102 0 / 0.8) e oklch(70.4% .191 22.216)',
    );
    assert.deepEqual(found.slice(0, 2), ['#ff6600', '#ff6600']);
    assert.ok(found.includes('#ff6600'));
    // Tailwind 4's red-400, which is the value Tailwind itself publishes.
    assert.ok(found.includes('#ff6467'), found.join(' '));
  });

  it('reads oklch at all, which is what Tailwind 4 emits', () => {
    // vibld.com's own stylesheet yielded zero colours before this: the scan
    // found `#0000` shadows and nothing that was a colour. Tailwind 4 writes
    // every one of its colours as oklch(), so a scanner without it is blind
    // on a large share of modern sites.
    const found = readColorLiterals(
      '--color-blue-500: oklch(0.623 0.214 259.815);',
    );
    assert.deepEqual(found, ['#2b7fff']);
  });

  it('skips colours that are essentially transparent', () => {
    const found = readColorLiterals(
      'rgba(255,0,0,0.05) oklch(0.5 0.2 30 / 2%)',
    );
    assert.deepEqual(found, []);
  });

  it('finds colour wherever it sits, not only in CSS', () => {
    // Hacker News keeps its orange in `bgcolor`, an attribute older than CSS.
    // A scan that only looked at <style> and style= found nothing there.
    const found = readColorLiterals(
      '<td bgcolor="#ff6600"><svg fill="#f6f6ef">',
    );
    assert.deepEqual(found, ['#ff6600', '#f6f6ef']);
  });
});

describe('choosing the brand colour', () => {
  it('believes a declared theme-color over anything counted', () => {
    const colors = readPageColors(
      '<meta name="theme-color" content="#00add8">' +
        '<style>a{color:#ff0000}a{color:#ff0000}a{color:#ff0000}</style>',
    );
    assert.equal(colors.themeColor, '#00add8');
    assert.equal(dominantBrandColor(colors), '#00add8');
  });

  it('ignores a theme-color that is white or black', () => {
    // Plenty of sites declare one, truthfully and uselessly.
    const colors = readPageColors(
      '<meta name="theme-color" content="#ffffff"><style>a{color:#2b7fff}</style>',
    );
    assert.equal(dominantBrandColor(colors), '#2b7fff');
  });

  it('sets aside the neutrals, which are always the commonest colours', () => {
    // Text and background dominate every page by count. Seeding from them
    // gives a palette with no colour in it.
    const colors = readPageColors(
      '<style>' +
        'a{color:#111111}b{color:#111111}c{color:#111111}d{color:#111111}' +
        'e{color:#ffffff}f{color:#ffffff}g{color:#ffffff}' +
        'h{color:#7a7a7a}i{color:#7a7a7a}' +
        'j{color:#e0532a}' +
        '</style>',
    );
    assert.equal(dominantBrandColor(colors), '#e0532a');
  });

  it('has no answer when a page offers no colour', () => {
    assert.equal(
      dominantBrandColor(readPageColors('<p>no colour here</p>')),
      null,
    );
    assert.equal(paletteFromPage('<p>no colour here</p>'), null);
  });
});

describe('stylesheets', () => {
  it('takes same-origin ones, absolute, deduplicated and capped', () => {
    const html =
      '<link rel="stylesheet" href="/a.css">' +
      '<link rel="preload stylesheet" href="https://cdn.other.com/b.css">' +
      '<link rel="icon" href="/i.png">' +
      '<link rel=stylesheet href=/c.css>' +
      '<link rel="stylesheet" href="/a.css">' +
      '<link rel="stylesheet" href="/d.css">';
    assert.deepEqual(sameOriginStylesheets(html, 'https://example.com/page'), [
      'https://example.com/a.css',
      'https://example.com/c.css',
    ]);
  });

  it('refuses a cross-origin sheet', () => {
    // Following those turns "fetch the URL I gave you" into "fetch whatever
    // that page links", which is a different and much larger promise.
    const html = '<link rel="stylesheet" href="https://cdn.other.com/b.css">';
    assert.deepEqual(sameOriginStylesheets(html, 'https://example.com/'), []);
  });

  it('says nothing rather than throwing on an unusable base', () => {
    const html = '<link rel="stylesheet" href="/a.css">';
    assert.deepEqual(sameOriginStylesheets(html, 'not a url'), []);
  });

  it('folds a fetched sheet into the evidence', () => {
    const html = '<p>nothing here</p>';
    const sheet = ':root{--brand:#e0532a}.x{color:#e0532a}';
    assert.equal(paletteFromPage(html), null);
    const found = paletteFromPage(html, [sheet]);
    assert.ok(found);
    assert.equal(found.source, '#e0532a');
  });
});

describe('the palette a page produces', () => {
  it('is contrast-solved like any other, whatever the page supplied', () => {
    // The guarantee has to survive arbitrary input, because the input is
    // arbitrary: it is a colour off somebody else's page. These are the real
    // brand colours of Hacker News, go.dev, Mozilla and vibld.com, read off
    // their live pages.
    for (const hex of ['#ff6600', '#00add8', '#0060df', '#f3680f']) {
      const found = paletteFromPage(
        `<meta name="theme-color" content="${hex}">`,
        [`.a{color:${hex}}`],
      );
      assert.ok(found, hex);
      assert.deepEqual(paletteFailures(found.palette), [], hex);
    }
  });

  it('refuses a neutral as evidence rather than deriving a colourless page', () => {
    // A grey or a near-black is a real colour on the page and a useless
    // brand colour, and seeding from one produces a palette with nothing in
    // it. Null here sends the caller back to the default it already had,
    // which is the better answer.
    for (const hex of ['#808080', '#111111', '#fdfdfd']) {
      assert.equal(
        paletteFromPage(`<meta name="theme-color" content="${hex}">`, [
          `.a{color:${hex}}`,
        ]),
        null,
        hex,
      );
    }
  });

  it('reports whether the site declared the colour or it was counted', () => {
    const declared = paletteFromPage(
      '<meta name="theme-color" content="#00add8">',
    );
    assert.equal(declared?.declared, true);
    const counted = paletteFromPage('<style>.a{color:#00add8}</style>');
    assert.equal(counted?.declared, false);
  });
});

describe('where a reference palette sits in the prompt', () => {
  const request = { prompt: 'a landing page for a dental clinic' };
  const found = paletteFromPage('<meta name="theme-color" content="#00add8">');

  it('outranks the keyword-matched default', () => {
    // Someone who supplied a reference URL expressed a preference more
    // specific than any keyword match can be.
    const prompt = buildUserPrompt(
      request,
      null,
      null,
      'text',
      null,
      found!.palette,
    );
    assert.match(prompt, /derived from the reference site/);
    assert.doesNotMatch(prompt, /In the absence of a stated palette/);
  });

  it('leaves the default in place when there is no reference palette', () => {
    const prompt = buildUserPrompt(request, null, null, 'text', null, null);
    assert.doesNotMatch(prompt, /derived from the reference site/);
  });

  it('yields to a chosen style preset, same as the default does', () => {
    const prompt = buildUserPrompt(
      request,
      'dark',
      null,
      'text',
      null,
      found!.palette,
    );
    assert.doesNotMatch(prompt, /derived from the reference site/);
  });

  it('carries the solved values, not a description of them', () => {
    const prompt = buildUserPrompt(
      request,
      null,
      null,
      'text',
      null,
      found!.palette,
    );
    for (const token of [
      '--primary',
      '--background',
      '--foreground',
      '--border',
    ]) {
      assert.ok(prompt.includes(token), token);
    }
    assert.ok(prompt.includes(found!.palette.colors.primary));
  });
});

describe("the page's own mode", () => {
  it('reads a dark page as dark even when its brand colour is bright', () => {
    // The bug: mode was inferred from the seed colour's lightness, and the
    // seed colour is an accent by construction (this module filters out
    // near-black and near-white before counting). A bright accent on a dark
    // site was classified light, and the guidance then told the model in so
    // many words to build for a light ground.
    const found = paletteFromPage(
      '<meta name="theme-color" content="#39d353">' +
        '<style>body{background:#0d1117}.c{background-color:#161b22}</style>' +
        '<p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
    assert.equal(found.palette.mode, 'dark');
    assert.deepEqual(paletteFailures(found.palette), []);
  });

  it('takes color-scheme at its word', () => {
    const found = paletteFromPage(
      '<meta name="color-scheme" content="dark light">' +
        '<style>.a{color:#c0392b}.b{color:#c0392b}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('does not read a light page as dark because it offers a dark mode', () => {
    // `prefers-color-scheme: dark` contains `color-scheme: dark`. A pattern
    // that does not exclude the prefixed form calls every site with a
    // dark-mode media query a dark site, which against seven real sites got
    // four of them wrong and hid the fact that the background scan below was
    // never reached.
    const found = paletteFromPage(
      '<style>body{background:#ffffff}' +
        '@media (prefers-color-scheme: dark){:root{color-scheme:dark}' +
        'body{background:#111111}}' +
        '.btn{color:#0b5fff}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('ignores a background set on something that is not the ground', () => {
    // Counting every background declaration counts what a utility stylesheet
    // can do rather than what the page does. Only html, body and :root are
    // the ground.
    const found = paletteFromPage(
      '<style>.bg-black{background-color:#000}.bg-slate{background:#0f172a}' +
        '.bg-ink{background:#111}body{background:#fbfbfb}</style>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('reads a light page as light', () => {
    const found = paletteFromPage(
      '<style>body{background:#ffffff}.c{background:#f7f7f7}' +
        '.btn{color:#0b5fff}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('falls back to the colour itself when the page says nothing', () => {
    // No background declaration anywhere: a guess from the hex is then the
    // only thing available, and better than refusing.
    const found = paletteFromPage('<p style="color:#0b5fff">x</p>');
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });
});

describe('a meta tag written the other way round', () => {
  it('honours theme-color with content before name', () => {
    // HTML does not order attributes. A pattern that insists on
    // name-then-content demotes the site's own declaration to an ordinary
    // counted literal, and whichever colour happens to appear more often
    // wins instead.
    const found = paletteFromPage(
      '<meta content="#00add8" name="theme-color">' +
        '<style>.a{color:#c0392b}.b{color:#c0392b}.c{color:#c0392b}</style>' +
        '<p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.source, '#00add8');
    assert.equal(found.declared, true);
  });
});

describe('a reference palette and the product type', () => {
  // paletteGuidance carries more than colour: the product type's fonts,
  // radii, shadows and motion durations travel in the same block. Dropping
  // the block when a reference palette arrived took all of that with it, so
  // pointing at a site quietly made the output less specified, not more.
  const request = { prompt: 'a dashboard for a fintech product' };
  const found = paletteFromPage('<meta name="theme-color" content="#00add8">');

  it('replaces the catalogue colours', () => {
    const prompt = buildUserPrompt(
      request,
      null,
      null,
      'text',
      null,
      found!.palette,
    );
    assert.ok(prompt.includes(found!.palette.colors.primary));
    assert.doesNotMatch(prompt, /In the absence of a stated palette/);
  });

  it('keeps the fonts, radii, shadows and motion it has no opinion on', () => {
    const prompt = buildUserPrompt(
      request,
      null,
      null,
      'text',
      null,
      found!.palette,
    );
    for (const token of [
      '--radius-md',
      '--shadow-medium',
      '--duration-standard',
    ]) {
      assert.ok(prompt.includes(token), `${token} was dropped`);
    }
    assert.match(prompt, /Heading font:/);
    assert.match(prompt, /fonts\.googleapis\.com/);
  });

  it('emits one colour system, not two', () => {
    const prompt = buildUserPrompt(
      request,
      null,
      null,
      'text',
      null,
      found!.palette,
    );
    assert.equal(prompt.split('--primary:').length - 1, 1);
  });
});

describe('a page built to be expensive to read', () => {
  /**
   * How much longer one big scan takes than four quarter-sized ones.
   *
   * Both sides do the same total work, 180,000 characters, so linear work
   * comes out near 1 and the backtracking this guards against comes out near
   * 4. Comparing equal totals rather than a small measurement against a
   * large one is what makes it survive a busy runner: an earlier version
   * compared 45,000 against 180,000, where the smaller reading was tens of
   * milliseconds and a scheduler hiccup moved the ratio past its threshold.
   * Here both sides accumulate the same couple of hundred milliseconds.
   */
  function backtrackingFactor(scan: (size: number) => void): number {
    // 40,000 and 160,000 rather than a quarter of the scan cap, so an inline
    // `<style>` block's closing tag still falls inside the window at the
    // larger size. At 180,000 the tag is cut off, the block is never found,
    // and the scan the test is about does not happen at all.
    const quarters = () => {
      const started = Date.now();
      for (let run = 0; run < 4; run += 1) scan(40_000);
      return Date.now() - started;
    };
    const whole = () => {
      const started = Date.now();
      scan(160_000);
      return Date.now() - started;
    };
    let best = Number.POSITIVE_INFINITY;
    for (let round = 0; round < 3; round += 1) {
      best = Math.min(best, whole() / Math.max(1, quarters()));
    }
    return best;
  }

  it('scans a stylesheet of delimiters without backtracking over them', () => {
    // 180,000 semicolons with no brace after them cost 25 seconds under a
    // lazy scan for the next `{`. A stylesheet is where this input really
    // arrives, and it is scanned whole rather than having to be found
    // between tags.
    const factor = backtrackingFactor((size) => {
      paletteFromPage('<p style="color:#0b5fff">x</p>', [';'.repeat(size)]);
    });
    assert.ok(factor < 2.5, `four times the work cost ${factor.toFixed(1)}x`);
  });

  it('is not slowed down by unclosed media queries in a stylesheet', () => {
    const factor = backtrackingFactor((size) => {
      paletteFromPage('<p style="color:#0b5fff">x</p>', [
        '@media '.repeat(Math.floor(size / 7)),
      ]);
    });
    assert.ok(factor < 2.5, `four times the work cost ${factor.toFixed(1)}x`);
  });

  it('is not slowed down by delimiters in an inline style block', () => {
    // The markup path into the same rule scan. There is deliberately no
    // test here for a page of unclosed `<body ` tags: the pattern that made
    // those expensive was a lookahead for a `bgcolor` attribute, which no
    // longer exists, and a measurement that reads the same with the bound
    // removed is not a guard. The ceiling below still covers that shape.
    const factor = backtrackingFactor((size) => {
      paletteFromPage(
        `<style>${';'.repeat(size)}</style><p style="color:#0b5fff">x</p>`,
      );
    });
    assert.ok(factor < 2.5, `four times the work cost ${factor.toFixed(1)}x`);
  });

  it('bounds a hostile page in absolute terms too', () => {
    // A regression that somehow grew evenly would pass the ratio. Ten
    // seconds is far above anything measured (the worst is a third of a
    // second) and far below the twenty-five the unbounded patterns cost.
    const started = Date.now();
    paletteFromPage(`${'<body '.repeat(30_000)}<p>x</p>`, [
      ';'.repeat(180_000),
    ]);
    const took = Date.now() - started;
    assert.ok(took < 10_000, `took ${took}ms`);
  });
});

describe('what actually counts as the page saying so', () => {
  it('reads a ground written inline on body', () => {
    // `<body style="background:#0d1117">` states the ground as plainly as a
    // stylesheet does. Reading only the legacy bgcolor attribute missed
    // every site that writes it this way, and the mode fell back to the
    // brand accent: a dark page with a bright accent came out light again.
    const found = paletteFromPage(
      '<meta name="theme-color" content="#39d353">' +
        '<body style="background:#0d1117"><p>x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('reads a ground written inline on html', () => {
    const found = paletteFromPage(
      '<html style="background-color:#0d1117">' +
        '<p style="color:#39d353">x</p></html>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('does not treat a data attribute as a declaration', () => {
    // `data-color-scheme="dark"` is a hook a theme switcher reads, not a
    // declaration, and the prefixed name is excluded for the same reason
    // `prefers-color-scheme` is. The ground decides instead.
    const found = paletteFromPage(
      '<body data-color-scheme="dark" style="background:#fbfbfb">' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('ignores color-scheme scoped to a component', () => {
    // `.scheme-dark { color-scheme: dark }` is that component saying it, not
    // the page. An unrestricted search returned dark on the first one it
    // found, and could not tell it from the same words inside a comment or a
    // script either.
    const found = paletteFromPage(
      '<style>.scheme-dark{color-scheme:dark}body{background:#fbfbfb}</style>' +
        '<!-- color-scheme: dark -->' +
        '<script>const s = "color-scheme: dark";</script>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('honours a scheme written on the root element in any attribute', () => {
    // astro.build states it as a Tailwind arbitrary utility in the class
    // list, not in a style attribute, and reading only `style` called that
    // dark site light.
    for (const tag of [
      '<html class="text-gray-100 [color-scheme:dark] bg-dark-900">',
      '<html style="color-scheme:dark">',
      '<body class="[color-scheme:dark]">',
    ]) {
      const found = paletteFromPage(`${tag}<p style="color:#39d353">x</p>`);
      assert.ok(found, tag);
      assert.equal(found.mode, 'dark', tag);
    }
  });

  it('still honours color-scheme on a root', () => {
    const found = paletteFromPage(
      '<style>:root{color-scheme:dark}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('does not mistake a component selector for the root element', () => {
    // Word boundaries fire inside .body, #body, [data-body], .html-preview
    // and body-copy, because CSS punctuation is not a word character. Each
    // of those is an ordinary component whose background would otherwise
    // decide the whole page's mode.
    for (const selector of [
      '.body',
      '#body',
      '[data-body]',
      '.html-preview',
      '.body-copy',
      'body .card',
    ]) {
      const found = paletteFromPage(
        `<style>${selector}{background:#0d1117}body{background:#fbfbfb}</style>` +
          '<p style="color:#0b5fff">x</p>',
      );
      assert.ok(found, selector);
      assert.equal(found.mode, 'light', selector);
    }
  });

  it('reads a root rule that carries no condition', () => {
    for (const selector of ['html', 'body', ':root', 'html body', 'html, .x']) {
      const found = paletteFromPage(
        `<style>${selector}{background:#0d1117}</style>` +
          '<p style="color:#39d353">x</p>',
      );
      assert.ok(found, selector);
      assert.equal(found.mode, 'dark', selector);
    }
  });

  it('ignores a root rule whose condition it cannot check', () => {
    // `html.dark` applies only if the root carries that class, and knowing
    // that means tracking the classes the root has and how the rules naming
    // them rank, which is most of a CSS engine. A theme rule that is not in
    // force would otherwise reverse the mode of the page it sits in.
    //
    // The fallback when nothing unconditional is found is the brand colour,
    // which is where this started. A missing answer is recoverable; a
    // confident wrong one builds a light page for a dark site.
    for (const selector of [
      '.dark body',
      'html.theme-dark',
      ':root.dark',
      ':root[data-theme="dark"]',
      'body#app',
    ]) {
      const found = paletteFromPage(
        `<style>body{background:#fbfbfb}${selector}{background:#0d1117}</style>` +
          '<p style="color:#0b5fff">x</p>',
      );
      assert.ok(found, selector);
      assert.equal(found.mode, 'light', selector);
    }
  });
});

describe('a document that declares a base', () => {
  it('resolves stylesheet hrefs against it', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<base href="/assets/"><link rel="stylesheet" href="theme.css">',
        'https://example.com/',
      ),
      ['https://example.com/assets/theme.css'],
    );
  });

  it('drops sheets a cross-origin base puts on another host', () => {
    // A base elsewhere changes where a relative href points, not which
    // origins may be reached.
    assert.deepEqual(
      sameOriginStylesheets(
        '<base href="https://cdn.example.net/"><link rel=stylesheet href="a.css">',
        'https://example.com/',
      ),
      [],
    );
  });

  it('ignores a base it cannot parse', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<base href="::::"><link rel="stylesheet" href="/a.css">',
        'https://example.com/',
      ),
      ['https://example.com/a.css'],
    );
  });
});

describe('names that only look like the real thing', () => {
  // `\b` sits either side of a hyphen, so it fires inside `<body-copy>`,
  // `data-style` and `data-name`. Each is a different thing wearing the name
  // of a root element or a real attribute, and each was read as the genuine
  // article. The rule is written once in the module now and used at every
  // name in it.
  it('does not scan a custom element as a document root', () => {
    const found = paletteFromPage(
      '<body style="background:#fbfbfb">' +
        '<body-copy style="color-scheme:dark;background:#0d1117">x</body-copy>' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read a data attribute as an inline style', () => {
    const found = paletteFromPage(
      '<body data-style="background:#0d1117" style="background:#fbfbfb">' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read data-name as a meta tag name', () => {
    const found = paletteFromPage(
      '<meta data-name="theme-color" content="#00add8">' +
        '<style>.a{color:#c0392b}.b{color:#c0392b}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.declared, false);
    assert.equal(found.source, '#c0392b');
  });

  it('does not treat a custom link-alike as a stylesheet link', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<link-preview rel="stylesheet" href="/nope.css">' +
          '<link rel="stylesheet" href="/real.css">',
        'https://example.com/',
      ),
      ['https://example.com/real.css'],
    );
  });
});

describe('when a page sets its ground more than once', () => {
  it('takes the later rule, as the browser does', () => {
    const found = paletteFromPage(
      '<style>body{background:#ffffff}body{background:#111111}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('takes the later declaration within one block', () => {
    const found = paletteFromPage(
      '<style>body{background:#ffffff;background:#111111}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('lets an inline style outrank a rule that came after it', () => {
    // Specificity, not order: the element's own style attribute wins
    // wherever the stylesheet sits in the file.
    const found = paletteFromPage(
      '<body style="background:#fbfbfb">' +
        '<style>body{background:#111111}</style>' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });
});

describe('text that merely contains CSS', () => {
  it('does not read rules out of a script payload', () => {
    // CSS inside a JSON string is text the site is carrying, not a rule it
    // applies, and feeding the raw document to the rule pattern let it
    // override the page's real background. The whitespace matters: without
    // it the selector tokeniser happened to reject `";body` as a subject,
    // which is luck rather than a defence.
    const found = paletteFromPage(
      '<style>body{background:#fbfbfb}</style>' +
        '<script type="application/json">' +
        '{"css":"; body{color-scheme:dark;background:#0d1117}"}' +
        '</script><p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read rules out of a commented-out line of script', () => {
    const found = paletteFromPage(
      '<style>body{background:#fbfbfb}</style>' +
        '<script>\n// body{background:#0d1117}\nvar x = 1;\n</script>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read rules out of an HTML comment', () => {
    const found = paletteFromPage(
      '<style>body{background:#fbfbfb}</style>' +
        '<!--\nbody{background:#0d1117}\n-->' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read rules out of a CSS comment', () => {
    const found = paletteFromPage(
      '<style>body{background:#fbfbfb} /*\nbody{background:#0d1117}\n*/</style>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('still reads rules from a linked stylesheet', () => {
    const found = paletteFromPage('<p style="color:#39d353">x</p>', [
      'body{background:#0d1117}',
    ]);
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });
});

describe('a property name is not a suffix of another', () => {
  it('does not read a custom property as a root background', () => {
    // `--card-background:` ends in `background:`, so an unanchored pattern
    // hands the page whichever custom property came last.
    const found = paletteFromPage(
      '<style>:root{--page-background:#ffffff;--card-background:#111111}' +
        'body{background:var(--page-background)}</style>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not read a custom property as a root color-scheme', () => {
    const found = paletteFromPage(
      '<style>:root{--my-color-scheme:dark}body{background:#fbfbfb}</style>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });
});

describe('links that are not stylesheet links', () => {
  it('ignores data-rel and a rel token that merely starts with stylesheet', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<link data-rel="stylesheet" href="/a.css">' +
          '<link rel="stylesheet-preview" href="/b.css">' +
          '<link rel="preload stylesheet" href="/c.css">',
        'https://example.com/',
      ),
      ['https://example.com/c.css'],
    );
  });
});

describe('the order a document applies its CSS in', () => {
  it('lets a style block override a stylesheet linked before it', () => {
    // Scanning every style block and then every sheet hands the page to the
    // sheet wherever it was linked. A `<style>` after a `<link>` overrides
    // it in a browser.
    const found = paletteFromPage(
      '<link rel="stylesheet" href="/theme.css">' +
        '<style>body{background:#fbfbfb}</style>' +
        '<p style="color:#0b5fff">x</p>',
      [
        {
          url: 'https://example.com/theme.css',
          text: 'body{background:#0d1117}',
        },
      ],
      'analogous',
      'https://example.com/',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('lets a stylesheet linked after a style block override it', () => {
    const found = paletteFromPage(
      '<style>body{background:#fbfbfb}</style>' +
        '<link rel="stylesheet" href="/theme.css">' +
        '<p style="color:#39d353">x</p>',
      [
        {
          url: 'https://example.com/theme.css',
          text: 'body{background:#0d1117}',
        },
      ],
      'analogous',
      'https://example.com/',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('takes the later of two root color-scheme declarations', () => {
    // The same source order the backgrounds already followed. Keeping the
    // first was this scan disagreeing with itself.
    const found = paletteFromPage(
      '<style>body{color-scheme:light}body{color-scheme:dark}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('still lets a scheme on the root element outrank a rule', () => {
    const found = paletteFromPage(
      '<html class="[color-scheme:dark]">' +
        '<style>body{color-scheme:light}</style>' +
        '<p style="color:#39d353">x</p></html>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });
});

describe('links the browser would never load', () => {
  it('ignores a commented-out stylesheet link', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<!-- <link rel="stylesheet" href="/ghost.css"> -->' +
          '<link rel="stylesheet" href="/real.css">',
        'https://example.com/',
      ),
      ['https://example.com/real.css'],
    );
  });

  it('ignores a link in a script closed the way a browser closes one', () => {
    // A browser ends a script at `</script foo>` and at `</script\t\n bar>`.
    // A pattern insisting on `</script>` reads past both and the script
    // stands as live markup again, which is a bypass of the whole point of
    // stripping it.
    for (const closer of [
      '</script foo>',
      '</script\t\n bar>',
      '</script >',
      '</SCRIPT>',
    ]) {
      assert.deepEqual(
        sameOriginStylesheets(
          `<script>var t = '<link rel="stylesheet" href="/ghost.css">';${closer}` +
            '<link rel="stylesheet" href="/real.css">',
          'https://example.com/',
        ),
        ['https://example.com/real.css'],
        closer,
      );
    }
  });

  it('does not treat a custom element close as the end of a script', () => {
    // `</script-foo>` is not the end of a script, and a word boundary says
    // it is.
    assert.deepEqual(
      sameOriginStylesheets(
        "<script>var t = '</script-foo>" +
          '<link rel="stylesheet" href="/ghost.css">\';</script>' +
          '<link rel="stylesheet" href="/real.css">',
        'https://example.com/',
      ),
      ['https://example.com/real.css'],
    );
  });

  it('ignores a stylesheet link quoted inside a script', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<script>var t = \'<link rel="stylesheet" href="/ghost.css">\';</script>' +
          '<link rel="stylesheet" href="/real.css">',
        'https://example.com/',
      ),
      ['https://example.com/real.css'],
    );
  });
});

describe('a script the scan window cuts in half', () => {
  it('does not follow a link left live by the truncation', () => {
    // A script that opens inside the window and closes outside it has no
    // closing tag to match, so its payload stood as live markup and a
    // `<link>` quoted in it was fetched. The cap was quietly undoing the
    // stripping at its own boundary.
    const filler = '<p>x</p>'.repeat(3_000);
    const html =
      '<link rel="stylesheet" href="/real.css">' +
      `${filler}<script>var t = '<link rel="stylesheet" href="/ghost.css">';` +
      'y'.repeat(200_000) +
      '</script>';
    assert.deepEqual(sameOriginStylesheets(html, 'https://example.com/'), [
      'https://example.com/real.css',
    ]);
  });

  it('does not cut the page short at an ordinary closed style block', () => {
    // The check has to be for a missing closer, not for an opener: cutting
    // from any opener to the end deletes the rest of a perfectly normal
    // page at its first `<style>`.
    const found = paletteFromPage(
      '<style>body{background:#0d1117}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });
});

describe('stylesheets the browser would not apply to a screen', () => {
  it('skips a print stylesheet', () => {
    // A print sheet forces a white ground, so counting it turns every dark
    // site that has one into a light site.
    assert.deepEqual(
      sameOriginStylesheets(
        '<link rel="stylesheet" media="print" href="/print.css">' +
          '<link rel="stylesheet" href="/screen.css">',
        'https://example.com/',
      ),
      ['https://example.com/screen.css'],
    );
  });

  it('keeps sheets that do apply, including feature queries', () => {
    for (const media of [
      'all',
      'screen',
      'screen and (min-width: 40em)',
      '(min-width: 40em)',
      '',
    ]) {
      assert.deepEqual(
        sameOriginStylesheets(
          `<link rel="stylesheet" media="${media}" href="/a.css">`,
          'https://example.com/',
        ),
        ['https://example.com/a.css'],
        media,
      );
    }
  });
});

describe('what the cascade would actually apply', () => {
  it('lets a more specific root rule beat a later one', () => {
    // `html body` outranks `body`, so the page renders dark however late
    // the white rule sits. Source order is the tie-breaker, not the rule.
    const found = paletteFromPage(
      '<style>html body{background:#111111}body{background:#ffffff}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('still takes the later of two rules at equal specificity', () => {
    const found = paletteFromPage(
      '<style>body{background:#ffffff}body{background:#111111}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('ignores a root rule nested in an at-rule', () => {
    // A selector that looks unconditional is still conditional when
    // something encloses it. Print, a viewport query and @supports are all
    // the same shape, and none of them is verified here.
    for (const condition of [
      '@media print',
      '@media (min-width: 40em)',
      '@supports (display: grid)',
      '@layer theme',
    ]) {
      const found = paletteFromPage(
        `<style>body{background:#111111}${condition}{body{background:#ffffff}}</style>` +
          '<p style="color:#39d353">x</p>',
      );
      assert.ok(found, condition);
      assert.equal(found.mode, 'dark', condition);
    }
  });

  it('still ignores a dark-scheme media override', () => {
    // The case the at-rule rule replaces: it was the first instance of
    // exactly this problem, handled on its own.
    const found = paletteFromPage(
      '<style>body{background:#ffffff}' +
        '@media (prefers-color-scheme: dark){body{background:#111111}}</style>' +
        '<p style="color:#0b5fff">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });
});

describe('attributes that store CSS rather than apply it', () => {
  it('does not read a data attribute as a scheme declaration', () => {
    const found = paletteFromPage(
      '<body data-config="color-scheme:dark" style="background:#ffffff">' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('still reads the scheme from style and class', () => {
    for (const tag of [
      '<html style="color-scheme:dark">',
      '<html class="text-gray-100 [color-scheme:dark]">',
    ]) {
      const found = paletteFromPage(`${tag}<p style="color:#39d353">x</p>`);
      assert.ok(found, tag);
      assert.equal(found.mode, 'dark', tag);
    }
  });
});

describe('a theme-color the browser would not use', () => {
  it('ignores a commented-out theme-color', () => {
    const found = paletteFromPage(
      '<!-- <meta name="theme-color" content="#00add8"> -->' +
        '<style>.a{color:#c0392b}.b{color:#c0392b}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.declared, false);
    assert.equal(found.source, '#c0392b');
  });

  it('ignores a theme-color quoted inside a script', () => {
    const found = paletteFromPage(
      '<script>var t = \'<meta name="theme-color" content="#00add8">\';</script>' +
        '<style>.a{color:#c0392b}.b{color:#c0392b}</style><p>x</p>',
    );
    assert.ok(found);
    assert.equal(found.source, '#c0392b');
  });
});

describe('the rest of the cascade', () => {
  it('lets an important rule beat a normal inline style', () => {
    // The one case where inline does not win. Consulting inline first and
    // the rules afterwards cannot express it, so importance is compared
    // rather than ordered.
    const found = paletteFromPage(
      '<body style="background:#ffffff">' +
        '<style>body{background:#111111!important}</style>' +
        '<p style="color:#39d353">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('keeps an inline style ahead of a normal rule', () => {
    const found = paletteFromPage(
      '<body style="background:#ffffff">' +
        '<style>body{background:#111111}</style>' +
        '<p style="color:#0b5fff">x</p></body>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'light');
  });

  it('does not let a later normal declaration beat an important one', () => {
    const found = paletteFromPage(
      '<style>body{background:#111111!important}body{background:#ffffff}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('takes the last declaration when a block repeats the property', () => {
    // A block writing the property twice is a fallback, not an ambiguity:
    // CSS applies the last valid one and a single exec returned the one the
    // page had already overruled.
    const scheme = paletteFromPage(
      '<style>body{color-scheme:light;color-scheme:dark}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(scheme);
    assert.equal(scheme.mode, 'dark');

    const ground = paletteFromPage(
      '<style>body{background:#ffffff;background:#111111}</style>' +
        '<p style="color:#39d353">x</p>',
    );
    assert.ok(ground);
    assert.equal(ground.mode, 'dark');
  });
});

describe('braces that are not structure', () => {
  it('removes a whole at-rule containing a brace in a string', () => {
    // The counter stopped at the brace inside `content`, so the rest of the
    // print block was left behind as ordinary rules and its white ground
    // reversed the page.
    const found = paletteFromPage(
      '<style>body{background:#111111}' +
        '@media print{body::before{content:"}"}body{background:#ffffff}}' +
        '</style><p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });

  it('handles an escaped quote inside that string', () => {
    const found = paletteFromPage(
      '<style>body{background:#111111}' +
        '@media print{body::before{content:"\\"}"}body{background:#ffffff}}' +
        '</style><p style="color:#39d353">x</p>',
    );
    assert.ok(found);
    assert.equal(found.mode, 'dark');
  });
});

describe('a base tag the browser would not use', () => {
  it('ignores a commented-out base', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<!-- <base href="/old/"> --><link rel="stylesheet" href="theme.css">',
        'https://example.com/',
      ),
      ['https://example.com/theme.css'],
    );
  });

  it('still honours a live base', () => {
    assert.deepEqual(
      sameOriginStylesheets(
        '<base href="/assets/"><link rel="stylesheet" href="theme.css">',
        'https://example.com/',
      ),
      ['https://example.com/assets/theme.css'],
    );
  });
});
