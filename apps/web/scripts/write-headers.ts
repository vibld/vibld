/**
 * Rewrite `public/_headers` from `@vibld/security-headers`.
 *
 * The file is checked in because Cloudflare reads it out of the build
 * output, and it is generated because the same headers are sent from the
 * Worker: two hand-written copies of one decision is how `app.vibld.com`
 * ends up answering differently depending on which half of itself replied.
 *
 * `headers.test.ts` fails when the checked-in file has drifted, and names
 * this script. Run it with:
 *
 *     pnpm --filter @vibld/web headers
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { headersFile } from '@vibld/security-headers';

import { APP_ONLY_HEADERS } from '../src/crawling.ts';

const target = fileURLToPath(new URL('../public/_headers', import.meta.url));
writeFileSync(target, headersFile(APP_ONLY_HEADERS));
process.stdout.write(`wrote ${target}\n`);
