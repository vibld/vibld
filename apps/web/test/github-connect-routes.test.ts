import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  handleGitHubBind,
  handleGitHubCallback,
  handleGitHubConnect,
  handleGitHubDisconnect,
} from '../worker/github-handlers.ts';
import { signChoice, signState } from '../worker/github-connect.ts';
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
  const url = new URL('https://app.vibld.com/api/github/callback');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url, { method: 'GET' });
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
      new Request('https://app.vibld.com/api/github/disconnect', {
        method: 'POST',
      }),
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
    // So it cannot be used to ask whether somebody has connected something.
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubDisconnect(
      new Request('https://app.vibld.com/api/github/disconnect', {
        method: 'POST',
      }),
      env(db),
      PRINCIPAL,
      NOW,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connected: false });
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
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
    const response = await handleGitHubCallback(
      callbackRequest({ code: 'the-code', state }),
      env(db),
      PRINCIPAL,
      githubFor(BOTH, {}),
      NOW,
    );
    assert.equal(response.status, 409);
  });
});
