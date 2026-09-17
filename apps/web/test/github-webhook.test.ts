import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { isSignedByGitHub, pullRequestFrom } from '../worker/github-webhook.ts';
import { handleGitHubWebhook } from '../worker/github-handlers.ts';
import { GitHubStore } from '../worker/github-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SECRET = 'not-the-real-one';

function migration(file: string): string {
  return readFileSync(
    join(import.meta.dirname, '..', 'migrations', file),
    'utf8',
  );
}

// Both, because the pull request columns the webhook writes are added by the
// second one to the table the first one declares.
const SCHEMA = [
  migration('0005_github.sql'),
  migration('0015_github_pull_requests.sql'),
].join('\n');

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function pullRequestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'closed',
    repository: { name: 'site', owner: { login: 'acme' } },
    pull_request: {
      number: 9,
      html_url: 'https://github.com/acme/site/pull/9',
      state: 'closed',
      merged: false,
      updated_at: '2026-09-17T12:00:00Z',
      head: { ref: 'vibld/r7' },
      ...overrides,
    },
  });
}

function delivery(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.vibld.com/api/github/webhook', {
    method: 'POST',
    body,
    headers: {
      'x-github-delivery': 'd-1',
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign(body),
      ...headers,
    },
  });
}

function env(db: SqliteD1Database) {
  return {
    DB: db as unknown as D1Database,
    VIBLD_GITHUB_WEBHOOK_SECRET: SECRET,
  };
}

const PUSH = {
  userId: 'user_1',
  owner: 'acme',
  repo: 'site',
  revision: 'r7',
  baseSha: 'base',
  branch: 'vibld/r7',
  startedAt: '2026-09-17T11:00:00.000Z',
};

async function storeWithPush(db: SqliteD1Database): Promise<GitHubStore> {
  const store = new GitHubStore(db as unknown as D1Database);
  await store.beginPush(PUSH);
  await store.finishPush(
    { userId: 'user_1', owner: 'acme', repo: 'site', revision: 'r7' },
    {
      commitSha: 'commit',
      treeSha: 'tree',
      pullRequestUrl: 'https://github.com/acme/site/pull/9',
      finishedAt: '2026-09-17T11:01:00.000Z',
    },
  );
  return store;
}

describe('believing a delivery', () => {
  it('accepts a body signed with the secret', async () => {
    const body = pullRequestBody();
    assert.equal(await isSignedByGitHub(SECRET, body, sign(body)), true);
  });

  it('refuses one signed with a different secret', async () => {
    const body = pullRequestBody();
    assert.equal(
      await isSignedByGitHub(SECRET, body, sign(body, 'someone else')),
      false,
    );
  });

  it('refuses a signature over different bytes', async () => {
    // Why the handler verifies the raw text and parses afterwards:
    // re-serializing parsed JSON produces different bytes.
    const signature = sign(pullRequestBody());
    assert.equal(
      await isSignedByGitHub(
        SECRET,
        pullRequestBody({ number: 10 }),
        signature,
      ),
      false,
    );
  });

  it('refuses a digest offered under another algorithm', async () => {
    // GitHub still sends `sha1=` for endpoints that asked for it, and a
    // check that tolerated a bare digest would accept it.
    const body = pullRequestBody();
    const digest = sign(body).slice('sha256='.length);
    assert.equal(await isSignedByGitHub(SECRET, body, digest), false);
    assert.equal(await isSignedByGitHub(SECRET, body, `sha1=${digest}`), false);
  });

  it('refuses a missing header and an unset secret', async () => {
    const body = pullRequestBody();
    assert.equal(await isSignedByGitHub(SECRET, body, null), false);
    assert.equal(await isSignedByGitHub('', body, sign(body)), false);
  });

  it('refuses a digest that is not hex', async () => {
    const body = pullRequestBody();
    assert.equal(await isSignedByGitHub(SECRET, body, 'sha256=zz'), false);
  });
});

describe('reading what a delivery says', () => {
  it('reads a merge as merged, not as closed', async () => {
    // The state of a merged pull request is `closed`. Reading only the state
    // would report every merge as a closure, which is the one confusion this
    // vocabulary exists to prevent.
    const event = pullRequestFrom(
      'pull_request',
      JSON.parse(
        pullRequestBody({
          state: 'closed',
          merged: true,
          merged_at: '2026-09-17T12:00:00Z',
        }),
      ),
    );

    assert.equal(event?.state, 'merged');
  });

  it('reads a closure that is not a merge as closed', () => {
    const event = pullRequestFrom(
      'pull_request',
      JSON.parse(pullRequestBody()),
    );
    assert.equal(event?.state, 'closed');
  });

  it('names the branch, which is how a delivery finds its push', () => {
    const event = pullRequestFrom(
      'pull_request',
      JSON.parse(pullRequestBody()),
    );
    assert.equal(event?.branch, 'vibld/r7');
    assert.equal(event?.owner, 'acme');
    assert.equal(event?.repo, 'site');
  });

  it('ignores an event it does not act on', () => {
    assert.equal(pullRequestFrom('push', JSON.parse(pullRequestBody())), null);
  });

  it('ignores a body it cannot read', () => {
    assert.equal(pullRequestFrom('pull_request', null), null);
    assert.equal(pullRequestFrom('pull_request', { pull_request: {} }), null);
  });
});

