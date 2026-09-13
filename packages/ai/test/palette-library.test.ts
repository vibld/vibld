import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contrastRatio } from '../src/contrast.ts';
import {
  REQUIRED_PAIRS,
  derivePalette,
  paletteFailures,
  seedFromHex,
} from '../src/palette-derive.ts';
import type { PaletteScheme } from '../src/palette-derive.ts';
import {
  PALETTE_LIBRARY,
  findLibraryPalette,
  matchLibraryPalette,
  paletteSummaries,
} from '../src/palette-library.ts';

const SCHEMES: PaletteScheme[] = [
  'analogous',
  'complementary',
  'split',
  'triadic',
];

describe('the shipped library', () => {
  it('has entries, with unique ids and both modes represented', () => {
    assert.ok(PALETTE_LIBRARY.length >= 24);
    const ids = PALETTE_LIBRARY.map((palette) => palette.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate palette id');
    assert.ok(PALETTE_LIBRARY.some((palette) => palette.mode === 'light'));
    assert.ok(PALETTE_LIBRARY.some((palette) => palette.mode === 'dark'));
  });

  it('passes every required pair, in every entry', () => {
    // The whole reason the library is derived rather than hand-written. This
    // is the check that lets an entry be added by writing one line.
    for (const palette of PALETTE_LIBRARY) {
      assert.deepEqual(paletteFailures(palette), [], palette.id);
    }
  });

  it('gives body text far more contrast than the bare minimum', () => {
    // 4.5 is the floor for passing, not a target to sit on. Text set exactly
    // at the floor is legal and tiring to read.
    for (const palette of PALETTE_LIBRARY) {
      const ratio = contrastRatio(
        palette.colors.foreground,
        palette.colors.background,
      );
      assert.ok(ratio !== null && ratio >= 10, `${palette.id} at ${ratio}`);
    }
  });

  it('gives each palette a ground that is not the same near-white', () => {
    // The first version put every light background at lightness 97, where no
    // saturation survives quantisation, and six different hues all came out
    // within a shade of each other. A library whose palettes are only
    // distinguishable by their accent is not a library.
    const lightGrounds = PALETTE_LIBRARY.filter(
      (palette) => palette.mode === 'light',
    ).map((palette) => palette.colors.background);
    assert.ok(
      new Set(lightGrounds).size >= lightGrounds.length - 2,
      'light backgrounds are collapsing onto one another',
    );
  });
});

describe('finding one', () => {
  it('looks up by id, and says no to an unknown one', () => {
    const first = PALETTE_LIBRARY[0]!;
    assert.equal(findLibraryPalette(first.id)?.id, first.id);
    assert.equal(
      findLibraryPalette(' ' + first.id.toUpperCase() + ' ')?.id,
      first.id,
    );
    assert.equal(findLibraryPalette('not-a-palette'), null);
  });

  it('matches a trigger as a word, never as a substring', () => {
    // The bug this exists for: Ember lists "cli", and the first version used
    // `includes`, so "a dental clinic booking site" was given a near-black
    // orange developer-tool palette. A wrong palette raises no error, it is
    // just the wrong colours, so the matching rule has to be right rather
    // than worded around.
    assert.equal(
      matchLibraryPalette('a dental clinic booking site')?.id,
      'mint',
    );
    assert.equal(
      matchLibraryPalette('a cli tool for developers')?.id,
      'ember-dark',
    );
    assert.equal(matchLibraryPalette('a client portal'), null);
    assert.equal(matchLibraryPalette('clickable prototypes'), null);
  });

  it('matches nothing rather than guessing', () => {
    assert.equal(matchLibraryPalette('something with no keywords in it'), null);
  });

  it('summarises each palette for a chooser without leaking internals', () => {
    const summaries = paletteSummaries();
    assert.equal(summaries.length, PALETTE_LIBRARY.length);
    for (const summary of summaries) {
      assert.ok(summary.name.length > 0);
      assert.ok(summary.note.length > 0);
      assert.equal(summary.swatches.length, 5);
      for (const swatch of summary.swatches) {
        assert.match(swatch, /^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('deriving a seed that did not come from the library', () => {
  it('solves the whole wheel, in both modes, under every scheme', () => {
    // What makes the reference-URL path safe: a colour lifted off someone
    // else's page is an arbitrary hue, and it has to derive a readable page
    // or be refused, never produce an unreadable one.
    let derived = 0;
    for (let hue = 0; hue < 360; hue += 20) {
      for (const saturation of [28, 60, 92]) {
        for (const mode of ['light', 'dark'] as const) {
          for (const scheme of SCHEMES) {
            const palette = derivePalette({
              id: 'sweep',
              name: 'sweep',
              note: 'sweep',
              hue,
              saturation,
              mode,
              scheme,
            });
            assert.ok(palette, `hue ${hue}/${saturation} ${mode} ${scheme}`);
            assert.deepEqual(
              paletteFailures(palette),
              [],
              `hue ${hue}/${saturation} ${mode} ${scheme}`,
            );
            derived += 1;
          }
        }
      }
    }
    assert.equal(derived, 18 * 3 * 2 * 4);
  });

  it('reads the mode from the colour rather than asking twice', () => {
    // A site whose dominant colour is dark is a dark site. Making the caller
    // state separately what the colour already says is a question with one
    // correct answer.
    assert.equal(seedFromHex('#151210', 'a', 'a', 'a')?.mode, 'dark');
    assert.equal(seedFromHex('#f4f1e8', 'a', 'a', 'a')?.mode, 'light');
  });

  it('floors saturation so a grey source still derives a palette', () => {
    const seed = seedFromHex('#808080', 'a', 'a', 'a');
    assert.ok(seed);
    assert.ok(seed.saturation >= 28, `saturation was ${seed.saturation}`);
    const palette = derivePalette(seed);
    assert.ok(palette);
    assert.deepEqual(paletteFailures(palette), []);
  });

  it('refuses a source colour that is not a hex', () => {
    assert.equal(seedFromHex('rebeccapurple', 'a', 'a', 'a'), null);
  });
});

describe('the pairs themselves', () => {
  it('covers every token that carries text', () => {
    // If a token is added to the palette shape and not to REQUIRED_PAIRS, it
    // is unverified and nothing says so. This is the reminder.
    const checked = new Set(
      REQUIRED_PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
    );
    for (const token of [
      'foreground',
      'mutedForeground',
      'cardForeground',
      'onPrimary',
      'onSecondary',
      'onAccent',
      'onDestructive',
    ]) {
      assert.ok(checked.has(token as never), `${token} is never checked`);
    }
  });
});
