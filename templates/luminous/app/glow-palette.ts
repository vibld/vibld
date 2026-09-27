/**
 * The colours the home page's light field is allowed to use.
 *
 * This file is plain data on purpose. The WebGL field in
 * `components/GlowField.tsx` reads it to paint, and `test/contrast.test.ts`
 * reads it to prove that text laid over the field stays legible at the
 * field's most saturated. Keeping both readers on one source means the glow
 * cannot be made brighter without the contrast test noticing.
 *
 * The shader only ever mixes the ground towards a blend of these colours,
 * and never by more than `strength`. Every pixel it can draw therefore lies
 * between the ground and some blend of the palette, which is the space the
 * test searches.
 */

export interface GlowTheme {
  /** The page background under the field. Must equal `--paper` in app.css. */
  ground: string;
  /** Every colour the field can tint towards, in any blend. */
  palette: readonly string[];
  /** The furthest the field may move a pixel from the ground, 0 to 1. */
  strength: number;
  /**
   * Film grain added per channel, as a fraction of full scale. It breaks up
   * banding in the gradients; the contrast test allows for it.
   */
  grain: number;
}

export const GLOW: Record<'light' | 'dark', GlowTheme> = {
  light: {
    ground: '#fbfaf7',
    // Amber, ember, teal and a rose that only the in-app mood uses.
    palette: ['#f5a524', '#e2572a', '#13a394', '#ee6b72'],
    strength: 0.46,
    grain: 0.007,
  },
  dark: {
    ground: '#0b0f17',
    palette: ['#ffb74a', '#ff7a3d', '#3ccfc0', '#ff8a95'],
    strength: 0.3,
    grain: 0.007,
  },
};

export type SourceId = 'all' | 'email' | 'chat' | 'widget' | 'support';

/**
 * Each feedback source gives the field a mood: three palette entries, by
 * index, for the field's three main orbs. Moods only reorder the palette,
 * so switching between them never leaves the space the test has checked.
 */
export const MOODS: Record<SourceId, readonly [number, number, number]> = {
  all: [0, 1, 2],
  email: [1, 0, 2],
  chat: [2, 0, 1],
  widget: [3, 0, 2],
  support: [0, 2, 1],
};
