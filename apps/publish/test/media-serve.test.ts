import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { mediaObjectKey } from '@vibld/core';

import worker, { type Env } from '../worker/index.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * `/media/<name>` on a published site: the owner's uploaded file, from the
 * media library, with ranges, and withheld whenever the site is.
 */

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const SECRET = 'test-secret';
const HOST = 'acme.vibld-preview.dev';
const VIDEO = new Uint8Array(Array.from({ length: 100 }, (_, at) => at));

const SITE = [{ path: 'index.html', content: '<video src="/media/loop.mp4">' }];

async function publishedWithMedia(
  files: { path: string; content: string }[] = SITE,
): Promise<{
  env: Env;
  bucket: InMemoryR2Bucket;
  db: SqliteD1Database;
}> {
  const bucket = new InMemoryR2Bucket();
  const db = new SqliteD1Database(SCHEMA);
  const env: Env = {
    DB: db,
    PROJECT_CONTENT: bucket,
    PUBLISH_INTERNAL_SECRET: SECRET,
    PUBLISH_HOSTNAME: 'vibld-preview.dev',
  };
  await worker.fetch(
    new Request('https://internal.example/internal/publish', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files,
      }),
    }),
    env,
  );
  await db
    .prepare(
      `INSERT INTO project_media
         (id, user_id, path, kind, content_type, bytes, sha256, git_sha, alt, created_at)
       VALUES ('m1', 'u1', 'media/loop.mp4', 'video', 'video/mp4', 100, 'x', 'g', '', '2026-09-24')`,
    )
    .run();
  bucket.putBytes(mediaObjectKey('u1', 'm1'), VIDEO);
  // In the same library, and named by none of the site's files.
  await db
    .prepare(
      `INSERT INTO project_media
         (id, user_id, path, kind, content_type, bytes, sha256, git_sha, alt, created_at)
       VALUES ('m2', 'u1', 'media/private.jpg', 'image', 'image/jpeg', 3, 'y', 'g', '', '2026-09-24')`,
    )
    .run();
  bucket.putBytes(
    mediaObjectKey('u1', 'm2'),
    new Uint8Array([0xff, 0xd8, 0xff]),
  );
  return { env, bucket, db };
}

const get = (env: Env, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://${HOST}${path}`, { headers }), env);

describe('media on a published site', () => {
  it("serves the owner's file with the type decided at upload", async () => {
    const { env } = await publishedWithMedia();
    const response = await get(env, '/media/loop.mp4');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [...VIDEO],
    );
  });

  it('answers a range with exactly those bytes, which is how video plays', async () => {
    const { env } = await publishedWithMedia();
    const response = await get(env, '/media/loop.mp4', {
      range: 'bytes=10-19',
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
    const past = await get(env, '/media/loop.mp4', { range: 'bytes=500-' });
    assert.equal(past.status, 416);
  });

  it('404s a media path the owner never uploaded, never with a page', async () => {
    const { env } = await publishedWithMedia();
    const response = await get(env, '/media/missing.mp4', {
      accept: 'text/html',
    });
    assert.equal(response.status, 404);
  });

  it("never serves another account's file under this site", async () => {
    // Even one the site's own pages name: the library read is the owner's.
    const { env, db, bucket } = await publishedWithMedia([
      ...SITE,
      { path: 'about.html', content: '<img src="/media/secret.png" alt="">' },
    ]);
    await db
      .prepare(
        `INSERT INTO project_media
           (id, user_id, path, kind, content_type, bytes, sha256, git_sha, alt, created_at)
         VALUES ('m3', 'u2', 'media/secret.png', 'image', 'image/png', 4, 'x', 'g', '', '2026-09-24')`,
      )
      .run();
    bucket.putBytes(mediaObjectKey('u2', 'm3'), new Uint8Array([1, 2, 3, 4]));
    assert.equal((await get(env, '/media/secret.png')).status, 404);
  });

  it('withholds the media of a site an operator has held', async () => {
    const { env, db } = await publishedWithMedia();
    await db
      .prepare(
        `UPDATE published_projects SET held_at = '2026-09-24' WHERE slug = 'acme'`,
      )
      .run();
    assert.equal((await get(env, '/media/loop.mp4')).status, 404);
  });
});

describe('only the media the site itself uses', () => {
  it("will not serve the rest of the owner's library", async () => {
    const { env } = await publishedWithMedia();
    assert.equal((await get(env, '/media/loop.mp4')).status, 200);
    assert.equal((await get(env, '/media/private.jpg')).status, 404);
  });

  it('cannot be widened by a manifest the project wrote itself', async () => {
    const { env } = await publishedWithMedia([
      ...SITE,
      { path: '__vibld/media.json', content: '["media/private.jpg"]' },
    ]);
    assert.equal((await get(env, '/media/private.jpg')).status, 404);
    assert.equal((await get(env, '/media/loop.mp4')).status, 200);
  });

  it('serves a file once a page references it', async () => {
    const { env } = await publishedWithMedia([
      ...SITE,
      { path: 'assets/app.js', content: 'img.src = "/media/private.jpg";' },
    ]);
    assert.equal((await get(env, '/media/private.jpg')).status, 200);
  });
});

describe('a media library that cannot be read', () => {
  it('answers 404 for the file, not 500 for the site', async () => {
    const { env, bucket } = await publishedWithMedia();
    // Every other method still reaches the real fake, so the site's own
    // files load; only the media read fails.
    const failing = {
      ...env,
      PROJECT_CONTENT: {
        get: bucket.get.bind(bucket),
        put: bucket.put.bind(bucket),
        delete: bucket.delete.bind(bucket),
        list: bucket.list.bind(bucket),
        head: async () => {
          throw new Error('R2 is having a day');
        },
      },
    } as unknown as Env;
    assert.equal((await get(failing, '/media/loop.mp4')).status, 404);
    assert.equal((await get(failing, '/')).status, 200);
  });
});
