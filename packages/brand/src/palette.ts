/**
 * The Vibld palette, and the pairings that are allowed to carry text.
 *
 * One definition for both sites. Before this existed, vibld.com shipped a
 * warm orange system in oklch and app.vibld.com shipped a purple one in hsl,
 * with different logos, which BRAND-01 (docs/decisions.md) explicitly
 * forbids: the name, the mark and the colour have to be the same everywhere
 * or they are not an entity signal at all.
 *
 * The direction is "Signal" (2026-09-27, replacing "Offset" of 2026-09-16):
 * one vermilion signal on graphite and chalk, taken from the approved "Live
 * Build" mockup. The mark keeps Offset's geometry, one chevron printed twice
 * out of register; only its inks changed.
 *
 * **Every ratio in `PAIRINGS` below was measured, not estimated**, with this
 * repository's own contrast checker (`@vibld/ai`'s `contrastRatio`), and the
 * test beside this file recomputes all of them. That matters more than usual
 * here, because the headline finding is easy to get wrong in both directions:
 * vermilion on chalk is 3.05. That clears the 3:1 large-text bar by five
 * hundredths and fails the 4.5 body bar, which is exactly the margin that
 * reads as "fine" in a mockup and fails the first time a heading wraps into a
 * paragraph or a monitor is a little brighter. The brand's most recognisable
 * colour is therefore an ink for the mark and for fills, and never a text
 * colour, at any size.
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

/**
 * The three inks the direction is built from.
 *
 * Each triple was chosen so that `oklchToHex` lands exactly on the mockup's
 * hex (`#FF4A1C`, `#121418`, `#F4F4F1`), rather than the other way round: the
 * mockup is what was approved, and oklch is the encoding.
 */
export const VERMILION: Oklch = {
  l: 0.666,
  c: 0.224,
  h: 34.3,
  hex: '#ff4a1c',
};
export const GRAPHITE: Oklch = { l: 0.191, c: 0.009, h: 264, hex: '#121418' };
export const CHALK: Oklch = { l: 0.966, c: 0.004, h: 106, hex: '#f4f4f1' };

/**
 * The tokens each theme resolves to.
 *
 * `accent` is vermilion in both, because the mark and the fills are the
 * constant. `accentInk` is the colour a link or the wordmark is set in, and
 * it changes: a deepened vermilion reads on chalk (5.10) and sinks on a dark
 * ground (3.41), so dark flips to a lightened one (7.87).
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
   * **Vermilion is always the ghost**, in both themes, which is what makes it
   * the colour people recognise: it is the one that does not change.
   * `markInk` is the stroke the shape's legibility rests on and is the one
   * that has to clear the 3:1 non-text bar, and it changes with the ground:
   * graphite on chalk (16.73), the dark ink on a dark ground (16.48).
   * Vermilion alone against chalk is 3.05, which clears that bar by a margin
   * no rendering can be trusted to keep, and against the raised panel it is
   * 2.86, which does not clear it at all. A mark drawn in vermilion only is
   * a mark that disappears somewhere.
   *
   * This is also why the single-ink fallback is drawn in `markInk`. A
   * monochrome favicon throws the overprint away, and falling back to the
   * ghost would leave the weakest of the two strokes.
   */
  markInk: Oklch;
  markOffset: Oklch;
  /**
   * How the two impressions combine on this theme's ground.
   *
   * Not a stylistic choice: `multiply` darkens, which is what overprinting
   * ink on paper does and why it is right on chalk. On a dark ground it is
   * wrong in a way that is easy to ship and hard to see in a diff, because
   * multiplying a near-white impression with a near-black ground gives the
   * ground. The mark did exactly that: it was all but invisible in dark mode
   * until somebody looked at a screenshot.
   *
   * `screen` is the same operation reflected, and it is what a light ink on a
   * dark ground needs.
   */
  markBlend: 'multiply' | 'screen';
}

/**
 * A warm near-black, as the mockup sets it on its vermilion buttons, rather
 * than graphite. Both would pass (5.81 against 5.49); this one has the
 * margin. The same value in both themes, because the fill it sits on does not
 * change either, and that is the point of naming it: a component that reaches
 * for the theme's ink instead gets a near-white label in dark mode, at 2.89.
 */
const ON_VERMILION: Oklch = { l: 0.158, c: 0.02, h: 46, hex: '#140a06' };

export const LIGHT: Theme = {
  paper: CHALK,
  surface: { l: 1, c: 0, h: 0, hex: '#ffffff' },
  surfaceStrong: { l: 0.944, c: 0.007, h: 116, hex: '#ecede8' },
  ink: GRAPHITE,
  inkMuted: { l: 0.426, c: 0.015, h: 260, hex: '#4a4f57' },
  accent: VERMILION,
  accentInk: { l: 0.537, c: 0.187, h: 33.7, hex: '#c2310d' },
  onAccent: ON_VERMILION,
  markInk: GRAPHITE,
  markOffset: VERMILION,
  markBlend: 'multiply',
};

