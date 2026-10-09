import {
  catalogInspirationGuidance,
  matchCatalogDesigns,
} from '@vibld/ai/catalog-inspiration';
import type { CatalogInspiration } from '@vibld/ai/catalog-inspiration';
import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';

import { readJsonAsset } from './style-gallery.ts';
import type { StyleGalleryEnv } from './style-gallery.ts';

/**
 * The template catalog's closest designs to a typed request, as the section
 * `buildUserPrompt` places where the product-type palette would go, or null
 * when none match.
 *
 * Matched on the light index the Worker carries; each design's direction is
 * read from the file `scripts/template-assets.ts` writes beside the
 * builder's assets, because the catalog itself is far too large for the
 * bundle. A design whose file is missing is left out rather than failing
 * the build: this is inspiration, not something the person asked for.
 */
export async function readCatalogInspiration(
  env: StyleGalleryEnv,
  origin: string,
  prompt: string,
): Promise<string | null> {
  const ids = matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX);
  const entries = await Promise.all(
    ids.map(async (id) => {
      const file = await readJsonAsset(
        env,
        origin,
        `/_templates/inspiration/${id}.json`,
      );
      if (!file) return null;
      const entry = (await file.json()) as CatalogInspiration;
      return entry.id === id ? entry : null;
    }),
  );
  return catalogInspirationGuidance(
    entries.filter((entry): entry is CatalogInspiration => entry !== null),
  );
}
