import { findStylePreset } from '@vibld/ai/style-presets';

import type { Example } from './examples';

/** One site type's row of the sample gallery, in the order the file lists. */
export interface GalleryRow {
  siteType: string;
  title: string;
  prompt: string;
  cells: (Example & { styleName: string })[];
}

/**
 * The sample gallery (internal issue 186, D153): the same brief per site type, built in
 * each style, grouped by site type in the order the catalog lists them.
 */
export function galleryRows(all: readonly Example[]): GalleryRow[] {
  const rows = new Map<string, GalleryRow>();
  for (const example of all) {
    if (!example.gallery) continue;
    const style = findStylePreset(example.gallery.style);
    if (!style) {
      throw new Error(
        `Example ${example.slug} names unknown style ${example.gallery.style}`,
      );
    }
    const row = rows.get(example.gallery.siteType) ?? {
      siteType: example.gallery.siteType,
      title: example.title,
      prompt: example.prompt,
      cells: [],
    };
    row.cells.push({ ...example, styleName: style.name });
    rows.set(example.gallery.siteType, row);
  }
  return [...rows.values()];
}
