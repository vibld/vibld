import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  handleGitHubBind,
  handleGitHubCallback,
  handleGitHubComplete,
  handleGitHubConnect,
  handleGitHubDisconnect,
  handleGitHubStatus,
} from '../worker/github-handlers.ts';
import {
  signChoice,
  signState,
  userInstallations,
} from '../worker/github-connect.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0005_github.sql'),
  'utf8',
);

const CREDENTIALS = {
  clientId: 'Iv1.abc123',
  clientSecret: 'the-client-secret',
};

const PRINCIPAL = { userId: 'user_1', policyIdentity: 'chris@example.com' };
const NOW = new Date('2026-09-13T12:00:00.000Z');

function env(db: SqliteD1Database) {
  return {
    DB: db as unknown as D1Database,
    VIBLD_GITHUB_CLIENT_ID: CREDENTIALS.clientId,
    VIBLD_GITHUB_CLIENT_SECRET: CREDENTIALS.clientSecret,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A GitHub where `user_1` reaches installation 42 and nothing else. */
function githubFor(
  installations: { id: number; account: { login: string } }[],
  repositories: Record<number, unknown[]>,
) {
  return (async (url: string) => {
    const target = new URL(url);
    if (target.pathname === '/login/oauth/access_token') {
      return json({ access_token: 'ghu_user' });
    }
    if (target.pathname === '/user/installations') {
      return json({ installations });
    }
    const match = target.pathname.match(
      /^\/user\/installations\/(\d+)\/repositories$/,
    );
    if (match) {
      const id = Number(match[1]);
      // GitHub answers 404 for an installation this user cannot reach, which
      // is what a forged id looks like from here.
      if (!(id in repositories)) return json({ message: 'Not Found' }, 404);
      return json({ repositories: repositories[id] });
    }
    return json({ message: 'unexpected' }, 500);
  }) as unknown as typeof fetch;
}

const ACME_SITE = {
  name: 'site',
  default_branch: 'main',
  owner: { login: 'acme' },
  permissions: { push: true },
};

function callbackRequest(params: Record<string, string>): Request {
  return new Request('https://app.vibld.com/api/github/complete', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

describe('starting a connection', () => {
  it('hands back a URL rather than redirecting the caller', async () => {
    // The caller is an authenticated fetch from the builder. A 302 would be
    // followed by that fetch, sending its Authorization header to GitHub.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubConnect(
      new Request('https://app.vibld.com/api/github/connect'),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string };
    const url = new URL(body.url);
    assert.equal(url.host, 'github.com');
    assert.equal(url.searchParams.get('client_id'), CREDENTIALS.clientId);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://app.vibld.com/api/github/callback',
    );
  });

  it('says so when this deployment cannot connect anything', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubConnect(
      new Request('https://app.vibld.com/api/github/connect'),
      { DB: db as unknown as D1Database },
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 503);
  });
});

describe('coming back from GitHub', () => {
  it('offers the repositories the user can actually write to', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation_id: '42' }),
      env(db),
      PRINCIPAL,
      githubFor([{ id: 42, account: { login: 'acme' } }], { 42: [ACME_SITE] }),
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      repositories: { owner: string; repo: string }[];
      ticket: string;
    };
    assert.deepEqual(body.repositories, [
      {
        installationId: 42,
        owner: 'acme',
        repo: 'site',
        defaultBranch: 'main',
      },
    ]);
    assert.ok(body.ticket);
  });

  it('refuses a state signed for somebody else', async () => {
    // The attack this leg defends against: another person's authorization
    // walked into this session.
    const db = new SqliteD1Database(SCHEMA);
    const theirState = await signState(CREDENTIALS, 'user_2', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state: theirState }),
      env(db),
      PRINCIPAL,
      githubFor([{ id: 42, account: { login: 'acme' } }], { 42: [ACME_SITE] }),
      NOW,
    );
    assert.equal(response.status, 400);
  });

  it('refuses a state this deployment never signed', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state: 'made.up' }),
      env(db),
      PRINCIPAL,
      githubFor([{ id: 42, account: { login: 'acme' } }], { 42: [ACME_SITE] }),
      NOW,
    );
    assert.equal(response.status, 400);
  });

  it('ignores an installation id the user cannot reach', async () => {
    // The whole point of the file. `installation_id` arrives on an unsigned
    // redirect, so it is a preference: what GitHub says this account can
    // reach is what counts, and a forged id is simply not in that answer.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({
        code: 'the-code',
        state,
        installation_id: '999999',
      }),
      env(db),
      PRINCIPAL,
      githubFor([{ id: 42, account: { login: 'acme' } }], { 42: [ACME_SITE] }),
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      repositories: { installationId: number; owner: string; repo: string }[];
    };
    assert.deepEqual(body.repositories, [
      {
        installationId: 42,
        owner: 'acme',
        repo: 'site',
        defaultBranch: 'main',
      },
    ]);
  });

  it('says to install the app when the user reaches none', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor([], {}),
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { install?: boolean };
    assert.equal(body.install, true);
  });

  it('refuses a link with no code on it', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ state }),
      env(db),
      PRINCIPAL,
      githubFor([], {}),
      NOW,
    );
    assert.equal(response.status, 400);
  });
});

