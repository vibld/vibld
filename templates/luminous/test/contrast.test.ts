import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { GLOW, type GlowTheme } from '../app/glow-palette.ts';

/**
 * Every text colour on the colour it sits on, measured with the WCAG 2
 * formula, in both themes.
 *
 * The colours are read from app/app.css itself, so this cannot drift from
 * what ships: change a token and this test measures the new value. Text
 * needs 4.5:1. Large display text, control edges, focus rings and icons need
 * 3:1, which is what WCAG asks of them.
 *
 * The formula is written out here rather than imported: the template has no
 * dependency for it, and it is fifteen lines.
 */

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

function parse(hex: string): RGBA {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  assert.ok(match, `${hex} is not a #rrggbb or #rrggbbaa colour`);
  const n = parseInt(match[1]!, 16);
  const alpha = match[2] ? parseInt(match[2], 16) / 255 : 1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as RGB;
}

/** A translucent colour laid over an opaque one, as the browser paints it. */
function over(top: RGBA, under: RGB): RGB {
  return mix(under, [top[0], top[1], top[2]], top[3]);
}

function luminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = Math.min(255, Math.max(0, v)) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!;
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/* ------------------------------------------------------------------ */

const css = readFileSync(
  join(import.meta.dirname, '..', 'app', 'app.css'),
  'utf8',
);

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /--([a-z0-9-]+):\s*(#[^;]+);/g,
  )) {
    out[name!] = value!.trim();
  }
  return out;
}

const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!);
const LIGHT = tokens(blocks[0] ?? '');
const THEMES = {
  light: LIGHT,
  // The dark block only overrides; anything it leaves alone is inherited.
  dark: { ...LIGHT, ...tokens(blocks[1] ?? '') },
};

function solid(theme: Record<string, string>, name: string): RGB {
  const value = theme[name];
  assert.ok(value, `--${name} is not defined`);
  const [r, g, b, a] = parse(value);
  assert.equal(a, 1, `--${name} is translucent; measure it over something`);
  return [r, g, b];
}

function rgba(theme: Record<string, string>, name: string): RGBA {
  const value = theme[name];
  assert.ok(value, `--${name} is not defined`);
  return parse(value);
}

/**
 * Every colour the hero's WebGL field can paint, sampled densely: each blend
 * of the palette (in tenths), mixed into the ground at every strength up to
 * the maximum, with the grain pushed both ways. The shader's output always
 * lies in this set; see the comment above FRAGMENT in GlowField.tsx.
 */
function fieldSamples(glow: GlowTheme): RGB[] {
  const ground = parse(glow.ground).slice(0, 3) as RGB;
  const palette = glow.palette.map((hex) => parse(hex).slice(0, 3) as RGB);
  const blends: RGB[] = [];
  const steps = 10;
  const walk = (index: number, left: number, acc: number[]) => {
    if (index === palette.length - 1) {
      const weights = [...acc, left].map((w) => w / steps);
      blends.push(
        [0, 1, 2].map((c) =>
          palette.reduce((sum, colour, i) => sum + colour[c]! * weights[i]!, 0),
        ) as RGB,
      );
      return;
    }
    for (let w = 0; w <= left; w++) walk(index + 1, left - w, [...acc, w]);
  };
  walk(0, steps, []);

  const grain = glow.grain * 255;
  const out: RGB[] = [];
  for (const tint of blends) {
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const base = mix(ground, tint, s * glow.strength);
      out.push(base.map((v) => v - grain) as RGB);
      out.push(base.map((v) => v + grain) as RGB);
    }
  }
  return out;
}

function worst(fg: RGB, backgrounds: RGB[]): number {
  return Math.min(...backgrounds.map((bg) => contrast(fg, bg)));
}

const TEXT = 4.5;
const LARGE = 3;

