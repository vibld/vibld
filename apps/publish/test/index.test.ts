import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import worker, { type Env } from '../worker/index.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The real migrations, not a copy of them.
 *
 * This package binds the same D1 database apps/web migrates (ADR-0010), and
 * an inline copy of the table here is a copy that drifts: the column
 * 0016_unpublish.sql adds is exactly the kind of thing a hand-written
 * fixture keeps passing without.
 */
const SCHEMA = ['0003_publish.sql', '0016_unpublish.sql']
  .map((file) =>
    readFileSync(
      join(import.meta.dirname, '..', '..', 'web', 'migrations', file),
      'utf8',
    ),
  )
  .join('\n');

const SECRET = 'test-secret';

function newEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: new SqliteD1Database(SCHEMA),
    PROJECT_CONTENT: new InMemoryR2Bucket(),
    PUBLISH_INTERNAL_SECRET: SECRET,
    PUBLISH_HOSTNAME: 'published.vibld-preview.dev',
    ...overrides,
  };
}

function internalRequest(
  path: string,
  body: unknown,
  secret = SECRET,
): Request {
  return new Request(`https://internal.example/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function publicRequest(hostname: string, path = '/'): Request {
  return new Request(`https://${hostname}${path}`);
}

describe('apps/publish Worker: internal API', () => {
  it('refuses a publish call with no internal secret configured', async () => {
    const env = newEnv({ PUBLISH_INTERNAL_SECRET: undefined });
    const response = await worker.fetch(
      internalRequest(
        'internal/publish',
        {
          userId: 'u1',
          projectId: 'p1',
          slug: 'acme',
          files: [{ path: 'index.html', content: 'hi' }],
        },
        '',
      ),
      env,
    );
    assert.equal(response.status, 403);
  });

  it('refuses a publish call with the wrong secret', async () => {
    const env = newEnv();
    const response = await worker.fetch(
      internalRequest(
        'internal/publish',
        {
          userId: 'u1',
          projectId: 'p1',
          slug: 'acme',
          files: [{ path: 'index.html', content: 'hi' }],
        },
        'wrong',
      ),
      env,
    );
    assert.equal(response.status, 403);
  });

  it('publishes a new project and returns its URL', async () => {
    const env = newEnv();
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: '<h1>Acme</h1>' }],
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { slug: string; url: string };
    assert.equal(body.slug, 'acme');
    assert.equal(body.url, 'https://acme.published.vibld-preview.dev/');
  });

  it('rejects a first publish with no slug', async () => {
    const env = newEnv();
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: 'hi' }],
      }),
      env,
    );
    assert.equal(response.status, 400);
  });

  it('rejects an invalid slug', async () => {
    const env = newEnv();
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'Not Valid!',
        files: [{ path: 'index.html', content: 'hi' }],
      }),
      env,
    );
    assert.equal(response.status, 400);
  });

  it('rejects claiming a slug someone else already has', async () => {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: 'hi' }],
      }),
      env,
    );
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u2',
        projectId: 'p2',
        slug: 'acme',
        files: [{ path: 'index.html', content: 'hi' }],
      }),
      env,
    );
    assert.equal(response.status, 409);
  });

  it('reuses the existing slug on a republish with no slug given', async () => {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: 'v1' }],
      }),
      env,
    );
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: 'v2' }],
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { slug: string };
    assert.equal(body.slug, 'acme');
  });

  it('refuses a republish that tries to change the slug', async () => {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: 'v1' }],
      }),
      env,
    );
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'different',
        files: [{ path: 'index.html', content: 'v2' }],
      }),
      env,
    );
    assert.equal(response.status, 409);
  });

  it('refuses a publish for a project already owned by a different user', async () => {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: 'v1' }],
      }),
      env,
    );
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u2',
        projectId: 'p1',
        files: [{ path: 'index.html', content: 'v2' }],
      }),
      env,
    );
    assert.equal(response.status, 403);
  });
});