describe('binding the repository the user chose', () => {
  const OFFERED = [
    { installationId: 42, owner: 'acme', repo: 'site', defaultBranch: 'trunk' },
  ];

  async function ticketFor(userId = 'user_1', repositories = OFFERED) {
    return signChoice(CREDENTIALS, userId, repositories, NOW.getTime());
  }

  it('writes the binding from what was signed, not from the request', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        // The browser names a branch; the binding must take GitHub's.
        body: JSON.stringify({
          ticket: await ticketFor(),
          owner: 'acme',
          repo: 'site',
          defaultBranch: 'attacker-chosen',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);

    const stored = await new GitHubStore(db as unknown as D1Database).binding(
      'user_1',
    );
    assert.equal(stored?.owner, 'acme');
    assert.equal(stored?.repo, 'site');
    assert.equal(stored?.defaultBranch, 'trunk');
    assert.equal(stored?.installationId, 42);
    assert.equal(stored?.grantedByEmail, 'chris@example.com');
  });

  it('refuses a repository that was never offered', async () => {
    // Without this the ticket would be a bearer token for any repository,
    // and the browser would be back to asserting its own authorization.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: await ticketFor(),
          owner: 'someone-else',
          repo: 'private',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 403);
    assert.equal(
      await new GitHubStore(db as unknown as D1Database).binding('user_1'),
      null,
    );
  });

  it('refuses a ticket issued to a different user', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: await ticketFor('user_2'),
          owner: 'acme',
          repo: 'site',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 400);
    assert.equal(
      await new GitHubStore(db as unknown as D1Database).binding('user_1'),
      null,
    );
  });

  it('refuses a ticket this deployment did not sign', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const forged = await signChoice(
      { ...CREDENTIALS, clientSecret: 'not-the-secret' },
      'user_1',
      [
        {
          installationId: 999,
          owner: 'someone-else',
          repo: 'private',
          defaultBranch: 'main',
        },
      ],
      NOW.getTime(),
    );
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: forged,
          owner: 'someone-else',
          repo: 'private',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 400);
    assert.equal(
      await new GitHubStore(db as unknown as D1Database).binding('user_1'),
      null,
    );
  });

  it('refuses a ticket that has gone stale', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: await ticketFor(),
          owner: 'acme',
          repo: 'site',
        }),
      }),
      env(db),
      PRINCIPAL,
      new Date(NOW.getTime() + 16 * 60 * 1000),
    );
    assert.equal(response.status, 400);
  });

  it('matches the repository without regard to case', async () => {
    // GitHub treats owner and repository names case-insensitively, so a
    // picker that round-trips a differently-cased name must still bind.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: await ticketFor(),
          owner: 'ACME',
          repo: 'Site',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    const stored = await new GitHubStore(db as unknown as D1Database).binding(
      'user_1',
    );
    // Stored as GitHub spells it, not as the request did.
    assert.equal(stored?.owner, 'acme');
    assert.equal(stored?.repo, 'site');
  });

  it('refuses a request missing the pieces', async () => {
    const db = new SqliteD1Database(SCHEMA);
    for (const body of [{}, { ticket: 'x' }, { owner: 'a', repo: 'b' }]) {
      const response = await handleGitHubBind(
        new Request('https://app.vibld.com/api/github/bind', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        env(db),
        PRINCIPAL,
        NOW,
      );
      assert.equal(response.status, 400);
    }
  });
});

/** A binding row for the tests that need one already in place. */
const GRANT_ROW = {
  userId: 'user_1',
  installationId: 42,
  owner: 'acme',
  repo: 'site',
  defaultBranch: 'main',
  grantedAt: NOW.toISOString(),
  grantedByEmail: 'chris@example.com',
  expiresAt: '2026-12-13T00:00:00.000Z',
};