/** [foreground, background, minimum] on plain surfaces. */
const PAIRS: [string, string, number][] = [
  ...['paper', 'paper-2', 'card', 'plan-warm'].flatMap(
    (bg): [string, string, number][] => [
      ['ink', bg, TEXT],
      ['ink-soft', bg, TEXT],
      ['ink-muted', bg, TEXT],
      ['ink-faint', bg, TEXT],
      ['ember-ink', bg, TEXT],
    ],
  ),
  // The pastel feature cards carry headings and body copy.
  ...['peach', 'butter', 'mint', 'blush', 'sand', 'stone'].flatMap(
    (bg): [string, string, number][] => [
      ['ink', bg, TEXT],
      ['ink-muted', bg, TEXT],
    ],
  ),
  ['teal-ink', 'card', TEXT],
  ['teal-ink', 'ic-teal-bg', TEXT], // theme tags in the sample inbox
  ['ember-ink', 'ic-ember-bg', TEXT], // the "Most teams" badge
  ['on-ink', 'ink', TEXT], // primary buttons, pressed chips
  ['on-accent', 'warm-1', TEXT], // the warm button, both ends of its gradient
  ['on-accent', 'warm-2', TEXT],
  ['ink', 'selection', TEXT],
  // Control edges and focus rings.
  ['field-edge', 'card', LARGE],
  ['field-edge', 'paper', LARGE],
  ['focus', 'paper', LARGE],
  ['focus', 'paper-2', LARGE],
  ['focus', 'card', LARGE],
  // Icons on their tinted tiles.
  ['amber-ink', 'ic-amber-bg', LARGE],
  ['ink', 'ic-ink-bg', LARGE],
  ['ic-blush-fg', 'ic-blush-bg', LARGE],
  // The dark band, which is dark in both themes.
  ...['band', 'band-card'].flatMap((bg): [string, string, number][] => [
    ['band-ink', bg, TEXT],
    ['band-muted', bg, TEXT],
    ['band-faint', bg, TEXT],
    ['band-accent', bg, TEXT],
    ['band-teal', bg, LARGE],
    ['band-amber', bg, LARGE],
    ['band-edge', bg, LARGE],
  ]),
];

for (const [name, theme] of Object.entries(THEMES) as [
  'light' | 'dark',
  Record<string, string>,
][]) {
  describe(`${name} theme contrast`, () => {
    for (const [fg, bg, min] of PAIRS) {
      it(`--${fg} on --${bg} reaches ${min}:1`, () => {
        const ratio = contrast(solid(theme, fg), solid(theme, bg));
        assert.ok(
          ratio >= min,
          `${ratio.toFixed(2)}:1 is below ${min}:1 (${theme[fg]} on ${theme[bg]})`,
        );
      });
    }

    it('keeps band text legible where the band glows', () => {
      const band = solid(theme, 'band');
      const glows = [
        over(rgba(theme, 'band-glow-ember'), band),
        over(rgba(theme, 'band-glow-teal'), band),
      ];
      for (const fg of [
        'band-ink',
        'band-muted',
        'band-faint',
        'band-accent',
      ]) {
        const ratio = worst(solid(theme, fg), glows);
        assert.ok(ratio >= TEXT, `--${fg}: ${ratio.toFixed(2)}:1 on the glow`);
      }
    });

    describe('over the hero light field', () => {
      const glow = GLOW[name];
      const field = fieldSamples(glow);

      it('paints on the same ground as the page', () => {
        assert.equal(glow.ground, theme['paper']);
      });

      it('keeps the headline, its emphasis and the lead legible', () => {
        const checks: [string, number][] = [
          ['ink', TEXT],
          ['ink-soft', TEXT],
          ['ember-ink', LARGE], // the serif italic in the headline only
        ];
        for (const [fg, min] of checks) {
          const ratio = worst(solid(theme, fg), field);
          assert.ok(ratio >= min, `--${fg}: ${ratio.toFixed(2)}:1 at worst`);
        }
      });

      it('keeps the highlighter marker legible', () => {
        const ink = solid(theme, 'ink');
        for (const marker of ['marker-1', 'marker-2']) {
          const under = field.map((c) => over(rgba(theme, marker), c));
          const ratio = worst(ink, under);
          assert.ok(ratio >= TEXT, `ink on --${marker}: ${ratio.toFixed(2)}:1`);
        }
      });

      it('keeps text on the glass panels legible', () => {
        for (const glass of ['glass', 'glass-strong']) {
          const under = field.map((c) => over(rgba(theme, glass), c));
          for (const fg of ['ink', 'ink-muted']) {
            const ratio = worst(solid(theme, fg), under);
            assert.ok(
              ratio >= TEXT,
              `--${fg} on --${glass}: ${ratio.toFixed(2)}:1 at worst`,
            );
          }
          const edge = worst(solid(theme, 'field-edge'), under);
          assert.ok(
            edge >= LARGE,
            `chip edges on --${glass}: ${edge.toFixed(2)}:1`,
          );
        }
      });
    });

    it('keeps the sticky navigation legible over the dark band', () => {
      const under = over(rgba(theme, 'glass-strong'), solid(theme, 'band'));
      for (const fg of ['ink', 'ink-muted']) {
        const ratio = contrast(solid(theme, fg), under);
        assert.ok(ratio >= TEXT, `--${fg}: ${ratio.toFixed(2)}:1`);
      }
    });
  });
}

describe('the contrast formula', () => {
  it('matches the reference values', () => {
    assert.equal(contrast([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00');
    assert.equal(contrast([255, 255, 255], [255, 255, 255]).toFixed(2), '1.00');
    // #767676 on white is the well-known 4.54:1 grey.
    assert.equal(contrast([118, 118, 118], [255, 255, 255]).toFixed(2), '4.54');
  });

  it('found both theme blocks in app.css', () => {
    assert.equal(blocks.length, 2, 'expected a light and a dark :root block');
  });
});