describe('apps/publish Worker: public serving', () => {
  async function publishedEnv(): Promise<Env> {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [
          { path: 'index.html', content: '<h1>Home</h1>' },
          { path: 'about.html', content: '<h1>About</h1>' },
          { path: 'assets/app.js', content: 'console.log(1)' },
        ],
      }),
      env,
    );
    return env;
  }

  it('serves the root of a published slug', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev', '/'),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
    assert.equal(await response.text(), '<h1>Home</h1>');
  });

  it('serves an extensionless route via the .html fallback', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev', '/about'),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<h1>About</h1>');
  });

  it('serves a nested asset with the right content type', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev', '/assets/app.js'),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'text/javascript; charset=utf-8',
    );
  });

  it('404s an unknown path under a published slug', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev', '/nope'),
      env,
    );
    assert.equal(response.status, 404);
  });

  it('404s a slug that was never published', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('ghost.published.vibld-preview.dev', '/'),
      env,
    );
    assert.equal(response.status, 404);
  });

  it('404s a request to the bare publish hostname (no slug label)', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('published.vibld-preview.dev', '/'),
      env,
    );
    assert.equal(response.status, 404);
  });

  it('404s a request with an extra subdomain level', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(
      publicRequest('deep.acme.published.vibld-preview.dev', '/'),
      env,
    );
    assert.equal(response.status, 404);
  });

  it('404s a request to an unrelated hostname', async () => {
    const env = await publishedEnv();
    const response = await worker.fetch(publicRequest('example.com', '/'), env);
    assert.equal(response.status, 404);
  });
});

/**
 * `/internal/unpublish` (ADR-0013): the route that takes a site down.
 *
 * Same trust model as `/internal/publish` -- the shared secret proves the
 * caller is apps/web, and apps/web has already resolved a Clerk principal
 * -- plus the ownership check this Worker is the only one able to make,
 * since the store is what knows whose slug this is.
 */
describe('apps/publish Worker: taking a site down', () => {
  async function published(env: Env): Promise<void> {
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: '<h1>acme</h1>' }],
      }),
      env,
    );
    assert.equal(response.status, 200);
  }

  it('refuses a caller without the internal secret', async () => {
    const env = newEnv();
    await published(env);

    const response = await worker.fetch(
      internalRequest(
        'internal/unpublish',
        { userId: 'u1', projectId: 'p1' },
        'the-wrong-secret',
      ),
      env,
    );

    assert.equal(response.status, 403);
    // Still serving: a refused takedown must not half-happen.
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });

  it('refuses to take down a project belonging to somebody else', async () => {
    const env = newEnv();
    await published(env);

    const response = await worker.fetch(
      internalRequest('internal/unpublish', {
        userId: 'u2',
        projectId: 'p1',
      }),
      env,
    );

    assert.equal(response.status, 403);
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });

  it('answers 404 for a project that was never published', async () => {
    const env = newEnv();
    const response = await worker.fetch(
      internalRequest('internal/unpublish', {
        userId: 'u1',
        projectId: 'never',
      }),
      env,
    );
    assert.equal(response.status, 404);
  });

  it('takes the site off the web', async () => {
    const env = newEnv();
    await published(env);

    const before = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(before.status, 200);

    const response = await worker.fetch(
      internalRequest('internal/unpublish', {
        userId: 'u1',
        projectId: 'p1',
      }),
      env,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { slug: 'acme' });

    const after = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(after.status, 404, 'the site was still being served');
  });

  it('puts it back under the same name when it is published again', async () => {
    // ADR-0013 calls rollback a first-class, person-taken action. This is
    // the half of it that exists today: down, then up again, under the name
    // the owner never lost.
    const env = newEnv();
    await published(env);
    await worker.fetch(
      internalRequest('internal/unpublish', { userId: 'u1', projectId: 'p1' }),
      env,
    );

    const again = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: '<h1>back</h1>' }],
      }),
      env,
    );
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), {
      slug: 'acme',
      url: 'https://acme.published.vibld-preview.dev/',
    });

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
    assert.equal(await site.text(), '<h1>back</h1>');
  });

  it('refuses GET, so a link cannot take a site down', async () => {
    const env = newEnv();
    await published(env);

    const response = await worker.fetch(
      new Request('https://internal.example/internal/unpublish', {
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
      env,
    );

    assert.equal(response.status, 404);
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });
});