function disconnectRequest(body: unknown): Request {
  return new Request('https://app.vibld.com/api/github/disconnect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('disconnecting', () => {
  it('stops a push without deleting the record of the grant', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind({
      userId: 'user_1',
      installationId: 42,
      owner: 'acme',
      repo: 'site',
      defaultBranch: 'main',
      grantedAt: NOW.toISOString(),
      grantedByEmail: 'chris@example.com',
      expiresAt: '2026-12-13T00:00:00.000Z',
    });

    const response = await handleGitHubDisconnect(
      disconnectRequest({ owner: 'acme', repo: 'site' }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);

    const state = await store.usableBinding('user_1', NOW);
    assert.equal(state.usable, false);
    if (!state.usable) assert.equal(state.reason, 'revoked');
    assert.ok(await store.binding('user_1'), 'the row was deleted');
  });

  it('answers the same way when there was nothing connected', async () => {
    // A disconnect that got what it asked for and a disconnect with nothing
    // to do are the same answer, so neither the work nor the absence of it
    // is reported differently.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubDisconnect(
      disconnectRequest({ owner: 'acme', repo: 'site' }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connected: false });
  });

  it('refuses to end a connection it was not asked to end', async () => {
    // The panel offering this reads the connection whenever it last looked,
    // and the route acts on whatever is bound when the request arrives.
    // Without this, somebody reading `acme/site` and pressing Disconnect
    // ended `acme/other` if the binding had moved in another tab or on
    // another device: undoing a connection they meant to keep and keeping
    // one they meant to end, in one click, with nothing saying so.
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind({ ...GRANT_ROW, owner: 'acme', repo: 'other' });

    const response = await handleGitHubDisconnect(
      disconnectRequest({ owner: 'acme', repo: 'site' }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      movedTo?: { owner: string; repo: string };
    };
    assert.deepEqual(body.movedTo, { owner: 'acme', repo: 'other' });

    // And the connection it was not asked about is untouched.
    const state = await store.usableBinding('user_1', NOW);
    assert.equal(state.usable, true);
  });

  it('refuses one that does not say what it is ending', async () => {
    // Required rather than optional, on the reasoning the push settled: a
    // caller old enough to be sending no destination is the one most likely
    // to be holding a binding that has moved.
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind(GRANT_ROW);

    const response = await handleGitHubDisconnect(
      new Request('https://app.vibld.com/api/github/disconnect', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 400);
    const state = await store.usableBinding('user_1', NOW);
    assert.equal(state.usable, true);
  });

  it('ends a connection named in the case GitHub would resolve', async () => {
    // `acme/Site` and `acme/site` are one repository, and refusing that
    // would be a refusal with nothing for anybody to correct.
    const db = new SqliteD1Database(SCHEMA);
    const store = new GitHubStore(db as unknown as D1Database);
    await store.bind(GRANT_ROW);

    const response = await handleGitHubDisconnect(
      disconnectRequest({ owner: 'Acme', repo: 'Site' }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    const state = await store.usableBinding('user_1', NOW);
    assert.equal(state.usable, false);
  });
});

/**
 * More than one installation.
 *
 * One person can have the App on their own account and on an organisation.
 * Reading a second installation's repositories needs the user token, and
 * that is gone as soon as the callback ends, so anything not offered here
 * cannot be reached later at all. Offering one installation and naming the
 * rest would be a dead end rather than a limit.
 */
describe('a user with the app on more than one account', () => {
  const BOTH = [
    { id: 42, account: { login: 'chris' } },
    { id: 77, account: { login: 'acme' } },
  ];
  const REPOS = {
    42: [
      {
        name: 'personal',
        default_branch: 'main',
        owner: { login: 'chris' },
        permissions: { push: true },
      },
    ],
    77: [
      {
        name: 'work',
        default_branch: 'main',
        owner: { login: 'acme' },
        permissions: { push: true },
      },
    ],
  };

  async function callback(params: Record<string, string> = {}) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, ...params }),
      env(db),
      PRINCIPAL,
      githubFor(BOTH, REPOS),
      NOW,
    );
    return { db, response };
  }

  it('offers repositories from every installation, not just the first', async () => {
    const { response } = await callback();
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      repositories: { installationId: number; owner: string; repo: string }[];
    };
    assert.deepEqual(
      body.repositories.map((r) => `${r.owner}/${r.repo}`).sort(),
      ['acme/work', 'chris/personal'],
    );
  });

  it('puts the installation just used first, without hiding the others', async () => {
    const { response } = await callback({ installation_id: '77' });
    const body = (await response.json()) as {
      repositories: { owner: string; repo: string }[];
    };
    assert.equal(
      `${body.repositories[0]?.owner}/${body.repositories[0]?.repo}`,
      'acme/work',
    );
    assert.equal(body.repositories.length, 2);
  });

  it('binds through the installation the chosen repository came from', async () => {
    // The reason the installation travels with the repository: pushing
    // acme/work through the personal installation would be refused, and the
    // refusal would arrive at the first push rather than at the choice.
    const { db, response } = await callback();
    const body = (await response.json()) as { ticket: string };

    const bound = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: body.ticket,
          owner: 'acme',
          repo: 'work',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(bound.status, 200);
    const stored = await new GitHubStore(db as unknown as D1Database).binding(
      'user_1',
    );
    assert.equal(stored?.installationId, 77);
    assert.equal(stored?.repo, 'work');
  });

  it('binds through the right installation when the choice is not the first', async () => {
    // Deliberately picks the entry that does not sort first. Without it,
    // taking the installation from the head of the list passes by
    // coincidence, which is what this test caught when it was written the
    // other way round.
    const { db, response } = await callback();
    const body = (await response.json()) as {
      ticket: string;
      repositories: { owner: string; repo: string }[];
    };
    assert.notEqual(
      `${body.repositories[0]?.owner}/${body.repositories[0]?.repo}`,
      'chris/personal',
      'the fixture no longer puts the chosen repository second',
    );

    const bound = await handleGitHubBind(
      new Request('https://app.vibld.com/api/github/bind', {
        method: 'POST',
        body: JSON.stringify({
          ticket: body.ticket,
          owner: 'chris',
          repo: 'personal',
        }),
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(bound.status, 200);
    const stored = await new GitHubStore(db as unknown as D1Database).binding(
      'user_1',
    );
    assert.equal(stored?.installationId, 42);
    assert.equal(stored?.repo, 'personal');
  });

  it('still offers what it can read when one installation fails', async () => {
    // An organisation removed from under the App should not stop somebody
    // connecting a repository on their own account.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor(BOTH, { 42: REPOS[42] }),
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      repositories: { owner: string; repo: string }[];
    };
    assert.deepEqual(
      body.repositories.map((r) => `${r.owner}/${r.repo}`),
      ['chris/personal'],
    );
  });

  it('reports the failure when no installation could be read at all', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor(BOTH, {}),
      NOW,
    );
    assert.equal(response.status, 409);
  });
});

