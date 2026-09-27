import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePreset, StylePresetId } from '@vibld/ai/style-presets';

import { DEMO_SITES } from './demo-sites.ts';
import type { DemoSiteId } from './demo-sites.ts';

/**
 * The colours a miniature site is drawn in, and where each one came from.
 *
 * Three sources, and the difference between them is the whole point of this
 * file.
 *
 * - `preset`: a style preset that carries its own palette. Only its own
 *   pairs are used, the rule `catalogue.ts` explains: `packages/ai` verifies
 *   those pairs at 4.5:1, and this site's ink on somebody else's fill would
 *   inherit no proof at all. Decoration is drawn in the preset's own colours
 *   too, so a preview never shows a hue the preset does not have.
 * - `demo`: a surface treatment ("frosted glass") that deliberately has no
 *   palette. It is drawn in one fixed, neutral demonstration palette, and the
 *   pages that show it say so, because inventing a palette per treatment
 *   would show a choice the builder does not make.
 * - `site`: one of the invented sites the home page's demonstration builds,
 *   in the "direction A" colours its imaginary spec chose.
 *
 * Every text pair below is measured in `test/looks.test.ts` with the
 * repository's own checker, including the ones that sit on a translucent
 * panel, which are measured against the panel composited over every colour
 * that can show through it.
 */

export type LookSource = 'preset' | 'demo' | 'site';

/** A fill and the inks allowed on it. `soft` is the quieter of the two. */
export interface TextSurface {
  fill: string;
  ink: string;
  soft: string;
}

export interface LookColors {
  page: TextSurface;
  card: TextSurface;
  /** A quieter panel (a muted fill), for nav bars and chips. */
  panel: TextSurface;
  primary: { fill: string; ink: string };
  accent: { fill: string; ink: string };
  /** Hairlines between surfaces. Decorative, so not held to a text ratio. */
  line: string;
  /**
   * Shapes with no text on them: blobs, bars, illustrations. Never a text
   * colour and never under text, except through a glass panel whose
   * composite over each of these is measured. In order: the two colours of
   * an illustration's ground, then one strong shape and one soft one.
   */
  deco: readonly [string, string, string, string];
}

export interface Look {
  /** A preset id, or `spec` for a demonstration site's own direction. */
  id: StylePresetId | 'spec';
  name: string;
  source: LookSource;
  /** Which ground the treatment is drawn on. */
  ground: 'light' | 'dark';
  /**
   * Opacity of the frosted panels, for a treatment drawn in glass. Text on
   * those panels is measured against this opacity over every colour in
   * `backdrops`, so the number the stylesheet uses and the number the test
   * uses are this one.
   */
  glass: number | null;
  /**
   * Opacity of the coloured light a treatment casts across its page, when
   * page text sits in it (Cinematic's glow behind its headline). Text on the
   * page is measured against the page with each decoration hue laid over it
   * at this opacity.
   */
  glow: number | null;
  colors: LookColors;
}

/**
 * The demonstration palette for treatments that have none of their own.
 *
 * Neutral on purpose: near-white and near-black with one restrained blue,
 * so that what a visitor notices in a treatment's preview is the treatment
 * (the blur, the hard border, the soft shadow) and not a colour scheme the
 * product would never have picked. It has a light ground and a dark one,
 * because a treatment such as "Dark" or "Retro wave" is a dark treatment
 * whatever palette it wears. The decoration hues are for backdrops and
 * illustrations only, which is where glassmorphism's "saturated background"
 * has to come from.
 */
export const DEMO_PALETTE: Record<'light' | 'dark', LookColors> = {
  light: {
    page: { fill: '#F3F2EE', ink: '#16181D', soft: '#555963' },
    card: { fill: '#FFFFFF', ink: '#16181D', soft: '#555963' },
    panel: { fill: '#E7E6E1', ink: '#16181D', soft: '#4F535C' },
    primary: { fill: '#16181D', ink: '#FFFFFF' },
    accent: { fill: '#2F55D4', ink: '#FFFFFF' },
    line: '#D6D5CF',
    deco: ['#FF6B4A', '#FFC53D', '#16C2B0', '#FF4F8B'],
  },
  dark: {
    page: { fill: '#111318', ink: '#F2F1EC', soft: '#A5A9B2' },
    card: { fill: '#1B1E25', ink: '#F2F1EC', soft: '#A5A9B2' },
    panel: { fill: '#23262E', ink: '#F2F1EC', soft: '#A5A9B2' },
    primary: { fill: '#F2F1EC', ink: '#111318' },
    accent: { fill: '#8FA8FF', ink: '#111318' },
    line: '#2E323B',
    deco: ['#2DE2B5', '#FF6FB5', '#FFB547', '#5B7CFF'],
  },
};

/**
 * How each surface treatment is drawn: on which ground, and whether in glass.
 *
 * The treatment itself (radius, borders, shadow, motion) is in
 * `styles/miniature.css`, keyed on the preset id. This is only the part the
 * contrast test needs to know.
 */
const TREATMENTS: Record<
  StylePresetId,
  { ground: 'light' | 'dark'; glass: number | null; glow?: number }
