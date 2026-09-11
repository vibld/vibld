import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  previewConfigured,
  previewStatus,
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