/**
 * Pushing and connecting are configured separately, so the status has to
 * report them separately. A panel that reads one boolean offers a Connect
 * button on a deployment that cannot connect, and the user finds out by
 * being handed a 503.
 */
describe('what the status tells the builder it can offer', () => {
  const APP = {
    VIBLD_GITHUB_APP_ID: '123',
    VIBLD_GITHUB_PRIVATE_KEY: 'a-key',
  };
  const OAUTH = {
    VIBLD_GITHUB_CLIENT_ID: CREDENTIALS.clientId,
    VIBLD_GITHUB_CLIENT_SECRET: CREDENTIALS.clientSecret,
  };

  async function statusWith(extra: Record<string, string>) {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubStatus(
      new Request('https://app.vibld.com/api/github/status'),
      { DB: db as unknown as D1Database, ...extra },
      PRINCIPAL,
      NOW,
    );
    return (await response.json()) as {
      configured: boolean;
      canPush?: boolean;
      canConnect?: boolean;
    };
  }

  it('says it can do both when both halves are there', async () => {
    const body = await statusWith({ ...APP, ...OAUTH });
    assert.deepEqual(
      [body.configured, body.canPush, body.canConnect],
      [true, true, true],
    );
  });

  it('says it cannot connect when only the app half is there', async () => {
    // The case that would otherwise offer a button returning 503.
    const body = await statusWith(APP);
    assert.deepEqual(
      [body.configured, body.canPush, body.canConnect],
      [true, true, false],
    );
  });

  it('says it cannot push when only the oauth half is there', async () => {
    const body = await statusWith(OAUTH);
    assert.deepEqual(
      [body.configured, body.canPush, body.canConnect],
      [true, false, true],
    );
  });

  it('says it can do nothing when neither half is there', async () => {
    const body = await statusWith({});
    assert.deepEqual(
      [body.configured, body.canPush, body.canConnect],
      [false, false, false],
    );
  });
});

/**
 * The redirect GitHub actually lands on.
 *
 * This is the route that was wrong, and the reason it was wrong is worth
 * keeping: every test above hands a handler a principal, which quietly
 * assumes one can exist. GitHub returns through a top-level browser
 * navigation, which carries no Authorization header, so requiring a Clerk
 * session here rejected every real callback with a 401 before it did
 * anything. Testing the handler proved the handler; it could not prove the
 * route was reachable.
 */
describe('the redirect GitHub lands on', () => {
  it('needs no authentication at all', () => {
    // The assertion that matters: it is a plain function of the request,
    // with no principal and no env, so a route that cannot supply either
    // still works.
    const response = handleGitHubCallback(
      new Request('https://app.vibld.com/api/github/callback?code=c&state=s'),
    );
    assert.equal(response.status, 302);
  });

  it('hands the code and state to the app in the fragment', () => {
    // The fragment is never sent to a server, which keeps a single-use code
    // out of request logs on the way through.
    const response = handleGitHubCallback(
      new Request(
        'https://app.vibld.com/api/github/callback?code=the-code&state=the-state',
      ),
    );
    const location = new URL(response.headers.get('location')!);
    assert.equal(location.origin, 'https://app.vibld.com');
    assert.equal(location.search, '');
    assert.match(location.hash, /github=the-code/);
    assert.match(location.hash, /state=the-state/);
  });

  it('stays on this origin whatever the request asks for', () => {
    // A callback that forwarded somewhere the caller named would be an open
    // redirect with an OAuth code attached to it.
    const response = handleGitHubCallback(
      new Request(
        'https://app.vibld.com/api/github/callback?code=c&state=s&redirect_uri=https://evil.example/steal',
      ),
    );
    const location = new URL(response.headers.get('location')!);
    assert.equal(location.origin, 'https://app.vibld.com');
  });

  it('says so rather than passing an incomplete return through', () => {
    const response = handleGitHubCallback(
      new Request('https://app.vibld.com/api/github/callback'),
    );
    assert.equal(
      new URL(response.headers.get('location')!).hash,
      '#github=incomplete',
    );
  });
});

describe('starting a connection, for the browser to remember', () => {
  it('returns the state as well as the URL', async () => {
    // The app keeps this and compares it on the way back, so a link somebody
    // else crafted carries a state the browser never issued.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubConnect(
      new Request('https://app.vibld.com/api/github/connect'),
      env(db),
      PRINCIPAL,
      NOW,
    );
    const body = (await response.json()) as { url: string; state: string };
    assert.ok(body.state);
    assert.equal(
      new URL(body.url).searchParams.get('state'),
      body.state,
      'the state handed back is not the one in the URL',
    );
  });
});

