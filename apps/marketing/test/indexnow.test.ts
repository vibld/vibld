import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ROUTES, SITE } from '../app/site.ts';
import {
  INDEXNOW_KEY_FILE,
  buildIndexNowPayload,
} from '../scripts/indexnow-submit.ts';

describe('IndexNow submission', () => {
  it('publishes the ownership key at the site root', () => {
    const path = join(import.meta.dirname, '..', 'public', INDEXNOW_KEY_FILE);
    assert.ok(existsSync(path));
    assert.equal(readFileSync(path, 'utf8').trim(), buildIndexNowPayload().key);
  });

  it('submits every canonical route and nothing else', () => {
    const payload = buildIndexNowPayload();
    assert.equal(payload.host, new URL(SITE.url).host);
    assert.equal(
      payload.keyLocation,
      new URL(`/${INDEXNOW_KEY_FILE}`, SITE.url).toString(),
    );
    assert.deepEqual(
      payload.urlList,
      ROUTES.map((route) => new URL(route.path, SITE.url).toString()),
    );
  });
});
