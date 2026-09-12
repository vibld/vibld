import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import worker, { type Env } from '../worker/index.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = `
CREATE TABLE published_projects (
  slug TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

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
