import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PublishStore } from '../worker/publish-store.ts';
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
    });
  });
});
