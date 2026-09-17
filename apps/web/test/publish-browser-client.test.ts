import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  publishProject,
  unpublishProject,
} from '../src/generation/publish-client.ts';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('publishProject', () => {
  it('sends the Clerk bearer token, files and slug', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({
          slug: 'acme',
          url: 'https://acme.published.vibld-preview.dev/',
          skipped: [],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await publishProject(
      [{ path: 'index.html', content: 'hi' }],
      'acme',
      fetchImpl,
      async () => 'a-token',
    );

    assert.deepEqual(result, {
      ok: true,
      slug: 'acme',
      url: 'https://acme.published.vibld-preview.dev/',
      skipped: [],
    });
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/publish');
    assert.equal(init?.method, 'POST');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer a-token',
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      files: [{ path: 'index.html', content: 'hi' }],
      slug: 'acme',
    });
  });

  it('omits slug from the body on a republish', async () => {
    const calls: Array<RequestInit | undefined> = [];
    await publishProject([], undefined, (async (
      _url: string,
      init?: RequestInit,
    ) => {
      calls.push(init);
      return new Response(
        JSON.stringify({
          slug: 'acme',
          url: 'https://acme.published.vibld-preview.dev/',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch);
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), { files: [] });
  });

  it('reports skipped binary paths', async () => {
    const result = await publishProject(
      [],
      'acme',
      jsonFetch({
        slug: 'acme',
        url: 'https://acme.published.vibld-preview.dev/',
        skipped: ['logo.png'],
      }),
    );
    assert.deepEqual(result, {
      ok: true,
      slug: 'acme',
      url: 'https://acme.published.vibld-preview.dev/',
      skipped: ['logo.png'],
    });
  });

  it('surfaces the server error message rather than a generic one', async () => {
    const result = await publishProject(
      [],
      'acme',
      jsonFetch({ error: 'That slug is already taken.' }, 409),
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'That slug is already taken.',
    });
  });

  it('falls back to a generic message when the error body is unreadable', async () => {
    const result = await publishProject(
      [],
      'acme',
      (async () =>
        new Response('not json', { status: 500 })) as unknown as typeof fetch,
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish request failed. Try again shortly.',
    });
  });

  it('treats a 200 response with no readable slug/url as a failure, not a crash', async () => {
    const result = await publishProject([], 'acme', jsonFetch({}));
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish service returned an unexpected response.',
    });
  });

  it('does not crash on an unreadable success body', async () => {
    const result = await publishProject(
      [],
      'acme',
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish service returned an unreadable response.',
    });
  });
});

describe('unpublishProject', () => {
  it('deletes, sends the Clerk bearer token, and names no site', async () => {
    // What comes down is whatever this caller has up. A body naming a slug
    // would be a caller choosing a site, which is not theirs to choose.
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ slug: 'acme' }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await unpublishProject(fetchImpl, async () => 'a-token');

    assert.deepEqual(result, { ok: true, slug: 'acme' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], '/api/publish');
    assert.equal(calls[0]?.[1]?.method, 'DELETE');
    assert.equal(calls[0]?.[1]?.body, undefined);
    assert.deepEqual(calls[0]?.[1]?.headers, {
      Authorization: 'Bearer a-token',
    });
  });

  it('sends no Authorization header when there is no token', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ slug: 'acme' }), { status: 200 });
    }) as unknown as typeof fetch;

    await unpublishProject(fetchImpl, async () => null);

    assert.deepEqual(calls[0]?.[1]?.headers, {});
  });

  it("reports the server's own refusal", async () => {
    const result = await unpublishProject(
      jsonFetch({ error: 'This project is published by another user.' }, 403),
      async () => 'a-token',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'This project is published by another user.',
    });
  });

  it('treats a 200 with no slug as a failure, not a success', async () => {
    // Answering "it is down" on a reply that never said so is the one
    // outcome worth guarding here: somebody stops checking.
    const result = await unpublishProject(jsonFetch({}), async () => 'a-token');
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish service returned an unexpected response.',
    });
  });

  it('does not crash on an unreadable success body', async () => {
    const result = await unpublishProject(
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
      async () => 'a-token',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish service returned an unreadable response.',
    });
  });
});
