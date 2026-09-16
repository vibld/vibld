import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  grantAdminCredit,
  lookupAdminUser,
} from '../src/generation/admin-client.ts';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('lookupAdminUser', () => {
  it('sends the Clerk bearer token and the email as a query param', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({
          userId: 'user_1',
          spendableCreditMicroUsd: 5_000_000,
          grants: [],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await lookupAdminUser(
      'a@example.com',
      fetchImpl,
      async () => 'a-token',
    );

    assert.deepEqual(result, {
      ok: true,
      userId: 'user_1',
      spendableCreditMicroUsd: 5_000_000,
      grants: [],
      unreadable: 0,
    });
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/admin/user?email=a%40example.com');
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      'Bearer a-token',
    );
  });

  it('surfaces the server error message', async () => {
    const result = await lookupAdminUser(
      'a@example.com',
      jsonFetch({ error: 'Not authorized.' }, 403),
    );
    assert.deepEqual(result, { ok: false, error: 'Not authorized.' });
  });

  it('treats a 200 with no readable userId as a failure, not a crash', async () => {
    const result = await lookupAdminUser('a@example.com', jsonFetch({}));
    assert.equal(result.ok, false);
  });
});

describe('grantAdminCredit', () => {
  it('sends the email, amount and note', async () => {
    const calls: Array<RequestInit | undefined> = [];
    const result = await grantAdminCredit(
      'a@example.com',
      500,
      'goodwill',
      (async (_url: string, init?: RequestInit) => {
        calls.push(init);
        return new Response(
          JSON.stringify({ userId: 'user_1', creditUsdCents: 500 }),
          { status: 200 },
        );
      }) as unknown as typeof fetch,
    );

    assert.deepEqual(result, {
      ok: true,
      userId: 'user_1',
      creditUsdCents: 500,
    });
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), {
      email: 'a@example.com',
      amountUsdCents: 500,
      note: 'goodwill',
    });
  });

  it('surfaces the server error message rather than a generic one', async () => {
    const result = await grantAdminCredit(
      'a@example.com',
      500,
      null,
      jsonFetch({ error: 'No user found for a@example.com.' }, 404),
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'No user found for a@example.com.',
    });
  });

  it('falls back to a generic message when the error body is unreadable', async () => {
    const result = await grantAdminCredit(
      'a@example.com',
      500,
      null,
      (async () =>
        new Response('not json', { status: 500 })) as unknown as typeof fetch,
    );
    assert.deepEqual(result, {
      ok: false,
      error: 'The admin request failed (500).',
    });
  });
});

describe('a grant row the page cannot read', () => {
  function serving(grants: unknown): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          userId: 'user_1',
          spendableCreditMicroUsd: 5_000_000,
          grants,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  }

  it('does not present a row with no amount or no actor as a grant', async () => {
    // The cast this replaces rendered these: "$NaN by undefined", which
    // reads as a broken page rather than a gap in the record, so the
    // natural response is to ignore it and grant again.
    const result = await lookupAdminUser(
      'a@example.com',
      serving([
        { grantedByEmail: 'admin@vibld.com', note: null },
        { creditUsdCents: 500, note: null },
        { creditUsdCents: 500, grantedByEmail: '  ', note: null },
        { creditUsdCents: Number.NaN, grantedByEmail: 'a@b.com', note: null },
        null,
        'a grant, honestly',
      ]),
      async () => null,
    );

    assert.ok(result.ok);
    assert.deepEqual(result.grants, []);
    assert.equal(result.unreadable, 6);
  });

  it('counts them rather than dropping them quietly', async () => {
    // A silently shorter history is the one failure this list must not
    // have: it is read to decide whether an earlier grant already landed,
    // and a missing row is how the same person gets paid twice.
    const result = await lookupAdminUser(
      'a@example.com',
      serving([
        {
          creditUsdCents: 500,
          grantedByEmail: 'admin@vibld.com',
          note: 'outage',
          createdAt: '2026-01-01T00:00:00Z',
        },
        { creditUsdCents: 900 },
      ]),
      async () => null,
    );

    assert.ok(result.ok);
    assert.equal(result.grants.length, 1);
    assert.equal(result.grants[0]?.grantedByEmail, 'admin@vibld.com');
    assert.equal(result.unreadable, 1);
  });

  it('keeps a readable grant that simply has no note', async () => {
    // The other direction: a note is genuinely optional, and refusing a row
    // for want of one would hide grants that are perfectly fine.
    const result = await lookupAdminUser(
      'a@example.com',
      serving([{ creditUsdCents: 500, grantedByEmail: 'admin@vibld.com' }]),
      async () => null,
    );

    assert.ok(result.ok);
    assert.equal(result.grants.length, 1);
    assert.equal(result.grants[0]?.note, null);
    assert.equal(result.unreadable, 0);
  });
});
