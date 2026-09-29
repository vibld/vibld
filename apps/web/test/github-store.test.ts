import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

function newStore(): GitHubStore {
  return new GitHubStore(new SqliteD1Database(schemaSql()));
}

const GRANT = {
  userId: 'user_1',
  projectId: 'p1',
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
    const found = await store.binding('user_1', 'p1');
    assert.ok(found);
    assert.equal(found.installationId, 4242);
    assert.equal(found.owner, 'acme');
    assert.equal(found.repo, 'site');
    assert.equal(found.revokedAt, null);
  });

  it('has nothing for a user who has connected nothing', async () => {
    const store = newStore();
    assert.equal(await store.binding('nobody', 'p1'), null);
    const state = await store.usableBinding('nobody', 'p1');
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'none');
  });

  it('replaces the binding when a different repository is connected', async () => {
    // An ordinary thing to do, and the user's own grant to change.
    const store = newStore();
    await store.bind(GRANT);
    await store.bind({ ...GRANT, repo: 'other-site', installationId: 99 });
    const found = await store.binding('user_1', 'p1');
    assert.equal(found?.repo, 'other-site');
    assert.equal(found?.installationId, 99);
  });

  it('makes a reconnect a fresh grant, not an extended one', async () => {
    const store = newStore();
    await store.bind({ ...GRANT, expiresAt: '2026-09-14T12:00:00.000Z' });
    await store.disconnectAccount('user_1');
    await store.bind({ ...GRANT, expiresAt: '2027-01-01T00:00:00.000Z' });

    const found = await store.binding('user_1', 'p1');
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
      'p1',
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
      'p1',
      new Date('2027-01-01T00:00:00.000Z'),
    );
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'expired');
  });

  it('treats an unreadable expiry as expired', async () => {
    // A grant whose lifetime cannot be established is not one to push on.
    const store = newStore();
    await store.bind({ ...GRANT, expiresAt: 'whenever' });
    const state = await store.usableBinding('user_1', 'p1');
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'expired');
  });

  it('refuses a revoked grant even while it is unexpired', async () => {
    const store = newStore();
    await store.bind(GRANT);
    await store.disconnectAccount(
      'user_1',
      new Date('2026-09-20T00:00:00.000Z'),
    );
    const state = await store.usableBinding(
      'user_1',
      'p1',
      new Date('2026-10-01T00:00:00.000Z'),
    );
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'revoked');
  });

  it('keeps the row when revoking, and the first revocation time', async () => {
    const store = newStore();
    await store.bind(GRANT);
    await store.disconnectAccount(
      'user_1',
      new Date('2026-09-20T00:00:00.000Z'),
    );
    await store.disconnectAccount(
      'user_1',
      new Date('2026-09-25T00:00:00.000Z'),
    );
    const found = await store.binding('user_1', 'p1');
    assert.ok(found, 'the row was deleted rather than marked');
    assert.equal(found.revokedAt, '2026-09-20T00:00:00.000Z');
  });
});

/**
 * Revoking the repository that was named, and no other.
 *
 * The check and the write have to be one statement. Apart, a bind landing
 * between reading the binding and revoking it takes the newly bound
 * repository with it, which is the exact outcome naming one is meant to
 * prevent: a click labelled `acme/site` ending `acme/other`. Putting the
 * name in the `WHERE` clause is what makes the database decide instead of
 * the gap between two calls.
 */
