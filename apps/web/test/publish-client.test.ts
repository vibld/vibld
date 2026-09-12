import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoPublishConfigured,
  buildProject,
  publishProject,
} from '../worker/publish-client.ts';
import type { ServiceBinding } from '../worker/publish-client.ts';

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

describe('autoPublishConfigured', () => {
  it('requires the preview binding/secret and the publish binding/secret', () => {
    const { binding } = fakeBinding(() => jsonResponse({}));
    assert.equal(autoPublishConfigured({}), false);
    assert.equal(
      autoPublishConfigured({ PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 'p' }),
      false,
    );
    assert.equal(
      autoPublishConfigured({
        PREVIEW: binding,
        PREVIEW_INTERNAL_SECRET: 'p',
        PUBLISH: binding,
      }),
      false,
    );
    assert.equal(
      autoPublishConfigured({
        PREVIEW: binding,
        PREVIEW_INTERNAL_SECRET: 'p',
        PUBLISH: binding,
        PUBLISH_INTERNAL_SECRET: 'q',
      }),
      true,
    );
  });
});

describe('buildProject', () => {
  it('posts the files and userId to the build endpoint, with the shared secret attached', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        files: [{ path: 'index.html', content: '<h1>Hi</h1>' }],
        skipped: [],
      }),
    );
    const result = await buildProject(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's3cr3t' },
      'user_abc',
      [{ path: 'src/App.tsx', content: 'x' }],
    );

    assert.deepEqual(result, {
      ok: true,
      files: [{ path: 'index.html', content: '<h1>Hi</h1>' }],
      skipped: [],
    });
    assert.equal(calls.length, 1);
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/preview/build');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer s3cr3t');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.deepEqual(body.files, [{ path: 'src/App.tsx', content: 'x' }]);
  });

  it('reports skipped binary paths', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({
        files: [{ path: 'index.html', content: 'hi' }],
        skipped: ['logo.png'],
      }),
    );
    const result = await buildProject(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, {
      ok: true,
      files: [{ path: 'index.html', content: 'hi' }],
      skipped: ['logo.png'],
    });
  });

  it('surfaces the service error message on failure', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'npm run build failed (exit 1): boom' }),
    );
    const result = await buildProject(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'npm run build failed (exit 1): boom',
    });
  });

  it('treats a response with no readable files as a failure, not a crash', async () => {
    const { binding } = fakeBinding(() => jsonResponse({ files: [] }));
    const result = await buildProject(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.equal(result.ok, false);
  });

  it('does not crash on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const result = await buildProject(
      { PREVIEW: binding, PREVIEW_INTERNAL_SECRET: 's' },
      'user_abc',
      [],
    );
    assert.equal(result.ok, false);
  });
});

describe('publishProject', () => {
  it('posts userId, projectId, slug and files to the publish endpoint', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({
        slug: 'acme',
        url: 'https://acme.published.vibld-preview.dev/',
      }),
    );
    const result = await publishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's3cr3t' },
      'user_abc',
      'user_abc',
      'acme',
      [{ path: 'index.html', content: 'hi' }],
    );
    assert.deepEqual(result, {
      ok: true,
      slug: 'acme',
      url: 'https://acme.published.vibld-preview.dev/',
    });
    const request = calls[0]!;
    assert.equal(new URL(request.url).pathname, '/internal/publish');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer s3cr3t');
    const body = await request.json();
    assert.equal(body.userId, 'user_abc');
    assert.equal(body.projectId, 'user_abc');
    assert.equal(body.slug, 'acme');
  });

  it('surfaces a 4xx error and its status from the publish service', async () => {
    const { binding } = fakeBinding(() =>
      jsonResponse({ error: 'That slug is already taken.' }, 409),
    );
    const result = await publishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_abc',
      'user_abc',
      'acme',
      [],
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'That slug is already taken.',
      status: 409,
    });
  });

  it('collapses a non-4xx failure to a 502', async () => {
    const { binding } = fakeBinding(() => jsonResponse({}, 500));
    const result = await publishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_abc',
      'user_abc',
      undefined,
      [],
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'Could not publish this project.',
      status: 502,
    });
  });

  it('does not crash on an unreadable response body', async () => {
    const { binding } = fakeBinding(
      () => new Response('not json', { status: 200 }),
    );
    const result = await publishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_abc',
      'user_abc',
      undefined,
      [],
    );
    assert.equal(result.ok, false);
  });
});