/**
 * More installations than the read is willing to make calls for.
 *
 * Reading every installation is one call each, so it is capped. That cap is
 * a limit right up until the installation somebody just used falls outside
 * it, at which point it becomes a dead end: the user token is gone once the
 * exchange ends, so an installation not read here can never be reached.
 */
describe('when the account reaches more installations than are read', () => {
  const MANY = Array.from({ length: 12 }, (_, index) => ({
    id: 100 + index,
    account: { login: `account-${index}` },
  }));
  const REPOS = Object.fromEntries(
    MANY.map((installation) => [
      installation.id,
      [
        {
          name: `repo-${installation.id}`,
          default_branch: 'main',
          owner: { login: 'acme' },
          permissions: { push: true },
        },
      ],
    ]),
  );
  // The last one GitHub lists, well outside the cap.
  const LATE = MANY[11]!.id;

  async function complete(body: Record<string, string>) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, ...body }),
      env(db),
      PRINCIPAL,
      githubFor(MANY, REPOS),
      NOW,
    );
    return (await response.json()) as {
      repositories: { installationId: number; repo: string }[];
    };
  }

  it('offers the installation just used even when it is listed last', async () => {
    const body = await complete({ installation: String(LATE) });
    assert.ok(
      body.repositories.some((choice) => choice.installationId === LATE),
      'the installation the user just chose was never read',
    );
  });

  it('does not offer it when nothing points at it', async () => {
    // Shows the previous test is about the hint rather than about the cap
    // happening to be generous.
    const body = await complete({});
    assert.equal(
      body.repositories.some((choice) => choice.installationId === LATE),
      false,
    );
  });

  it('names the accounts it did not read, rather than dropping them', async () => {
    // The ordinary path has no hint at all: once the App is installed,
    // GitHub's authorization callback carries `code` and `state` and no
    // `installation_id`. So the two accounts past the cap are not merely
    // unlisted, they are unreachable, because the user token is discarded
    // when this ends. Naming them turns that back into a limit: installing
    // again on one returns an id, and a named installation is read directly
    // and outside the budget.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor(MANY, REPOS),
      NOW,
    );
    const body = (await response.json()) as { omitted?: string[] };
    assert.deepEqual(body.omitted, ['account-10', 'account-11']);
  });

  it('says a repository list was cut short, rather than signing it', async () => {
    // A page bound inside one installation. Unlike a skipped account there
    // is no route past it: reading the same installation again follows the
    // same bound, so the only honest thing is to stop presenting the short
    // list as the whole one.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return json({ access_token: 'ghu_user' });
      }
      if (target.pathname === '/user/installations') {
        return json({
          installations: [{ id: 55, account: { login: 'acme' } }],
        });
      }
      if (target.pathname === '/user/installations/55/repositories') {
        // Always another page, so the bound is what stops it.
        return new Response(
          JSON.stringify({
            repositories: [
              {
                name: `repo-${target.searchParams.get('page') ?? '1'}`,
                default_branch: 'main',
                owner: { login: 'acme' },
                permissions: { push: true },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              link: '</user/installations/55/repositories?page=9>; rel="next"',
            },
          },
        );
      }
      return json({ message: 'unexpected' }, 500);
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { truncated?: boolean };
    assert.equal(body.truncated, true);
  });

  it('says the installation list itself was cut short', async () => {
    // The other half of the same bound, and the one `omitted` cannot cover:
    // an account past the last page GitHub was asked for is never listed, so
    // it cannot be named as skipped either. Only the page bound knows.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return json({ access_token: 'ghu_user' });
      }
      if (target.pathname === '/user/installations') {
        // Always another page, so the bound is what stops it.
        return new Response(
          JSON.stringify({
            installations: [{ id: 55, account: { login: 'acme' } }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              link: '</user/installations?page=9>; rel="next"',
            },
          },
        );
      }
      if (target.pathname === '/user/installations/55/repositories') {
        return json({ repositories: [ACME_SITE] });
      }
      return json({ message: 'unexpected' }, 500);
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { truncated?: boolean };
    assert.equal(body.truncated, true);
  });

  it('says nothing about omissions when it read them all', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const few = MANY.slice(0, 3);
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor(few, REPOS),
      NOW,
    );
    const body = (await response.json()) as { omitted?: string[] };
    assert.equal(body.omitted, undefined);
  });

  it('ignores a hint that names an installation the user cannot reach', async () => {
    // Still only a reordering of what GitHub said this account can reach.
    const body = await complete({ installation: '999999' });
    assert.ok(body.repositories.length > 0);
    assert.equal(
      body.repositories.some((choice) => choice.installationId === 999999),
      false,
    );
  });
});

describe('the redirect passing the installation along', () => {
  it('carries it so the exchange can prefer it', () => {
    const response = handleGitHubCallback(
      new Request(
        'https://app.vibld.com/api/github/callback?code=c&state=s&installation_id=77',
      ),
    );
    assert.match(response.headers.get('location')!, /installation=77/);
  });

  it('leaves it out when GitHub did not send one', () => {
    const response = handleGitHubCallback(
      new Request('https://app.vibld.com/api/github/callback?code=c&state=s'),
    );
    assert.equal(
      response.headers.get('location')!.includes('installation='),
      false,
    );
  });
});

