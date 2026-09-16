import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { AccessStore } from '../worker/access-store.ts';
import {
  decideAccessFor,
  handleAccessStatus,
  handleInvite,
  handleInviteRevoke,
} from '../worker/access-handlers.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0007_access.sql'),
  'utf8',
);

const INVITED = {
  userId: 'user_1',
  email: 'chris@example.com',
  emailVerified: true,
  policyIdentity: 'chris@example.com',
};

const STRANGER = {
  userId: 'user_2',
  email: 'stranger@example.com',
  emailVerified: true,
  policyIdentity: 'stranger@example.com',
};

function newEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: new SqliteD1Database(SCHEMA),
    VIBLD_PLATFORM_ADMINS: 'admin@vibld.com',
    ...overrides,
  };
}

describe('decideAccessFor', () => {
  it('lets an invited account in and records that it was taken up', async () => {
    const env = newEnv();
    await new AccessStore(env.DB).invite(
      'chris@example.com',
      'admin@vibld.com',
    );

    const decision = await decideAccessFor(env, INVITED);

    assert.deepEqual(decision, { allowed: true, because: 'invited' });
    const [row] = await new AccessStore(env.DB).list();
    assert.equal(row?.redeemedByUserId, 'user_1');
  });

  it('refuses an account nobody invited', async () => {
    const decision = await decideAccessFor(newEnv(), STRANGER);
    assert.equal(decision.allowed, false);
  });

  it('refuses everybody when there is no database to hold a list', async () => {
    // A deployment missing its D1 binding must not become an open one.
    const decision = await decideAccessFor(
      { VIBLD_PLATFORM_ADMINS: 'admin@vibld.com' },
      STRANGER,
    );
    assert.equal(decision.allowed, false);
  });

  it('still lets an admin in with no database, so a deployment is recoverable', async () => {
    const decision = await decideAccessFor(
      { VIBLD_PLATFORM_ADMINS: 'admin@vibld.com' },
      {
        userId: 'user_admin',
        email: 'admin@vibld.com',
        emailVerified: true,
        policyIdentity: 'admin@vibld.com',
      },
    );
    assert.deepEqual(decision, { allowed: true, because: 'admin' });
  });

  it('opens to everybody when the mode says so', async () => {
    const decision = await decideAccessFor(
      newEnv({ VIBLD_ACCESS_MODE: 'open' }),
      STRANGER,
    );
    assert.deepEqual(decision, { allowed: true, because: 'open' });
  });
});

describe('handleAccessStatus', () => {
  it('gives both refusals the same words', async () => {
    // "Unverified" and "not on the list" are different facts about the
    // account, and a response that distinguished them would be a way to test
    // whether an address has been invited. The property is that the two are
    // indistinguishable, not that the sentence avoids particular words.
    const request = new Request('https://app.vibld.com/api/access/status');
    const uninvited = (await (
      await handleAccessStatus(request, newEnv(), STRANGER)
    ).json()) as Record<string, unknown>;
    const unverified = (await (
      await handleAccessStatus(request, newEnv(), {
        userId: 'user_3',
        policyIdentity: 'unknown',
      })
    ).json()) as Record<string, unknown>;

    assert.equal(uninvited.allowed, false);
    assert.equal(unverified.allowed, false);
    assert.equal(uninvited.message, unverified.message);
    assert.equal(uninvited.mode, 'invite');
  });

  it('refuses a method that is not GET', async () => {
    const response = await handleAccessStatus(
      new Request('https://app.vibld.com/api/access/status', {
        method: 'POST',
      }),
      newEnv(),
      INVITED,
    );
    assert.equal(response.status, 405);
  });
});

describe('the invite endpoints', () => {
  function post(body: unknown): Request {
    return new Request('https://app.vibld.com/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('invites an address, and says when it did nothing', async () => {
    const env = newEnv();
    const first = (await (
      await handleInvite(
        post({ email: 'New@Example.com' }),
        env,
        'admin@vibld.com',
      )
    ).json()) as Record<string, unknown>;

    assert.deepEqual(first, {
      email: 'new@example.com',
      created: true,
      reinstated: false,
    });

    const again = (await (
      await handleInvite(
        post({ email: 'new@example.com' }),
        env,
        'admin@vibld.com',
      )
    ).json()) as Record<string, unknown>;
    assert.equal(again.created, false);
    assert.equal(again.reinstated, false);
  });

  it('reports reinstating a revoked invite as its own outcome', async () => {
    const env = newEnv();
    await handleInvite(
      post({ email: 'a@example.com' }),
      env,
      'admin@vibld.com',
    );
    await handleInviteRevoke(post({ email: 'a@example.com' }), env);

    const body = (await (
      await handleInvite(
        post({ email: 'a@example.com' }),
        env,
        'admin@vibld.com',
      )
    ).json()) as Record<string, unknown>;

    assert.equal(body.created, false);
    assert.equal(body.reinstated, true);
  });

  it('refuses something that is not an address', async () => {
    const response = await handleInvite(
      post({ email: 'nope' }),
      newEnv(),
      'admin@vibld.com',
    );
    assert.equal(response.status, 400);
  });

  it('refuses a body that is not JSON at all', async () => {
    const response = await handleInvite(
      new Request('https://app.vibld.com/api/admin/invite', {
        method: 'POST',
        body: 'not json',
      }),
      newEnv(),
      'admin@vibld.com',
    );
    assert.equal(response.status, 400);
  });
});
