/**
 * The Vibld palette, and the pairings that are allowed to carry text.
 *
 * One definition for both sites. Before this existed, vibld.com shipped a
 * warm orange system in oklch and app.vibld.com shipped a purple one in hsl,
 * with different logos, which BRAND-01 (docs/decisions.md) explicitly
 * forbids: the name, the mark and the colour have to be the same everywhere
 * or they are not an entity signal at all.
 *
 * The direction is "Offset" (Chris, 2026-09-16): two flat inks overprinting
 * slightly out of register, the way cheap two-colour printing does. Coral and
 * ultramarine are the two inks; newsprint is the stock they print on.
 *
 * **Every ratio in `PAIRINGS` below was measured, not estimated**, with this
 * repository's own contrast checker (`@vibld/ai`'s `contrastRatio`), and the
 * test beside this file recomputes all of them. That matters more than usual
 * here, because the headline finding is counterintuitive: coral on newsprint
 * is 2.60, which fails even the large-text bar. The brand's most recognisable
 * colour cannot carry text on the brand's own background, so it is an ink for
 * the mark and for fills, and never a text colour.
 */

/**
 * An oklch triple, kept as numbers so it can be measured and re-emitted.
 *
 * `hex` is the same colour in a form older renderers understand, not a second
 * decision: the test beside this file recomputes each one with `oklchToHex`
 * and fails if they disagree. It exists because the first social card this
 * palette produced came out **entirely black**: librsvg, which rasterises the
 * PNGs, does not parse `oklch()` and falls back to black rather than failing.
 * Anything drawn outside a browser has to use `hex`.
 */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  hex: string;
}

export function oklch({ l, c, h }: Oklch): string {
  return `oklch(${l} ${c} ${h})`;
}

/** The three inks the direction is built from. */
export const CORAL: Oklch = { l: 0.7, c: 0.18, h: 25, hex: '#fa6863' };
export const ULTRAMARINE: Oklch = { l: 0.45, c: 0.16, h: 265, hex: '#284cac' };
export const NEWSPRINT: Oklch = { l: 0.96, c: 0.012, h: 90, hex: '#f5f2e9' };

/**
 * The tokens each theme resolves to.
 *
 * `accent` is coral in both, because the mark and the fills are the constant.
 * `accentInk` is the colour a link or the wordmark is set in, and it changes:
 * ultramarine reads on newsprint (6.90) and disappears on a dark ground, so
 * dark flips to a lightened coral (8.49).
 */
export interface Theme {
  paper: Oklch;
  surface: Oklch;
  /**
   * A third step, for interfaces that stack panels rather than lay out a
   * page. The builder needs it; a marketing page mostly does not.
   */
  surfaceStrong: Oklch;
  ink: Oklch;
  inkMuted: Oklch;
  accent: Oklch;
  accentInk: Oklch;
  /** The only text colour allowed on an `accent` fill. */
  onAccent: Oklch;
  /**
   * The mark is one chevron printed twice, slightly out of register. These
   * are the two inks, and which is which flips between themes.
   *
   * **Coral is always the ghost**, in both themes, which is what makes it the
   * colour people recognise: it is the one that does not change. `markInk` is
   * the stroke the shape's legibility rests on and is the one that has to
   * clear the 3:1 non-text bar, and it changes with the ground: ultramarine
   * on newsprint (6.90), newsprint on a dark ground (16.82). Coral alone
   * against newsprint is 2.60, so a mark drawn in coral only is not a mark.
   *
   * This is also why the single-ink fallback is drawn in `markInk`. A
   * monochrome favicon throws the overprint away, and falling back to the
   * ghost would leave a mark nobody can see.
   */
  markInk: Oklch;
  markOffset: Oklch;
  /**
   * How the two impressions combine on this theme's ground.
   *
   * Not a stylistic choice: `multiply` darkens, which is what overprinting
   * ink on paper does and why it is right on newsprint. On a dark ground it
   * is wrong in a way that is easy to ship and hard to see in a diff, because
   * multiplying a near-white impression with a near-black ground gives the
   * ground. The mark did exactly that: it was all but invisible in dark mode
   * until somebody looked at a screenshot.
   *
   * `screen` is the same operation reflected, and it is what a light ink on a
   * dark ground needs.
   */
  markBlend: 'multiply' | 'screen';
}

