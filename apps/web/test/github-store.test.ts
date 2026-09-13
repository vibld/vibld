import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0005_github.sql'),
  'utf8',
);

function newStore(): GitHubStore {
  return new GitHubStore(new SqliteD1Database(SCHEMA));
}

const GRANT = {
  userId: 'user_1',
  installationId: 4242,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
  grantedAt: '2026-09-13T12:00:00.000Z',
  grantedByEmail: 'chris@example.com',
  expiresAt: '2026-12-13T12:00:00.000Z',
};

describe('binding a repository', () => {
  it('stores what the user approved', async () => {
    const store = newStore();
    await store.bind(GRANT);
    const found = await store.binding('user_1');
    assert.ok(found);
    assert.equal(found.installationId, 4242);
    assert.equal(found.owner, 'acme');
    assert.equal(found.repo, 'site');
    assert.equal(found.revokedAt, null);
  });

  it('has nothing for a user who has connected nothing', async () => {
    const store = newStore();
    assert.equal(await store.binding('nobody'), null);
    const state = await store.usableBinding('nobody');
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'none');
  });

  it('replaces the binding when a different repository is connected', async () => {
    // An ordinary thing to do, and the user's own grant to change.
    const store = newStore();
    await store.bind(GRANT);
    await store.bind({ ...GRANT, repo: 'other-site', installationId: 99 });
    const found = await store.binding('user_1');
    assert.equal(found?.repo, 'other-site');
    assert.equal(found?.installationId, 99);
  });

  it('makes a reconnect a fresh grant, not an extended one', async () => {
    const store = newStore();
    await store.bind({ ...GRANT, expiresAt: '2026-09-14T12:00:00.000Z' });
    await store.revoke('user_1');
    await store.bind({ ...GRANT, expiresAt: '2027-01-01T00:00:00.000Z' });

    const found = await store.binding('user_1');
    assert.equal(found?.expiresAt, '2027-01-01T00:00:00.000Z');
    // The revocation does not survive the new grant, or the user would
    // reconnect and still be blocked.
    assert.equal(found?.revokedAt, null);
  });
});

describe('whether a grant may still be pushed on', () => {
  it('accepts one that is granted and unexpired', async () => {
    const store = newStore();
    await store.bind(GRANT);
    const state = await store.usableBinding(
      'user_1',
      new Date('2026-10-01T00:00:00.000Z'),
    );
    assert.equal(state.usable, true);
  });

  it('refuses an expired grant rather than renewing it silently', async () => {
    // ADR-0006: grants expire, and the answer is re-approval rather than a
    // silent re-auth.
    const store = newStore();
    await store.bind(GRANT);
    const state = await store.usableBinding(
      'user_1',
      new Date('2027-01-01T00:00:00.000Z'),
    );
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'expired');
  });

  it('treats an unreadable expiry as expired', async () => {
    // A grant whose lifetime cannot be established is not one to push on.
    const store = newStore();
    await store.bind({ ...GRANT, expiresAt: 'whenever' });
    const state = await store.usableBinding('user_1');
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'expired');
  });

  it('refuses a revoked grant even while it is unexpired', async () => {
    const store = newStore();
    await store.bind(GRANT);
    await store.revoke('user_1', new Date('2026-09-20T00:00:00.000Z'));
    const state = await store.usableBinding(
      'user_1',
      new Date('2026-10-01T00:00:00.000Z'),
    );
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'revoked');
  });

  it('keeps the row when revoking, and the first revocation time', async () => {
    const store = newStore();
    await store.bind(GRANT);
    await store.revoke('user_1', new Date('2026-09-20T00:00:00.000Z'));
    await store.revoke('user_1', new Date('2026-09-25T00:00:00.000Z'));
    const found = await store.binding('user_1');
    assert.ok(found, 'the row was deleted rather than marked');
    assert.equal(found.revokedAt, '2026-09-20T00:00:00.000Z');
  });
});

describe('recording a push', () => {
  const ATTEMPT = {
    userId: 'user_1',
    revision: 'r7',
    baseSha: 'base-when-we-started',
    branch: 'vibld/r7',
    startedAt: '2026-09-13T12:00:00.000Z',
  };

  it('returns the row it wrote', async () => {
    const store = newStore();
    const attempt = await store.beginPush(ATTEMPT);
    assert.equal(attempt.baseSha, 'base-when-we-started');
    assert.equal(attempt.commitSha, null);
    assert.equal(attempt.finishedAt, null);
  });

  it('gives a retry the parent the first attempt resolved', async () => {
    // The whole reason this table exists. Without it, an attempt that
    // commits and loses its reply has nothing to pin, and the retry reads a
    // base branch that may have moved: the "same" commit is then built on a
    // different parent and is a different object.
    const store = newStore();
    await store.beginPush(ATTEMPT);
    const retry = await store.beginPush({
      ...ATTEMPT,
      baseSha: 'the-base-has-moved-on',
      startedAt: '2026-09-13T12:05:00.000Z',
    });
    assert.equal(retry.baseSha, 'base-when-we-started');
    assert.equal(retry.startedAt, '2026-09-13T12:00:00.000Z');
  });

  it('keeps one row per checkpoint, however many attempts there are', async () => {
    const store = newStore();
    await store.beginPush(ATTEMPT);
    await store.beginPush(ATTEMPT);
    await store.beginPush(ATTEMPT);
    const found = await store.push('user_1', 'r7');
    assert.ok(found);
    assert.equal(found.branch, 'vibld/r7');
  });

  it('keeps two users apart at the same revision', async () => {
    const store = newStore();
    await store.beginPush(ATTEMPT);
    const other = await store.beginPush({
      ...ATTEMPT,
      userId: 'user_2',
      baseSha: 'their-own-base',
    });
    assert.equal(other.baseSha, 'their-own-base');
    const mine = await store.push('user_1', 'r7');
    assert.equal(mine?.baseSha, 'base-when-we-started');
  });

  it('records what the push established when it lands', async () => {
    const store = newStore();
    await store.beginPush(ATTEMPT);
    await store.finishPush('user_1', 'r7', {
      commitSha: 'abc',
      treeSha: 'def',
      pullRequestUrl: 'https://github.com/acme/site/pull/9',
      finishedAt: '2026-09-13T12:01:00.000Z',
    });
    const found = await store.push('user_1', 'r7');
    assert.equal(found?.commitSha, 'abc');
    assert.equal(found?.pullRequestUrl, 'https://github.com/acme/site/pull/9');
    assert.equal(found?.finishedAt, '2026-09-13T12:01:00.000Z');
  });

  it('records a push whose pull request did not open', async () => {
    // A branch that pushed and a pull request that did not is a success with
    // a missing link, which the client already reports that way.
    const store = newStore();
    await store.beginPush(ATTEMPT);
    await store.finishPush('user_1', 'r7', {
      commitSha: 'abc',
      treeSha: 'def',
      finishedAt: '2026-09-13T12:01:00.000Z',
    });
    const found = await store.push('user_1', 'r7');
    assert.equal(found?.commitSha, 'abc');
    assert.equal(found?.pullRequestUrl, null);
  });

  it('has nothing for a checkpoint nobody has pushed', async () => {
    const store = newStore();
    assert.equal(await store.push('user_1', 'never'), null);
  });
});