/**
 * An installation GitHub's own list never mentions.
 *
 * The list is paged, so an account with many installations can have the one
 * it just used fall outside what was read. Sorting the list cannot rescue
 * something that is not in it, so the installation named on the way back is
 * read directly. That gives up nothing: reading an installation's
 * repositories as the user is itself the authorization check.
 */
describe('when the list does not mention the installation just used', () => {
  const LISTED = [{ id: 1, account: { login: 'listed' } }];

  async function complete(hint: string, repos: Record<number, unknown[]>) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: hint }),
      env(db),
      PRINCIPAL,
      githubFor(LISTED, repos),
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        repositories?: { installationId: number; repo: string }[];
      },
    };
  }

  const repo = (name: string) => ({
    name,
    default_branch: 'main',
    owner: { login: 'acme' },
    permissions: { push: true },
  });

  it('offers it anyway when GitHub says the user can reach it', async () => {
    const { body } = await complete('500', {
      1: [repo('listed-one')],
      500: [repo('unlisted-one')],
    });
    assert.ok(
      body.repositories?.some((choice) => choice.installationId === 500),
      'an installation outside the list was never read',
    );
  });

  it('offers nothing extra when GitHub says the user cannot', async () => {
    // A forged id looks exactly like this, and the 404 is the answer.
    const { body } = await complete('999999', { 1: [repo('listed-one')] });
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['listed-one'],
    );
  });

  it('is not fooled into reading nonsense', async () => {
    const { body } = await complete('not-a-number', {
      1: [repo('listed-one')],
    });
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['listed-one'],
    );
  });
});

describe('the installation list itself', () => {
  it('is paged through rather than read once', async () => {
    // GitHub's default page is 30, and the list decides what can be offered.
    const asked: string[] = [];
    const first = 'https://api.github.com/user/installations?per_page=100';
    const second =
      'https://api.github.com/user/installations?per_page=100&page=2';
    const doFetch = (async (url: string) => {
      asked.push(url);
      if (url === first) {
        return new Response(
          JSON.stringify({
            installations: [{ id: 1, account: { login: 'a' } }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              link: `<${second}>; rel="next"`,
            },
          },
        );
      }
      return new Response(
        JSON.stringify({ installations: [{ id: 2, account: { login: 'b' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await userInstallations('ghu_user', doFetch);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.value.items.map((installation) => installation.id),
        [1, 2],
      );
    }
    assert.equal(asked.length, 2);
  });
});

/**
 * A hint that answers 404, alongside a full budget.
 *
 * Reading the named installation directly is what makes one behind a page
 * boundary reachable, but a forged or stale id gets read too, and its answer
 * is a 404. If that read were charged to the budget, a made-up id would cost
 * a real installation its place: with ten legitimate ones, the tenth would
 * go unread and, the token being gone by then, become unbindable. A stranger
 * should not be able to shrink somebody's choices by sending them a link.
 */
describe('a hint that is not real, with the budget already full', () => {
  const TEN = Array.from({ length: 10 }, (_, index) => ({
    id: 200 + index,
    account: { login: `account-${index}` },
  }));
  const REPOS = Object.fromEntries(
    TEN.map((installation) => [
      installation.id,
      [
        {
          name: `repo-${installation.id}`,
          default_branch: 'main',
          owner: { login: 'acme' },
          permissions: { push: true },
        },
      ],
    ]),
  );
  const LAST = TEN[9]!.id;

  async function offered(hint?: string) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({
        code: 'the-code',
        state,
        ...(hint ? { installation: hint } : {}),
      }),
      env(db),
      PRINCIPAL,
      githubFor(TEN, REPOS),
      NOW,
    );
    const body = (await response.json()) as {
      repositories: { installationId: number }[];
    };
    return body.repositories.map((choice) => choice.installationId);
  }

  it('does not cost a real installation its place in the read', async () => {
    const withForged = await offered('999999');
    assert.ok(
      withForged.includes(LAST),
      'a forged hint pushed a real installation out of the budget',
    );
  });

  it('offers the same set with or without the forged hint', async () => {
    assert.deepEqual(
      (await offered('999999')).sort(),
      (await offered()).sort(),
    );
  });
});

/**
 * The moment just after somebody installs the App.
 *
 * GitHub's `/user/installations` is not always current the instant it
 * redirects from an installation. Checking the list for emptiness before
 * reading anything therefore tells the person to install the App they have
 * just this second installed, which is both wrong and impossible to act on.
 * The id on the redirect names the thing that does not appear yet, so it is
 * read directly, and only a read that finds nothing means nothing is there.
 */
describe('when the new installation has not reached the list yet', () => {
  async function complete(hint: string, repos: Record<number, unknown[]>) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: hint }),
      env(db),
      PRINCIPAL,
      githubFor([], repos),
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        install?: boolean;
        repositories?: { repo: string }[];
      },
    };
  }

  it('offers the new installation rather than saying to install it', async () => {
    const { status, body } = await complete('55', {
      55: [
        {
          name: 'just-installed',
          default_branch: 'main',
          owner: { login: 'acme' },
          permissions: { push: true },
        },
      ],
    });
    assert.equal(status, 200);
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['just-installed'],
    );
  });

  it('still says to install when there is genuinely nothing', async () => {
    const { status, body } = await complete('55', {});
    assert.equal(status, 409);
    assert.equal(body.install, true);
  });
});

