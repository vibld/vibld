/**
 * Writes the four animated backgrounds into this site, from the source a
 * build writes into a project (packages/ai/src/backdrops.ts), so /styles
 * runs exactly what a project is given:
 *
 *   node --experimental-strip-types scripts/backdrops.ts
 *
 * The files are generated, never edited: test/backdrops.test.ts fails when
 * one differs from its recipe's source, and says to run this.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BACKDROPS } from '@vibld/ai/backdrops';

export const BACKDROP_COMPONENT_DIR = join(
  import.meta.dirname,
  '..',
  'app',
  'components',
  'backdrop',
);

if (import.meta.main) {
  mkdirSync(BACKDROP_COMPONENT_DIR, { recursive: true });
  for (const name of readdirSync(BACKDROP_COMPONENT_DIR)) {
    rmSync(join(BACKDROP_COMPONENT_DIR, name));
  }
  for (const recipe of BACKDROPS) {
    writeFileSync(
      join(BACKDROP_COMPONENT_DIR, `${recipe.id}.tsx`),
      recipe.source,
    );
  }
  console.log(`Wrote ${BACKDROPS.length} backdrops.`);
}
