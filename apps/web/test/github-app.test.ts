import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  githubAppCredentials,
  mintInstallationToken,
  signAppJwt,
} from '../worker/github-app.ts';

/**
 * A real RSA key pair, in both the shapes a GitHub App can hand you.
 *
 * Generated rather than checked in, because a private key in a repository is
 * a private key in a repository even when it was made for a test.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
/** What GitHub's "Generate a private key" button actually downloads. */
const PKCS1_PEM = privateKey
  .export({ type: 'pkcs1', format: 'pem' })
  .toString();
/** What WebCrypto can import without help. */
const PKCS8_PEM = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

/** Whether this JWT really was signed by the key above. */
function verifies(jwt: string): boolean {
  const [header, payload, signature] = jwt.split('.');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  return verifier.verify(
    publicKey,
    Buffer.from(
      (signature ?? '').replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ),
  );
}

describe('reading the App credentials', () => {
  it('needs both halves', () => {
    assert.equal(githubAppCredentials({}), null);
    assert.equal(githubAppCredentials({ VIBLD_GITHUB_APP_ID: '123' }), null);
    assert.equal(
      githubAppCredentials({ VIBLD_GITHUB_PRIVATE_KEY: PKCS8_PEM }),
      null,
    );
  });

  it('refuses an app id that is not a number', () => {
    // The id goes straight into the JWT's `iss`. Anything else is a
    // misconfiguration worth catching here rather than as a signature GitHub
    // rejects for reasons it will not explain.
    assert.equal(
      githubAppCredentials({
        VIBLD_GITHUB_APP_ID: 'my-app',
        VIBLD_GITHUB_PRIVATE_KEY: PKCS8_PEM,
      }),
      null,
    );
  });

  it('reads both when they are there', () => {
    const found = githubAppCredentials({
      VIBLD_GITHUB_APP_ID: ' 123 ',
      VIBLD_GITHUB_PRIVATE_KEY: PKCS8_PEM,
    });
    assert.ok(found);
    assert.equal(found.appId, '123');
  });
});

describe('signing an App JWT', () => {
  it('signs with a PKCS#8 key', async () => {
    const jwt = await signAppJwt({ appId: '123', privateKey: PKCS8_PEM });
    assert.ok(jwt);
    assert.ok(verifies(jwt));
  });

  it('signs with the PKCS#1 key GitHub actually gives you', async () => {
    // GitHub's own download is headed `BEGIN RSA PRIVATE KEY`, which
    // WebCrypto cannot import. The alternative to wrapping it here was to
    // ask someone to run `openssl` against a file that should never be
    // handled, so this test is the one that decides whether that stands.
    const jwt = await signAppJwt({ appId: '123', privateKey: PKCS1_PEM });
    assert.ok(jwt);
    assert.ok(verifies(jwt), 'the wrapped PKCS#1 key produced a bad signature');
  });

  it('claims the app id, and an expiry GitHub will accept', async () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    const jwt = await signAppJwt({ appId: '456', privateKey: PKCS1_PEM }, now);
    assert.ok(jwt);
    const payload = decodeSegment(jwt.split('.')[1] ?? '') as {
      iss: string;
      iat: number;
      exp: number;
    };
    assert.equal(payload.iss, '456');
    // Backdated, for a clock that is a little slow.
    assert.ok(payload.iat < Math.floor(now / 1000));
    // GitHub refuses anything over ten minutes.
    assert.ok(payload.exp - payload.iat <= 600);
    assert.ok(payload.exp > Math.floor(now / 1000));
  });

  it('says no to a key it cannot read, without quoting it', async () => {
    for (const key of [
      'not a key at all',
      '-----BEGIN RSA PRIVATE KEY-----\nnot base64!!\n-----END RSA PRIVATE KEY-----',
      '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----',
    ]) {
      assert.equal(await signAppJwt({ appId: '1', privateKey: key }), null);
    }
  });
});

describe('minting an installation token', () => {
  const credentials = { appId: '123', privateKey: PKCS1_PEM };
  const SCOPE = { owner: 'acme', repo: 'site' };

  it('presents the JWT and returns the token', async () => {
    let seen: Record<string, string> | undefined;
    let url: string | undefined;
    let sentBody: Record<string, unknown> | undefined;
    const result = await mintInstallationToken(credentials, 42, SCOPE, (async (
      target: string,
      init?: RequestInit,
    ) => {
      url = target;
      seen = init?.headers as Record<string, string>;
      sentBody = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      return new Response(
        JSON.stringify({ token: 'ghs_x', expires_at: '2026-09-13T13:00:00Z' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.token, 'ghs_x');
    assert.match(url ?? '', /\/app\/installations\/42\/access_tokens$/);
    assert.match(seen?.authorization ?? '', /^Bearer ey/);
    // GitHub's docs make this a requirement, not a courtesy.
    assert.ok(seen?.['user-agent']);
    // The point of passing the scope: an installation can cover many
    // repositories, and a bodyless request would mint a token for all of
    // them with every permission the installation holds.
    assert.deepEqual(sentBody?.repositories, ['site']);
    assert.deepEqual(sentBody?.permissions, {
      contents: 'write',
      pull_requests: 'write',
    });
  });

  it('says the access is gone rather than reporting a status code', async () => {
    // The failure modes table asks for this by name: a person can act on
    // "Vibld no longer has access", and cannot act on a 404 from an endpoint
    // they have never heard of.
    for (const status of [401, 404]) {
      const result = await mintInstallationToken(
        credentials,
        42,
        SCOPE,
        (async () => new Response('', { status })) as unknown as typeof fetch,
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /no longer has access/);
    }
  });

  it('never puts the key in an error', async () => {
    const results = [
      await mintInstallationToken(
        { appId: '1', privateKey: 'broken' },
        42,
        SCOPE,
        (async () =>
          new Response('', { status: 500 })) as unknown as typeof fetch,
      ),
      await mintInstallationToken(credentials, 42, SCOPE, (async () => {
        throw new Error(PKCS1_PEM);
      }) as unknown as typeof fetch),
      await mintInstallationToken(
        credentials,
        42,
        SCOPE,
        (async () =>
          new Response('not json', { status: 200 })) as unknown as typeof fetch,
      ),
    ];
    for (const result of results) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(!result.error.includes('PRIVATE KEY'));
        assert.ok(!result.error.includes(PKCS1_PEM.slice(40, 80)));
      }
    }
  });

  it('reads a rate limit as a rate limit, not as revoked access', async () => {
    // The same three-way reading the repository calls do. Telling someone to
    // reconnect a working App because GitHub asked them to wait is the wrong
    // instruction twice over.
    for (const response of [
      new Response('', { status: 429, headers: { 'retry-after': '45' } }),
      new Response('', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    ]) {
      const result = await mintInstallationToken(
        credentials,
        42,
        SCOPE,
        (async () => response.clone()) as unknown as typeof fetch,
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /rate limiting/);
        assert.doesNotMatch(result.error, /no longer has access/);
      }
    }
  });

  it('reports an unreachable GitHub as unreachable', async () => {
    const result = await mintInstallationToken(
      credentials,
      42,
      SCOPE,
      (async () => {
        throw new Error('boom');
      }) as unknown as typeof fetch,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not be reached/);
  });
});
