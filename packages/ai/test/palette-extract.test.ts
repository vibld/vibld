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
