import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import worker, { type Env } from '../worker/index.ts';
import { PublishStore } from '../worker/publish-store.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The real migrations, all of them, not a copy and not a chosen subset.
 *
 * This package binds the same D1 database apps/web migrates (ADR-0010). An
 * inline copy of the table drifts, which is what 0016_unpublish.sql's column
 * would have slipped past; naming the files drifts too, one migration later,
 * which is what 0018_operator_hold.sql's did. Reading the directory is the
 * same answer apps/web's own `schemaSql()` settled on, and for the same
 * reason: the fake gets exactly the schema the deployment gets, and adding a
 * migration needs no edit here.
 *
 * Ordering is the filename's numeric prefix, which is what
 * `wrangler d1 migrations apply` orders by.
 */
const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
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

describe('apps/publish Worker: the nightly sweep', () => {
  const fire = async (env: Env) =>
    worker.scheduled?.({} as ScheduledController, env);

  it('collects an object no catalogue row names', async () => {
    const env = newEnv();
    await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        slug: 'acme',
        files: [{ path: 'index.html', content: '<h1>acme</h1>' }],
      }),
      env,
    );
    const bucket = env.PROJECT_CONTENT as InMemoryR2Bucket;
    await bucket.put('published/acme/gen-lost/late.html', 'the late write');

    await fire(env);

    assert.ok(
      !bucket.keys().some((key) => key.includes('gen-lost')),
      'the sweep did not run, or did not collect the orphan',
    );
    // And the live site is untouched, which is the half that matters.
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });

  it('does nothing at all when the bindings are missing', async () => {
    // A scheduled handler that throws is one whose failure is a line in a
    // log nobody reads, and a Worker deployed without its bindings is
    // exactly when this would fire.
    await assert.doesNotReject(() => fire({} as Env));
  });

  it('survives a bucket that throws rather than failing the run', async () => {
    const env = newEnv();
    const bucket = env.PROJECT_CONTENT as InMemoryR2Bucket;
    bucket.list = async () => {
      throw new Error('R2 is having a day');
    };
    await assert.doesNotReject(() => fire(env));
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

  it('keeps the site down when the replacement files cannot be stored', async () => {
    // Clearing the tombstone is what puts a site back, so it must not happen
    // before the content exists. Otherwise a republish whose R2 write fails
    // reports failure and leaves the slug resolving to an empty prefix: the
    // site reads as live and serves nothing, which is the failure `unpublish`
    // orders itself to avoid, pointed the other way.
    const env = newEnv();
    await published(env);
    await worker.fetch(
      internalRequest('internal/unpublish', { userId: 'u1', projectId: 'p1' }),
      env,
    );

    const bucket = env.PROJECT_CONTENT as InMemoryR2Bucket;
    bucket.put = async () => {
      throw new Error('R2 is having a day');
    };

    await assert.rejects(() =>
      worker.fetch(
        internalRequest('internal/publish', {
          userId: 'u1',
          projectId: 'p1',
          files: [{ path: 'index.html', content: '<h1>back</h1>' }],
        }),
        env,
      ),
    );

    // The public answer is 404 either way, because the content is gone --
    // which is exactly why asserting on it would prove nothing. What differs
    // is the row: clearing the mark before the write lands leaves the slug
    // resolving to a project with an empty prefix, so the site reads as live
    // and serves nothing, and the owner's builder is told it is up.
    const store = new PublishStore(env.DB, env.PROJECT_CONTENT);
    assert.equal(
      await store.resolveSlug('acme'),
      undefined,
      'a failed republish marked the site live with nothing to serve',
    );
    assert.deepEqual(await store.slugForProject('p1'), {
      slug: 'acme',
      userId: 'u1',
      live: false,
      state: 'down',
    });

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 404, 'a failed republish put the site back up');
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

/**
 * `/internal/hold` and `/internal/release` (#172): an operator taking
 * somebody else's site off the web.
 *
 * No ownership check, which is the point of the route rather than a gap in
 * it: apps/web has already established the caller is a platform admin, and
 * that is a stricter thing than owning the site.
 */
describe('apps/publish Worker: holding somebody else"s site', () => {
  async function published(
    env: Env,
    slug = 'acme',
    userId = 'u1',
    projectId = 'p1',
  ) {
    const response = await worker.fetch(
      internalRequest('internal/publish', {
        userId,
        projectId,
        slug,
        files: [{ path: 'index.html', content: `<h1>${slug}</h1>` }],
      }),
      env,
    );
    assert.equal(response.status, 200);
  }

  const held = (env: Env, body: unknown) =>
    worker.fetch(internalRequest('internal/hold', body), env);

  it('refuses a caller without the internal secret', async () => {
    const env = newEnv();
    await published(env);

    const response = await worker.fetch(
      internalRequest(
        'internal/hold',
        { slug: 'acme', by: 'admin@vibld.com', reason: 'phishing' },
        'the-wrong-secret',
      ),
      env,
    );

    assert.equal(response.status, 403);
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200, 'a refused hold half-happened');
  });

  it('requires a reason, so a hold can be reviewed later', async () => {
    const env = newEnv();
    await published(env);

    const blank = await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: '   ',
    });
    assert.equal(blank.status, 400);

    const missing = await held(env, { slug: 'acme', by: 'admin@vibld.com' });
    assert.equal(missing.status, 400);

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });

  it('answers 404 for a slug nothing published', async () => {
    const env = newEnv();
    const response = await held(env, {
      slug: 'never',
      by: 'admin@vibld.com',
      reason: 'phishing',
    });
    assert.equal(response.status, 404);
  });

  it('takes the site off the web', async () => {
    const env = newEnv();
    await published(env);

    const response = await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: 'phishing report 41',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { slug: 'acme', state: 'held' });

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 404);
  });

  it('refuses the owner"s republish while it is held', async () => {
    // The whole reason a hold is its own column. Publishing again is what
    // clears an owner"s own takedown; an operator hold it also cleared would
    // be no hold at all.
    const env = newEnv();
    await published(env);
    await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: 'phishing report 41',
    });

    const again = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: '<h1>back</h1>' }],
      }),
      env,
    );

    assert.equal(again.status, 409);
    assert.match(
      ((await again.json()) as { error: string }).error,
      /taken down by the operator/,
      'the one refusal that is an operator did not say so',
    );
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 404, 'a republish lifted an operator hold');
  });

  it('does not blame an operator for a refusal no operator caused', async () => {
    // `promote` refuses for four reasons and only one of them is a hold: the
    // owner's own takedown holds a claim while it removes the bytes, and the
    // revision can be collected or being collected. Reporting all four as an
    // operator takedown told an owner racing their own unpublish that
    // somebody had taken their site down for cause, and told them it could
    // not be republished when publishing again is exactly what works.
    const env = newEnv();
    await published(env);

    // The interleaving, made to happen rather than waited for: the owner's
    // takedown lands while this publish is still writing its files.
    const bucket = env.PROJECT_CONTENT as InMemoryR2Bucket;
    const realPut = bucket.put.bind(bucket);
    let raced = false;
    bucket.put = async (key: string, content: string) => {
      const written = await realPut(key, content);
      if (!raced) {
        raced = true;
        await worker.fetch(
          internalRequest('internal/unpublish', {
            userId: 'u1',
            projectId: 'p1',
          }),
          env,
        );
      }
      return written;
    };

    const again = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: '<h1>back</h1>' }],
      }),
      env,
    );

    assert.equal(again.status, 409);
    const { error } = (await again.json()) as { error: string };
    assert.doesNotMatch(
      error,
      /operator/,
      'the owner was told an operator had taken their own site down',
    );
    assert.match(error, /Try publishing again/);
  });

  it('still names the operator when the hold lands mid-publish', async () => {
    // The other side of the same branch. The up-front refusal catches a
    // republish of an already-held site; this one catches the hold that
    // arrives while the files are being written, which is the race the
    // generation prefix exists for. It is a real operator takedown, so it
    // has to say so rather than fall back to the generic conflict.
    const env = newEnv();
    await published(env);

    const bucket = env.PROJECT_CONTENT as InMemoryR2Bucket;
    const realPut = bucket.put.bind(bucket);
    let raced = false;
    bucket.put = async (key: string, content: string) => {
      const written = await realPut(key, content);
      if (!raced) {
        raced = true;
        await held(env, {
          slug: 'acme',
          by: 'admin@vibld.com',
          reason: 'phishing report 42',
        });
      }
      return written;
    };

    const again = await worker.fetch(
      internalRequest('internal/publish', {
        userId: 'u1',
        projectId: 'p1',
        files: [{ path: 'index.html', content: '<h1>back</h1>' }],
      }),
      env,
    );

    assert.equal(again.status, 409);
    assert.match(
      ((await again.json()) as { error: string }).error,
      /taken down by the operator/,
      'a hold that landed mid-publish was reported as an ordinary conflict',
    );
  });

  it("refuses the owner's takedown while it is held", async () => {
    // The owner's takedown deletes the objects, which is right when it is
    // their decision. Under a hold it would erase the bytes the hold exists
    // to keep: an owner who disliked being held could destroy what an
    // operator is holding for review, and a wrong hold could no longer be
    // simply lifted.
    //
    // So the proof is not the 409. It is that the content is still there
    // afterwards, which is what releasing shows.
    const env = newEnv();
    await published(env);
    await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: 'phishing report 41',
    });

    const down = await worker.fetch(
      internalRequest('internal/unpublish', { userId: 'u1', projectId: 'p1' }),
      env,
    );
    assert.equal(down.status, 409);

    await worker.fetch(
      internalRequest('internal/release', {
        slug: 'acme',
        by: 'admin@vibld.com',
      }),
      env,
    );
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200, 'the owner emptied a held site');
    assert.equal(await site.text(), '<h1>acme</h1>');
  });

  it('refuses to release a site that is not held', async () => {
    const env = newEnv();
    await published(env);
    const response = await worker.fetch(
      internalRequest('internal/release', {
        slug: 'acme',
        by: 'admin@vibld.com',
      }),
      env,
    );
    assert.equal(response.status, 409);
  });

  it('serves again once the hold is lifted', async () => {
    const env = newEnv();
    await published(env);
    await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: 'wrong report',
    });

    const release = await worker.fetch(
      internalRequest('internal/release', {
        slug: 'acme',
        by: 'admin@vibld.com',
      }),
      env,
    );
    assert.equal(release.status, 200);
    assert.deepEqual(await release.json(), { slug: 'acme', state: 'live' });

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
    assert.equal(await site.text(), '<h1>acme</h1>');
  });

  it('does not republish a released site its owner had taken down', async () => {
    const env = newEnv();
    await published(env);
    await worker.fetch(
      internalRequest('internal/unpublish', { userId: 'u1', projectId: 'p1' }),
      env,
    );
    await held(env, {
      slug: 'acme',
      by: 'admin@vibld.com',
      reason: 'wrong report',
    });

    const release = await worker.fetch(
      internalRequest('internal/release', {
        slug: 'acme',
        by: 'admin@vibld.com',
      }),
      env,
    );
    assert.deepEqual(await release.json(), { slug: 'acme', state: 'down' });

    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 404);
  });

  it('refuses GET, so a link cannot hold or release a site', async () => {
    const env = newEnv();
    await published(env);
    for (const path of ['internal/hold', 'internal/release']) {
      const response = await worker.fetch(
        new Request(`https://internal.example/${path}`, {
          headers: { Authorization: `Bearer ${SECRET}` },
        }),
        env,
      );
      assert.equal(response.status, 404, path);
    }
    const site = await worker.fetch(
      publicRequest('acme.published.vibld-preview.dev'),
      env,
    );
    assert.equal(site.status, 200);
  });
});
