import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  authorizeUrl,
  exchangeCode,
  githubOAuthCredentials,
  installationRepositories,
  signChoice,
  signState,
  userInstallations,
  verifyChoice,
  verifyState,
} from '../worker/github-connect.ts';

const CREDENTIALS = {
  clientId: 'Iv1.abc123',
  clientSecret: 'shhh-this-is-the-client-secret',
};

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

function json(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('whether this deployment can connect anything', () => {
  it('is unconfigured rather than half-configured', () => {
    assert.equal(githubOAuthCredentials({}), null);
    assert.equal(
      githubOAuthCredentials({ VIBLD_GITHUB_CLIENT_ID: 'Iv1.abc' }),
      null,
    );
    assert.equal(
      githubOAuthCredentials({ VIBLD_GITHUB_CLIENT_SECRET: 'secret' }),
      null,
    );
    assert.deepEqual(
      githubOAuthCredentials({
        VIBLD_GITHUB_CLIENT_ID: ' Iv1.abc ',
        VIBLD_GITHUB_CLIENT_SECRET: ' secret ',
      }),
      { clientId: 'Iv1.abc', clientSecret: 'secret' },
    );
  });
});

describe('the state on the authorize leg', () => {
  it('round-trips the user who started it', async () => {
    const state = await signState(CREDENTIALS, 'user_1', NOW);
    assert.equal(await verifyState(CREDENTIALS, state, NOW + 1000), 'user_1');
  });

  it('refuses one this deployment did not sign', async () => {
    // The whole point: an attacker who can write a state cannot walk their
    // own authorization into somebody else's session.
    const forged = await signState(
      { ...CREDENTIALS, clientSecret: 'a-different-secret' },
      'user_1',
      NOW,
    );
    assert.equal(await verifyState(CREDENTIALS, forged, NOW), null);
  });

  it('refuses one whose payload was edited after signing', async () => {
    const state = await signState(CREDENTIALS, 'user_1', NOW);
    const [, signature] = state.split('.');
    const swapped = Buffer.from(JSON.stringify({ u: 'user_2', t: NOW }), 'utf8')
      .toString('base64url')
      .replace(/=+$/, '');
    assert.equal(
      await verifyState(CREDENTIALS, `${swapped}.${signature}`, NOW),
      null,
    );
  });

  it('refuses one that has gone stale', async () => {
    const state = await signState(CREDENTIALS, 'user_1', NOW);
    assert.equal(
      await verifyState(CREDENTIALS, state, NOW + 11 * 60 * 1000),
      null,
    );
  });

  it('refuses one dated in the future', async () => {
    const state = await signState(CREDENTIALS, 'user_1', NOW + 60 * 60 * 1000);
    assert.equal(await verifyState(CREDENTIALS, state, NOW), null);
  });

  it('refuses rubbish without throwing', async () => {
    for (const nonsense of ['', '.', 'a.b', 'no-dot', '...', 'a.b.c']) {
      assert.equal(await verifyState(CREDENTIALS, nonsense, NOW), null);
    }
  });
});

describe('the authorize URL', () => {
  it('carries the client id, the state and where to come back to', () => {
    const url = new URL(
      authorizeUrl(CREDENTIALS, 'the-state', 'https://app.vibld.com/cb'),
    );
    assert.equal(
      url.origin + url.pathname,
      'https://github.com/login/oauth/authorize',
    );
    assert.equal(url.searchParams.get('client_id'), 'Iv1.abc123');
    assert.equal(url.searchParams.get('state'), 'the-state');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://app.vibld.com/cb',
    );
  });

  it('never puts the client secret in it', () => {
    const url = authorizeUrl(
      CREDENTIALS,
      'the-state',
      'https://app.vibld.com/cb',
    );
    assert.equal(url.includes(CREDENTIALS.clientSecret), false);
  });
});

describe('trading the code for a user token', () => {
  it('reads the token out of a successful exchange', async () => {
    const result = await exchangeCode(CREDENTIALS, 'the-code', (async () =>
      json({ access_token: 'ghu_user' })) as unknown as typeof fetch);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.token, 'ghu_user');
  });

  it('treats a refusal GitHub reports with a 200 as a refusal', async () => {
    // GitHub answers a bad or reused code with 200 and an `error` field, so
    // reading the status alone accepts a body with no token in it.
    const result = await exchangeCode(CREDENTIALS, 'stale', (async () =>
      json({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      })) as unknown as typeof fetch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid');
  });

  it('never puts the client secret into an error', async () => {
    // The one thing an error string must not carry is the credential that
    // produced it.
    for (const reply of [
      json({ error: 'bad_verification_code' }),
      json({ message: CREDENTIALS.clientSecret }, 500),
      new Response('not json', { status: 500 }),
    ]) {
      const result = await exchangeCode(CREDENTIALS, 'the-code', (async () =>
        reply.clone()) as unknown as typeof fetch);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(
          result.error.includes(CREDENTIALS.clientSecret),
          false,
          `leaked the client secret: ${result.error}`,
        );
      }
    }
  });

  it('sends the secret in the body, never on the query string', async () => {
    // A query string is the part of a request that ends up in logs and
    // proxies.
    const seen: { url: string; body: string }[] = [];
    await exchangeCode(CREDENTIALS, 'the-code', (async (
      url: string,
      init?: RequestInit,
    ) => {
      seen.push({ url, body: String(init?.body ?? '') });
      return json({ access_token: 'ghu_user' });
    }) as unknown as typeof fetch);
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.url.includes(CREDENTIALS.clientSecret), false);
    assert.equal(call.url.includes('?'), false);
    assert.ok(call.body.includes(CREDENTIALS.clientSecret));
  });

  it('reports being unable to reach GitHub as that, not as a refusal', async () => {
    const result = await exchangeCode(CREDENTIALS, 'the-code', (async () => {
      throw new Error('connection reset');
    }) as unknown as typeof fetch);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'unreachable');
  });
});

