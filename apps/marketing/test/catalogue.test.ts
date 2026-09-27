import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import { catalogue, withPalettes } from '../app/catalogue.ts';

/**
 * The catalogue of visual directions (#186).
 *
 * Two things these hold. That the page is the product's own list rather
 * than a second one written here, and that every colour shown is a pair the
 * preset itself says is legible.
 *
 * The second is the rule `palette-use.test.ts` is built on, applied to
 * somebody else's palette: this site's ink on a preset's fill inherits no
 * proof at all, and a contrast mistake looks exactly like a contrast choice.
 */

describe('what the catalogue lists', () => {
  it('lists every direction the builder can actually use', () => {
    // Not a curated subset. A visitor deciding whether the product suits
    // them is choosing from this list, so a shorter one here is a smaller
    // product than the one that ships.
    assert.equal(catalogue().length, STYLE_PRESETS.length);
    assert.deepEqual(
      catalogue().map((entry) => entry.id),
      STYLE_PRESETS.map((preset) => preset.id),
    );
  });

  it('takes its words from the presets rather than restating them', () => {
    for (const entry of catalogue()) {
      const preset = STYLE_PRESETS.find((each) => each.id === entry.id);
      assert.ok(preset);
      assert.equal(entry.name, preset.name);
      assert.equal(entry.description, preset.description);
    }
  });
});

describe('the colours a direction shows', () => {
  it('only ever pairs a fill with the ink that preset names for it', () => {
    // The whole rule. `packages/ai` verifies these pairs at 4.5:1, so this
    // page inherits a proof rather than making a claim.
    for (const entry of catalogue()) {
      if (!entry.pairs) continue;
      const colors = STYLE_PRESETS.find((preset) => preset.id === entry.id)
        ?.tokens?.colors;
      assert.ok(colors, `${entry.id} lost its colours`);

      const allowed = new Map([
        [colors.background, colors.foreground],
        [colors.card, colors.cardForeground],
        [colors.primary, colors.onPrimary],
        [colors.accent, colors.onAccent],
      ]);
      for (const pair of entry.pairs) {
        assert.equal(
          pair.ink,
          allowed.get(pair.fill),
          `${entry.id}: ${pair.label} puts ink on a fill the preset did not pair it with`,
        );
      }
    }
  });

  it('shows no colours for a direction that has none', () => {
    // Sixteen of these are surface treatments any palette can wear, left
    // open on purpose. Inventing swatches would show a choice the builder
    // does not make.
    for (const entry of catalogue()) {
      const preset = STYLE_PRESETS.find((each) => each.id === entry.id);
      assert.equal(
        entry.pairs === null,
        preset?.tokens === undefined,
        `${entry.id} disagrees with its preset about having a palette`,
      );
    }
  });

  it('finds the directions that do carry a palette', () => {
    const withColour = withPalettes(catalogue());
    assert.ok(withColour.length > 0, 'no direction shows any colour at all');
    assert.ok(
      withColour.length < catalogue().length,
      'every direction claims a palette, which would mean the split is gone',
    );
    for (const entry of withColour) assert.ok(entry.pairs);
  });
});