export const DARK: Theme = {
  paper: { l: 0.168, c: 0.004, h: 264, hex: '#0e0f11' },
  surface: { l: 0.208, c: 0.007, h: 258, hex: '#16181b' },
  surfaceStrong: { l: 0.242, c: 0.009, h: 256, hex: '#1d2024' },
  ink: { l: 0.948, c: 0.007, h: 107, hex: '#eeeee9' },
  inkMuted: { l: 0.746, c: 0.01, h: 258, hex: '#a9adb3' },
  accent: VERMILION,
  accentInk: { l: 0.742, c: 0.16, h: 36, hex: '#ff8260' },
  onAccent: ON_VERMILION,
  markInk: { l: 0.948, c: 0.007, h: 107, hex: '#eeeee9' },
  markOffset: VERMILION,
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
 *
 * The figure after each is what the checker measures today, so a reader can
 * see the margin without running anything; the test is what keeps it true.
 */
export const PAIRINGS: Pairing[] = [
  {
    // 16.73
    what: 'body text on paper',
    foreground: LIGHT.ink,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    // 18.44
    what: 'body text on surface',
    foreground: LIGHT.ink,
    background: LIGHT.surface,
    minimum: 4.5,
  },
  {
    // 15.67
    what: 'body text on the raised surface',
    foreground: LIGHT.ink,
    background: LIGHT.surfaceStrong,
    minimum: 4.5,
  },
  {
    // 7.48
    what: 'muted text on paper',
    foreground: LIGHT.inkMuted,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    // 8.24
    what: 'muted text on surface',
    foreground: LIGHT.inkMuted,
    background: LIGHT.surface,
    minimum: 4.5,
  },
  {
    // 7.01
    what: 'muted text on the raised surface',
    foreground: LIGHT.inkMuted,
    background: LIGHT.surfaceStrong,
    minimum: 4.5,
  },
  {
    // 5.10
    what: 'a link on paper',
    foreground: LIGHT.accentInk,
    background: LIGHT.paper,
    minimum: 4.5,
  },
  {
    // 5.81, and the same in dark: neither the fill nor the ink on it moves.
    what: 'text on an accent fill',
    foreground: LIGHT.onAccent,
    background: LIGHT.accent,
    minimum: 4.5,
  },
  {
    // 16.48
    what: 'dark body text on paper',
    foreground: DARK.ink,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    // 15.28
    what: 'dark body text on surface',
    foreground: DARK.ink,
    background: DARK.surface,
    minimum: 4.5,
  },
  {
    // 14.05
    what: 'dark body text on the raised surface',
    foreground: DARK.ink,
    background: DARK.surfaceStrong,
    minimum: 4.5,
  },
  {
    // 8.51
    what: 'dark muted text on paper',
    foreground: DARK.inkMuted,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    // 7.89
    what: 'dark muted text on surface',
    foreground: DARK.inkMuted,
    background: DARK.surface,
    minimum: 4.5,
  },
  {
    // 7.25
    what: 'dark muted text on the raised surface',
    foreground: DARK.inkMuted,
    background: DARK.surfaceStrong,
    minimum: 4.5,
  },
  {
    // 7.87
    what: 'a dark-mode link on paper',
    foreground: DARK.accentInk,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    // 16.73
    what: "the mark's load-bearing stroke on paper",
    foreground: LIGHT.markInk,
    background: LIGHT.paper,
    minimum: 3,
  },
  {
    // 16.48
    what: "the mark's load-bearing stroke on dark paper",
    foreground: DARK.markInk,
    background: DARK.paper,
    minimum: 3,
  },
  {
    // 16.73. The favicon, the touch icon and the builder's logo tile.
    what: "the mark's chalk stroke on a graphite tile",
    foreground: CHALK,
    background: GRAPHITE,
    minimum: 3,
  },
  {
    // 16.73
    what: 'the social card wordmark on a graphite ground',
    foreground: CHALK,
    background: GRAPHITE,
    minimum: 4.5,
  },
  {
    // 7.56. Set at 40px, so large text, but it clears the body bar anyway.
    what: 'the social card tagline on a graphite ground',
    foreground: DARK.accentInk,
    background: GRAPHITE,
    minimum: 3,
  },
];

/**
 * Pairings the brand explicitly refuses, and the test asserts still fail.
 *
 * A rule nobody can measure is a rule nobody keeps. These are the ones that
 * look reasonable and are not. Vermilion is the brand's colour and the
 * obvious thing to set a heading in; chalk or white is the obvious thing to
 * put on a vermilion button; and a component that sets its text to the
 * theme's ink puts a near-white label on a vermilion fill the moment the
 * reader is in dark mode.
 *
 * The first three carry a 4.5 minimum rather than 3 because 3 is not what
 * they fail. Vermilion on chalk measures 3.05 and white on vermilion 3.36:
 * both clear the large-text bar and both fail body text. They are refused
 * at the bar they fail, and the brand guide refuses them at every size,
 * because a margin of five hundredths is not a margin.
 */
export const REFUSED: Pairing[] = [
  {
    // 3.05
    what: 'vermilion as a text colour on chalk',
    foreground: VERMILION,
    background: CHALK,
    minimum: 4.5,
  },
  {
    // 3.36
    what: 'white text on a vermilion fill',
    foreground: LIGHT.surface,
    background: VERMILION,
    minimum: 4.5,
  },
  {
    // 3.05
    what: 'chalk text on a vermilion fill',
    foreground: CHALK,
    background: VERMILION,
    minimum: 4.5,
  },
  {
    // 2.86: on the raised panel it fails even the large-text bar.
    what: 'vermilion as a text colour on the raised surface',
    foreground: VERMILION,
    background: LIGHT.surfaceStrong,
    minimum: 3,
  },
  {
    // 2.89
    what: "the dark theme's ink on a vermilion fill",
    foreground: DARK.ink,
    background: VERMILION,
    minimum: 3,
  },
  {
    // 2.45
    what: 'muted text on a vermilion fill',
    foreground: LIGHT.inkMuted,
    background: VERMILION,
    minimum: 3,
  },
  {
    // 3.41: the light link ink, left unflipped on a dark ground.
    what: "the light theme's link ink on dark paper",
    foreground: LIGHT.accentInk,
    background: DARK.paper,
    minimum: 4.5,
  },
  {
    // 2.21: the dark link ink, leaked into the light theme.
    what: "the dark theme's link ink on chalk",
    foreground: DARK.accentInk,
    background: CHALK,
    minimum: 3,
  },
];