/**
 * An empty list and a probe that failed for some other reason.
 *
 * "Install the App" is the right answer to a 404, which alongside an empty
 * list confirms there is nothing there. It is the wrong answer to a rate
 * limit or an unreachable GitHub, which say nothing about whether anything
 * is installed: it hides a retryable error behind an instruction that cannot
 * help, and sends somebody off to reinstall an App that may be working.
 */
describe('when the list is empty and the probe fails for another reason', () => {
  async function complete(probeReply: () => Response) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'ghu_user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname === '/user/installations') {
        return new Response(JSON.stringify({ installations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return probeReply();
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '55' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as { install?: boolean; error: string },
    };
  }

  it('reports a rate limit rather than telling them to install', async () => {
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'retry-after': '60',
          },
        }),
    );
    assert.equal(status, 429);
    assert.equal(body.install, undefined);
    assert.match(body.error, /rate limiting/);
  });

  it('reports GitHub being unreachable as that', async () => {
    const { status, body } = await complete(() => {
      throw new Error('connection reset');
    });
    assert.equal(status, 502);
    assert.equal(body.install, undefined);
  });

  it('reports a server error as retryable', async () => {
    const { status, body } = await complete(
      () => new Response('{}', { status: 500 }),
    );
    assert.equal(status, 502);
    assert.equal(body.install, undefined);
  });

  it('still says to install when the probe genuinely 404s', async () => {
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    );
    assert.equal(status, 409);
    assert.equal(body.install, true);
  });
});

/**
 * An empty list and a probe GitHub refuses rather than cannot find.
 *
 * 403 and 404 both mean "you are not getting this", and they need different
 * sentences. A 404 with nothing listed means nothing is installed. A 403 is
 * an organisation policy or an ungranted authorization: that person has an
 * App they cannot reach, and "install it" is advice they cannot act on.
 */
