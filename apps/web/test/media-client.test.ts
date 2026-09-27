import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchMedia,
  formatBytes,
  removeMedia,
  uploadMedia,
} from '../src/generation/media-client.ts';

/**
 * The builder's calls to `/api/media`: what it sends, and what it makes of
 * every answer, including the ones that are not answers.
 */

const token = async () => 'tok';

function recorder(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('uploading a file', () => {
  it('sends the bytes raw, with the name and alt text encoded in headers', async () => {
    const { calls, fetchImpl } = recorder(
      Response.json(
        {
          media: {
            id: 'm1',
            path: 'media/hero.png',
            kind: 'image',
            contentType: 'image/png',
            bytes: 4,
            alt: 'Café at dawn',
          },
        },
        { status: 201 },
      ),
    );
    const file = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: 'image/png',
    });
    const result = await uploadMedia(
      file,
      { name: 'Café hero.png', alt: 'Café at dawn' },
      fetchImpl,
      token,
    );
    assert.equal(result.ok, true);
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(calls[0]!.init.method, 'POST');
    assert.equal(headers.Authorization, 'Bearer tok');
    assert.equal(headers['content-type'], 'image/png');
    assert.equal(decodeURIComponent(headers['x-media-name']!), 'Café hero.png');
    assert.equal(decodeURIComponent(headers['x-media-alt']!), 'Café at dawn');
    assert.equal(headers['x-media-poster-for'], undefined);
    assert.equal(calls[0]!.init.body, file);
  });

  it("passes on the server's reason when it refuses", async () => {
    const { fetchImpl } = recorder(
      Response.json(
        { error: 'Only JPEG, PNG ... can be used.' },
        { status: 415 },
      ),
    );
    const result = await uploadMedia(
      new Blob(['<svg/>'], { type: 'image/svg+xml' }),
      { name: 'x.svg', alt: '' },
      fetchImpl,
      token,
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'Only JPEG, PNG ... can be used.',
    });
  });

  it('says the upload never arrived when the network fails', async () => {
    const { fetchImpl } = recorder(new Error('offline'));
    const result = await uploadMedia(
      new Blob(['x']),
      { name: 'x', alt: '' },
      fetchImpl,
      token,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /did not reach Vibld/);
  });
});

describe('reading and pruning the library', () => {
  it('keeps only well-formed entries', async () => {
    const { fetchImpl } = recorder(
      Response.json({
        media: [
          { id: 'm1', path: 'media/a.png', kind: 'image', bytes: 1, alt: '' },
          { id: 'm2', path: 'media/b.svg', kind: 'script', bytes: 1, alt: '' },
        ],
        usage: { files: 1, bytes: 1, maxFiles: 30, maxBytes: 200 },
      }),
    );
    const library = await fetchMedia(fetchImpl, token);
    assert.equal(library?.media.length, 1);
    assert.equal(library?.usage.maxFiles, 30);
  });

  it('reads as unavailable rather than empty when it cannot be read', async () => {
    assert.equal(
      await fetchMedia(recorder(new Error('down')).fetchImpl, token),
      null,
    );
    assert.equal(
      await fetchMedia(
        recorder(new Response('nope', { status: 503 })).fetchImpl,
        token,
      ),
      null,
    );
  });

  it('removes by id, encoded', async () => {
    const { calls, fetchImpl } = recorder(Response.json({ removed: 'a b' }));
    assert.equal(await removeMedia('a b', fetchImpl, token), true);
    assert.equal(calls[0]!.url, '/api/media?id=a%20b');
    assert.equal(calls[0]!.init.method, 'DELETE');
  });

  it('writes sizes a person reads', () => {
    assert.equal(formatBytes(340 * 1024), '340 KB');
    assert.equal(formatBytes(1.25 * 1024 * 1024), '1.3 MB');
    assert.equal(formatBytes(10), '1 KB');
  });
});
