/**
 * Writes each design template's brief (docs/decisions.md, D106, D148) into
 * the build output as a file the Worker reads, never as code: the template
 * catalog is 6.5 MB, and the builder needs one brief at a time.
 *
 *   _templates/briefs/<id>.json   { "brief": "..." }
 *
 * The Worker answers every request for `/_templates/*` itself and refuses
 * it, so a brief reaches the builder only through `/api/templates/brief`.
 *
 * Run by the Vite plugin in `vite.config.ts` after every production build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';
import { designBrief } from '@vibld/ai/design-templates';

export const TEMPLATES_DIR = '_templates';

/** Writes the briefs into `outDir`; returns how many it wrote. */
export function writeTemplateAssets(outDir: string): number {
  const root = join(outDir, TEMPLATES_DIR, 'briefs');
  mkdirSync(root, { recursive: true });
  let count = 0;
  for (const template of DESIGN_TEMPLATE_INDEX) {
    const brief = designBrief(template.id);
    if (brief === undefined) continue;
    writeFileSync(join(root, `${template.id}.json`), JSON.stringify({ brief }));
    count += 1;
  }
  return count;
}
