import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { admitToClerk } from '../worker/clerk-waitlist.ts';

/**
 * Approving an invited person in Clerk as well as here.
 *
 * Clerk is in Waitlist mode, so an invite row gets somebody past the access
 * gate and Clerk decides whether they can create a session at all. What
 * these tests are mostly about is the difference between having made the
 * call and knowing the answer: Clerk does not document whether creating an
 * invitation moves a waitlist entry, so the code reads the entry back and
 * reports what Clerk says rather than assuming the call did it.
 */
const ENV = { CLERK_SECRET_KEY: 'sk_test' };

/** A Clerk that answers the invitation and the waitlist read. */
function clerkServing(options: {
  invitationOk?: boolean;
  entries?: unknown;
  waitlistStatus?: number;
  wrap?: boolean;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/invitations')) {
      return new Response('{}', {
        status: options.invitationOk === false ? 400 : 200,
      });
    }
    const rows = options.entries ?? [];
    return new Response(
      JSON.stringify(options.wrap === false ? rows : { data: rows }),
      { status: options.waitlistStatus ?? 200 },
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function entry(email: string, status: string) {
  return { email_address: email, status };
}

describe('admitting somebody in Clerk', () => {
  it('says they can sign in when Clerk says they are invited', async () => {
    const { fetchImpl } = clerkServing({
      entries: [entry('sam@example.com', 'invited')],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, { admitted: true, via: 'waitlist' });
  });

  it('reads the entry back rather than trusting the call', async () => {
    // The case the whole design turns on. Clerk accepted the invitation and
    // still has the person waiting, which is what happens if creating an
    // invitation does not move a waitlist entry. Reported as success this
    // would tell an operator somebody can sign in when they cannot.
    const { fetchImpl, calls } = clerkServing({
      entries: [entry('sam@example.com', 'pending')],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, {
      admitted: false,
      reason: 'still-waiting',
      status: 'pending',
    });
    assert.ok(
      calls.some(
        (call) => call.startsWith('GET') && call.includes('waitlist_entries'),
      ),
      'never checked what Clerk actually thinks',
    );
  });

  it('admits somebody who was never on the waitlist', async () => {
    // An invitation lets a person sign up whether or not they ever joined
    // the waitlist, so a created one with no entry to move is still them
    // being let in.
    const { fetchImpl } = clerkServing({ entries: [] });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, { admitted: true, via: 'invitation' });
  });

  it('still reads back when Clerk refuses the invitation', async () => {
    // Clerk rejects a duplicate invitation, and somebody who already has one
    // may already be admitted. Treating the refusal as the answer would
    // report a person who is in as a person who is not.
    const { fetchImpl } = clerkServing({
      invitationOk: false,
      entries: [entry('sam@example.com', 'completed')],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, { admitted: true, via: 'waitlist' });
  });

  it('does not take a near-miss address for this person', async () => {
    // `query` is a search, not an exact match. A row for
    // sam@example.com.au is somebody else entirely, and reading it as this
    // person is how an operator is told the wrong thing about who can sign
    // in.
    const { fetchImpl } = clerkServing({
      entries: [entry('sam@example.com.au', 'invited')],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.equal(result.admitted, true);
    assert.equal(
      result.admitted && result.via,
      'invitation',
      'read somebody else’s waitlist row as this person’s',
    );
  });

  it('matches whatever case either side was written in', async () => {
    const { fetchImpl } = clerkServing({
      entries: [entry('Sam@Example.COM', 'invited')],
    });

    const result = await admitToClerk(ENV, ' sam@example.com ', fetchImpl);

    assert.deepEqual(result, { admitted: true, via: 'waitlist' });
  });

  it('reads a bare list as well as a wrapped one', async () => {
    const { fetchImpl } = clerkServing({
      wrap: false,
      entries: [entry('sam@example.com', 'invited')],
    });

    assert.deepEqual(await admitToClerk(ENV, 'sam@example.com', fetchImpl), {
      admitted: true,
      via: 'waitlist',
    });
  });

  it('says it could not tell when the waitlist cannot be read', async () => {
    // Not admitted and not still-waiting: unknown. Saying either would be a
    // claim this deployment cannot make.
    const { fetchImpl } = clerkServing({ waitlistStatus: 500 });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.equal(result.admitted, false);
    assert.equal(result.admitted === false && result.reason, 'error');
  });

  it('asks nothing at all when no Clerk key is configured', async () => {
    // A deployment with no key still issues invites. It must not pretend to
    // have approved anybody, and must not make a request with no credential.
    const { fetchImpl, calls } = clerkServing({});

    const result = await admitToClerk({}, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, { admitted: false, reason: 'unconfigured' });
    assert.equal(calls.length, 0, 'called Clerk with no key');
  });
});
