import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createShare,
  listShares,
  previewConfigured,
  previewStatus,
  revokeShare,
  startPreview,
  stopPreview,
} from '../worker/preview-client.ts';
import type { ServiceBinding } from '../worker/preview-client.ts';

function fakeBinding(handler: (request: Request) => Response): {
  binding: ServiceBinding;
  calls: Request[];
} {
  const calls: Request[] = [];
  return {
    binding: {
      fetch: async (request: Request) => {
        calls.push(request);
        return handler(request);
      },
    },
    calls,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('previewConfigured', () => {
  it('requires both the binding and the shared secret', () => {
    const { binding } = fakeBinding(() => jsonResponse({}));
    assert.equal(previewConfigured({}), false);
    assert.equal(previewConfigured({ PREVIEW: binding }), false);
    assert.equal(
      previewConfigured({ PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' }),
      true,
    );
  });
});

describe('startPreview', () => {
  it('posts the files and userId, with the shared secret attached', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({ status: 'installing' }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's3cr3t' },
      'user_abc',
      [{ path: 'src/App.tsx', content: 'x' }],
    );

    assert.deepEqual(result, { status: 'installing' });
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/start');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer s3cr3t');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.deepEqual(body.files, [{ path: 'src/App.tsx', content: 'x' }]);
  });

  it('parses a queued response, including position', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ status: 'queued', position: 3 }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, { status: 'queued', position: 3 });
  });

  it('parses a ready response', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({
        status: 'ready',
        url: 'https://5173-abc-def.vibld-preview.dev',
        expiresAt: 1_800_000_000_000,
      }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, {
      status: 'ready',
      url: 'https://5173-abc-def.vibld-preview.dev',
      expiresAt: 1_800_000_000_000,
    });
  });

  it('treats a ready response missing url/expiresAt as a failure, not a crash', async () => {
    const { binding } = fakeBinding(() => jsonResponse({ status: 'ready' }));
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.equal(result.status, 'failed');
  });

  it('surfaces the service error message on failure', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ status: 'failed', error: 'npm install failed' }, 200),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, { status: 'failed', error: 'npm install failed' });
  });

  it('does not crash on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const result = await startPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.equal(result.status, 'failed');
  });
});

describe('previewStatus', () => {
  it('gets the status endpoint with the userId in the query string', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({ status: 'ready-to-start' }),
    );
    const result = await previewStatus(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user abc',
    );
    assert.deepEqual(result, { status: 'ready-to-start' });
    const request = calls[0]!;
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).searchParams.get('userId'), 'user abc');
  });
});

describe('stopPreview', () => {
  it('posts the userId to the stop endpoint', async () => {
    const { binding, calls } = fakeBinding(() => jsonResponse({ ok: true }));
    await stopPreview(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/stop');
    assert.equal(request.method, 'POST');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
  });
});

describe('createShare', () => {
  it('posts the userId and returns the parsed grant', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        shareId: 'share_1',
        expiresAt: 1_800_000_000_000,
        url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
      }),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, {
      ok: true,
      shareId: 'share_1',
      expiresAt: 1_800_000_000_000,
      url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
    });
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(request.method, 'POST');
    assert.equal((await request.json()).userId, 'user_abc');
  });

  it('surfaces the service error message when the preview cannot be shared', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'This preview is not currently running.' }, 409),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'This preview is not currently running.',
    });
  });

  it('does not crash on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const result = await createShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.equal(result.ok, false);
  });
});

describe('listShares', () => {
  it('gets the share endpoint with the userId in the query string', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        shares: [
          {
            shareId: 'share_1',
            createdAt: 1,
            expiresAt: 1_800_000_000_000,
            revoked: false,
            url: 'https://share.vibld-preview.dev/user_abc/share_1?exp=1&sig=x',
          },
          {
            shareId: 'share_2',
            createdAt: 2,
            expiresAt: 3,
            revoked: true,
          },
        ],
      }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user abc',
    );
    assert.equal(shares.length, 2);
    assert.equal(shares[1]!.revoked, true);
    assert.equal(shares[1]!.url, undefined);
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(new URL(request.url).searchParams.get('userId'), 'user abc');
  });

  it('filters out anything not shaped like a share', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ shares: [{ shareId: 'share_1' }, 'garbage', null] }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(shares, []);
  });

  it('is an empty list on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const shares = await listShares(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
    );
    assert.deepEqual(shares, []);
  });
});

describe('revokeShare', () => {
  it('sends the userId and shareId to the share endpoint as a DELETE', async () => {
    const { binding, calls } = fakeBinding(() => jsonResponse({ ok: true }));
    await revokeShare(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      'share_1',
    );
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/share');
    assert.equal(request.method, 'DELETE');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.equal(body.shareId, 'share_1');
  });
});
