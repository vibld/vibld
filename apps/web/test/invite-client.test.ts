import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  inviteState,
  issueInvite,
  listInvites,
  revokeInvite,
} from '../src/access/invite-client.ts';
import type { InviteRecord } from '../src/access/invite-client.ts';

/**
 * The client behind the only way anybody gets let in.
 *
 * The rules that matter here are all about not overstating what happened.
 * Three of these calls can succeed at the HTTP level and change nothing, and
 * an operator who is told "done" when nothing moved stops watching the one
 * list that decides who can use the product.
 */

interface Call {
  url: string;
  method: string;
  body: string;
}

function serving(
  body: unknown,
  status = 200,
): { fetch: typeof fetch; calls: () => Call[] } {
  // The recorded request is kept as plain fields rather than a `Request`:
  // these paths are relative, and `new Request('/api/...')` throws outside a
  // browser, which would make every one of these tests pass through the
  // client's own catch and prove nothing.
  const calls: Call[] = [];
  return {
    calls: () => calls,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  };
}

const noToken = async () => null;

function record(over: Partial<InviteRecord> = {}): InviteRecord {
  return {
    email: 'a@example.com',
    invitedByEmail: 'sam@example.com',
    invitedAt: '2026-09-16T00:00:00.000Z',
    redeemedByUserId: null,
    redeemedAt: null,
    revokedAt: null,
    ...over,
  };
}

describe('issueInvite', () => {
  it('keeps a new invite, a reinstatement and a no-op apart', async () => {
    // The route distinguishes all three and this is the only place that can
    // lose the distinction. "Already invited" told as success is how
    // somebody concludes they have just let a person in.
    for (const [body, expected] of [
      [{ email: 'a@example.com', created: true, reinstated: false }, 'created'],
      [
        { email: 'a@example.com', created: false, reinstated: true },
        'reinstated',
      ],
      [{ email: 'a@example.com', created: false, reinstated: false }, 'none'],
    ] as const) {
      const served = serving(body);
      const result = await issueInvite('a@example.com', served.fetch, noToken);
      assert.ok(result.ok);
      const got = result.created
        ? 'created'
        : result.reinstated
          ? 'reinstated'
          : 'none';
      assert.equal(got, expected, JSON.stringify(body));
    }
  });

  it('does not invent a truthy outcome from a missing field', async () => {
    // A body with neither flag is a route that did not say. Reading absence
    // as "created" would report an invite nobody has.
    const served = serving({ email: 'a@example.com' });
    const result = await issueInvite('a@example.com', served.fetch, noToken);
    assert.ok(result.ok);
    assert.equal(result.created, false);
    assert.equal(result.reinstated, false);
  });

  it('reports the route’s own refusal rather than a guess', async () => {
    const served = serving(
      { error: 'That does not look like an email address.' },
      400,
    );
    const result = await issueInvite('nonsense', served.fetch, noToken);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /look like an email/);
  });

  it('survives a request that never arrives', async () => {
    const result = await issueInvite(
      'a@example.com',
      (async () => {
        throw new Error('offline');
      }) as typeof fetch,
      noToken,
    );
    assert.equal(result.ok, false);
  });
});

describe('revokeInvite', () => {
  it('says when nothing was withdrawn', async () => {
    // `revoked: false` is an address with no invite, or one already
    // withdrawn. Reporting it as a withdrawal is a claim about somebody's
    // access that nothing established.
    const served = serving({ email: 'a@example.com', revoked: false });
    const result = await revokeInvite('a@example.com', served.fetch, noToken);
    assert.ok(result.ok);
    assert.equal(result.revoked, false);
  });

  it('posts the address it was given', async () => {
    const served = serving({ email: 'a@example.com', revoked: true });
    await revokeInvite('a@example.com', served.fetch, noToken);
    const [request] = served.calls();
    assert.ok(request);
    assert.equal(request.url, '/api/admin/invite/revoke');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body), { email: 'a@example.com' });
  });
});

describe('listInvites', () => {
  it('drops a row it cannot read rather than inventing one', async () => {
    // A shorter list is recoverable. A list with a made-up address in it is
    // something an operator acts on.
    const served = serving({
      invites: [record(), null, { invitedByEmail: 'x' }, 42],
    });
    const result = await listInvites(served.fetch, noToken);
    assert.ok(result.ok);
    assert.equal(result.invites.length, 1);
    assert.equal(result.invites[0]?.email, 'a@example.com');
  });

  it('refuses a body that is not a list', async () => {
    const served = serving({ invites: 'none' });
    assert.equal((await listInvites(served.fetch, noToken)).ok, false);
  });
});

describe('inviteState', () => {
  it('calls a withdrawn invite withdrawn even after it was used', async () => {
    // The order matters. A redeemed row that was later revoked describes an
    // account that no longer has access, and labelling it "in" tells an
    // operator the opposite of what they did.
    assert.equal(
      inviteState(
        record({
          redeemedByUserId: 'user_1',
          redeemedAt: '2026-09-16T01:00:00.000Z',
          revokedAt: '2026-09-16T02:00:00.000Z',
        }),
      ),
      'withdrawn',
    );
    assert.equal(inviteState(record({ redeemedByUserId: 'user_1' })), 'in');
    assert.equal(inviteState(record()), 'waiting');
  });
});
