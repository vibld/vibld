/**
 * A full semantic token set, derived from a seed and verified as it is built.
 *
 * `palettes.ts` hand-writes its entries and checks them afterwards, which is
 * the right shape for a dozen curated combinations and the wrong shape for a
 * large library: at sixty entries, hand-pairing fifteen tokens apiece is
 * nine hundred chances to ship an unreadable pair, and the check that finds
 * one only tells you it is broken.
 *
 * So the library is derived instead. A seed carries the part a person
 * actually chooses -- a hue, how saturated it is, whether the page is light
 * or dark, and how the supporting hues are placed around it -- and
 * everything else is solved from it. Every colour that carries text is found
 * by `shadeAgainst`, which moves lightness until the pair clears its ratio,
 * so a failing pair is not something this can emit: either the seed derives
 * with every pair passing, or `derivePalette` returns null and the seed is
 * refused.
 *
 * That is also what lets a reference URL feed the same machinery. A site's
 * dominant colour is just another hue and saturation, so a palette extracted
 * from a page and a palette chosen from the library are the same object,
 * built by the same function, with the same guarantee behind them.
 */

import { AA_LARGE_TEXT, AA_NORMAL_TEXT, contrastRatio } from './contrast.ts';
import {
  hexToHsl,
  hslToHex,
  normaliseHue,
  readableOn,
  shadeAgainst,
  shiftLightness,
} from './color-space.ts';

/** How the supporting hues are placed relative to the seed's own. */
export type PaletteScheme = 'analogous' | 'complementary' | 'split' | 'triadic';

export type PaletteMode = 'light' | 'dark';

export interface PaletteSeed {
  id: string;
  /** Shown to a person choosing one. */
  name: string;
  /** Degrees on the colour wheel, 0 to 359. */
  hue: number;
  /** Percent. Below about 25 reads as a neutral, above about 85 as neon. */
  saturation: number;
  mode: PaletteMode;
  scheme: PaletteScheme;
  /** One line on where this palette belongs, for the chooser. */
  note: string;
}

/** The same token names `palettes.ts` emits, so both feed one guidance path. */
export interface PaletteColors {
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  accent: string;
  onAccent: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  destructive: string;
  onDestructive: string;
}

export interface DerivedPalette {
  id: string;
  name: string;
  note: string;
  mode: PaletteMode;
  colors: PaletteColors;
}

const SCHEME_ROTATION: Record<PaletteScheme, [number, number]> = {
  analogous: [32, -28],
  complementary: [180, 152],
  split: [150, 210],
  triadic: [120, 240],
};

/**
 * Body text aims far above the minimum. 4.5 is the floor for passing, not a
 * target to sit on: text set exactly at the floor is legal and tiring, and
 * the solver returns the least extreme shade that clears whatever it is
 * given, so the number here is the one that decides how comfortable the page
 * reads.
 */
const BODY_TEXT_RATIO = 11;

/**
 * The ratio a filled control needs against the page behind it. This is the
 * non-text threshold, because what it buys is the button being visible as a
 * shape; the label on it is solved separately at the text threshold.
 */
const FILL_RATIO = AA_LARGE_TEXT;

/** Red for destructive actions, kept off the seed's own hue on purpose. */
const DESTRUCTIVE_HUE = 6;

function surfaces(seed: PaletteSeed): {
  background: string;
  card: string;
  muted: string;
} | null {
  // Not a pure grey: a neutral carrying a little of the page's own hue is
  // the difference between a palette that looks chosen and one that looks
  // defaulted.
  //
  // The numbers are where they are because the first attempt put light
  // backgrounds at lightness 97, and at 97 the channels are so close
  // together that no saturation survives: six different hues all came out
  // within a shade of the same near-white. A cream has to be a cream, so the
  // light ground sits lower and carries more tint.
  const tint = Math.min(seed.saturation, seed.mode === 'light' ? 30 : 20);
  const background = hslToHex({
    hue: seed.hue,
    saturation: tint,
    lightness: seed.mode === 'light' ? 95.5 : 9,
  });
  const card = shiftLightness(background, seed.mode === 'light' ? 2.6 : 4);
  const muted = shiftLightness(background, seed.mode === 'light' ? -4 : 7);
  if (!card || !muted) return null;
  return { background, card, muted };
}

