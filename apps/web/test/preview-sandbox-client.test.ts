import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPreviewShare,
  fetchPreviewShares,
  fetchPreviewStatus,
  revokePreviewShare,
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

describe('fetchPreviewShares', () => {
  it('sends the Clerk bearer token and returns the parsed list', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({
          shares: [
            {
              shareId: 'share_1',
              createdAt: 1,
              expiresAt: 2,
              revoked: false,
              url: 'https://share.vibld-preview.dev/user_1/share_1?exp=2&sig=x',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const shares = await fetchPreviewShares(fetchImpl, async () => 'a-token');

    assert.equal(shares.length, 1);
    assert.equal(shares[0]!.shareId, 'share_1');
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview/share');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer a-token',
    );
  });

  it('filters out anything not shaped like a share', async () => {
    const shares = await fetchPreviewShares(
      jsonFetch({ shares: [{ shareId: 'share_1' }, 'garbage', null] }),
    );
    assert.deepEqual(shares, []);
  });

  it('is an empty list rather than throwing when signed out or unauthorized', async () => {
    assert.deepEqual(
      await fetchPreviewShares(jsonFetch({ error: 'Sign in required.' }, 401)),
      [],
    );
  });

  it('is an empty list when the deployment has no preview endpoint at all', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    assert.deepEqual(await fetchPreviewShares(failing), []);
  });
});

describe('createPreviewShare', () => {
  it('posts and returns the parsed grant', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({
          shareId: 'share_1',
          expiresAt: 1_800_000_000_000,
          url: 'https://share.vibld-preview.dev/user_1/share_1?exp=1&sig=x',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const share = await createPreviewShare(fetchImpl, async () => 'a-token');

    assert.equal(share.shareId, 'share_1');
    assert.equal(share.revoked, false);
    assert.equal(
      share.url,
      'https://share.vibld-preview.dev/user_1/share_1?exp=1&sig=x',
    );
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview/share');
    assert.equal(init?.method, 'POST');
  });

  it('surfaces the server error message rather than failing opaquely', async () => {
    await assert.rejects(
      () =>
        createPreviewShare(
          jsonFetch({ error: 'This preview is not currently running.' }, 409),
        ),
      /not currently running/,
    );
  });

  it('rejects a 200 response that is not shaped like a grant', async () => {
    await assert.rejects(
      () => createPreviewShare(jsonFetch({})),
      /unreadable response/,
    );
  });
});

describe('revokePreviewShare', () => {
  it('sends the shareId as a DELETE', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    await revokePreviewShare(
      'share_1',
      (async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch,
      async () => 'a-token',
    );
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/preview/share');
    assert.equal(init?.method, 'DELETE');
    assert.deepEqual(JSON.parse(String(init?.body)), { shareId: 'share_1' });
  });

  it('throws on a failed revoke, rather than pretending it succeeded', async () => {
    await assert.rejects(
      () => revokePreviewShare('share_1', jsonFetch({ error: 'nope' }, 500)),
      /nope/,
    );
  });
});
