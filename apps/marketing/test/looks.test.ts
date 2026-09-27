import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { contrastRatio } from '@vibld/ai/contrast';
import { STYLE_PRESETS } from '@vibld/ai/style-presets';

import { DEMO_SITE_IDS } from '../app/demo-sites.ts';
import {
  DEMO_PALETTE,
  backdrops,
  presetLooks,
  specLook,
} from '../app/looks.ts';
import type { Look } from '../app/looks.ts';
import { blend } from './blend.ts';

/**
 * The colours every miniature site is drawn in (app/looks.ts).
 *
 * Three rules, one per source. A preset with a palette is drawn only in the
 * pairs `packages/ai` verifies for it. A treatment without one is drawn in
 * the demonstration palette and nothing else. And every pair, whatever its
 * source, clears 4.5:1 here, including text on glass, which is measured on
 * the glass composited over each colour the stylesheet can put behind it.
 */

const MINIATURE_CSS = readFileSync(
  join(import.meta.dirname, '..', 'app', 'styles', 'miniature.css'),
  'utf8',
);

function ratio(foreground: string, background: string): number {
  const value = contrastRatio(foreground, background);
  assert.ok(value !== null, `unparseable: ${foreground} on ${background}`);
  return value;
}

/** Every (ink, fill) pair a look sets text in, labelled. */
function textPairs(look: Look): [string, string, string][] {
  const c = look.colors;
  return [
    ['ink on page', c.page.ink, c.page.fill],
    ['soft ink on page', c.page.soft, c.page.fill],
    ['ink on card', c.card.ink, c.card.fill],
    ['soft ink on card', c.card.soft, c.card.fill],
    ['ink on panel', c.panel.ink, c.panel.fill],
    ['soft ink on panel', c.panel.soft, c.panel.fill],
    ['ink on primary', c.primary.ink, c.primary.fill],
    ['ink on accent', c.accent.ink, c.accent.fill],
  ];
}

const ALL_LOOKS: Look[] = [
  ...presetLooks(),
  ...DEMO_SITE_IDS.map((site) => specLook(site)),
];

describe('which looks exist', () => {
  it('draws every preset the builder knows, in its order', () => {
    assert.deepEqual(
      presetLooks().map((look) => look.id),
      STYLE_PRESETS.map((preset) => preset.id),
    );
  });

  it('has a hand-built treatment in the stylesheet for every preset', () => {
    // A preset with no rule of its own would render as the plain spec site
    // under that preset's name, which is a preview of nothing.
    for (const preset of STYLE_PRESETS) {
      assert.ok(
        MINIATURE_CSS.includes(`.ms[data-look='${preset.id}']`),
        `${preset.id} has no treatment in miniature.css`,
      );
    }
  });

  it('draws glass only where the contrast test knows there is glass', () => {
    // The stylesheet reads --s-glass for a translucent panel. A treatment
    // that uses it with no opacity recorded in looks.ts would be glass whose
    // text nobody measured.
    for (const look of presetLooks()) {
      const start = MINIATURE_CSS.indexOf(`.ms[data-look='${look.id}'] {`);
      const rule = MINIATURE_CSS.slice(
        start,
        MINIATURE_CSS.indexOf('}', start),
      );
      if (rule.includes('var(--s-glass)')) {
        assert.ok(look.glass !== null, `${look.id} is glass with no opacity`);
      }
    }
  });
});

describe('the colours a look is drawn in', () => {
  it('uses only the pairs a preset’s own tests verify, for a preset with a palette', () => {
    // The rule catalogue.ts states, applied to a whole drawing rather than
    // four swatches. These are the pairs packages/ai's style-tokens test
    // measures; anything else would be this site inventing a pairing on
    // somebody else's palette.
    for (const look of presetLooks().filter((l) => l.source === 'preset')) {
      const c = STYLE_PRESETS.find((p) => p.id === look.id)!.tokens!.colors;
      const verified = new Set(
        [
          [c.foreground, c.background],
          [c.cardForeground, c.card],
          [c.mutedForeground, c.muted],
          [c.mutedForeground, c.background],
          [c.onPrimary, c.primary],
          [c.onSecondary, c.secondary],
          [c.onAccent, c.accent],
          [c.onDestructive, c.destructive],
        ].map(([ink, fill]) => `${ink}/${fill}`),
      );
      for (const [what, ink, fill] of textPairs(look)) {
        // A card's quiet text is its own foreground, which is the same pair.
        assert.ok(
          verified.has(`${ink}/${fill}`),
          `${look.id}: ${what} (${ink} on ${fill}) is not a pair the preset verifies`,
        );
      }
      const own = new Set(Object.values(c));
      for (const hue of look.colors.deco) {
        assert.ok(own.has(hue), `${look.id}: decoration ${hue} is not its own`);
      }
    }
  });

  it('uses the demonstration palette, and only it, for a treatment', () => {
    for (const look of presetLooks()) {
      const preset = STYLE_PRESETS.find((p) => p.id === look.id)!;
      assert.equal(
        look.source === 'demo',
        preset.tokens === undefined,
        `${look.id} disagrees with its preset about having a palette`,
      );
      if (look.source === 'demo') {
        assert.equal(look.colors, DEMO_PALETTE[look.ground]);
      }
    }
  });

  for (const look of ALL_LOOKS) {
    const label = look.source === 'site' ? `the spec look` : look.id;
    it(`sets every text pair at 4.5:1: ${label} (${look.source}, ${look.colors.page.fill})`, () => {
      for (const [what, ink, fill] of textPairs(look)) {
        const value = ratio(ink, fill);
        assert.ok(
          value >= 4.5,
          `${look.id}: ${what} is ${value.toFixed(2)} (${ink} on ${fill})`,
        );
      }
    });
  }

  it('keeps text on glass legible over everything that shows through it', () => {
    // Blur mixes the backdrop, so its colour under any point lies between
    // the colours drawn there. Measuring the panel over each pure colour is
    // the worst case of that mix, not an average of it.
    const glassy = presetLooks().filter((look) => look.glass !== null);
    assert.ok(
      glassy.length >= 3,
      'no glass looks found, so this checks nothing',
    );
    for (const look of glassy) {
      for (const under of backdrops(look)) {
        const fill = blend(look.colors.card.fill, look.glass!, under);
        for (const ink of [look.colors.card.ink, look.colors.card.soft]) {
          const value = ratio(ink, fill);
          assert.ok(
            value >= 4.5,
            `${look.id}: ${ink} on glass over ${under} is ${value.toFixed(2)}`,
          );
        }
      }
    }
  });

  it('keeps page text legible inside a treatment’s glow', () => {
    for (const look of presetLooks().filter((l) => l.glow !== null)) {
      for (const hue of look.colors.deco) {
        const fill = blend(hue, look.glow!, look.colors.page.fill);
        for (const ink of [look.colors.page.ink, look.colors.page.soft]) {
          const value = ratio(ink, fill);
          assert.ok(
            value >= 4.5,
            `${look.id}: ${ink} in the ${hue} glow is ${value.toFixed(2)}`,
          );
        }
      }
    }
  });
});
