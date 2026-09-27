import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AccessStore } from '../worker/access-store.ts';
import {
  decideAccessFor,
  handleAccessStatus,
  handleInvite,
  handleInviteRevoke,
} from '../worker/access-handlers.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const SCHEMA = schemaSql();

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
    const [row] = (await new AccessStore(env.DB).list()).invites;
    assert.equal(row?.redeemedByUserId, 'user_1');
  });

  it('admits an admin when the database is unusable', async () => {
    // The order admin, open, invited was true of the decision and not of the
    // work: the invite lookup ran first regardless, so a missing table or an
    // unavailable D1 threw and even a platform admin got an error. The admin
    // path is what makes a broken deployment recoverable, so it must not
    // depend on the database being well.
    const broken = {
      DB: {
        prepare() {
          throw new Error('no such table: access_invites');
        },
      },
      VIBLD_PLATFORM_ADMINS: 'admin@vibld.com',
    } as unknown as Parameters<typeof decideAccessFor>[0];

    const decision = await decideAccessFor(broken, {
      userId: 'user_admin',
      email: 'admin@vibld.com',
      emailVerified: true,
      policyIdentity: 'admin@vibld.com',
    });

    assert.deepEqual(decision, { allowed: true, because: 'admin' });
  });

  it('admits everybody on an open deployment without reading the list', async () => {
    const broken = {
      DB: {
        prepare() {
          throw new Error('no such table: access_invites');
        },
      },
      VIBLD_ACCESS_MODE: 'open',
      VIBLD_PLATFORM_ADMINS: 'admin@vibld.com',
    } as unknown as Parameters<typeof decideAccessFor>[0];

    const decision = await decideAccessFor(broken, STRANGER);

    assert.deepEqual(decision, { allowed: true, because: 'open' });
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
      // This env has no Clerk key, and the route says so rather than
      // omitting the field. A response that does not mention Clerk is one
      // the panel cannot tell apart from a deployment that did approve
      // somebody, so the silence has to be deliberate and named.
      clerk: { admitted: false, reason: 'unconfigured' },
      // Named for the same reason `clerk` is: a response that omits it is
      // one the panel cannot tell apart from a deployment that did put a
      // scheduled cancellation back.
      billing: { restored: false, reason: 'unconfigured' },
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
    // Clerk is asked again even though the row did not change. Gating it on
    // the row changing left no way to approve anybody whose invite already
    // existed, which is every invite issued before Clerk approval shipped.
    assert.deepEqual(again.clerk, { admitted: false, reason: 'unconfigured' });
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

describe('approving in Clerk from the invite route', () => {
  function post(body: unknown): Request {
    return new Request('https://app.vibld.com/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** A Clerk that records what it was asked and admits the address. */
  function clerkServing() {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      if (url.includes('/invitations'))
        return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({
          data: [{ email_address: 'sam@example.com', status: 'invited' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    return { calls, restore: () => (globalThis.fetch = original) };
  }

  it('asks again for an address that was already invited', async () => {
    // The retry path, and without it there is none. Every invite issued
    // before Clerk approval shipped, and every one whose first attempt
    // failed or ran with no key configured, would be approvable only by
    // withdrawing the invite and putting it back, which takes somebody's
    // access away to give it back.
    const env = newEnv({ CLERK_SECRET_KEY: 'sk_test' });
    const clerk = clerkServing();
    try {
      await handleInvite(
        post({ email: 'sam@example.com' }),
        env,
        'admin@vibld.com',
      );
      const before = clerk.calls.length;

      // Same address again. The row does not change this time.
      const again = (await (
        await handleInvite(
          post({ email: 'sam@example.com' }),
          env,
          'admin@vibld.com',
        )
      ).json()) as Record<string, unknown>;

      assert.equal(
        again.created,
        false,
        'the row changed, so this proves nothing',
      );
      assert.ok(
        clerk.calls.length > before,
        'never asked Clerk again, so an existing invite can never be approved',
      );
      assert.deepEqual(again.clerk, { admitted: true, via: 'waitlist' });
    } finally {
      clerk.restore();
    }
  });
});

describe('stopping the billing from the revoke route', () => {
  function post(body: unknown): Request {
    return new Request('https://app.vibld.com/api/admin/invite/revoke', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('says what happened to their money, not only their access', async () => {
    // Revoking used to answer with the row alone, so an operator had no way
    // to learn that a subscriber they had just cut off was still being
    // charged every month for a product they could no longer sign in to.
    const env = newEnv();
    await new AccessStore(env.DB).invite('sam@example.com', 'admin@vibld.com');

    const body = (await (
      await handleInviteRevoke(post({ email: 'sam@example.com' }), env)
    ).json()) as Record<string, unknown>;

    assert.equal(body.revoked, true);
    // No Stripe key in this env, and the route says so rather than omitting
    // the field. A response that does not mention billing is one the panel
    // cannot tell apart from a deployment that did stop the charges.
    assert.deepEqual(body.billing, {
      scheduled: false,
      reason: 'unconfigured',
    });
  });

  it('asks again for an address that was already withdrawn', async () => {
    // The retry path, and without it there is none. Every invite revoked
    // before this shipped, and every one whose first attempt failed or ran
    // with no Stripe key configured, could only be dealt with by reinstating
    // their access in order to take it away again.
    const env = newEnv();
    await new AccessStore(env.DB).invite('sam@example.com', 'admin@vibld.com');
    await handleInviteRevoke(post({ email: 'sam@example.com' }), env);

    const again = (await (
      await handleInviteRevoke(post({ email: 'sam@example.com' }), env)
    ).json()) as Record<string, unknown>;

    assert.equal(
      again.revoked,
      false,
      'the row changed again, so this proves nothing',
    );
    assert.deepEqual(
      again.billing,
      { scheduled: false, reason: 'unconfigured' },
      'never asked about the billing, so a revoked subscriber can never be stopped',
    );
  });
});

describe('putting the billing back from the invite route', () => {
  function post(body: unknown): Request {
    return new Request('https://app.vibld.com/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('says what happened to a scheduled cancellation', async () => {
    // Without this the reason for cancelling at period end rather than
    // immediately was false. Revoking schedules the subscription to end, and
    // re-inviting cleared revoked_at, asked Clerk, and left the cancellation
    // standing, so Stripe ended a subscription belonging to somebody whose
    // access had been restored.
    const env = newEnv();
    const body = (await (
      await handleInvite(
        post({ email: 'sam@example.com' }),
        env,
        'admin@vibld.com',
      )
    ).json()) as Record<string, unknown>;

    assert.equal(body.created, true);
    // No Stripe key in this env, and the route says so rather than omitting
    // the field. A response that does not mention billing is one the panel
    // cannot tell apart from a deployment that did put the subscription back.
    assert.deepEqual(body.billing, {
      restored: false,
      reason: 'unconfigured',
    });
  });
});
