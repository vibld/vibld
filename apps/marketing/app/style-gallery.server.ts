import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseStyleGallery } from '@vibld/ai/style-gallery';
import type { StyleGalleryCatalog } from '@vibld/ai/style-gallery';

/**
 * The style gallery (docs/decisions.md, D142, D143), read from
 * `packages/ai/data/style-gallery.json` while the site is prerendered.
 *
 * Read from disk rather than imported: the file is several megabytes of
 * JSON, and only the loaders of the gallery's pages, which run at build
 * time, need it. The build runs inside the repository, so the file is found
 * by walking up from the working directory.
 */

const FILE = join('packages', 'ai', 'data', 'style-gallery.json');

let cached: StyleGalleryCatalog | null = null;

export function styleGalleryCatalog(): StyleGalleryCatalog {
  if (cached) return cached;
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, FILE);
    if (existsSync(candidate)) {
      cached = parseStyleGallery(readFileSync(candidate, 'utf8'));
      return cached;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`${FILE} not found above ${process.cwd()}`);
    dir = up;
  }
}