describe('ending a grant by name', () => {
  it('revokes the repository it names', async () => {
    const store = newStore();
    await store.bind(GRANT);

    assert.equal(
      await store.revokeRepository('user_1', 'p1', {
        owner: 'acme',
        repo: 'site',
      }),
      true,
    );
    const state = await store.usableBinding('user_1', 'p1');
    assert.equal(state.usable, false);
  });

  it('leaves a repository it was not asked about alone', async () => {
    // The race, as the database sees it: whatever the caller read a moment
    // ago, this statement matches only the name it was given.
    const store = newStore();
    await store.bind({ ...GRANT, owner: 'acme', repo: 'other' });

    assert.equal(
      await store.revokeRepository('user_1', 'p1', {
        owner: 'acme',
        repo: 'site',
      }),
      false,
    );
    const state = await store.usableBinding('user_1', 'p1');
    assert.equal(state.usable, true, 'a grant nobody asked about was ended');
  });

  it('tells an owner apart from a name', async () => {
    // `acme/site` and `other/site` are different repositories, which forks
    // make ordinary.
    const store = newStore();
    await store.bind(GRANT);

    assert.equal(
      await store.revokeRepository('user_1', 'p1', {
        owner: 'other',
        repo: 'site',
      }),
      false,
    );
    assert.equal((await store.usableBinding('user_1', 'p1')).usable, true);
  });

  it('matches the way GitHub resolves a name', async () => {
    const store = newStore();
    await store.bind(GRANT);

    assert.equal(
      await store.revokeRepository('user_1', 'p1', {
        owner: 'Acme',
        repo: 'Site',
      }),
      true,
    );
    assert.equal((await store.usableBinding('user_1', 'p1')).usable, false);
  });

  it('changes nothing twice, and keeps the first time', async () => {
    const store = newStore();
    await store.bind(GRANT);
    const first = new Date('2026-09-13T12:00:00.000Z');

    assert.equal(
      await store.revokeRepository(
        'user_1',
        'p1',
        { owner: 'acme', repo: 'site' },
        first,
      ),
      true,
    );
    assert.equal(
      await store.revokeRepository(
        'user_1',
        'p1',
        { owner: 'acme', repo: 'site' },
        new Date('2026-09-14T12:00:00.000Z'),
      ),
      false,
      'a second revocation reported work it did not do',
    );
    const row = await store.binding('user_1', 'p1');
    assert.equal(row?.revokedAt, first.toISOString());
  });
});

describe('recording a push', () => {
  const ATTEMPT = {
    userId: 'user_1',
    projectId: 'p1',
    owner: 'acme',
    repo: 'site',
    revision: 'r7',
    baseSha: 'base-when-we-started',
    branch: 'vibld/r7',
    startedAt: '2026-09-13T12:00:00.000Z',
  };

  const KEY = {
    userId: 'user_1',
    owner: 'acme',
    repo: 'site',
    revision: 'r7',
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
    const found = await store.push(KEY);
    assert.ok(found);
    assert.equal(found.branch, 'vibld/r7');
  });

  it('keeps two repositories apart at the same revision', async () => {
    // A parent sha means something in the repository it came from and
    // nothing in any other, so the destination is part of which push this
    // is. Sharing the row across repositories hands the second push a
    // parent the second repository has never heard of.
    const store = newStore();
    await store.beginPush(ATTEMPT);
    const elsewhere = await store.beginPush({
      ...ATTEMPT,
      repo: 'other-site',
      baseSha: 'the-other-repository-base',
    });
    assert.equal(elsewhere.baseSha, 'the-other-repository-base');
    const original = await store.push(KEY);
    assert.equal(original?.baseSha, 'base-when-we-started');
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
    const mine = await store.push(KEY);
    assert.equal(mine?.baseSha, 'base-when-we-started');
  });

  it('records what the push established when it lands', async () => {
    const store = newStore();
    await store.beginPush(ATTEMPT);
    await store.finishPush(KEY, {
      commitSha: 'abc',
      treeSha: 'def',
      pullRequestUrl: 'https://github.com/acme/site/pull/9',
      finishedAt: '2026-09-13T12:01:00.000Z',
    });
    const found = await store.push(KEY);
    assert.equal(found?.commitSha, 'abc');
    assert.equal(found?.pullRequestUrl, 'https://github.com/acme/site/pull/9');
    assert.equal(found?.finishedAt, '2026-09-13T12:01:00.000Z');
  });

  it('records a push whose pull request did not open', async () => {
    // A branch that pushed and a pull request that did not is a success with
    // a missing link, which the client already reports that way.
    const store = newStore();
    await store.beginPush(ATTEMPT);
    await store.finishPush(KEY, {
      commitSha: 'abc',
      treeSha: 'def',
      finishedAt: '2026-09-13T12:01:00.000Z',
    });
    const found = await store.push(KEY);
    assert.equal(found?.commitSha, 'abc');
    assert.equal(found?.pullRequestUrl, null);
  });

  it('has nothing for a checkpoint nobody has pushed', async () => {
    const store = newStore();
    assert.equal(await store.push({ ...KEY, revision: 'never' }), null);
  });
});

