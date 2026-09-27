import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  MEDIA_ACCOUNT_MAX_FILES,
  MEDIA_IMAGE_MAX_BYTES,
  MEDIA_VIDEO_MAX_BYTES,
  mediaObjectKey,
} from '@vibld/core';

import { handleMedia } from '../worker/media-handlers.ts';
import type { MediaEnv } from '../worker/media-handlers.ts';
import type { PrincipalGranted } from '../worker/principal.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * `/api/media`: uploading, listing and removing the caller's own media.
 *
 * The rules that matter are the ones a hostile uploader would test: the
 * type comes from the bytes, SVG never gets in, a file cannot be bigger
 * than its kind allows or push an account past its quota, and nobody can
 * see or remove another account's files.
 */

const ORIGIN = 'https://app.vibld.com';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4,
]);
const MP4 = new Uint8Array([
  0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0,
]);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

function env(): MediaEnv & { bucket: InMemoryR2Bucket } {
  const bucket = new InMemoryR2Bucket();
  return {
    DB: new SqliteD1Database(schemaSql()),
    PROJECT_CONTENT: bucket,
    bucket,
  };
}

/** Signs every request in as `user`, the way `resolvePrincipal` would. */
const as = (userId: string) => async () =>
  ({
    denied: null,
    principal: { userId },
  }) as unknown as PrincipalGranted;

let ids = 0;
const options = {
  now: () => new Date('2026-09-24T04:00:00Z'),
  newId: () => `m${(ids += 1)}`,
};

