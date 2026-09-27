import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  ClerkVerificationError,
  fetchClerkKeys,
  resetClerkKeyCache,
  verifyClerkJwt,
} from '../worker/clerk-auth.ts';
import type { ClerkJwk } from '../worker/clerk-auth.ts';

const ISSUER = 'https://verb-noun-00.clerk.accounts.dev';
const ORIGIN = 'https://app.vibld.com';
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
  sid: 'sess_2def456',
  iss: ISSUER,
  azp: [ORIGIN],
  exp: NOW + 3600,
  iat: NOW - 10,
  email: 'chris@example.com',
  email_verified: true,
};

describe('Clerk session token verification', () => {
  it('accepts a correctly signed token and returns its claims', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      validPayload,
    );

    const claims = await verifyClerkJwt(token, {
      keys: [jwk],
      issuer: ISSUER,
      allowedOrigins: [ORIGIN],
      now: NOW,
    });

    assert.equal(claims.sub, 'user_2abc123');
    assert.equal(claims.email, 'chris@example.com');
    assert.equal(claims.emailVerified, true);
  });

  it('does not surface email or emailVerified when the token carries neither', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const { email, email_verified, ...withoutEmail } = validPayload;
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      withoutEmail,
    );

    const claims = await verifyClerkJwt(token, {
      keys: [jwk],
      issuer: ISSUER,
      now: NOW,
    });

    assert.equal(claims.email, undefined);
    assert.equal(claims.emailVerified, undefined);
  });

  it('rejects a token signed by a key it does not know', async () => {
    const attacker = await makeKeypair('k1');
    const real = await makeKeypair('k1');
    const token = await sign(
      attacker.privateKey,
      { alg: 'RS256', kid: 'k1' },
      validPayload,
    );

    await assert.rejects(
      () =>
        verifyClerkJwt(token, { keys: [real.jwk], issuer: ISSUER, now: NOW }),
      (error: unknown) => {
        assert.ok(error instanceof ClerkVerificationError);
        assert.match(error.message, /signature is invalid/);
        return true;
      },
    );
  });

  it('rejects a tampered payload', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      validPayload,
    );
    const [header, , signature] = token.split('.');
    const forged = `${header}.${b64url(JSON.stringify({ ...validPayload, sub: 'user_attacker' }))}.${signature}`;

    await assert.rejects(
      () => verifyClerkJwt(forged, { keys: [jwk], issuer: ISSUER, now: NOW }),
      ClerkVerificationError,
    );
  });

  it('rejects the alg:none downgrade', async () => {
    const { jwk } = await makeKeypair('k1');
    const unsigned = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(validPayload))}.`;

    await assert.rejects(
      () => verifyClerkJwt(unsigned, { keys: [jwk], issuer: ISSUER, now: NOW }),
      (error: unknown) => {
        assert.match((error as Error).message, /Unsupported signing algorithm/);
        return true;
      },
    );
  });

  it('rejects a token issued for a different origin, when azp is present and enforced', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      { ...validPayload, azp: ['https://evil.example.com'] },
    );

    await assert.rejects(
      () =>
        verifyClerkJwt(token, {
          keys: [jwk],
          issuer: ISSUER,
          allowedOrigins: [ORIGIN],
          now: NOW,
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /different origin/);
        return true;
      },
    );
  });

  it('does not reject on origin when the token has no azp at all', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const { azp, ...withoutAzp } = validPayload;
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      withoutAzp,
    );

    const claims = await verifyClerkJwt(token, {
      keys: [jwk],
      issuer: ISSUER,
      allowedOrigins: [ORIGIN],
      now: NOW,
    });
    assert.equal(claims.azp, undefined);
  });

  it('rejects a token from a different Clerk instance', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      { ...validPayload, iss: 'https://someone-elses-app.clerk.accounts.dev' },
    );

    await assert.rejects(
      () => verifyClerkJwt(token, { keys: [jwk], issuer: ISSUER, now: NOW }),
      (error: unknown) => {
        assert.match((error as Error).message, /different Clerk instance/);
        return true;
      },
    );
  });

  it('rejects a token with no subject', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const { sub, ...withoutSub } = validPayload;
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      withoutSub,
    );

    await assert.rejects(
      () => verifyClerkJwt(token, { keys: [jwk], issuer: ISSUER, now: NOW }),
      (error: unknown) => {
        assert.match((error as Error).message, /no subject/);
        return true;
      },
    );
  });

  it('rejects an expired token but allows small clock skew', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      { ...validPayload, exp: NOW - 30 },
    );

    await verifyClerkJwt(token, { keys: [jwk], issuer: ISSUER, now: NOW });

    await assert.rejects(
      () =>
        verifyClerkJwt(token, {
          keys: [jwk],
          issuer: ISSUER,
          now: NOW + 600,
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /expired/);
        return true;
      },
    );
  });

  it('rejects a malformed token without throwing something unexpected', async () => {
    const { jwk } = await makeKeypair('k1');
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d']) {
      await assert.rejects(
        () => verifyClerkJwt(bad, { keys: [jwk], issuer: ISSUER, now: NOW }),
        ClerkVerificationError,
      );
    }
  });
});

describe('Clerk signing key retrieval', () => {
  beforeEach(() => resetClerkKeyCache());

  it('fetches from <issuer>/.well-known/jwks.json', async () => {
    let requestedUrl: string | undefined;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          keys: [{ kid: 'k1', kty: 'RSA', n: 'n', e: 'AQAB' }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchClerkKeys(ISSUER, fetchImpl, 0);
    assert.equal(requestedUrl, `${ISSUER}/.well-known/jwks.json`);
  });

  it('caches keys so every request does not refetch them', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          keys: [{ kid: 'k1', kty: 'RSA', n: 'n', e: 'AQAB' }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchClerkKeys(ISSUER, fetchImpl, 0);
    await fetchClerkKeys(ISSUER, fetchImpl, 1000);
    assert.equal(calls, 1);

    // Past the TTL it refetches.
    await fetchClerkKeys(ISSUER, fetchImpl, 4 * 60 * 60 * 1000);
    assert.equal(calls, 2);
  });

  it('throws when the endpoint fails or returns no keys', async () => {
    const failing = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(
      () => fetchClerkKeys(ISSUER, failing, 0),
      ClerkVerificationError,
    );

    const empty = (async () =>
      new Response(JSON.stringify({ keys: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => fetchClerkKeys('https://other.clerk.accounts.dev', empty, 0),
      ClerkVerificationError,
    );
  });
});