/**
 * A repository per project (D72).
 *
 * The account used to be bound to one repository, and every project pushed
 * there. Now each project has its own binding, and the account's own
 * connection sits beside them: ending one project's binding must leave every
 * other project's alone, and disconnecting the account must end all of them.
 */
describe('a repository per project', () => {
  function world() {
    const db = new SqliteD1Database(schemaSql());
    return { db, store: new GitHubStore(db as unknown as D1Database) };
  }

  const CONNECTION = {
    userId: 'user_1',
    login: 'chris',
    installationId: 7,
    connectedAt: '2026-09-13T12:00:00.000Z',
    grantedByEmail: 'chris@example.com',
  };

  it('looks a binding up by project, not by account', async () => {
    const { store } = world();
    await store.bind(GRANT);
    await store.bind({ ...GRANT, projectId: 'p2', repo: 'blog' });

    assert.equal((await store.binding('user_1', 'p1'))?.repo, 'site');
    assert.equal((await store.binding('user_1', 'p2'))?.repo, 'blog');
    // A project that never chose one has none, however many others did.
    const third = await store.usableBinding('user_1', 'p3');
    assert.equal(third.usable, false);
    if (!third.usable) assert.equal(third.reason, 'none');
  });

  it('finds nothing for a project id named by somebody else', async () => {
    // Every read asks for the project and its owner together, so a guessed
    // id is as good as no id.
    const { store } = world();
    await store.bind(GRANT);
    assert.equal(await store.binding('user_2', 'p1'), null);
    assert.equal((await store.usableBinding('user_2', 'p1')).usable, false);
  });

  it('never lets a bind move a project to another account', async () => {
    // The route checks ownership first. This is the same rule said again
    // where the write happens.
    const { store } = world();
    await store.bind(GRANT);
    await store.bind({ ...GRANT, userId: 'user_2', repo: 'theirs' });
    assert.equal((await store.binding('user_1', 'p1'))?.repo, 'site');
    assert.equal(await store.binding('user_2', 'p1'), null);
  });

  it('disconnects one project and leaves the others pushing', async () => {
    const { store } = world();
    await store.bind(GRANT);
    // The same repository on a second project, which is the case a looser
    // statement would take down with the first.
    await store.bind({ ...GRANT, projectId: 'p2' });
    await store.bind({ ...GRANT, projectId: 'p3', repo: 'blog' });

    assert.equal(
      await store.revokeRepository('user_1', 'p1', {
        owner: 'acme',
        repo: 'site',
      }),
      true,
    );
    assert.equal((await store.usableBinding('user_1', 'p1')).usable, false);
    assert.equal((await store.usableBinding('user_1', 'p2')).usable, true);
    assert.equal((await store.usableBinding('user_1', 'p3')).usable, true);
  });

  it('disconnects every project when the account is disconnected', async () => {
    const { store } = world();
    await store.connect(CONNECTION);
    await store.bind(GRANT);
    await store.bind({ ...GRANT, projectId: 'p2', repo: 'blog' });
    await store.bind({
      ...GRANT,
      userId: 'user_2',
      projectId: 'q1',
      repo: 'someone-elses',
    });

    await store.disconnectAccount(
      'user_1',
      new Date('2026-09-20T00:00:00.000Z'),
    );

    for (const project of ['p1', 'p2']) {
      const state = await store.usableBinding('user_1', project);
      assert.equal(state.usable, false);
      if (!state.usable) assert.equal(state.reason, 'revoked');
    }
    assert.equal(
      (await store.connection('user_1'))?.revokedAt,
      '2026-09-20T00:00:00.000Z',
    );
    // Somebody else's account is not this account.
    assert.equal((await store.usableBinding('user_2', 'q1')).usable, true);
  });

  it('reconnects the account without rebinding any project', async () => {
    // A disconnect was an instruction to stop pushing; signing in again is
    // not an instruction to start, so each project chooses again.
    const { store } = world();
    await store.connect(CONNECTION);
    await store.bind(GRANT);
    await store.disconnectAccount('user_1');
    await store.connect({
      ...CONNECTION,
      connectedAt: '2026-09-21T00:00:00.000Z',
    });

    assert.equal((await store.connection('user_1'))?.revokedAt, null);
    assert.equal((await store.usableBinding('user_1', 'p1')).usable, false);
  });

  it('keeps the login it knew when a sign-in could not read one', async () => {
    const { store } = world();
    await store.connect(CONNECTION);
    await store.connect({ ...CONNECTION, login: null, installationId: null });
    const found = await store.connection('user_1');
    assert.equal(found?.login, 'chris');
    assert.equal(found?.installationId, 7);
  });

  it('answers ownership from the projects table', async () => {
    const { db, store } = world();
    await db
      .prepare(
        `INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
         VALUES ('p1', 'user_1', 'North Star', ?1, ?1, ?1)`,
      )
      .bind('2026-09-13T12:00:00.000Z')
      .run();
    assert.equal(await store.ownsProject('user_1', 'p1'), true);
    assert.equal(await store.ownsProject('user_2', 'p1'), false);
    assert.equal(await store.ownsProject('user_1', 'nope'), false);
  });

  it('reports the last pull request of this project only', async () => {
    const { store } = world();
    const push = {
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      baseSha: 'b',
    };
    const opened = async (projectId: string, revision: string, at: string) => {
      await store.beginPush({
        ...push,
        projectId,
        revision,
        branch: `vibld/${revision}`,
        startedAt: at,
      });
      await store.finishPush(
        { userId: 'user_1', owner: 'acme', repo: 'site', revision },
        {
          commitSha: `c-${revision}`,
          treeSha: `t-${revision}`,
          pullRequestUrl: `https://github.com/acme/site/pull/${revision}`,
          finishedAt: at,
        },
      );
    };
    await opened('p1', 'r1', '2026-09-13T12:00:00.000Z');
    await opened('p2', 'r2', '2026-09-14T12:00:00.000Z');

    // The later push is p2's. p1 still reports its own.
    assert.equal(
      (await store.lastPullRequest('user_1', 'p1'))?.pullRequestUrl,
      'https://github.com/acme/site/pull/r1',
    );
    assert.equal(
      (await store.lastPullRequest('user_1', 'p2'))?.pullRequestUrl,
      'https://github.com/acme/site/pull/r2',
    );
    assert.equal(await store.lastPullRequest('user_1', 'p3'), null);

    // A webhook knows the branch and nothing about the project, and still
    // reaches the project whose push opened it.
    await store.recordPullRequest({
      owner: 'acme',
      repo: 'site',
      branch: 'vibld/r1',
      number: 1,
      url: 'https://github.com/acme/site/pull/r1',
      state: 'merged',
      updatedAt: '2026-09-15T00:00:00Z',
    });
    assert.equal(
      (await store.lastPullRequest('user_1', 'p1'))?.pullRequestState,
      'merged',
    );
    assert.equal(
      (await store.lastPullRequest('user_1', 'p2'))?.pullRequestState,
      null,
    );
  });
});