function upload(
  body: Uint8Array | null,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/api/media`, {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      origin: ORIGIN,
      'x-media-name': 'Hero shot.png',
      ...headers,
    },
    body: body as BodyInit | null,
  });
}

async function body(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}

describe('uploading', () => {
  it('stores a file under a safe path, typed from its bytes', async () => {
    const e = env();
    const response = await handleMedia(
      upload(PNG, {
        // A lie the bytes overrule.
        'content-type': 'image/jpeg',
        'x-media-alt': encodeURIComponent('A lighthouse at dusk'),
      }),
      e,
      as('user_a'),
      options,
    );
    assert.equal(response.status, 201);
    const { media } = await body(response);
    assert.equal(media.path, 'media/hero-shot.png');
    assert.equal(media.contentType, 'image/png');
    assert.equal(media.kind, 'image');
    assert.equal(media.alt, 'A lighthouse at dusk');
    // The name git gives these bytes, so a push preview can compare them.
    assert.equal(
      media.gitSha,
      createHash('sha1')
        .update(`blob ${PNG.length}\0`)
        .update(PNG)
        .digest('hex'),
    );
    const key = mediaObjectKey('user_a', media.id);
    assert.deepEqual([...e.bucket.bytes(key)!], [...PNG]);
    assert.equal(e.bucket.contentTypeOf(key), 'image/png');
  });

  it('refuses SVG, whatever it claims to be', async () => {
    const e = env();
    const response = await handleMedia(
      upload(SVG, { 'x-media-name': 'logo.png' }),
      e,
      as('user_a'),
      options,
    );
    assert.equal(response.status, 415);
    assert.deepEqual(e.bucket.keys(), []);
  });

  it('refuses a body that is not declared as an image or a video', async () => {
    // A form post from another site can only send urlencoded, multipart or
    // text/plain. None of them reaches the upload.
    for (const type of [
      'text/plain',
      'multipart/form-data',
      'application/x-www-form-urlencoded',
    ]) {
      const response = await handleMedia(
        upload(PNG, { 'content-type': type }),
        env(),
        as('user_a'),
        options,
      );
      assert.equal(response.status, 415, type);
    }
  });

  it('takes a file the browser could not type, from its bytes', async () => {
    // `File.type` is empty for a file the browser does not recognise, and the
    // client then sends application/octet-stream. That type needs a
    // preflight like image/* does, and the bytes decide what it is.
    const response = await handleMedia(
      upload(PNG, { 'content-type': 'application/octet-stream' }),
      env(),
      as('user_a'),
      options,
    );
    assert.equal(response.status, 201);
    assert.equal((await body(response)).media.contentType, 'image/png');
  });

  it('gives two uploads of the same name at once different paths', async () => {
    const e = env();
    const [first, second] = await Promise.all([
      handleMedia(upload(PNG), e, as('user_a'), options),
      handleMedia(upload(PNG), e, as('user_a'), options),
    ]);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const paths = [
      (await body(first)).media.path,
      (await body(second)).media.path,
    ].sort();
    assert.deepEqual(paths, ['media/hero-shot-2.png', 'media/hero-shot.png']);
  });

  it('chooses the path again when another upload took it first', async () => {
    // The race above resolves in order on this in-memory database, so the
    // loss is made to happen: the first insert fails on the unique path, as
    // D1 reports it, and the upload must choose again rather than fail.
    const e = env();
    const db = e.DB!;
    let failed = false;
    e.DB = {
      ...db,
      prepare: (sql: string) => {
        const statement = db.prepare(sql);
        if (!failed && /INSERT INTO project_media/.test(sql)) {
          failed = true;
          return {
            ...statement,
            bind: () => ({
              run: async () => {
                throw new Error(
                  'D1_ERROR: UNIQUE constraint failed: project_media.user_id, project_media.path',
                );
              },
            }),
          } as unknown as ReturnType<typeof db.prepare>;
        }
        return statement;
      },
    } as typeof db;
    const response = await handleMedia(upload(PNG), e, as('user_a'), options);
    assert.equal(response.status, 201);
    assert.equal(failed, true);
    assert.equal((await body(response)).media.path, 'media/hero-shot.png');
  });

  it('refuses a cross-site origin', async () => {
    const response = await handleMedia(
      upload(PNG, { origin: 'https://evil.example' }),
      env(),
      as('user_a'),
      options,
    );
    assert.equal(response.status, 403);
  });

  it('refuses an image past the image limit, and anything past the video limit', async () => {
    const bigImage = new Uint8Array(MEDIA_IMAGE_MAX_BYTES + 1);
    bigImage.set(PNG);
    const tooBigImage = await handleMedia(
      upload(bigImage),
      env(),
      as('user_a'),
      options,
    );
    assert.equal(tooBigImage.status, 413);
    assert.match((await body(tooBigImage)).error, /Images can be at most 8 MB/);

    const declared = await handleMedia(
      upload(PNG, { 'content-length': String(MEDIA_VIDEO_MAX_BYTES + 1) }),
      env(),
      as('user_a'),
      options,
    );
    assert.equal(declared.status, 413);
  });

  it('never overwrites a path already in the library', async () => {
    const e = env();
    await handleMedia(upload(PNG), e, as('user_a'), options);
    const second = await handleMedia(upload(PNG), e, as('user_a'), options);
    assert.equal((await body(second)).media.path, 'media/hero-shot-2.png');
  });

  it('stops at the file quota', async () => {
    const e = env();
    for (let n = 0; n < MEDIA_ACCOUNT_MAX_FILES; n += 1) {
      const response = await handleMedia(upload(PNG), e, as('user_a'), options);
      assert.equal(response.status, 201);
    }
    const over = await handleMedia(upload(PNG), e, as('user_a'), options);
    assert.equal(over.status, 409);
  });

  it('keeps the quota when two uploads race for the last place', async () => {
    const e = env();
    for (let n = 0; n < MEDIA_ACCOUNT_MAX_FILES - 1; n += 1) {
      const response = await handleMedia(upload(PNG), e, as('user_a'), options);
      assert.equal(response.status, 201);
    }
    // Both read the same usage before either is stored; only one fits.
    const raced = await Promise.all(
      ['one.png', 'two.png'].map((name) =>
        handleMedia(
          upload(PNG, { 'x-media-name': name }),
          e,
          as('user_a'),
          options,
        ),
      ),
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409]);
    assert.equal(e.bucket.keys().length, MEDIA_ACCOUNT_MAX_FILES);
  });

  it('stores exactly the bytes sent when the length is declared', async () => {
    for (const declared of [PNG.byteLength, PNG.byteLength + 64]) {
      const e = env();
      const response = await handleMedia(
        upload(PNG, { 'content-length': String(declared) }),
        e,
        as('user_a'),
        options,
      );
      assert.equal(response.status, 201, String(declared));
      const { media } = await body(response);
      assert.equal(media.bytes, PNG.byteLength);
      assert.deepEqual(
        [...e.bucket.bytes(mediaObjectKey('user_a', media.id))!],
        [...PNG],
      );
    }
    // More bytes than it declared is refused, not truncated.
    const lying = await handleMedia(
      upload(PNG, { 'content-length': String(PNG.byteLength - 4) }),
      env(),
      as('user_a'),
      options,
    );
    assert.equal(lying.status, 413);
  });

  it('keeps alt text to one printable line', async () => {
    const response = await handleMedia(
      upload(PNG, {
        'x-media-alt': encodeURIComponent('A pier\u0001 at\ndusk\u007f'),
      }),
      env(),
      as('user_a'),
      options,
    );
    assert.equal((await body(response)).media.alt, 'A pier at dusk');
  });

  it('links a poster to its video, and only to a video of the same account', async () => {
    const e = env();
    const video = await body(
      await handleMedia(
        upload(MP4, {
          'content-type': 'video/mp4',
          'x-media-name': 'loop.mp4',
        }),
        e,
        as('user_a'),
        options,
      ),
    );
    const poster = await handleMedia(
      upload(PNG, {
        'x-media-name': 'loop-poster.png',
        'x-media-poster-for': video.media.id,
      }),
      e,
      as('user_a'),
      options,
    );
    assert.equal(poster.status, 201);
    const list = await body(
      await handleMedia(
        new Request(`${ORIGIN}/api/media`),
        e,
        as('user_a'),
        options,
      ),
    );
    const listed = list.media.find(
      (entry: { id: string }) => entry.id === video.media.id,
    );
    assert.equal(listed.posterPath, 'media/loop-poster.png');

    const stranger = await handleMedia(
      upload(PNG, { 'x-media-poster-for': video.media.id }),
      e,
      as('user_b'),
      options,
    );
    assert.equal(stranger.status, 404);
  });
});

describe("one account's library is its own", () => {
  it("lists only the caller's files, with what it may still hold", async () => {
    const e = env();
    await handleMedia(upload(PNG), e, as('user_a'), options);
    const list = await body(
      await handleMedia(
        new Request(`${ORIGIN}/api/media`),
        e,
        as('user_b'),
        options,
      ),
    );
    assert.deepEqual(list.media, []);
    assert.equal(list.usage.files, 0);
    assert.equal(list.usage.maxFiles, MEDIA_ACCOUNT_MAX_FILES);
  });

  it("removes a file and its bytes, and never another account's", async () => {
    const e = env();
    const { media } = await body(
      await handleMedia(upload(PNG), e, as('user_a'), options),
    );
    const remove = (userId: string) =>
      handleMedia(
        new Request(`${ORIGIN}/api/media?id=${media.id}`, { method: 'DELETE' }),
        e,
        as(userId),
        options,
      );
    assert.equal((await remove('user_b')).status, 404);
    assert.ok(e.bucket.bytes(mediaObjectKey('user_a', media.id)));
    assert.equal((await remove('user_a')).status, 200);
    assert.equal(e.bucket.bytes(mediaObjectKey('user_a', media.id)), undefined);
  });
});

describe('removing when storage fails', () => {
  it('keeps the file listed, so trying again removes its bytes', async () => {
    const e = env();
    const { media } = await body(
      await handleMedia(upload(PNG), e, as('user_a'), options),
    );
    const key = mediaObjectKey('user_a', media.id);
    const realDelete = e.bucket.delete.bind(e.bucket);
    let failures = 1;
    e.bucket.delete = async (keys: string | string[]) => {
      if (failures-- > 0) throw new Error('R2 unavailable');
      return realDelete(keys as string);
    };
    const remove = () =>
      handleMedia(
        new Request(`${ORIGIN}/api/media?id=${media.id}`, { method: 'DELETE' }),
        e,
        as('user_a'),
        options,
      );
    assert.equal((await remove()).status, 503);
    const listed = await body(
      await handleMedia(
        new Request(`${ORIGIN}/api/media`),
        e,
        as('user_a'),
        options,
      ),
    );
    assert.deepEqual(
      listed.media.map((item: { id: string }) => item.id),
      [media.id],
    );
    assert.ok(e.bucket.bytes(key));
    assert.equal((await remove()).status, 200);
    assert.equal(e.bucket.bytes(key), undefined);
  });
});

describe('a deployment without media', () => {
  it('says so rather than failing', async () => {
    const response = await handleMedia(upload(PNG), {}, as('user_a'), options);
    assert.equal(response.status, 503);
  });
});
