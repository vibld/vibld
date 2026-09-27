import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { resolvePrincipal } from '../worker/principal.ts';
import { resetClerkKeyCache } from '../worker/clerk-auth.ts';
import type { ClerkJwk } from '../worker/clerk-auth.ts';

const ISSUER = 'https://clerk.vibld.com';
const NOW = 1_800_000_000;

function b64url(bytes: Uint8Array | string): string {
  const buffer =
    typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return buffer.toString('base64url');
}

async function makeKeypair(kid: string) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as {
    n: string;
    e: string;
  };
  return {
    privateKey: pair.privateKey,
    jwk: {
      kid,
      kty: 'RSA',
      alg: 'RS256',
      n: jwk.n,
      e: jwk.e,
    } satisfies ClerkJwk,
  };
}

async function sign(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

const validPayload = {
  sub: 'user_2abc123',
  iss: ISSUER,
  exp: NOW + 3600,
  iat: NOW - 10,
  email: 'chris@example.com',
  email_verified: true,
};

function fetchImplFor(jwk: ClerkJwk): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
    })) as unknown as typeof fetch;
}

/**
 * `resolvePrincipal` calls `fetchClerkKeys` with no injected `fetchImpl`,
 * which means it hits real `fetch`. These tests stub the global instead --
 * the same seam `clerk-auth.test.ts` avoids needing because it takes
 * `fetchImpl` directly.
 */
function stubGlobalFetch(jwk: ClerkJwk): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImplFor(jwk) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function requestWithToken(token?: string): Request {
  return new Request('https://example.com/api/plan', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('resolvePrincipal', () => {
  beforeEach(() => resetClerkKeyCache());

  it('reports unavailable when Clerk is not configured', async () => {
    const result = await resolvePrincipal(requestWithToken('anything'), {});
    assert.ok(result.denied);
    assert.equal(result.denied.status, 403);
  });

  it('requires a bearer token', async () => {
    const result = await resolvePrincipal(requestWithToken(), {
      CLERK_FRONTEND_API_URL: ISSUER,
    });
    assert.ok(result.denied);
    assert.equal(result.denied.status, 401);
  });

  it('grants the Clerk user id as the principal, keyed for the ledger', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    // verifyClerkJwt defaults `now` to the real clock (resolvePrincipal does
    // not inject one), so every token here must be valid right now rather
    // than at the fixed NOW used elsewhere in this repo's JWT tests.
    const liveNow = Math.floor(Date.now() / 1000);
    const liveToken = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      {
        ...validPayload,
        exp: liveNow + 3600,
        iat: liveNow - 10,
      },
    );

    const restore = stubGlobalFetch(jwk);
    try {
      const result = await resolvePrincipal(requestWithToken(liveToken), {
        CLERK_FRONTEND_API_URL: ISSUER,
      });
      assert.equal(result.denied, null);
      assert.ok(!result.denied);
      assert.equal(result.principal.userId, 'user_2abc123');
      assert.equal(result.principal.email, 'chris@example.com');
      assert.equal(result.principal.emailVerified, true);
      assert.equal(result.principal.policyIdentity, 'chris@example.com');
    } finally {
      restore();
    }
  });

  it('buckets a missing email claim into the shared "unknown" policy identity', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const liveNow = Math.floor(Date.now() / 1000);
    const { email, email_verified, ...withoutEmail } = validPayload;
    void email;
    void email_verified;
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      {
        ...withoutEmail,
        exp: liveNow + 3600,
        iat: liveNow - 10,
      },
    );

    const restore = stubGlobalFetch(jwk);
    try {
      const result = await resolvePrincipal(requestWithToken(token), {
        CLERK_FRONTEND_API_URL: ISSUER,
      });
      assert.equal(result.denied, null);
      assert.ok(!result.denied);
      assert.equal(result.principal.policyIdentity, 'unknown');
      // The ledger key is unaffected -- it never depended on email.
      assert.equal(result.principal.userId, 'user_2abc123');
    } finally {
      restore();
    }
  });

  it('buckets an unverified email claim into "unknown" too', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const liveNow = Math.floor(Date.now() / 1000);
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      {
        ...validPayload,
        email_verified: false,
        exp: liveNow + 3600,
        iat: liveNow - 10,
      },
    );

    const restore = stubGlobalFetch(jwk);
    try {
      const result = await resolvePrincipal(requestWithToken(token), {
        CLERK_FRONTEND_API_URL: ISSUER,
      });
      assert.equal(result.denied, null);
      assert.ok(!result.denied);
      assert.equal(result.principal.policyIdentity, 'unknown');
    } finally {
      restore();
    }
  });

  it('denies a token from an unknown key with an opaque error', async () => {
    const attacker = await makeKeypair('k1');
    const real = await makeKeypair('k1');
    const liveNow = Math.floor(Date.now() / 1000);
    const token = await sign(
      attacker.privateKey,
      { alg: 'RS256', kid: 'k1' },
      {
        ...validPayload,
        exp: liveNow + 3600,
        iat: liveNow - 10,
      },
    );

    const restore = stubGlobalFetch(real.jwk);
    try {
      const result = await resolvePrincipal(requestWithToken(token), {
        CLERK_FRONTEND_API_URL: ISSUER,
      });
      assert.ok(result.denied);
      assert.equal(result.denied.status, 403);
      const body = (await result.denied.json()) as { error: string };
      assert.doesNotMatch(body.error, /signature|key/i);
    } finally {
      restore();
    }
  });
});