/**
 * A fill of this hue that clears `FILL_RATIO` against the page and can carry
 * a readable label, or null if no lightness of it does both.
 *
 * Both halves are required together, which is why this is one function
 * rather than two calls. A fill can be perfectly visible against the page
 * and still have nothing that reads on it, and picking the fill first and
 * discovering that second is how a palette ends up with a button nobody can
 * read the label of.
 */
function fillPair(
  hue: number,
  saturation: number,
  background: string,
  mode: PaletteMode,
): { fill: string; on: string } | null {
  // Walked from the lightness a brand fill usually sits at, outwards, so the
  // first hit is the most conventional-looking one that satisfies both
  // constraints rather than whichever extreme happens to pass.
  const start = mode === 'light' ? 46 : 58;
  for (let step = 0; step <= 34; step += 2) {
    for (const lightness of [start - step, start + step]) {
      if (lightness < 14 || lightness > 88) continue;
      const fill = hslToHex({ hue, saturation, lightness });
      const against = contrastRatio(fill, background);
      if (against === null || against < FILL_RATIO) continue;
      const on = readableOn(fill, AA_NORMAL_TEXT);
      if (!on) continue;
      return { fill, on: on.color };
    }
  }
  return null;
}

/**
 * The seed solved into a complete token set, or null if it cannot be.
 *
 * Null is a real outcome rather than a fallback: a seed that cannot produce
 * a readable page should not produce an unreadable one instead. Every seed
 * shipped in the library is asserted to derive, so a null here in production
 * means a caller supplied the seed, and a caller-supplied seed that will not
 * solve is exactly the thing that should be refused.
 */
export function derivePalette(seed: PaletteSeed): DerivedPalette | null {
  const ground = surfaces(seed);
  if (!ground) return null;
  const { background, card, muted } = ground;

  const [secondaryRotation, accentRotation] = SCHEME_ROTATION[seed.scheme];
  const secondaryHue = normaliseHue(seed.hue + secondaryRotation);
  const accentHue = normaliseHue(seed.hue + accentRotation);

  const primary = fillPair(seed.hue, seed.saturation, background, seed.mode);
  const secondary = fillPair(
    secondaryHue,
    Math.max(18, seed.saturation - 26),
    background,
    seed.mode,
  );
  // Capped rather than boosted. Raising the accent's saturation above the
  // seed's was the first version and it produced neon: a split or
  // complementary rotation off an already-saturated hue lands somewhere
  // vivid on its own, and adding to it gave every palette a colour that
  // fought the primary instead of supporting it.
  const accent = fillPair(
    accentHue,
    Math.min(seed.saturation, 74),
    background,
    seed.mode,
  );
  const destructive = fillPair(DESTRUCTIVE_HUE, 68, background, seed.mode);
  if (!primary || !secondary || !accent || !destructive) return null;

  // Text is tinted with the page's hue at low saturation, so body copy on a
  // warm page is warm rather than a grey borrowed from somewhere else.
  const textSaturation = Math.min(seed.saturation, 22);
  const foreground = shadeAgainst(
    seed.hue,
    textSaturation,
    background,
    BODY_TEXT_RATIO,
  );
  const cardForeground = shadeAgainst(
    seed.hue,
    textSaturation,
    card,
    BODY_TEXT_RATIO,
  );
  const mutedForeground = shadeAgainst(
    seed.hue,
    textSaturation,
    background,
    AA_NORMAL_TEXT,
  );
  if (!foreground || !cardForeground || !mutedForeground) return null;

  // A hairline, not text: it only has to be seen, so it is solved at the
  // non-text threshold against the surface it divides.
  const border = shadeAgainst(seed.hue, textSaturation, background, 1.9);
  if (!border) return null;

  return {
    id: seed.id,
    name: seed.name,
    note: seed.note,
    mode: seed.mode,
    colors: {
      primary: primary.fill,
      onPrimary: primary.on,
      secondary: secondary.fill,
      onSecondary: secondary.on,
      accent: accent.fill,
      onAccent: accent.on,
      background,
      foreground,
      card,
      cardForeground,
      muted,
      mutedForeground,
      border,
      destructive: destructive.fill,
      onDestructive: destructive.on,
    },
  };
}

