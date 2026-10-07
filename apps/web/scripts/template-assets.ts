/**
 * Writes each design template's brief (docs/decisions.md, D106, D148) into
 * the build output as a file the Worker reads, never as code: the template
 * catalog is 6.5 MB, and the builder needs one brief at a time. Each style
 * gallery entry gets one too, since the Templates option lists them beside
 * the designs (D162); no style shares an id with a design.
 *
 *   _templates/briefs/<id>.json   { "brief": "..." }
 *
 * The Worker answers every request for `/_templates/*` itself and refuses
 * it, so a brief reaches the builder only through `/api/templates/brief`.
 *
 * Run by the Vite plugin in `vite.config.ts` after every production build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';
import { designBrief } from '@vibld/ai/design-templates';
import { parseStyleGallery, styleGalleryBrief } from '@vibld/ai/style-gallery';

import { STYLE_GALLERY_DATA } from './style-gallery-assets.ts';

export const TEMPLATES_DIR = '_templates';

/** Writes the briefs into `outDir`; returns how many it wrote. */
export function writeTemplateAssets(
  outDir: string,
  styleData = STYLE_GALLERY_DATA,
): number {
  const root = join(outDir, TEMPLATES_DIR, 'briefs');
  mkdirSync(root, { recursive: true });
  let count = 0;
  for (const template of DESIGN_TEMPLATE_INDEX) {
    const brief = designBrief(template.id);
    if (brief === undefined) continue;
    writeFileSync(join(root, `${template.id}.json`), JSON.stringify({ brief }));
    count += 1;
  }
  // A copy built without the gallery's data lists no styles.
  if (existsSync(styleData)) {
    const catalog = parseStyleGallery(readFileSync(styleData, 'utf8'));
    for (const entry of catalog.entries) {
      const brief = styleGalleryBrief(catalog.baseline_rules_markdown, entry);
      writeFileSync(join(root, `${entry.id}.json`), JSON.stringify({ brief }));
      count += 1;
    }
  }
  return count;
}
