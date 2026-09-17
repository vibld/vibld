import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PublishStore } from '../worker/publish-store.ts';
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

function newStore(): PublishStore {
  return new PublishStore(new SqliteD1Database(SCHEMA), new InMemoryR2Bucket());
}

describe('PublishStore', () => {
  it('has no slug for a project that has never published', async () => {
    const store = newStore();
    assert.equal(await store.slugForProject('proj-1'), undefined);
  });

  it('claims a free slug for a project', async () => {
    const store = newStore();
    const result = await store.claimSlug('acme', 'proj-1', 'user-1');
    assert.deepEqual(result, { claimed: true });
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
    });
    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
  });

  it('refuses to claim a slug another project already holds', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    const result = await store.claimSlug('acme', 'proj-2', 'user-2');
    assert.deepEqual(result, { claimed: false, reason: 'slug-taken' });
    // The original claim is untouched.
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
    });
  });

  it('lets the same project "reclaim" its own slug idempotently', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    const result = await store.claimSlug('acme', 'proj-1', 'user-1');
    assert.deepEqual(result, { claimed: true });
  });

  it('resolves an unclaimed slug to nothing', async () => {
    const store = newStore();
    assert.equal(await store.resolveSlug('nobody-here'), undefined);
  });

  it('stores and serves file content by slug and path', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>Hi</h1>' },
      { path: 'about.html', content: '<h1>About</h1>' },
    ]);

    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: '<h1>Hi</h1>',
    });
    assert.deepEqual(await store.getFile('acme', 'about.html'), {
      content: '<h1>About</h1>',
    });
    assert.equal(await store.getFile('acme', 'missing.html'), undefined);
  });

  it("overwrites a slug's content on a later publish rather than appending", async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [{ path: 'index.html', content: 'v1' }]);
    await store.putFiles('acme', [{ path: 'index.html', content: 'v2' }]);
    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: 'v2',
    });
  });

  it("does not leak one slug's files under a different slug", async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.claimSlug('beta', 'proj-2', 'user-2');
    await store.putFiles('acme', [
      { path: 'index.html', content: 'acme home' },
    ]);
    assert.equal(await store.getFile('beta', 'index.html'), undefined);
  });

  it('touch updates updated_at without changing the slug mapping', async () => {
    const store = newStore();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.touch('acme');
    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: true,
    });
  });
});

/**
 * Taking a site down (ADR-0013).
 *
 * Until this existed there was no way off the web at all: `putFiles`
 * overwrites and `claimSlug` claims, and nothing removed either. A site
 * published by mistake, or one an operator has to pull, stayed up.
 */
describe('taking a published site down', () => {
  function stored(): { store: PublishStore; bucket: InMemoryR2Bucket } {
    const bucket = new InMemoryR2Bucket();
    return {
      store: new PublishStore(new SqliteD1Database(SCHEMA), bucket),
      bucket,
    };
  }

  it('stops the slug resolving for the public', async () => {
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');

    assert.equal(await store.resolveSlug('acme'), undefined);
  });

  it('leaves the owner holding the name, marked as down', async () => {
    // The two readers diverge on purpose: the public one refuses it, the
    // owner's own lookup still finds it. That is what makes putting the
    // site back a republish rather than a race to re-claim the name.
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(await store.slugForProject('proj-1'), {
      slug: 'acme',
      userId: 'user-1',
      live: false,
    });
  });

  it('puts the site back when it is published again', async () => {
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.unpublish('acme');

    // What `handlePublish` does for a project that already holds a slug.
    await store.touch('acme');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>back</h1>' },
    ]);

    assert.deepEqual(await store.resolveSlug('acme'), {
      projectId: 'proj-1',
      userId: 'user-1',
    });
    assert.deepEqual(await store.getFile('acme', 'index.html'), {
      content: '<h1>back</h1>',
    });
  });

  it('removes the content, so nothing is left to serve', async () => {
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
      { path: 'about/index.html', content: '<h1>about</h1>' },
      { path: 'assets/app.css', content: 'body{}' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), [], 'bytes were left behind');
    assert.equal(await store.getFile('acme', 'index.html'), undefined);
  });

  it('deletes every page of objects, not just the first', async () => {
    // R2 lists with a cursor. A site with more files than one page holds
    // would otherwise be half removed, and the half left behind is content
    // nothing points at and nobody thinks to look for.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles(
      'acme',
      Array.from({ length: 7 }, (_, index) => ({
        path: `page-${index}.html`,
        content: `<h1>${index}</h1>`,
      })),
    );

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), []);
  });

  it("leaves another project's site alone", async () => {
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.claimSlug('acme-two', 'proj-2', 'user-2');
    await store.putFiles('acme-two', [
      { path: 'index.html', content: '<h1>two</h1>' },
    ]);

    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), ['published/acme-two/index.html']);
    assert.deepEqual(await store.resolveSlug('acme-two'), {
      projectId: 'proj-2',
      userId: 'user-2',
    });
  });

  it('does not hand the slug to the next project that asks', async () => {
    // ADR-0010 makes a slug a durable, semi-public identifier: somebody has
    // linked to it. Releasing it on takedown would serve the next claimant's
    // content at an address the previous owner advertised, which is worse
    // than a dead link and is the shape of a takeover. This is the reason
    // the row is marked rather than deleted.
    const { store } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);
    await store.unpublish('acme');

    const claim = await store.claimSlug('acme', 'proj-2', 'user-2');
    assert.deepEqual(claim, { claimed: false, reason: 'slug-taken' });
    assert.equal(await store.slugForProject('proj-2'), undefined);
  });

  it('is safe to repeat after a crash between the two writes', async () => {
    // Content first, mapping second. A failure in between leaves a slug
    // resolving to nothing, which the public handler answers as a 404 and
    // which a second call finishes.
    const { store, bucket } = stored();
    await store.claimSlug('acme', 'proj-1', 'user-1');
    await store.putFiles('acme', [
      { path: 'index.html', content: '<h1>acme</h1>' },
    ]);

    await store.unpublish('acme');
    await store.unpublish('acme');

    assert.deepEqual(bucket.keys(), []);
    assert.equal(await store.resolveSlug('acme'), undefined);
  });
});
