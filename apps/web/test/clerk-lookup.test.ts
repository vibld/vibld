import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clerkLookupConfigured,
  findClerkUserIdByEmail,
} from '../worker/clerk-lookup.ts';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('clerkLookupConfigured', () => {
  it('requires the secret key', () => {
    assert.equal(clerkLookupConfigured({}), false);
    assert.equal(clerkLookupConfigured({ CLERK_SECRET_KEY: 'sk_x' }), true);
  });
});

describe('findClerkUserIdByEmail', () => {
  it('refuses to run at all when unconfigured', async () => {
    let called = false;
    const result = await findClerkUserIdByEmail(
      {},
      'a@example.com',
      (async () => {
        called = true;
        return new Response('[]');
      }) as unknown as typeof fetch,
    );
    assert.equal(result.ok, false);
    assert.equal(called, false);
  });

  it('resolves the id from a single matching user', async () => {
    const result = await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'a@example.com',
      jsonFetch([{ id: 'user_123' }]),
    );
    assert.deepEqual(result, { ok: true, userId: 'user_123' });
  });

  it('sends the email and the bearer token', async () => {
    let sentUrl = '';
    let sentAuth = '';
    await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'a+b@example.com',
      (async (url: string, init?: RequestInit) => {
        sentUrl = url;
        sentAuth = (init?.headers as Record<string, string>).authorization;
        return new Response('[{"id":"user_1"}]');
      }) as unknown as typeof fetch,
    );
    assert.match(sentUrl, /email_address\[\]=a%2Bb%40example\.com/);
    assert.equal(sentAuth, 'Bearer sk_x');
  });

  it('reports no match rather than an empty success', async () => {
    const result = await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'nobody@example.com',
      jsonFetch([]),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /No user found/);
  });

  it('reports a non-2xx response from Clerk', async () => {
    const result = await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'a@example.com',
      jsonFetch({ error: 'unauthorized' }, 401),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /401/);
  });

  it('reports a network failure', async () => {
    const result = await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'a@example.com',
      (async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Could not reach Clerk/);
  });

  it('reports an unexpected response shape rather than crashing', async () => {
    const result = await findClerkUserIdByEmail(
      { CLERK_SECRET_KEY: 'sk_x' },
      'a@example.com',
      jsonFetch([{ notAnId: true }]),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /unexpected response shape/);
  });
});