> = {
  glassmorphism: { ground: 'light', glass: 0.66 },
  neumorphism: { ground: 'light', glass: null },
  brutalism: { ground: 'light', glass: null },
  minimalist: { ground: 'light', glass: null },
  dark: { ground: 'dark', glass: null },
  gradient: { ground: 'light', glass: null },
  depth: { ground: 'light', glass: null },
  retrowave: { ground: 'dark', glass: null },
  claymorphism: { ground: 'light', glass: null },
  aurora: { ground: 'dark', glass: 0.86 },
  bentoGrid: { ground: 'light', glass: null },
  editorial: { ground: 'light', glass: null },
  organic: { ground: 'light', glass: null },
  aiNative: { ground: 'light', glass: null },
  vibrantBlocks: { ground: 'light', glass: null },
  liquidGlass: { ground: 'dark', glass: 0.86 },
  // The eight below carry their own palettes. The ground is read from the
  // preset rather than asserted here, see `lookForPreset`.
  warmTerminal: { ground: 'dark', glass: null },
  layeredVoid: { ground: 'dark', glass: null },
  acidDark: { ground: 'dark', glass: null },
  nightIndigo: { ground: 'dark', glass: null },
  warmPaper: { ground: 'light', glass: null },
  monoPress: { ground: 'light', glass: null },
  polarityBands: { ground: 'light', glass: null },
  // The floating pill navigation is the recipe's own glass.
  cinematic: { ground: 'dark', glass: 0.78, glow: 0.3 },
};

/** A preset's own colours, arranged as surfaces. Pairs only, never loose. */
export function presetColors(preset: StylePreset): LookColors | null {
  const c = preset.tokens?.colors;
  if (!c) return null;
  return {
    page: { fill: c.background, ink: c.foreground, soft: c.mutedForeground },
    // `mutedForeground` is verified on `muted` and on `background`, not on
    // `card`, so a card's quieter text is its own foreground. A preview that
    // borrowed the page's muted ink for a card would be making a claim the
    // preset's tests never checked.
    card: { fill: c.card, ink: c.cardForeground, soft: c.cardForeground },
    panel: { fill: c.muted, ink: c.mutedForeground, soft: c.mutedForeground },
    primary: { fill: c.primary, ink: c.onPrimary },
    accent: { fill: c.accent, ink: c.onAccent },
    line: c.border,
    // The order every look shares: two colours for the illustration's
    // ground, one strong shape and one soft one.
    deco: [c.secondary, c.muted, c.primary, c.accent],
  };
}

function lightness(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function lookForPreset(preset: StylePreset): Look {
  const own = presetColors(preset);
  const treatment = TREATMENTS[preset.id];
  if (own) {
    return {
      id: preset.id,
      name: preset.name,
      source: 'preset',
      ground: lightness(own.page.fill) < 0.5 ? 'dark' : 'light',
      glass: treatment.glass,
      glow: treatment.glow ?? null,
      colors: own,
    };
  }
  return {
    id: preset.id,
    name: preset.name,
    source: 'demo',
    ground: treatment.ground,
    glass: treatment.glass,
    glow: treatment.glow ?? null,
    colors: DEMO_PALETTE[treatment.ground],
  };
}

/** Every preset's look, in the builder's own order. */
export function presetLooks(): Look[] {
  return STYLE_PRESETS.map(lookForPreset);
}

export function lookById(id: StylePresetId): Look {
  const preset = STYLE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No style preset ${id}`);
  return lookForPreset(preset);
}

/** A demonstration site in its own "direction A" colours. */
export function specLook(site: DemoSiteId): Look {
  return {
    id: 'spec',
    name: 'Spec A',
    source: 'site',
    ground: 'light',
    glass: null,
    glow: null,
    colors: DEMO_SITES[site].colors,
  };
}

/**
 * Every colour that can sit behind a glass panel in this look: the page,
 * and each decoration hue. The stylesheet draws backdrops from nothing else.
 */
export function backdrops(look: Look): string[] {
  return [look.colors.page.fill, ...look.colors.deco];
}

/**
 * The custom properties the miniature's stylesheet reads. Written inline on
 * the miniature, so one stylesheet serves every look.
 */
export function lookVars(look: Look): Record<string, string> {
  const c = look.colors;
  return {
    '--s-page': c.page.fill,
    '--s-ink': c.page.ink,
    '--s-soft': c.page.soft,
    '--s-card': c.card.fill,
    '--s-card-ink': c.card.ink,
    '--s-card-soft': c.card.soft,
    '--s-panel': c.panel.fill,
    '--s-panel-ink': c.panel.ink,
    '--s-primary': c.primary.fill,
    '--s-on-primary': c.primary.ink,
    '--s-accent': c.accent.fill,
    '--s-on-accent': c.accent.ink,
    '--s-line': c.line,
    '--s-deco-1': c.deco[0],
    '--s-deco-2': c.deco[1],
    '--s-deco-3': c.deco[2],
    '--s-deco-4': c.deco[3],
    '--s-glass': `${Math.round((look.glass ?? 1) * 100)}%`,
    '--s-glow': `${Math.round((look.glow ?? 0) * 100)}%`,
  };
}
