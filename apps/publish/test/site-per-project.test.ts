import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import worker, { type Env } from '../worker/index.ts';
import { InMemoryR2Bucket } from './fakes/memory-r2.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * One published site per project (docs/decisions.md, "Resolved
 * 2026-09-28"), from the publish service's side.
 *
 * apps/web used to send the caller's user id as the project id, so an
 * account had one site; it now sends the project's own id. This service
 * already keyed a site by project, so nothing here changed, and these
 * tests hold it to what that change relies on: publishing one project can
 * never replace another's site, a slug stays unique across every site, a
 * takedown takes down one project's site and no other, and a site
 * published the old way is found again at its address by the project whose
 * id it was keyed under.
 */

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'web', 'migrations');
const SCHEMA = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const SECRET = 'test-secret';
const ALICE = 'user_alice00000000000000000001';

function newEnv(): Env {
  return {
    DB: new SqliteD1Database(SCHEMA),
    PROJECT_CONTENT: new InMemoryR2Bucket(),
    PUBLISH_INTERNAL_SECRET: SECRET,
    PUBLISH_HOSTNAME: 'vibld-preview.dev',
  };
}

async function internal(env: Env, path: string, body: unknown) {
  const response = await worker.fetch(
    new Request(`https://internal.example/internal/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, any>,
  };
}

function publish(env: Env, projectId: string, html: string, slug?: string) {
  return internal(env, 'publish', {
    userId: ALICE,
    projectId,
    ...(slug ? { slug } : {}),
    files: [{ path: 'index.html', content: html }],
  });
}

async function served(env: Env, slug: string): Promise<string | null> {
  const response = await worker.fetch(
    new Request(`https://${slug}.vibld-preview.dev/`),
    env,
  );
  return response.status === 200 ? response.text() : null;
}

describe('one site per project', () => {
  it("never replaces another project's site", async () => {
    const env = newEnv();
    assert.equal((await publish(env, 'bakery', 'bread', 'bakery')).status, 200);
    assert.equal((await publish(env, 'garage', 'cars', 'garage')).status, 200);

    assert.equal(await served(env, 'bakery'), 'bread');
    assert.equal(await served(env, 'garage'), 'cars');

    // Republishing one changes that one.
    const again = await publish(env, 'bakery', 'more bread');
    assert.equal(again.status, 200);
    assert.equal(again.body.slug, 'bakery');
    assert.equal(await served(env, 'bakery'), 'more bread');
    assert.equal(await served(env, 'garage'), 'cars');
  });

  it("keeps slugs unique: one project cannot take another's", async () => {
    const env = newEnv();
    await publish(env, 'bakery', 'bread', 'bakery');
    const taken = await publish(env, 'garage', 'cars', 'bakery');
    assert.equal(taken.status, 409);
    assert.equal(await served(env, 'bakery'), 'bread');

    // Nor can a project that already has a site move it onto another.
    await publish(env, 'garage', 'cars', 'garage');
    const moved = await publish(env, 'garage', 'cars', 'bakery');
    assert.equal(moved.status, 409);
  });

  it("takes one project's site down and leaves the others serving", async () => {
    const env = newEnv();
    await publish(env, 'bakery', 'bread', 'bakery');
    await publish(env, 'garage', 'cars', 'garage');

    const down = await internal(env, 'unpublish', {
      userId: ALICE,
      projectId: 'bakery',
    });
    assert.equal(down.status, 200);
    assert.equal(down.body.slug, 'bakery');
    assert.equal(await served(env, 'bakery'), null);
    assert.equal(await served(env, 'garage'), 'cars');
  });

  it('finds a site published the old way at its address, under the project keyed by the user id', async () => {
    const env = newEnv();
    // What the builder did before: the account's one site, keyed by the
    // caller's user id.
    await publish(env, ALICE, 'old site', 'alices-site');

    // The project 0033 made of that account's work has that id, so
    // publishing from it now names the same key: same slug, same address,
    // no slug asked for.
    const republished = await publish(env, ALICE, 'new version');
    assert.equal(republished.status, 200);
    assert.equal(republished.body.slug, 'alices-site');
    assert.equal(
      republished.body.url,
      'https://alices-site.vibld-preview.dev/',
    );
    assert.equal(await served(env, 'alices-site'), 'new version');

    // A new project of the same account gets a site of its own.
    const second = await publish(env, 'second-project', 'second', 'second');
    assert.equal(second.status, 200);
    assert.equal(await served(env, 'alices-site'), 'new version');
    assert.equal(await served(env, 'second'), 'second');
  });
});
