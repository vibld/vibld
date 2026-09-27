/**
 * Notify IndexNow after vibld.com is deployed.
 *
 * The ownership key is public by protocol design and is served from the site
 * root. This script verifies that the deployed key is readable before it
 * submits the canonical URLs derived from the same route catalogue that
 * generates the sitemap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROUTES, SITE } from '../app/site.ts';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_FILE = '7c42bf846012b7307870dda0a288976e.txt';

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export function indexNowKey(): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'public', INDEXNOW_KEY_FILE),
    'utf8',
  ).trim();
}

export function buildIndexNowPayload(): IndexNowPayload {
  const origin = new URL(SITE.url);
  return {
    host: origin.host,
    key: indexNowKey(),
    keyLocation: new URL(`/${INDEXNOW_KEY_FILE}`, origin).toString(),
    urlList: ROUTES.map((route) => new URL(route.path, origin).toString()),
  };
}

export async function submitIndexNow(): Promise<void> {
  const payload = buildIndexNowPayload();
  const keyResponse = await fetch(payload.keyLocation);
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== payload.key) {
    throw new Error(
      `IndexNow ownership file is not live at ${payload.keyLocation} (${keyResponse.status})`,
    );
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (response.status !== 200 && response.status !== 202) {
    const detail = (await response.text()).trim();
    throw new Error(
      `IndexNow rejected the submission (${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  console.log(
    `IndexNow accepted ${payload.urlList.length} vibld.com URLs (${response.status}).`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(buildIndexNowPayload(), null, 2));
  } else {
    await submitIndexNow();
  }
}
