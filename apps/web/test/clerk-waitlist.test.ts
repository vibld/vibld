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
  /** The literal body the waitlist read answers with, before any wrapping. */
  rawBody?: string;
  /** Rows the invitations list answers with, read only after a refusal. */
  invitations?: unknown[];
  invitationListStatus?: number;
}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/invitations')) {
      // The list read, which is only reached when creating one was refused.
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(
          JSON.stringify({ data: options.invitations ?? [] }),
          {
            status: options.invitationListStatus ?? 200,
          },
        );
      }
      return new Response('{}', {
        status: options.invitationOk === false ? 400 : 200,
      });
    }
    const rows = options.entries ?? [];
    return new Response(
      options.rawBody ??
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
      // Clerk took the invitation and still says pending. The two answers
      // disagree, and which governs is undocumented, so both are carried
      // rather than one being picked.
      invited: true,
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

  it('takes a standing invitation as admission when a second one is refused', async () => {
    // What re-submitting an address does once the first invitation
    // succeeded: Clerk refuses the duplicate, there is no waitlist row to
    // fall back on, and the invitation still standing is the thing that
    // admits them. Reading the refusal as failure turns a correct "they can
    // sign in" into an error the second time somebody presses the button.
    const { fetchImpl } = clerkServing({
      invitationOk: false,
      entries: [],
      invitations: [{ email_address: 'sam@example.com', status: 'pending' }],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.deepEqual(result, { admitted: true, via: 'invitation' });
  });

  it('does not take a revoked invitation as admission', async () => {
    // The other half, and the reason this reads the status rather than the
    // existence of a row. A revoked or expired invitation admits nobody.
    const { fetchImpl } = clerkServing({
      invitationOk: false,
      entries: [],
      invitations: [{ email_address: 'sam@example.com', status: 'revoked' }],
    });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.equal(result.admitted, false);
    assert.equal(result.admitted === false && result.reason, 'error');
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

  it('survives a successful response whose body is null', async () => {
    // `JSON.parse('null')` is a successful parse, so the parse guard above it
    // does not catch this, and reading `.data` off null throws. The throw
    // would escape to the route, which has already written the invite row,
    // so the operator would get a 500 for a request that half happened.
    const { fetchImpl } = clerkServing({ rawBody: 'null' });

    const result = await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    assert.equal(result.admitted, false);
    assert.equal(result.admitted === false && result.reason, 'error');
  });

  it('asks for more rows than the default page holds', async () => {
    // Both lists filter by address server-side, so one address's rows are
    // all that can come back. The limit is asked for anyway: Clerk's default
    // is ten, and an address invited, revoked and invited again over a year
    // accumulates rows. A silent truncation reads as "Clerk holds nothing
    // for them", which is the one wrong answer that costs somebody access.
    const { fetchImpl, calls } = clerkServing({
      invitationOk: false,
      entries: [],
      invitations: [{ email_address: 'sam@example.com', status: 'pending' }],
    });

    await admitToClerk(ENV, 'sam@example.com', fetchImpl);

    const reads = calls.filter((call) => call.startsWith('GET'));
    assert.ok(reads.length >= 2, 'did not read both lists');
    for (const read of reads) {
      assert.match(
        read,
        /limit=\d+/,
        `left the page size to the default: ${read}`,
      );
      assert.match(
        read,
        /query=/,
        `read the whole list instead of this address`,
      );
    }
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
