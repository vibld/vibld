import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  handleGitHubPush,
  handleGitHubStatus,
} from '../worker/github-handlers.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0005_github.sql'),
  'utf8',
);

const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();

const PRINCIPAL = { userId: 'user_1', policyIdentity: 'chris@example.com' };

const GRANT = {
  userId: 'user_1',
  installationId: 4242,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
  grantedAt: '2026-09-13T00:00:00.000Z',
  grantedByEmail: 'chris@example.com',
  expiresAt: '2026-12-13T00:00:00.000Z',
};

const NOW = new Date('2026-09-13T12:00:00.000Z');

function pushRequest(body: unknown = undefined): Request {
  return new Request('https://app.vibld.com/api/github/push', {
    method: 'POST',
    body: JSON.stringify(
      body ?? {
        files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
        revision: 'r7',
      },
    ),
  });
}

/**
 * A GitHub that answers the token mint and the five push endpoints, with
 * a `base` that can change between calls so a retry can be told apart from
 * a first attempt.
 */
function fakeGitHub(state: {
  base: string;
  branch?: string;
  branchTree?: string;
}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const doFetch = (async (url: string, init?: RequestInit) => {
    const path = url.replace('https://api.github.com', '');
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (path.endsWith('/access_tokens')) {
      return json({ token: 'ghs_x', expires_at: '2026-09-13T13:00:00Z' }, 201);
    }
    if (path.endsWith('/git/ref/heads/main')) {
      return json({ object: { sha: state.base } });
    }
    if (path.includes('/git/ref/heads/vibld/')) {
      return state.branch
        ? json({ object: { sha: state.branch } })
        : json({ message: 'Not Found' }, 404);
    }
    if (path.includes('/git/commits/')) {
      return json({ tree: { sha: state.branchTree ?? 'another-tree' } });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      return json({ sha: 'the-tree' }, 201);
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      return json({ sha: 'the-commit' }, 201);
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      return json({ ref: 'refs/heads/vibld/r7' }, 201);
    }
    if (path.includes('/pulls?')) return json([]);
    if (method === 'POST' && path.endsWith('/pulls')) {
      return json({ html_url: 'https://github.com/acme/site/pull/9' }, 201);
    }
    return json({ message: 'unexpected' }, 500);
  }) as unknown as typeof fetch;
  return { doFetch, calls };
}

function env(db: SqliteD1Database) {
  return {
    DB: db as unknown as D1Database,
    VIBLD_GITHUB_APP_ID: '123',
    VIBLD_GITHUB_PRIVATE_KEY: PRIVATE_KEY,
  };
}

describe('pushing without a usable connection', () => {
  it('asks for a connection rather than returning an auth error', async () => {
    // The failure-mode table asks for a re-connect, not a 401 the browser
    // will try to fix by reloading.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () =>
        new Response('', { status: 500 })) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, true);
  });

  it('says so when the grant has expired', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () =>
        new Response('', { status: 500 })) as unknown as typeof fetch,
      new Date('2027-01-01T00:00:00.000Z'),
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /expired/);
  });

  it('says so when the grant was revoked', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind(GRANT);
    await store.revoke('user_1');
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () =>
        new Response('', { status: 500 })) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /revoked/);
  });

  it('is unavailable rather than broken when nothing is configured', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubPush(
      pushRequest(),
      { DB: db as unknown as D1Database },
      PRINCIPAL,
      (async () =>
        new Response('', { status: 500 })) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 503);
  });
});

describe('pushing a checkpoint', () => {
  it('pushes and reports the branch and pull request', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      branch: string;
      created: boolean;
      pullRequestUrl?: string;
    };
    assert.equal(body.branch, 'vibld/r7');
    assert.equal(body.created, true);
    assert.equal(body.pullRequestUrl, 'https://github.com/acme/site/pull/9');
  });

  it('records the parent before it commits, and reuses it on a retry', async () => {
    // The reason the store exists. The base branch moves between the two
    // attempts; the second must still commit onto the parent the first one
    // resolved, or the same files become a second commit.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);

    const first = fakeGitHub({ base: 'base-at-first-attempt' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      first.doFetch,
      NOW,
    );

    const second = fakeGitHub({ base: 'the-base-has-moved-on' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      second.doFetch,
      new Date('2026-09-13T12:05:00.000Z'),
    );

    const commit = second.calls.find((c) => c.path.endsWith('/git/commits'));
    assert.deepEqual((commit?.body as { parents?: string[] })?.parents, [
      'base-at-first-attempt',
    ]);
  });

  it('does not re-read the base branch once one is recorded', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const first = fakeGitHub({ base: 'base-commit' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      first.doFetch,
      NOW,
    );

    const second = fakeGitHub({ base: 'base-commit' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      second.doFetch,
      NOW,
    );
    assert.equal(
      second.calls.some((c) => c.path.endsWith('/git/ref/heads/main')),
      false,
    );
  });

  it('commits with the same date on every attempt', async () => {
    // Git objects are content-addressed, so the date has to come from the
    // attempt rather than from the clock, or a retry is a different commit.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);

    const first = fakeGitHub({ base: 'base-commit' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      first.doFetch,
      NOW,
    );
    const second = fakeGitHub({ base: 'base-commit' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      second.doFetch,
      new Date('2026-09-13T18:00:00.000Z'),
    );

    const dateOf = (calls: typeof first.calls) =>
      (
        calls.find((c) => c.path.endsWith('/git/commits'))?.body as {
          committer?: { date?: string };
        }
      )?.committer?.date;
    assert.equal(dateOf(first.calls), dateOf(second.calls));
  });

  it('records what landed, so the row is not left ambiguous', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });
    await handleGitHubPush(pushRequest(), env(db), PRINCIPAL, doFetch, NOW);

    const attempt = await store.push({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
    });
    assert.equal(attempt?.commitSha, 'the-commit');
    assert.equal(attempt?.treeSha, 'the-tree');
    assert.ok(attempt?.finishedAt);
  });

  it('reports a conflict without touching the branch', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({
      base: 'base-commit',
      branch: 'someone-elses',
      branchTree: 'a-different-tree',
    });
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      conflict?: { existingSha: string };
    };
    assert.equal(body.conflict?.existingSha, 'someone-elses');
    assert.equal(
      calls.some((c) => c.method === 'POST' && c.path.endsWith('/git/refs')),
      false,
    );
  });
});

