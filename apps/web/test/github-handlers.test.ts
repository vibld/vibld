import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  handleGitHubDiff,
  handleGitHubPush,
  handleGitHubStatus,
} from '../worker/github-handlers.ts';
import { blobSha } from '../worker/github-push.ts';
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
        // The destination is part of a well-formed push: the route reads
        // the binding when the request arrives, so a request that does not
        // say where it meant to go is asking for whatever is connected by
        // then.
        owner: 'acme',
        repo: 'site',
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
  /** What the base commit holds, for the diff route. */
  baseTree?: { path: string; type: string; sha: string }[];
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
    if (method === 'GET' && path.includes('/git/trees/')) {
      return json({ tree: state.baseTree ?? [], truncated: false });
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

/**
 * The binding is read when the request arrives, not when the button drew it.
 *
 * In between, another tab or the panel in the header can rebind. Without the
 * destination on the request, the click lands on whatever is connected by
 * then: a button labelled one repository writing to another, and two clicks
 * either side of a rebind collapsing onto one
 * `(user, owner, repo, revision)` key so the first one's destination never
 * receives its push and nothing says so.
 */
describe('pushing where the click said, or not at all', () => {
  const FILES = [{ path: 'index.html', content: '<h1>hi</h1>' }];

  it('pushes when the destination is still the one connected', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({
        files: FILES,
        revision: 'r7',
        owner: 'acme',
        repo: 'site',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
  });

  it('refuses one whose destination has moved, and writes nothing', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({
        files: FILES,
        revision: 'r7',
        owner: 'acme',
        repo: 'somewhere-else',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      error: string;
      reconnect?: boolean;
    };
    // The connected repository is named, because that is the half somebody
    // can act on. The requested one is not: it came out of the request body,
    // and a message the browser draws is no place to repeat a caller's own
    // input back at it.
    assert.match(body.error, /acme\/site/);
    assert.doesNotMatch(body.error, /somewhere-else/);
    // Reconnecting is not the remedy, and offering it would send somebody
    // round a loop that ends where it started.
    assert.equal(body.reconnect, undefined);
    // Nothing reached GitHub at all, not even a token.
    assert.deepEqual(calls, []);
  });

  it('refuses one whose owner has moved, keeping the name', async () => {
    // `acme/site` and `other/site` are different repositories. A check that
    // reads the name alone calls them the same one, which forks make
    // ordinary rather than contrived.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({
        files: FILES,
        revision: 'r7',
        owner: 'other',
        repo: 'site',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 409);
    assert.deepEqual(calls, []);
  });

  it('accepts a destination that differs only in case', async () => {
    // GitHub resolves an owner and a name without regard to case, so this
    // destination has not moved. Refusing it would be a refusal with nothing
    // the person could correct.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({
        files: FILES,
        revision: 'r7',
        owner: 'Acme',
        repo: 'Site',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
  });

  it('refuses a caller that did not say where it was pushing', async () => {
    // This was optional for one commit, so an older bundle could still
    // push. It is the wrong trade: a tab old enough to be sending the
    // previous bundle is the tab most likely to be holding a binding that
    // has since moved, so the guard would be skipped by exactly the
    // requests that most need it.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({ files: FILES, revision: 'r7' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  });

  it('refuses half a destination', async () => {
    // An owner with no name has not named a repository, and guessing which
    // half to trust would be inventing the other.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({ files: FILES, revision: 'r7', owner: 'acme' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
  });

  it('refuses an empty destination', async () => {
    // A blank is not a name, and it is a malformed request rather than a
    // destination that moved: 400 says which, and reporting a move would
    // send somebody looking for a change that did not happen.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({ files: FILES, revision: 'r7', owner: '', repo: '' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      movedTo?: { owner: string; repo: string };
    };
    assert.equal(body.movedTo, undefined);
  });

  it('names where the connection points, so the caller can tell later', async () => {
    // A tab that missed the change cannot find out any other way: the
    // notification inside the browser is per-document, so a rebind in
    // another tab or on another device never reaches it. Without this it
    // repeats the same refused push forever, because nothing in a 409 says
    // that what it believes is the thing that is wrong.
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit' });

    const response = await handleGitHubPush(
      pushRequest({
        files: FILES,
        revision: 'r7',
        owner: 'acme',
        repo: 'somewhere-else',
      }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      movedTo?: { owner: string; repo: string };
      reconnect?: boolean;
    };
    // The destination rather than a flag: the sentence beside it names this
    // repository, and a caller that reads the connection again needs to be
    // able to tell whether that sentence is still about the place it is
    // showing.
    assert.deepEqual(body.movedTo, { owner: 'acme', repo: 'site' });
    // The connection is not the thing that is wrong, so reconnecting is not
    // the remedy and offering it would be a loop.
    assert.equal(body.reconnect, undefined);
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

    // The user connects somewhere else and pushes the same checkpoint. The
    // second push names the second repository: a click made after the
    // rebind is a click on a button showing the new destination, and one
    // still naming the old one is refused rather than sent blind.
    await store.bind({ ...GRANT, owner: 'acme', repo: 'other-site' });
    const second = fakeGitHub({ base: 'base-in-other-site' });
    const response = await handleGitHubPush(
      pushRequest({
        files: [{ path: 'index.html', content: '<h1>hi</h1>' }],
        revision: 'r7',
        owner: 'acme',
        repo: 'other-site',
      }),
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

/**
 * The same distinction as the mint, one seam further along.
 *
 * `call` in `github-push.ts` classifies each refusal and keeps the status,
 * and the whole benefit is lost if every push failure reaches the browser as
 * a 409. A conflict is something a person has to resolve; a rate limit or a
 * dropped connection is something to retry, and calling the second the first
 * puts the user in a dialog they cannot act on.
 */
describe('when the push itself fails', () => {
  function githubThatRefuses(refusal: () => Response) {
    return (async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path.endsWith('/access_tokens')) {
        return new Response(
          JSON.stringify({ token: 'ghs_x', expires_at: 'later' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (path.endsWith('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'base' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return refusal();
    }) as unknown as typeof fetch;
  }

  async function pushWith(doFetch: typeof fetch) {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    return handleGitHubPush(pushRequest(), env(db), PRINCIPAL, doFetch, NOW);
  }

  it('reports a rate limit during the push as one, not as a conflict', async () => {
    const response = await pushWith(
      githubThatRefuses(
        () =>
          new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
            status: 403,
            headers: {
              'content-type': 'application/json',
              'retry-after': '30',
            },
          }),
      ),
    );
    assert.equal(response.status, 429);
    const body = (await response.json()) as {
      error: string;
      reconnect?: boolean;
    };
    assert.equal(body.reconnect, undefined);
    assert.match(body.error, /rate limiting/);
  });

  it('reports a GitHub server error as retryable, not as a conflict', async () => {
    const response = await pushWith(
      githubThatRefuses(() => new Response('{}', { status: 500 })),
    );
    assert.equal(response.status, 502);
  });

  it('asks for a reconnect when the push finds access gone', async () => {
    const response = await pushWith(
      githubThatRefuses(
        () =>
          new Response(JSON.stringify({ message: 'Bad credentials' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { reconnect?: boolean };
    assert.equal(body.reconnect, true);
  });

  it('refuses a repository with no commits rather than calling it a conflict', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const doFetch = (async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path.endsWith('/access_tokens')) {
        return new Response(
          JSON.stringify({ token: 'ghs_x', expires_at: 'later' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      // No base ref, and no branches at all: an empty repository.
      if (path.includes('/git/ref/heads/main')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /no commits yet/);
  });
});

/**
 * A repository dropped from the installation's selection.
 *
 * GitHub refuses to scope a token to a repository the installation was not
 * granted, and the refusal is a 422 rather than a 404. Read as an ordinary
 * validation failure it becomes a retryable 502, so the client retries a
 * call that cannot ever succeed and the user is never told the one thing
 * that would fix it.
 */
describe('when the repository has left the installation', () => {
  it('asks for re-approval rather than reporting something to retry', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const response = await handleGitHubPush(
      pushRequest(),
      env(db),
      PRINCIPAL,
      (async () =>
        new Response(
          JSON.stringify({
            message:
              'There is at least one repository that does not exist or is not accessible to the parent installation.',
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      error: string;
      reconnect?: boolean;
    };
    assert.equal(body.reconnect, true);
    assert.match(body.error, /Approve it again/);
  });
});

describe('previewing a push', () => {
  function diffRequest(body: unknown = undefined): Request {
    return new Request('https://app.vibld.com/api/github/diff', {
      method: 'POST',
      body: JSON.stringify(
        body ?? { files: [{ path: 'index.html', content: '<h1>hi</h1>' }] },
      ),
    });
  }

  it('reports what the push would add, change and remove', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({
      base: 'base-commit',
      baseTree: [
        {
          path: 'index.html',
          type: 'blob',
          sha: await blobSha('<h1>old</h1>'),
        },
        { path: 'LICENSE', type: 'blob', sha: await blobSha('MIT') },
      ],
    });

    const response = await handleGitHubDiff(
      diffRequest(),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      owner: string;
      repo: string;
      changed: string[];
      removed: string[];
    };
    assert.equal(body.changed[0], 'index.html');
    assert.deepEqual(body.removed, ['LICENSE']);
    // The destination travels with the diff: a caller has to be able to tell
    // whether the preview describes the repository it is about to push to.
    assert.equal(body.owner, 'acme');
    assert.equal(body.repo, 'site');
  });

  it('writes nothing to GitHub', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch, calls } = fakeGitHub({
      base: 'base-commit',
      baseTree: [],
    });

    await handleGitHubDiff(diffRequest(), env(db), PRINCIPAL, doFetch, NOW);

    // The token mint is a POST GitHub requires; nothing else may be.
    const writes = calls.filter(
      (call) => call.method === 'POST' && !call.path.endsWith('/access_tokens'),
    );
    assert.deepEqual(writes, []);
  });

  it('records no push attempt, so a preview cannot pin a parent', async () => {
    // The push ledger is what makes a retry commit onto the same parent. A
    // preview that wrote to it would pin a base the user never pushed
    // against, and a later real push would inherit it.
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit', baseTree: [] });

    await handleGitHubDiff(diffRequest(), env(db), PRINCIPAL, doFetch, NOW);

    assert.equal(
      await store.push({
        userId: 'user_1',
        owner: 'acme',
        repo: 'site',
        revision: 'r7',
      }),
      null,
    );
  });

  it('asks for a connection when there is not one', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubDiff(
      diffRequest(),
      env(db),
      PRINCIPAL,
      (async () =>
        new Response('', { status: 500 })) as unknown as typeof fetch,
      NOW,
    );
    assert.equal(response.status, 409);
  });

  it('refuses a body with no files rather than answering an empty diff', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await new GitHubStore(db as unknown as D1Database).bind(GRANT);
    const { doFetch } = fakeGitHub({ base: 'base-commit', baseTree: [] });

    const response = await handleGitHubDiff(
      diffRequest({ files: [] }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );

    assert.ok(response.status >= 400);
  });
});
