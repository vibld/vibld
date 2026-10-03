/**
 * Writes the style gallery (docs/decisions.md, D142) into the build output
 * as files the Worker reads, never as code: the data is 26 MB and a bundle
 * that imported it would carry all of it.
 *
 *   _style-gallery/cards.json         every style's picker card
 *   _style-gallery/baseline.json      the rules every build prompt assumes
 *   _style-gallery/styles/<id>.json   one whole entry
 *
 * The Worker answers every request for `/_style-gallery/*` itself and
 * refuses it, so these files are read through the Worker's own API and are
 * never served as they are (D144).
 *
 * A copy built without the data file still gets a
 * `cards.json`, empty, so the picker says there are no styles rather than
 * failing.
 *
 * Run by the Vite plugin in `vite.config.ts` after every production build.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStyleGallery, styleCardOf } from '@vibld/ai/style-gallery';

export const STYLE_GALLERY_DATA = fileURLToPath(
  new URL('../../../packages/ai/data/style-gallery.json', import.meta.url),
);

export const STYLE_GALLERY_DIR = '_style-gallery';

/** Writes the files into `outDir`; returns how many styles it wrote. */
export function writeStyleGalleryAssets(
  outDir: string,
  dataFile = STYLE_GALLERY_DATA,
): number {
  const root = join(outDir, STYLE_GALLERY_DIR);
  mkdirSync(join(root, 'styles'), { recursive: true });
  if (!existsSync(dataFile)) {
    writeFileSync(join(root, 'cards.json'), '[]');
    writeFileSync(
      join(root, 'baseline.json'),
      JSON.stringify({ baseline: '' }),
    );
    return 0;
  }
  const catalog = parseStyleGallery(readFileSync(dataFile, 'utf8'));
  writeFileSync(
    join(root, 'cards.json'),
    JSON.stringify(catalog.entries.map(styleCardOf)),
  );
  writeFileSync(
    join(root, 'baseline.json'),
    JSON.stringify({ baseline: catalog.baseline_rules_markdown }),
  );
  for (const entry of catalog.entries) {
    writeFileSync(
      join(root, 'styles', `${entry.id}.json`),
      JSON.stringify(entry),
    );
  }
  return catalog.entries.length;
}
