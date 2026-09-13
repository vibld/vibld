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
