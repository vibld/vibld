import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoPublishConfigured,
  buildProject,
  publishProject,
  publishServiceConfigured,
  unpublishProject,
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

describe('publishServiceConfigured', () => {
  it('asks only for the publish service, not the build one', () => {
    // Publishing builds first, so it needs apps/preview as well. A takedown
    // builds nothing, and requiring preview anyway would answer 503 to the
    // one control that removes a live site on a deployment where removing it
    // still works. A fail-closed check has to fail closed on its own subject.
    const { binding } = fakeBinding(() => jsonResponse({}));
    assert.equal(publishServiceConfigured({}), false);
    assert.equal(publishServiceConfigured({ PUBLISH: binding }), false);
    assert.equal(
      publishServiceConfigured({ PUBLISH_INTERNAL_SECRET: 's' }),
      false,
    );
    assert.equal(
      publishServiceConfigured({
        PUBLISH: binding,
        PUBLISH_INTERNAL_SECRET: 's',
      }),
      true,
      'a takedown was refused on a deployment that can take things down',
    );
    // The point of the split, stated as an assertion: publishing still wants
    // both services.
    assert.equal(
      autoPublishConfigured({
        PUBLISH: binding,
        PUBLISH_INTERNAL_SECRET: 's',
      }),
      false,
    );
  });
});

describe('unpublishProject', () => {
  it('posts the caller and the project to the publish service', async () => {
    const { binding, calls } = fakeBinding(() =>
      jsonResponse({ slug: 'acme' }),
    );

    const result = await unpublishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 'the-secret' },
      'user_1',
      'proj_1',
    );

    assert.deepEqual(result, { ok: true, slug: 'acme' });
    assert.equal(calls.length, 1);
    const sent = calls[0]!;
    assert.equal(new URL(sent.url).pathname, '/internal/unpublish');
    assert.equal(sent.method, 'POST');
    assert.equal(sent.headers.get('Authorization'), 'Bearer the-secret');
    assert.deepEqual(await sent.json(), {
      userId: 'user_1',
      projectId: 'proj_1',
    });
  });

  it('passes a refusal through with its own status', async () => {
    // A 403 is the caller's answer and a 404 is a project that was never
    // published. Collapsing either into a 502 would tell somebody this
    // service is broken when it is working exactly as intended.
    const { binding } = fakeBinding(() =>
      jsonResponse(
        { error: 'This project is published by another user.' },
        403,
      ),
    );

    const result = await unpublishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_2',
      'proj_1',
    );

    assert.deepEqual(result, {
      ok: false,
      error: 'This project is published by another user.',
      status: 403,
    });
  });

  it("reports a service failure as 502, not as the caller's fault", async () => {
    const { binding } = fakeBinding(() => jsonResponse({ error: 'boom' }, 500));
    const result = await unpublishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_1',
      'proj_1',
    );
    assert.deepEqual(result, { ok: false, error: 'boom', status: 502 });
  });

  it('does not report success on a reply that never said so', async () => {
    const { binding } = fakeBinding(() => jsonResponse({}));
    const result = await unpublishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_1',
      'proj_1',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'Could not take this project down.',
      status: 502,
    });
  });

  it('does not crash on an unreadable reply', async () => {
    const { binding } = fakeBinding(() => new Response('not json'));
    const result = await unpublishProject(
      { PUBLISH: binding, PUBLISH_INTERNAL_SECRET: 's' },
      'user_1',
      'proj_1',
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'The publish service returned an unreadable response.',
      status: 502,
    });
  });
});