describe('which installations the connecting user can reach', () => {
  it('lists them as GitHub reports them', async () => {
    const result = await userInstallations('ghu_user', (async () =>
      json({
        total_count: 2,
        installations: [
          { id: 11, account: { login: 'chris' } },
          { id: 22, account: { login: 'acme' } },
        ],
      })) as unknown as typeof fetch);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, [
        { id: 11, account: 'chris' },
        { id: 22, account: 'acme' },
      ]);
    }
  });

  it('asks as the user, not as the app', async () => {
    // The distinction the whole flow rests on. `/installation/repositories`
    // answers "what does the App have"; this has to answer "what can this
    // person reach".
    let path = '';
    let auth = '';
    await userInstallations('ghu_user', (async (
      url: string,
      init?: RequestInit,
    ) => {
      path = new URL(url).pathname;
      auth = String(
        (init?.headers as Record<string, string>)?.authorization ?? '',
      );
      return json({ installations: [] });
    }) as unknown as typeof fetch);
    assert.equal(path, '/user/installations');
    assert.equal(auth, 'Bearer ghu_user');
  });

  it('treats a 404 as not yours rather than as a server fault', async () => {
    // This is what a forged installation id looks like coming back.
    const result = await installationRepositories('ghu_user', 999, (async () =>
      json({ message: 'Not Found' }, 404)) as unknown as typeof fetch);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'access');
      assert.match(result.error, /not available to your GitHub account/);
    }
  });
});