describe('the webhook route', () => {
  it('records what became of the pull request', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = await storeWithPush(db);

    const response = await handleGitHubWebhook(
      delivery(
        pullRequestBody({ merged: true, merged_at: '2026-09-17T12:00:00Z' }),
      ),
      env(db),
    );

    assert.equal(response.status, 200);
    const attempt = await store.push({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
    });
    assert.equal(attempt?.pullRequestState, 'merged');
    assert.equal(attempt?.pullRequestNumber, 9);
  });

  it('refuses an unsigned delivery without saying what was wrong', async () => {
    const db = new SqliteD1Database(SCHEMA);
    await storeWithPush(db);
    const body = pullRequestBody();

    const response = await handleGitHubWebhook(
      delivery(body, { 'x-hub-signature-256': sign(body, 'forged') }),
      env(db),
    );

    assert.equal(response.status, 401);
    const said = (await response.json()) as { error: string };
    // One sentence for a missing header and a bad digest alike: anything
    // finer tells a forger where to work.
    assert.equal(said.error, 'Invalid signature.');
  });

  it('writes nothing when the signature is wrong', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = await storeWithPush(db);
    const body = pullRequestBody({ merged: true });

    await handleGitHubWebhook(
      delivery(body, { 'x-hub-signature-256': sign(body, 'forged') }),
      env(db),
    );

    const attempt = await store.push({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
    });
    assert.equal(attempt?.pullRequestState, null);
  });

  it('applies a redelivery once', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = await storeWithPush(db);

    await handleGitHubWebhook(delivery(pullRequestBody()), env(db));
    // The same delivery id, carrying a later state. A redelivery is the same
    // delivery, so the second must change nothing.
    await handleGitHubWebhook(
      delivery(
        pullRequestBody({
          merged: true,
          merged_at: '2026-09-18T12:00:00Z',
          updated_at: '2026-09-18T12:00:00Z',
        }),
      ),
      env(db),
    );

    const attempt = await store.push({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
    });
    assert.equal(attempt?.pullRequestState, 'closed');
  });

  it('does not let a late delivery move a pull request backwards', async () => {
    // Delivery is at-least-once and unordered. Without the timestamp
    // comparison, `closed` arriving after `merged` overwrites the better
    // answer with the worse one.
    const db = new SqliteD1Database(SCHEMA);
    const store = await storeWithPush(db);

    await handleGitHubWebhook(
      delivery(
        pullRequestBody({
          merged: true,
          merged_at: '2026-09-17T13:00:00Z',
          updated_at: '2026-09-17T13:00:00Z',
        }),
        { 'x-github-delivery': 'd-merged' },
      ),
      env(db),
    );
    await handleGitHubWebhook(
      delivery(pullRequestBody({ updated_at: '2026-09-17T12:00:00Z' }), {
        'x-github-delivery': 'd-closed',
      }),
      env(db),
    );

    const attempt = await store.push({
      userId: 'user_1',
      owner: 'acme',
      repo: 'site',
      revision: 'r7',
    });
    assert.equal(attempt?.pullRequestState, 'merged');
  });

  it('accepts an event it does not act on rather than failing it', async () => {
    // GitHub retries a non-2xx and eventually disables an endpoint that
    // keeps failing. Spending that on an event we ignore would be spending
    // it on nothing.
    const db = new SqliteD1Database(SCHEMA);
    await storeWithPush(db);
    const body = JSON.stringify({ zen: 'hello' });

    const response = await handleGitHubWebhook(
      delivery(body, { 'x-github-event': 'ping' }),
      env(db),
    );

    assert.equal(response.status, 200);
  });

  it('is unconfigured rather than open when there is no secret', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubWebhook(delivery(pullRequestBody()), {
      DB: db as unknown as D1Database,
    });

    assert.equal(response.status, 503);
  });

  it('refuses something that is not a delivery at all', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleGitHubWebhook(
      new Request('https://app.vibld.com/api/github/webhook', {
        method: 'POST',
        body: pullRequestBody(),
      }),
      env(db),
    );

    assert.equal(response.status, 400);
  });
});