/** Every pair a derived palette promises, named, for tests to walk. */
export const REQUIRED_PAIRS: readonly {
  readonly foreground: keyof PaletteColors;
  readonly background: keyof PaletteColors;
  readonly ratio: number;
}[] = [
  { foreground: 'foreground', background: 'background', ratio: AA_NORMAL_TEXT },
  {
    foreground: 'mutedForeground',
    background: 'background',
    ratio: AA_NORMAL_TEXT,
  },
  { foreground: 'cardForeground', background: 'card', ratio: AA_NORMAL_TEXT },
  { foreground: 'onPrimary', background: 'primary', ratio: AA_NORMAL_TEXT },
  { foreground: 'onSecondary', background: 'secondary', ratio: AA_NORMAL_TEXT },
  { foreground: 'onAccent', background: 'accent', ratio: AA_NORMAL_TEXT },
  {
    foreground: 'onDestructive',
    background: 'destructive',
    ratio: AA_NORMAL_TEXT,
  },
  { foreground: 'primary', background: 'background', ratio: AA_LARGE_TEXT },
  { foreground: 'destructive', background: 'background', ratio: AA_LARGE_TEXT },
];

/** Which of `REQUIRED_PAIRS` this palette fails, empty when it is sound. */
export function paletteFailures(palette: DerivedPalette): string[] {
  const problems: string[] = [];
  for (const pair of REQUIRED_PAIRS) {
    const fg = palette.colors[pair.foreground];
    const bg = palette.colors[pair.background];
    const measured = contrastRatio(fg, bg);
    if (measured === null) {
      problems.push(
        `${pair.foreground} or ${pair.background} is not a hex value`,
      );
      continue;
    }
    if (measured < pair.ratio) {
      problems.push(
        `${pair.foreground} on ${pair.background} is ${measured.toFixed(2)}:1, below ${pair.ratio}`,
      );
    }
  }
  return problems;
}

/**
 * A seed built from a colour someone already has, for the reference-URL path.
 *
 * The mode is read from the colour's own lightness rather than asked for: a
 * site whose dominant colour is dark is a dark site, and making the caller
 * state separately what the colour already says is a question with one
 * correct answer.
 */
export function seedFromHex(
  hex: string,
  id: string,
  name: string,
  note: string,
  scheme: PaletteScheme = 'analogous',
): PaletteSeed | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return {
    id,
    name,
    note,
    hue: hsl.hue,
    // Floored, because a near-grey source colour would otherwise derive a
    // palette with no colour in it at all, and raised no higher than the
    // source so a muted brand stays muted.
    saturation: Math.max(28, Math.min(92, hsl.saturation)),
    mode: hsl.lightness < 42 ? 'dark' : 'light',
    scheme,
  };
}

/**
 * The CSS a derived palette becomes, as the model is asked to write it.
 *
 * Same token names and same shape as `paletteGuidance` in `palettes.ts`, so
 * whichever source supplied the colours the model sees one format and the
 * generated `src/styles.css` looks the same either way.
 *
 * The wording is firmer than the product-type default's, and deliberately.
 * A keyword-matched palette is a guess and says so ("in the absence of a
 * stated palette"); this one was derived from a page the user chose, which
 * is the strongest signal short of them typing hex values.
 */
export function paletteCss(palette: DerivedPalette): string {
  const c = palette.colors;
  return `:root {
  --background: ${c.background}; --foreground: ${c.foreground};
  --card: ${c.card}; --card-foreground: ${c.cardForeground};
  --muted: ${c.muted}; --muted-foreground: ${c.mutedForeground};
  --primary: ${c.primary}; --primary-foreground: ${c.onPrimary};
  --secondary: ${c.secondary}; --secondary-foreground: ${c.onSecondary};
  --accent: ${c.accent}; --accent-foreground: ${c.onAccent};
  --border: ${c.border};
  --destructive: ${c.destructive}; --destructive-foreground: ${c.onDestructive};
}`;
}

/**
 * The section a reference-derived palette contributes to the prompt.
 *
 * Every pair in it has already been solved against WCAG AA, which is why the
 * instruction is to use these values rather than to be inspired by them: the
 * guarantee only holds if the numbers survive. A model that "adjusts" them
 * is re-opening exactly the question this package spent a contrast solver
 * answering.
 */
export function referencePaletteGuidance(palette: DerivedPalette): string {
  return `Colour palette for this build, derived from the reference site the
user pointed at. ${palette.note}

Use these exact values as the CSS custom properties in src/styles.css. Every
foreground and background pair here has already been checked against WCAG AA,
so use the values as given rather than adjusting them; a colour the user
actually typed in the request above still wins over any of them. This is a
${palette.mode} palette, so build the page for a ${palette.mode} ground.

${paletteCss(palette)}`;
}