describe('what the request has to carry', () => {
  it('refuses a revision that could not be a branch', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({ base: 'base-commit' });
    const response = await handleGitHubPush(
      pushRequest({
        files: [{ path: 'a.html', content: 'x' }],
        revision: '../escape',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
    // Refused before anything was minted or fetched.
    assert.equal(calls.length, 0);
  });

  it('refuses an empty file list', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });
    const response = await handleGitHubPush(
      pushRequest({ files: [], revision: 'r7' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
  });

  it('refuses anything but POST', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubPush(
      new Request('https://app.vibld.com/api/github/push'),
      env(db),
      PRINCIPAL,
      undefined,
      NOW,
    );
    assert.equal(response.status, 405);
  });
});

describe('the status the builder reads', () => {
  it('reports a connected repository', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const response = await handleGitHubStatus(
      new Request('https://app.vibld.com/api/github/status'),
      env(db),
      PRINCIPAL,
      NOW,
    );
    const body = (await response.json()) as {
      connected: boolean;
      owner: string;
    };
    assert.equal(body.connected, true);
    assert.equal(body.owner, 'acme');
  });

  it('reports why there is no usable connection', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubStatus(
      new Request('https://app.vibld.com/api/github/status'),
      env(db),
      PRINCIPAL,
      NOW,
    );
    const body = (await response.json()) as {
      connected: boolean;
      reason: string;
    };
    assert.equal(body.connected, false);
    assert.equal(body.reason, 'none');
  });

  it('says the deployment has no GitHub app rather than pretending', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubStatus(
      new Request('https://app.vibld.com/api/github/status'),
      { DB: db as unknown as D1Database },
      PRINCIPAL,
      NOW,
    );
    const body = (await response.json()) as { configured: boolean };
    assert.equal(body.configured, false);
  });
});

/**
 * `github-app.ts` goes to some trouble to tell a rate limit apart from
 * revoked access, and the whole benefit of that is lost if the route reports
 * both the same way. Someone told to reconnect because GitHub was briefly
 * unreachable reinstalls an App that was working, and is no wiser about the
 * wait that would have fixed it.
 */
describe('when the token cannot be minted', () => {
  async function pushAgainst(mint: Response) {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    return handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () => mint.clone()) as unknown as typeof fetch,
      NOW,
    );
  }

  it('asks for a reconnect only when access is actually gone', async () => {
    const response = await pushAgainst(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, true);
  });

  it('reports a rate limit as one, and does not ask for a reconnect', async () => {
    const response = await pushAgainst(
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'retry-after': '60' },
      }),
    );
    assert.equal(response.status, 429);
    const body = (await response.json()) as {
      error: string;
      reconnect?: boolean;
    };
    assert.equal(body.reconnect, undefined);
    assert.match(body.error, /rate limiting/);
  });

  it('does not ask for a reconnect when GitHub is simply unreachable', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () => {
        throw new Error('connection reset');
      }) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 502);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, undefined);
  });

  it('does not ask for a reconnect when GitHub returns a server error', async () => {
    const response = await pushAgainst(new Response('', { status: 500 }));
    assert.equal(response.status, 502);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, undefined);
  });
});

/**
 * Reconnecting to a different repository starts a different operation.
 *
 * The recorded parent exists so a retry of one push commits onto the sha the
 * first attempt used. That is only true while both attempts are aimed at the
 * same repository: a sha from one repository names nothing in another, so
 * reusing it builds a commit on a parent the destination has never heard of.
 */
describe('pushing the same checkpoint to a second repository', () => {
  it('resolves a parent in the repository it is actually pushing to', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);

    await store.bind(GRANT);
    const first = fakeGitHub({ base: 'base-in-acme-site' });
    await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      first.doFetch,
      NOW,
    );

    // The user connects somewhere else and pushes the same checkpoint.
    await store.bind({ ...GRANT, owner: 'acme', repo: 'other-site' });
    const second = fakeGitHub({ base: 'base-in-other-site' });
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      second.doFetch,
      NOW,
    );

    assert.equal(response.status, 200);
    const commit = second.calls.find(
      (call) => call.method === 'POST' && call.path.endsWith('/git/commits'),
    );
    assert.ok(commit, 'no commit was created in the second repository');
    assert.deepEqual(
      (commit.body as { parents: string[] }).parents,
      ['base-in-other-site'],
      'committed onto a parent from the repository it was disconnected from',
    );
  });
});
