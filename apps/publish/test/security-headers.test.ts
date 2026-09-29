import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { mediaObjectKey } from '@vibld/core';
import { PUBLISHED_SITE_HEADERS } from '@vibld/security-headers';

import worker, { type Env } from '../worker/index.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * That a published site actually sends its defaults (D64).
 *
 * The package's own tests prove `withDefaultHeaders` adds them and keeps
 * what a response already set. These prove every kind of response this
 * Worker produces goes through it: a page, each fallback, each 404, media,
 * an example and the refusal a stranger gets on `/internal/`. Until D64
 * published sites were sending none of them.
 */

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const SECRET = 'test-secret';

async function publish(
  env: Env,
  slug: string,
  projectId: string,
  files: { path: string; content: string }[],
): Promise<void> {
  const response = await worker.fetch(
    new Request('https://internal.example/internal/publish', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ userId: 'u1', projectId, slug, files }),
    }),
    env,
  );
  assert.equal(response.status, 200, await response.text());
}

async function sites(): Promise<Env> {
  const db = new SqliteD1Database(SCHEMA);
  const bucket = new InMemoryR2Bucket();
  const env: Env = {
    DB: db,
    PROJECT_CONTENT: bucket,
    PUBLISH_INTERNAL_SECRET: SECRET,
    PUBLISH_HOSTNAME: 'vibld-preview.dev',
  };
  await publish(env, 'acme', 'p1', [
    { path: 'index.html', content: '<video src="/media/loop.mp4">' },
    { path: 'about.html', content: '<h1>About</h1>' },
    { path: '404.html', content: '<h1>Lost</h1>' },
    { path: 'assets/app.js', content: 'console.log(1)' },
  ]);
  // The examples on vibld.com/examples are published by the same route, at
  // `example-<slug>` (scripts/examples.mjs), and served by the same code.
  await publish(env, 'example-bakery', 'p2', [
    { path: 'index.html', content: '<h1>Bakery</h1>' },
  ]);
  await db
    .prepare(
      `INSERT INTO project_media
         (id, user_id, path, kind, content_type, bytes, sha256, git_sha, alt, created_at)
       VALUES ('m1', 'u1', 'media/loop.mp4', 'video', 'video/mp4', 10, 'x', 'g', '', '2026-09-29')`,
    )
    .run();
  bucket.putBytes(
    mediaObjectKey('u1', 'm1'),
    new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
  );
  return env;
}

function get(
  env: Env,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return worker.fetch(new Request(url, { headers }), env);
}

function assertDefaults(response: Response, what: string): void {
  for (const [name, value] of Object.entries(PUBLISHED_SITE_HEADERS)) {
    assert.equal(
      response.headers.get(name),
      value,
      `${what} is missing ${name}`,
    );
  }
  // The other half of D64: nothing that would stop a site embedding, or
  // being embedded, arrives with them.
  assert.equal(response.headers.get('content-security-policy'), null, what);
  assert.equal(response.headers.get('x-frame-options'), null, what);
}

describe('what a published site sends with every response (D64)', () => {
  it('sends them with a page, and keeps its content type', async () => {
    const env = await sites();
    const response = await get(env, 'https://acme.vibld-preview.dev/');
    assert.equal(response.status, 200);
    assertDefaults(response, 'a page');
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
  });

  it('sends them with a script', async () => {
    const env = await sites();
    const response = await get(
      env,
      'https://acme.vibld-preview.dev/assets/app.js',
    );
    assert.equal(response.status, 200);
    assertDefaults(response, 'a script');
  });

  it("sends them with the site's own 404 page", async () => {
    const env = await sites();
    const response = await get(
      env,
      'https://acme.vibld-preview.dev/missing.html',
    );
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '<h1>Lost</h1>');
    assertDefaults(response, "the site's 404 page");
  });

  it('sends them with the plain 404 for a missing asset', async () => {
    const env = await sites();
    const response = await get(
      env,
      'https://acme.vibld-preview.dev/assets/missing.js',
    );
    assert.equal(response.status, 404);
    assertDefaults(response, 'a missing asset');
  });

  it('sends them with the 404 for a slug nobody published', async () => {
    const env = await sites();
    const response = await get(env, 'https://nobody.vibld-preview.dev/');
    assert.equal(response.status, 404);
    assertDefaults(response, 'an unknown slug');
  });

  it('sends them with an example', async () => {
    const env = await sites();
    const response = await get(
      env,
      'https://example-bakery.vibld-preview.dev/',
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<h1>Bakery</h1>');
    assertDefaults(response, 'an example');
  });

  it('sends them with media, keeping what media set for itself', async () => {
    const env = await sites();
    const response = await get(
      env,
      'https://acme.vibld-preview.dev/media/loop.mp4',
      { range: 'bytes=2-4' },
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer())],
      [2, 3, 4],
    );
    assertDefaults(response, 'media');
  });

  it("sends them with the refusal a stranger gets on a site's /internal/", async () => {
    // apps/preview forwards a published host's paths whole, so this is
    // answered on the site's own origin.
    const env = await sites();
    const response = await worker.fetch(
      new Request('https://acme.vibld-preview.dev/internal/publish', {
        method: 'POST',
        body: '{}',
      }),
      env,
    );
    assert.equal(response.status, 403);
    assertDefaults(response, 'the internal refusal');
  });
});