export const LIGHT: Theme = {
  paper: NEWSPRINT,
  surface: { l: 0.93, c: 0.014, h: 90, hex: '#ebe8de' },
  surfaceStrong: { l: 0.9, c: 0.016, h: 90, hex: '#e2ded2' },
  ink: { l: 0.22, c: 0.03, h: 265, hex: '#141a29' },
  inkMuted: { l: 0.48, c: 0.02, h: 265, hex: '#585e69' },
  accent: CORAL,
  accentInk: ULTRAMARINE,
  onAccent: { l: 0.22, c: 0.03, h: 265, hex: '#141a29' },
  markInk: ULTRAMARINE,
  markOffset: CORAL,
  markBlend: 'multiply',
};

export const DARK: Theme = {
  paper: { l: 0.18, c: 0.035, h: 265, hex: '#0a1121' },
  surface: { l: 0.22, c: 0.035, h: 265, hex: '#131a2b' },
  surfaceStrong: { l: 0.26, c: 0.035, h: 265, hex: '#1c2435' },
  ink: NEWSPRINT,
  inkMuted: { l: 0.72, c: 0.02, h: 265, hex: '#9ea5b2' },
  accent: CORAL,
  accentInk: { l: 0.78, c: 0.15, h: 25, hex: '#ff8e86' },
  onAccent: { l: 0.22, c: 0.03, h: 265, hex: '#141a29' },
  markInk: NEWSPRINT,
  markOffset: CORAL,
  markBlend: 'screen',
};

/** A text-on-background pair the brand claims is legible, and the bar it must clear. */
export interface Pairing {
  what: string;
  foreground: Oklch;
  background: Oklch;
  /** 4.5 for body text, 3 for large text and non-text UI edges. */
  minimum: number;
}

/**
 * Every pairing either site is allowed to use, as a list a test can walk.
 *
 * A palette is a set of claims about legibility. Written down as hex values in
 * a stylesheet, those claims are unfalsifiable and rot the first time somebody
 * nudges a lightness. Written down here, they are checked on every run.
 */
export const PAIRINGS: Pairing[] = [
  {
    what: 'body text on paper',
    foreground: LIGHT.ink,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    what: 'body text on surface',
    foreground: LIGHT.ink,
    background: LIGHT.surface,
    minimum: 4.5,
  },
  {
    what: 'body text on the raised surface',
    foreground: LIGHT.ink,
    background: LIGHT.surfaceStrong,
    minimum: 4.5,
  },
  {
    what: 'muted text on paper',
    foreground: LIGHT.inkMuted,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    what: 'a link on paper',
    foreground: LIGHT.accentInk,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    what: 'text on an accent fill',
    foreground: LIGHT.onAccent,
    background: LIGHT.accent,
    minimum: 4.5,
  },
  {
    what: 'text on an ultramarine fill',
    foreground: NEWSPRINT,
    background: ULTRAMARINE,
    minimum: 4.5,
  },
  {
    what: 'dark body text on paper',
    foreground: DARK.ink,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    what: 'dark body text on surface',
    foreground: DARK.ink,
    background: DARK.surface,
    minimum: 4.5,
  },
  {
    what: 'dark body text on the raised surface',
    foreground: DARK.ink,
    background: DARK.surfaceStrong,
    minimum: 4.5,
  },
  {
    what: 'dark muted text on paper',
    foreground: DARK.inkMuted,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    what: 'a dark-mode link on paper',
    foreground: DARK.accentInk,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    what: 'the social card tagline on an ultramarine ground',
    foreground: DARK.accentInk,
    background: ULTRAMARINE,
    minimum: 3,
  },
  {
    what: "the mark's load-bearing stroke on paper",
    foreground: LIGHT.markInk,
    background: LIGHT.paper,
    minimum: 3,
  },
  {
    what: "the mark's load-bearing stroke on dark paper",
    foreground: DARK.markInk,
    background: DARK.paper,
    minimum: 3,
  },
];

/**
 * Pairings the brand explicitly refuses, and the test asserts still fail.
 *
 * A rule nobody can measure is a rule nobody keeps. These are the two that
 * look reasonable and are not: coral is the brand's colour and the obvious
 * thing to set a heading in, and newsprint is the obvious thing to put on a
 * coral button. Both are illegible, both at 2.60.
 */
export const REFUSED: Pairing[] = [
  {
    what: 'coral as a text colour on newsprint',
    foreground: CORAL,
    background: NEWSPRINT,
    minimum: 3,
  },
  {
    what: 'newsprint text on a coral fill',
    foreground: NEWSPRINT,
    background: CORAL,
    minimum: 3,
  },
  {
    what: 'ink on an ultramarine fill',
    foreground: LIGHT.ink,
    background: ULTRAMARINE,
    minimum: 3,
  },
  {
    what: 'coral as a text colour on an ultramarine fill',
    foreground: CORAL,
    background: ULTRAMARINE,
    minimum: 3,
  },
];
