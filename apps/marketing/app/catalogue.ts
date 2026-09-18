import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import type { StylePreset } from '@vibld/ai/style-presets';

/**
 * The visual directions vibld can build in, for the catalogue page (#186).
 *
 * Read from `packages/ai/src/style-presets.ts` rather than restated here.
 * That file is what the builder actually sends a model, so a second list on
 * the marketing site would be a promise about the product written somewhere
 * the product cannot see -- and it would go stale the first time a preset
 * was renamed, with nothing complaining.
 *
 * Deep import, never the barrel: the barrel carries a provider SDK, and
 * `apps/web`'s `browser-boundary.test.ts` exists because importing it once
 * doubled that bundle. The same reasoning applies to a prerendered site.
 */

/**
 * One pair a preset says is legible: a fill, and the ink meant for it.
 *
 * Pairs, never loose colours. `packages/ai` verifies every text pair in
 * these presets at 4.5:1, so showing `onPrimary` on `primary` inherits a
 * proof that already exists. Putting this site's own ink on somebody else's
 * fill would inherit nothing, and `palette-use.test.ts` records what that
 * costs: "a colour mistake looks exactly like a colour choice".
 */
export interface CataloguePair {
  label: string;
  fill: string;
  ink: string;
}

export interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  /**
   * The preset's own colours, or null when it does not have any.
   *
   * Sixteen of the twenty-three are surface treatments -- "frosted glass",
   * "soft 3D shadows" -- that any palette can wear, and `style-presets.ts`
   * leaves their colours open deliberately so they are not made narrower
   * than they are. Inventing swatches for those would misrepresent the
   * product: it would show a choice the builder does not actually make.
   */
  pairs: CataloguePair[] | null;
}

/** The pairs worth showing, in the order they read as a palette. */
function pairsOf(preset: StylePreset): CataloguePair[] | null {
  const colors = preset.tokens?.colors;
  if (!colors) return null;
  return [
    { label: 'Page', fill: colors.background, ink: colors.foreground },
    { label: 'Card', fill: colors.card, ink: colors.cardForeground },
    { label: 'Primary', fill: colors.primary, ink: colors.onPrimary },
    { label: 'Accent', fill: colors.accent, ink: colors.onAccent },
  ];
}

export function catalogue(): CatalogueEntry[] {
  return STYLE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    pairs: pairsOf(preset),
  }));
}

/** Presets that carry a full colour system, for the page's own copy. */
export function withPalettes(entries: CatalogueEntry[]): CatalogueEntry[] {
  return entries.filter((entry) => entry.pairs !== null);
}