describe('which repositories may be offered', () => {
  const reply = (repositories: unknown[]) =>
    (async () => json({ repositories })) as unknown as typeof fetch;

  it('offers one the user can write to', async () => {
    const result = await installationRepositories(
      'ghu_user',
      11,
      reply([
        {
          name: 'site',
          default_branch: 'trunk',
          owner: { login: 'acme' },
          permissions: { push: true },
        },
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, [
        { owner: 'acme', repo: 'site', defaultBranch: 'trunk' },
      ]);
    }
  });

  it('leaves out one the user cannot push to', async () => {
    // Offering it means the user picks it, waits, and is refused at the push
    // instead of at the choice.
    const result = await installationRepositories(
      'ghu_user',
      11,
      reply([
        {
          name: 'read-only',
          owner: { login: 'acme' },
          permissions: { push: false },
        },
        {
          name: 'unstated',
          owner: { login: 'acme' },
        },
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, []);
  });

  it('leaves out an archived repository', async () => {
    const result = await installationRepositories(
      'ghu_user',
      11,
      reply([
        {
          name: 'old',
          owner: { login: 'acme' },
          archived: true,
          permissions: { push: true },
        },
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, []);
  });

  it('falls back to main when GitHub states no default branch', async () => {
    const result = await installationRepositories(
      'ghu_user',
      11,
      reply([
        { name: 'site', owner: { login: 'acme' }, permissions: { push: true } },
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value[0]?.defaultBranch, 'main');
  });

  it('skips entries it cannot read rather than inventing them', async () => {
    const result = await installationRepositories(
      'ghu_user',
      11,
      reply([
        null,
        { owner: { login: 'acme' }, permissions: { push: true } },
        { name: 'site', permissions: { push: true } },
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, []);
  });
});

/**
 * The ticket is the load-bearing piece of the second leg.
 *
 * The callback has a user token and can ask GitHub what this person
 * controls. The bind call, arriving later as its own request, has neither,
 * because Vibld does not keep a token that can act as somebody on GitHub.
 * So the callback signs what it established, and the bind call may only
 * choose from what was signed.
 */
describe('the ticket a verified callback issues', () => {
  const REPOS = [
    { installationId: 42, owner: 'acme', repo: 'site', defaultBranch: 'main' },
    { installationId: 42, owner: 'acme', repo: 'docs', defaultBranch: 'trunk' },
  ];

  it('round-trips what the callback established', async () => {
    const ticket = await signChoice(CREDENTIALS, 'user_1', REPOS, NOW);
    const verified = await verifyChoice(CREDENTIALS, ticket, NOW + 1000);
    assert.deepEqual(verified, { userId: 'user_1', repositories: REPOS });
  });

  it('refuses one this deployment did not sign', async () => {
    // Without this, anybody could mint a ticket naming any installation and
    // any repository, which is the whole attack the flow exists to stop.
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
      NOW,
    );
    assert.equal(await verifyChoice(CREDENTIALS, forged, NOW), null);
  });

  it('refuses one whose repository list was edited after signing', async () => {
    const ticket = await signChoice(CREDENTIALS, 'user_1', REPOS, NOW);
    const [, signature] = ticket.split('.');
    const swapped = Buffer.from(
      JSON.stringify({
        u: 'user_1',
        r: [[999, 'someone-else', 'private', 'main']],
        t: NOW,
      }),
      'utf8',
    )
      .toString('base64url')
      .replace(/=+$/, '');
    assert.equal(
      await verifyChoice(CREDENTIALS, `${swapped}.${signature}`, NOW),
      null,
    );
  });

  it('goes stale, so a verification is not good indefinitely', async () => {
    const ticket = await signChoice(CREDENTIALS, 'user_1', REPOS, NOW);
    assert.equal(
      await verifyChoice(CREDENTIALS, ticket, NOW + 16 * 60 * 1000),
      null,
    );
  });

  it('names the user it was issued to, for the caller to check', async () => {
    // A ticket is not a bearer token: the caller compares this against its
    // own identity, so one user's ticket is no use in another's session.
    const ticket = await signChoice(CREDENTIALS, 'user_1', REPOS, NOW);
    const verified = await verifyChoice(CREDENTIALS, ticket, NOW);
    assert.equal(verified?.userId, 'user_1');
  });

  it('refuses a malformed repository entry rather than partly reading it', async () => {
    const payload = Buffer.from(
      JSON.stringify({ u: 'user_1', r: [[42, 'acme', 'site']], t: NOW }),
      'utf8',
    )
      .toString('base64url')
      .replace(/=+$/, '');
    // Signed correctly, but structurally wrong: it must still be refused.
    const ticket = await signChoice(CREDENTIALS, 'user_1', [], NOW);
    const [, goodSignature] = ticket.split('.');
    assert.equal(
      await verifyChoice(CREDENTIALS, `${payload}.${goodSignature}`, NOW),
      null,
    );
  });

  it('carries an empty list rather than pretending there is a choice', async () => {
    const ticket = await signChoice(CREDENTIALS, 'user_1', [], NOW);
    const verified = await verifyChoice(CREDENTIALS, ticket, NOW);
    assert.deepEqual(verified?.repositories, []);
  });
});

/**
 * More than one page of repositories.
 *
 * The same reasoning as reading every installation: the user token is gone
 * once the callback ends, so a repository left off this list can never be
 * chosen afterwards. An installation with more than a hundred repositories
 * would otherwise have its tail silently unreachable, which reads as a
 * missing repository rather than as a limit.
 */
describe('paging through an installation with many repositories', () => {
  function pagedGitHub(
    pages: Record<string, { repos: string[]; next?: string }>,
  ) {
    const asked: string[] = [];
    const doFetch = (async (url: string) => {
      asked.push(url);
      const page = pages[url];
      if (!page) return json({ message: 'Not Found' }, 404);
      return json(
        {
          repositories: page.repos.map((name) => ({
            name,
            default_branch: 'main',
            owner: { login: 'acme' },
            permissions: { push: true },
          })),
        },
        200,
        page.next ? { link: `<${page.next}>; rel="next"` } : {},
      );
    }) as unknown as typeof fetch;
    return { doFetch, asked };
  }

  const FIRST =
    'https://api.github.com/user/installations/42/repositories?per_page=100';
  const SECOND =
    'https://api.github.com/user/installations/42/repositories?per_page=100&page=2';

  it('follows the next link rather than stopping at the first page', async () => {
    const { doFetch } = pagedGitHub({
      [FIRST]: { repos: ['one'], next: SECOND },
      [SECOND]: { repos: ['two'] },
    });
    const result = await installationRepositories('ghu_user', 42, doFetch);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.value.map((choice) => choice.repo),
        ['one', 'two'],
      );
    }
  });

  it('stops when GitHub offers no next link', async () => {
    const { doFetch, asked } = pagedGitHub({ [FIRST]: { repos: ['only'] } });
    const result = await installationRepositories('ghu_user', 42, doFetch);
    assert.equal(result.ok, true);
    assert.equal(asked.length, 1);
  });

  it('stops following rather than trusting a server to end the loop', async () => {
    // A `next` that always points somewhere is not a loop to run against
    // somebody else's server.
    const { doFetch, asked } = pagedGitHub({
      [FIRST]: { repos: ['a'], next: FIRST },
    });
    const result = await installationRepositories('ghu_user', 42, doFetch);
    assert.equal(result.ok, true);
    assert.ok(asked.length <= 5, `followed ${asked.length} pages`);
  });
});