describe('when the probe is refused rather than absent', () => {
  async function complete(probe: Response) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'ghu_user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname === '/user/installations') {
        return new Response(JSON.stringify({ installations: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return probe.clone();
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '55' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        install?: boolean;
        reconnect?: boolean;
        error: string;
      },
    };
  }

  it('does not tell them to install an App they cannot reach', async () => {
    const { status, body } = await complete(
      new Response(
        JSON.stringify({
          message: 'Resource protected by organization SAML enforcement',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    assert.equal(status, 409);
    assert.equal(body.install, undefined);
    // The assertion this test was missing when it was first written: an
    // organisation policy is not fixed by signing in again, so telling the
    // client to reconnect contradicts the sentence beside it.
    assert.equal(body.reconnect, undefined);
    assert.match(body.error, /organisation settings/);
  });

  it('still says to install when GitHub cannot find it at all', async () => {
    const { status, body } = await complete(
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    assert.equal(status, 409);
    assert.equal(body.install, true);
  });
});

/**
 * The chosen installation failing while another one works.
 *
 * A partial list is the right answer when some unrelated installation is
 * unreadable. It is the wrong answer when the unreadable one is the
 * installation somebody just picked: they get a cheerful picker that quietly
 * omits what they came for, and the user token is discarded before anything
 * could be retried.
 *
 * The distinction is whether retrying could change the answer. Transient,
 * report it. Definitive, carry on, because failing the whole connection over
 * a forged or stale id in a link would stop somebody binding a repository
 * they can perfectly well reach.
 */
describe('when the installation just chosen cannot be read', () => {
  const OTHER = [{ id: 1, account: { login: 'other' } }];
  const OTHER_REPOS = {
    1: [
      {
        name: 'unrelated',
        default_branch: 'main',
        owner: { login: 'acme' },
        permissions: { push: true },
      },
    ],
  };

  async function complete(probeReply: () => Response) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'ghu_user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname === '/user/installations') {
        return new Response(JSON.stringify({ installations: OTHER }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname.includes('/user/installations/500/')) {
        return probeReply();
      }
      return new Response(JSON.stringify({ repositories: OTHER_REPOS[1] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '500' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        error?: string;
        repositories?: { repo: string }[];
      },
    };
  }

  it('reports a rate limit rather than offering a list without it', async () => {
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'retry-after': '30',
          },
        }),
    );
    assert.equal(status, 429);
    assert.equal(body.repositories, undefined);
  });

  it('reports an unreachable GitHub rather than a partial list', async () => {
    const { status } = await complete(() => {
      throw new Error('connection reset');
    });
    assert.equal(status, 502);
  });

  it('still offers the rest when the chosen one simply is not there', async () => {
    // A forged or stale id in a link must not cost somebody the repositories
    // they can actually reach.
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    );
    assert.equal(status, 200);
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['unrelated'],
    );
  });

  it('still offers the rest when a policy refuses the chosen one', async () => {
    const { status, body } = await complete(
      () =>
        new Response(
          JSON.stringify({ message: 'Resource protected by organization' }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    );
    assert.equal(status, 200);
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['unrelated'],
    );
  });
});

/**
 * A brand-new installation that has nothing pushable in it.
 *
 * The probe succeeding is proof the App is installed, whatever it found.
 * Reading "no repositories offered" as "no App installed" tells somebody to
 * install what they have just installed, and the thing they actually need to
 * hear is that none of its repositories are ones they can push to.
 */
describe('when the new installation has nothing to offer', () => {
  async function complete(repositories: unknown[]) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '55' }),
      env(db),
      PRINCIPAL,
      githubFor([], { 55: repositories }),
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        install?: boolean;
        repositories?: unknown[];
        ticket?: string;
      },
    };
  }

  it('offers an empty picker rather than saying to install it', async () => {
    const { status, body } = await complete([]);
    assert.equal(status, 200);
    assert.equal(body.install, undefined);
    assert.deepEqual(body.repositories, []);
    assert.ok(body.ticket, 'no ticket to pick from');
  });

  it('does the same when everything in it is unpushable', async () => {
    const { status, body } = await complete([
      {
        name: 'read-only',
        owner: { login: 'acme' },
        permissions: { push: false },
      },
      {
        name: 'archived',
        owner: { login: 'acme' },
        archived: true,
        permissions: { push: true },
      },
    ]);
    assert.equal(status, 200);
    assert.equal(body.install, undefined);
    assert.deepEqual(body.repositories, []);
  });

  it('offers the empty picker even when another installation failed', async () => {
    // The finding: one installation read fine and held nothing pushable,
    // another was rate-limited, and the branch tested the repository count
    // rather than whether anything had been read. So somebody whose own
    // installation answered perfectly well was handed an unrelated
    // installation's error and told to retry something that was not wrong.
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return json({ access_token: 'ghu_user' });
      }
      if (target.pathname === '/user/installations') {
        return json({
          installations: [
            { id: 55, account: { login: 'acme' } },
            { id: 66, account: { login: 'other' } },
          ],
        });
      }
      if (target.pathname === '/user/installations/55/repositories') {
        // Read fine, and holds nothing this person can push to.
        return json({ repositories: [] });
      }
      if (target.pathname === '/user/installations/66/repositories') {
        return new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
          },
        });
      }
      return json({ message: 'unexpected' }, 500);
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '55' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      repositories?: unknown[];
      ticket?: string;
    };
    assert.deepEqual(body.repositories, []);
    assert.ok(body.ticket, 'no ticket to pick from');
  });

  it('still says to install when the probe finds no installation at all', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '55' }),
      env(db),
      PRINCIPAL,
      githubFor([], {}),
      NOW,
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { install?: boolean };
    assert.equal(body.install, true);
  });
});

/**
 * The chosen installation failing when GitHub's list *does* mention it.
 *
 * The ordinary case, and the one an earlier fix here missed: it tracked the
 * chosen installation's failure only when the list had not mentioned it, so
 * the common path still let a transient error on exactly the installation
 * somebody picked be discarded the moment any other one succeeded.
 */
describe('when the chosen installation is listed and cannot be read', () => {
  const BOTH = [
    { id: 7, account: { login: 'chosen' } },
    { id: 8, account: { login: 'other' } },
  ];

  async function complete(chosenReply: () => Response) {
    const db = new SqliteD1Database(SCHEMA);
    const state = await signState(CREDENTIALS, 'user_1', NOW.getTime());
    const doFetch = (async (url: string) => {
      const target = new URL(url);
      if (target.pathname === '/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'ghu_user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname === '/user/installations') {
        return new Response(JSON.stringify({ installations: BOTH }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.pathname.includes('/user/installations/7/')) {
        return chosenReply();
      }
      return new Response(
        JSON.stringify({
          repositories: [
            {
              name: 'unrelated',
              default_branch: 'main',
              owner: { login: 'acme' },
              permissions: { push: true },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const response = await handleGitHubComplete(
      callbackRequest({ code: 'the-code', state, installation: '7' }),
      env(db),
      PRINCIPAL,
      doFetch,
      NOW,
    );
    return {
      status: response.status,
      body: (await response.json()) as { repositories?: { repo: string }[] },
    };
  }

  it('reports a rate limit rather than a list without the chosen one', async () => {
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'retry-after': '30',
          },
        }),
    );
    assert.equal(status, 429);
    assert.equal(body.repositories, undefined);
  });

  it('reports an unreachable GitHub the same way', async () => {
    const { status } = await complete(() => {
      throw new Error('connection reset');
    });
    assert.equal(status, 502);
  });

  it('still offers the rest when the chosen one is definitively gone', async () => {
    const { status, body } = await complete(
      () =>
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    );
    assert.equal(status, 200);
    assert.deepEqual(
      body.repositories?.map((choice) => choice.repo),
      ['unrelated'],
    );
  });
});
