import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchPreviewStatus,
  startSandboxPreview,
  stopSandboxPreview,
} from '../src/generation/preview-client.ts';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('fetchPreviewStatus', () => {
  it('sends the Clerk bearer token and returns the parsed status', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ status: 'installing' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const status = await fetchPreviewStatus(fetchImpl, async () => 'a-token');

    assert.deepEqual(status, { status: 'installing' });
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer a-token',
    );
  });

  it('omits the Authorization header when signed out', async () => {
    const calls: Array<RequestInit | undefined> = [];
    await fetchPreviewStatus(
      (async (_url: string, init?: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify({ status: 'ready-to-start' }), {
          status: 200,
        });
      }) as unknown as typeof fetch,
      async () => null,
    );
    assert.equal(
      (calls[0]?.headers as Record<string, string>).Authorization,
      undefined,
    );
  });

  it('parses a queued status, including position', async () => {
    assert.deepEqual(
      await fetchPreviewStatus(jsonFetch({ status: 'queued', position: 3 })),
      { status: 'queued', position: 3 },
    );
  });

  it('parses a ready status', async () => {
    assert.deepEqual(
      await fetchPreviewStatus(
        jsonFetch({
          status: 'ready',
          url: 'https://5173-abc-def.vibld-preview.dev',
          expiresAt: 1_800_000_000_000,
        }),
      ),
      {
        status: 'ready',
        url: 'https://5173-abc-def.vibld-preview.dev',
        expiresAt: 1_800_000_000_000,
      },
    );
  });

  it('treats a ready status missing url/expiresAt as a failure, not a crash', async () => {
    const status = await fetchPreviewStatus(jsonFetch({ status: 'ready' }));
    assert.equal(status?.status, 'failed');
  });

  it('is null rather than throwing when signed out or unauthorized', async () => {
    assert.equal(
      await fetchPreviewStatus(jsonFetch({ error: 'Sign in required.' }, 401)),
      null,
    );
  });

  it('is null when the deployment has no preview endpoint at all', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    assert.equal(await fetchPreviewStatus(failing), null);
  });
});

describe('startSandboxPreview', () => {
  it('posts the files and returns the parsed status', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ status: 'installing' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const status = await startSandboxPreview(
      [{ path: 'src/App.tsx', content: 'x' }],
      fetchImpl,
      async () => 'a-token',
    );

    assert.deepEqual(status, { status: 'installing' });
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      files: [{ path: 'src/App.tsx', content: 'x' }],
    });
  });

  it('surfaces the server error message rather than failing opaquely', async () => {
    await assert.rejects(
      () =>
        startSandboxPreview(
          [],
          jsonFetch(
            { error: 'Preview is not configured for this deployment.' },
            503,
          ),
        ),
      /not configured for this deployment/,
    );
  });

  it('does not crash on an unreadable response body', async () => {
    const status = await startSandboxPreview(
      [],
      (async () =>
        new Response('not json', { status: 200 })) as unknown as typeof fetch,
    );
    assert.equal(status.status, 'failed');
  });
});

describe('stopSandboxPreview', () => {
  it('sends a DELETE request', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    await stopSandboxPreview(
      (async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch,
      async () => 'a-token',
    );
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview');
    assert.equal(init?.method, 'DELETE');
  });

  it('throws on a failed stop, rather than pretending it succeeded', async () => {
    await assert.rejects(
      () => stopSandboxPreview(jsonFetch({ error: 'nope' }, 500)),
      /nope/,
    );
  });
});
