import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  AccessVerificationError,
  fetchAccessKeys,
  resetAccessKeyCache,
  verifyAccessJwt,
} from '../worker/access.ts';
import type { AccessJwk } from '../worker/access.ts';

const ISSUER = 'https://team.cloudflareaccess.com';
const AUDIENCE = 'aud-tag-for-this-app';
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
    } satisfies AccessJwk,
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
  aud: [AUDIENCE],
  iss: ISSUER,
  exp: NOW + 3600,
  iat: NOW - 10,
  email: 'a@b.com',
};

describe('Cloudflare Access token verification', () => {
  it('accepts a correctly signed token and returns its claims', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      validPayload,
    );

    const claims = await verifyAccessJwt(token, {
      keys: [jwk],
      audience: AUDIENCE,
      issuer: ISSUER,
      now: NOW,
    });

    assert.equal(claims.email, 'a@b.com');
    assert.deepEqual(claims.aud, [AUDIENCE]);
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
        verifyAccessJwt(token, {
          keys: [real.jwk],
          audience: AUDIENCE,
          issuer: ISSUER,
          now: NOW,
        }),
      (error: unknown) => {
        assert.ok(error instanceof AccessVerificationError);
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
    const forged = `${header}.${b64url(JSON.stringify({ ...validPayload, email: 'attacker@evil.com' }))}.${signature}`;

    await assert.rejects(
      () =>
        verifyAccessJwt(forged, {
          keys: [jwk],
          audience: AUDIENCE,
          issuer: ISSUER,
          now: NOW,
        }),
      AccessVerificationError,
    );
  });

  it('rejects the alg:none downgrade', async () => {
    const { jwk } = await makeKeypair('k1');
    const unsigned = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(validPayload))}.`;

    await assert.rejects(
      () =>
        verifyAccessJwt(unsigned, {
          keys: [jwk],
          audience: AUDIENCE,
          issuer: ISSUER,
          now: NOW,
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /Unsupported signing algorithm/);
        return true;
      },
    );
  });

  it('rejects a token minted for a different Access application', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      { ...validPayload, aud: ['someone-elses-app'] },
    );

    await assert.rejects(
      () =>
        verifyAccessJwt(token, {
          keys: [jwk],
          audience: AUDIENCE,
          issuer: ISSUER,
          now: NOW,
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /different application/);
        return true;
      },
    );
  });

  it('rejects a token from a different team', async () => {
    const { privateKey, jwk } = await makeKeypair('k1');
    const token = await sign(
      privateKey,
      { alg: 'RS256', kid: 'k1' },
      { ...validPayload, iss: 'https://evil.cloudflareaccess.com' },
    );

    await assert.rejects(
      () =>
        verifyAccessJwt(token, {
          keys: [jwk],
          audience: AUDIENCE,
          issuer: ISSUER,
          now: NOW,
        }),
      (error: unknown) => {
        assert.match((error as Error).message, /different team/);
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

    // Within the 60s leeway.
    await verifyAccessJwt(token, {
      keys: [jwk],
      audience: AUDIENCE,
      issuer: ISSUER,
      now: NOW,
    });

    await assert.rejects(
      () =>
        verifyAccessJwt(token, {
          keys: [jwk],
          audience: AUDIENCE,
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
        () =>
          verifyAccessJwt(bad, {
            keys: [jwk],
            audience: AUDIENCE,
            issuer: ISSUER,
            now: NOW,
          }),
        AccessVerificationError,
      );
    }
  });
});

describe('Access signing key retrieval', () => {
  beforeEach(() => resetAccessKeyCache());

  it('caches keys so every request does not refetch them', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          keys: [{ kid: 'k1', kty: 'RSA', n: 'n', e: 'AQAB' }],
        }),
        {
          status: 200,
        },
      );
    }) as unknown as typeof fetch;

    await fetchAccessKeys('team.cloudflareaccess.com', fetchImpl, 0);
    await fetchAccessKeys('team.cloudflareaccess.com', fetchImpl, 1000);
    assert.equal(calls, 1);

    // Past the TTL it refetches.
    await fetchAccessKeys(
      'team.cloudflareaccess.com',
      fetchImpl,
      4 * 60 * 60 * 1000,
    );
    assert.equal(calls, 2);
  });

  it('throws when the endpoint fails or returns no keys', async () => {
    const failing = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(
      () => fetchAccessKeys('team.cloudflareaccess.com', failing, 0),
      AccessVerificationError,
    );

    const empty = (async () =>
      new Response(JSON.stringify({ keys: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => fetchAccessKeys('other.cloudflareaccess.com', empty, 0),
      AccessVerificationError,
    );
  });
});
