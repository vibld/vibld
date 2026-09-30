import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  AccessVerificationError,
  accessIssuer,
  accessToken,
  resetAccessKeyCache,
  verifyAccessJwt,
} from '../worker/access-auth.ts';
import {
  OWNER_COOKIE,
  OWNER_SESSION_SECONDS,
  handleOwnerSession,
  passwordMatches,
  sameOrigin,
  signOwnerSession,
  verifyOwnerSession,
} from '../worker/owner-auth.ts';
import { platformAdminsFor } from '../worker/platform-admins.ts';
import { resolvePrincipal, signInMode } from '../worker/principal.ts';
import type { Rs256Jwk } from '../worker/rs256.ts';

const NOW = 1_800_000_000;
const TEAM = 'acme.cloudflareaccess.com';
const AUD = 'a1b2c3d4e5f6';
const PASSWORD = 'correct horse battery staple';
const BUILDER = 'https://builder.example.com';

function b64url(bytes: Uint8Array | string): string {
  const buffer =
    typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return buffer.toString('base64url');
}

async function keypair(kid: string) {
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
    jwk: { kid, kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e } as Rs256Jwk,
  };
}

async function sign(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  kid = 'k1',
): Promise<string> {
  const input = `${b64url(JSON.stringify({ alg: 'RS256', kid }))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

function accessClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: `https://${TEAM}`,
    aud: [AUD],
    sub: '7335d417-61da-459d-899c-0a01c76a2f94',
    email: 'Owner@Example.com',
    iat: NOW - 10,
    exp: NOW + 3600,
    ...overrides,
  };
}

describe('Cloudflare Access sign-in (D123)', () => {
  it('accepts a token Access signed for this application', async () => {
    const { privateKey, jwk } = await keypair('k1');
    const claims = await verifyAccessJwt(
      await sign(privateKey, accessClaims()),
      {
        keys: [jwk],
        teamDomain: TEAM,
        audience: AUD,
        now: NOW,
      },
    );
    assert.equal(claims.sub, '7335d417-61da-459d-899c-0a01c76a2f94');
    assert.equal(claims.email, 'Owner@Example.com');
  });

  it("refuses another application's token, another team's, a service token and an expired one", async () => {
    const { privateKey, jwk } = await keypair('k1');
    const cases: [string, Record<string, unknown>][] = [
      ['audience', { aud: ['someone-elses-app'] }],
      ['team', { iss: 'https://other.cloudflareaccess.com' }],
      [
        'service token without a subject',
        { sub: '', email: undefined, common_name: 'ci' },
      ],
      // Codex review of internal PR 337: a service token can carry a subject too.
      [
        'service token with a subject',
        { email: undefined, common_name: 'ci.access' },
      ],
      ['token naming no person', { email: undefined }],
      ['expiry', { exp: NOW - 3600 }],
    ];
    for (const [what, overrides] of cases) {
      await assert.rejects(
        verifyAccessJwt(await sign(privateKey, accessClaims(overrides)), {
          keys: [jwk],
          teamDomain: TEAM,
          audience: AUD,
          now: NOW,
        }),
        AccessVerificationError,
        what,
      );
    }
  });

  it('refuses a token signed by a key Access does not publish', async () => {
    const theirs = await keypair('k1');
    const ours = await keypair('k1');
    await assert.rejects(
      verifyAccessJwt(await sign(theirs.privateKey, accessClaims()), {
        keys: [ours.jwk],
        teamDomain: TEAM,
        audience: AUD,
        now: NOW,
      }),
      /signature is invalid/,
    );
  });

  it('reads the team domain however it was written, and the token from header or cookie', () => {
    assert.equal(
      accessIssuer('https://acme.cloudflareaccess.com/'),
      `https://${TEAM}`,
    );
    assert.equal(
      accessIssuer(' acme.cloudflareaccess.com '),
      `https://${TEAM}`,
    );
    assert.equal(
      accessToken(
        new Request(BUILDER, { headers: { 'Cf-Access-Jwt-Assertion': 'h' } }),
      ),
      'h',
    );
    assert.equal(
      accessToken(
        new Request(BUILDER, {
          headers: { Cookie: 'a=1; CF_Authorization=c' },
        }),
      ),
      'c',
    );
    assert.equal(accessToken(new Request(BUILDER)), undefined);
  });
});

describe('owner-password sign-in (D123)', () => {
  it('keeps a session it signed until it expires, and only for that password', async () => {
    const token = await signOwnerSession(PASSWORD, NOW);
    assert.equal(await verifyOwnerSession(token, PASSWORD, NOW + 60), true);
    assert.equal(
      await verifyOwnerSession(
        token,
        PASSWORD,
        NOW + OWNER_SESSION_SECONDS + 1,
      ),
      false,
    );
    assert.equal(
      await verifyOwnerSession(token, 'another long password', NOW),
      false,
    );
    const [expires, mac] = token.split('.');
    // A later expiry with the old MAC is not a longer session.
    assert.equal(
      await verifyOwnerSession(
        `${Number(expires) + 999}.${mac}`,
        PASSWORD,
        NOW,
      ),
      false,
    );
    for (const junk of [
      undefined,
      '',
      'x',
      '1.2.3',
      'abc.def',
      `${expires}.!!`,
    ]) {
      assert.equal(
        await verifyOwnerSession(junk, PASSWORD, NOW),
        false,
        String(junk),
      );
    }
  });

  it('compares the password exactly', async () => {
    assert.equal(await passwordMatches(PASSWORD, PASSWORD), true);
    assert.equal(await passwordMatches(`${PASSWORD} `, PASSWORD), false);
    assert.equal(await passwordMatches('', PASSWORD), false);
  });

  it("refuses a change that does not come from the builder's own origin", () => {
    const post = (headers: Record<string, string>) =>
      new Request(`${BUILDER}/api/plan`, { method: 'POST', headers });
    assert.equal(sameOrigin(post({ Origin: BUILDER })), true);
    // Behind a proxy that ends TLS the Worker sees http.
    assert.equal(
      sameOrigin(
        new Request('http://builder.example.com/api/plan', {
          method: 'POST',
          headers: { Origin: BUILDER },
        }),
      ),
      true,
    );
    // Under Docker a preview is another port on the same host: same site,
    // different origin.
    assert.equal(
      sameOrigin(post({ Origin: 'https://builder.example.com:8788' })),
      false,
    );
    assert.equal(sameOrigin(post({})), false);
    assert.equal(sameOrigin(new Request(`${BUILDER}/api/config`)), true);
  });

  const env = { VIBLD_OWNER_PASSWORD: PASSWORD };
  const signIn = (password: string, origin = BUILDER, url = BUILDER) =>
    new Request(`${url}/api/owner/session`, {
      method: 'POST',
      headers: { Origin: origin, 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });

  it('signs in with the right password and sets a strict, HttpOnly cookie', async () => {
    const response = await handleOwnerSession(signIn(PASSWORD), env);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, new RegExp(`^${OWNER_COOKIE}=\\d+\\.[\\w-]+;`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);

    const session = cookie.split(';')[0]!;
    const status = await handleOwnerSession(
      new Request(`${BUILDER}/api/owner/session`, {
        headers: { Cookie: session },
      }),
      env,
    );
    assert.deepEqual(await status.json(), { signedIn: true });
  });

  it('leaves Secure off over plain http, where the browser would drop the cookie', async () => {
    const response = await handleOwnerSession(
      signIn(PASSWORD, 'http://192.168.1.20:8787', 'http://192.168.1.20:8787'),
      env,
    );
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.headers.get('set-cookie') ?? '', /Secure/);
  });

  it('refuses a wrong password, a cross-origin attempt and one past the limit', async () => {
    assert.equal(
      (await handleOwnerSession(signIn('wrong password here'), env)).status,
      401,
    );
    assert.equal(
      (await handleOwnerSession(signIn(PASSWORD, 'https://evil.example'), env))
        .status,
      403,
    );
    const keys: string[] = [];
    const limited = await handleOwnerSession(signIn(PASSWORD), env, {
      limit: async (key) => {
        keys.push(key);
        return false;
      },
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(keys, ['owner-sign-in:unknown']);
  });

  it('is not there at all with a password under twelve characters', async () => {
    const response = await handleOwnerSession(signIn('short'), {
      VIBLD_OWNER_PASSWORD: 'short',
    });
    assert.equal(response.status, 404);
  });
});

describe('which sign-in a deployment uses (D123)', () => {
  it('is Clerk by default, and nothing when a named mode is not fully set', () => {
    assert.equal(
      signInMode({ CLERK_FRONTEND_API_URL: 'https://c.example' }),
      'clerk',
    );
    assert.equal(signInMode({}), undefined);
    assert.equal(
      signInMode({ VIBLD_AUTH: 'owner', VIBLD_OWNER_PASSWORD: PASSWORD }),
      'owner',
    );
    assert.equal(
      signInMode({ VIBLD_AUTH: 'owner', VIBLD_OWNER_PASSWORD: 'short' }),
      undefined,
    );
    assert.equal(
      signInMode({
        VIBLD_AUTH: 'access',
        VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
        VIBLD_ACCESS_AUD: AUD,
      }),
      'access',
    );
    assert.equal(
      signInMode({ VIBLD_AUTH: 'access', VIBLD_ACCESS_TEAM_DOMAIN: TEAM }),
      undefined,
    );
    // A typo is not a way to switch sign-in off, even with Clerk set.
    assert.equal(
      signInMode({
        VIBLD_AUTH: 'nobody',
        CLERK_FRONTEND_API_URL: 'https://c.example',
      }),
      undefined,
    );
  });

  it('makes the owner an admin on an owner copy, and nobody extra elsewhere', () => {
    const owner = { VIBLD_AUTH: 'owner', VIBLD_OWNER_PASSWORD: PASSWORD };
    assert.deepEqual([...platformAdminsFor(owner)], ['owner@localhost']);
    assert.deepEqual(
      [...platformAdminsFor({ ...owner, VIBLD_OWNER_EMAIL: 'Me@Example.com' })],
      ['me@example.com'],
    );
    assert.deepEqual(
      [
        ...platformAdminsFor({
          CLERK_FRONTEND_API_URL: 'https://c.example',
          VIBLD_OWNER_PASSWORD: PASSWORD,
          VIBLD_PLATFORM_ADMINS: 'a@example.com',
        }),
      ],
      ['a@example.com'],
    );
  });

  it('resolves the owner from the session cookie, and refuses it cross-origin', async () => {
    const env = { VIBLD_AUTH: 'owner', VIBLD_OWNER_PASSWORD: PASSWORD };
    const cookie = `${OWNER_COOKIE}=${await signOwnerSession(PASSWORD)}`;
    const resolved = await resolvePrincipal(
      new Request(`${BUILDER}/api/plan`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: BUILDER },
      }),
      env,
    );
    assert.equal(resolved.denied, null);
    assert.deepEqual(resolved.denied === null && resolved.principal, {
      userId: 'owner',
      email: 'owner@localhost',
      emailVerified: true,
      policyIdentity: 'owner@localhost',
    });

    const crossSite = await resolvePrincipal(
      new Request(`${BUILDER}/api/plan`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'http://builder.example.com:8788' },
      }),
      env,
    );
    assert.equal(crossSite.denied?.status, 403);

    const signedOut = await resolvePrincipal(
      new Request(`${BUILDER}/api/config`),
      env,
    );
    assert.equal(signedOut.denied?.status, 401);

    // A Clerk token is not an owner session.
    const bearer = await resolvePrincipal(
      new Request(`${BUILDER}/api/config`, {
        headers: { Authorization: 'Bearer x.y.z' },
      }),
      env,
    );
    assert.equal(bearer.denied?.status, 401);
  });

  describe('with Access keys served', () => {
    const realFetch = globalThis.fetch;
    let jwk: Rs256Jwk;
    let privateKey: CryptoKey;

    beforeEach(async () => {
      resetAccessKeyCache();
      ({ jwk, privateKey } = await keypair('k1'));
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        assert.equal(String(input), `https://${TEAM}/cdn-cgi/access/certs`);
        return Response.json({ keys: [jwk] });
      }) as typeof fetch;
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      resetAccessKeyCache();
    });

    it('resolves the person Access let through, with a verified address', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await sign(
        privateKey,
        accessClaims({ iat: now - 5, exp: now + 600 }),
      );
      const resolved = await resolvePrincipal(
        new Request(`${BUILDER}/api/config`, {
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }),
        {
          VIBLD_AUTH: 'access',
          VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
          VIBLD_ACCESS_AUD: AUD,
        },
      );
      assert.equal(resolved.denied, null);
      assert.deepEqual(resolved.denied === null && resolved.principal, {
        userId: '7335d417-61da-459d-899c-0a01c76a2f94',
        email: 'Owner@Example.com',
        emailVerified: true,
        policyIdentity: 'owner@example.com',
      });
    });

    it("refuses a request that reached the Worker without Access's token", async () => {
      const resolved = await resolvePrincipal(
        new Request(`${BUILDER}/api/config`),
        {
          VIBLD_AUTH: 'access',
          VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
          VIBLD_ACCESS_AUD: AUD,
        },
      );
      assert.equal(resolved.denied?.status, 401);
    });
  });
});

describe("the builder's side of the sign-in modes (D123)", async () => {
  const { authModeFor, fetchOwnerSignedIn, ownerSignIn } =
    await import('../src/auth/mode.ts');
  const { clerkModeFor } = await import('../src/auth/clerk-token.ts');

  it("shows Clerk's UI only in a build for Clerk, whatever key is present", () => {
    // Codex review of internal PR 337: an Access build with an old Clerk key left in
    // its environment gated the builder behind a Clerk session.
    assert.equal(clerkModeFor(undefined), true);
    assert.equal(clerkModeFor('Clerk'), true);
    assert.equal(clerkModeFor('access'), false);
    assert.equal(clerkModeFor('owner'), false);
    assert.equal(clerkModeFor('typo'), false);
  });

  it('takes the named mode, else Clerk with a key, else none', () => {
    assert.equal(authModeFor('owner', true), 'owner');
    assert.equal(authModeFor(' Access ', false), 'access');
    assert.equal(authModeFor(undefined, true), 'clerk');
    assert.equal(authModeFor('something', false), 'none');
    // Codex review of internal PR 337: an unknown mode is no sign-in, as on the Worker,
    // not Clerk because a key happens to be in the build.
    assert.equal(authModeFor('something', true), 'none');
    assert.equal(authModeFor('clerk', true), 'clerk');
    assert.equal(authModeFor('clerk', false), 'none');
  });

  it("signs in with the password and shows the Worker's refusal as it was given", async () => {
    const calls: RequestInit[] = [];
    const reply = (status: number, body: unknown) =>
      (async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init ?? {});
        return Response.json(body, { status });
      }) as typeof fetch;
    assert.deepEqual(
      await ownerSignIn(PASSWORD, reply(200, { signedIn: true })),
      { ok: true },
    );
    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.credentials, 'same-origin');
    assert.deepEqual(
      await ownerSignIn(
        'nope',
        reply(401, { error: 'That password is not right.' }),
      ),
      { ok: false, error: 'That password is not right.' },
    );
    assert.equal(
      await fetchOwnerSignedIn(reply(200, { signedIn: true })),
      true,
    );
    assert.equal(
      await fetchOwnerSignedIn(reply(404, { error: 'Not found.' })),
      false,
    );
  });
});

describe('deleting an account on a copy without Clerk (D123)', async () => {
  const { deletionDepsFor } = await import('../worker/account-deletion.ts');

  it('has no sign-in account to delete, so that step completes', async () => {
    // Codex review of internal PR 337: it asked Clerk without a key, failed after
    // everything else was purged, and left the owner refused for good.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('Clerk was asked');
    }) as typeof fetch;
    try {
      for (const env of [
        { VIBLD_AUTH: 'owner', VIBLD_OWNER_PASSWORD: PASSWORD },
        {
          VIBLD_AUTH: 'access',
          VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
          VIBLD_ACCESS_AUD: AUD,
        },
      ]) {
        const deps = deletionDepsFor({ ...env, DB: {} as D1Database });
        assert.deepEqual(await deps.deleteClerkUser('owner'), { ok: true });
      }
      const clerk = deletionDepsFor({
        CLERK_FRONTEND_API_URL: 'https://c.example',
        DB: {} as D1Database,
      });
      assert.deepEqual(await clerk.deleteClerkUser('user_1'), {
        ok: false,
        error: 'CLERK_SECRET_KEY is not set, so the sign-in account was kept.',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('the admin tools on a copy without Clerk (D123)', async () => {
  const { accountDirectoryFor } =
    await import('../worker/account-directory.ts');

  it("knows the owner copy's one account, and asks nobody", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('Clerk was asked');
    }) as typeof fetch;
    try {
      const directory = accountDirectoryFor({
        VIBLD_AUTH: 'owner',
        VIBLD_OWNER_PASSWORD: PASSWORD,
        VIBLD_OWNER_EMAIL: 'me@example.com',
      });
      assert.equal(directory.configured, true);
      assert.deepEqual(await directory.lookupByEmail(' Me@Example.com '), {
        ok: true,
        userId: 'owner',
      });
      assert.equal(
        (await directory.lookupByEmail('someone@example.com')).ok,
        false,
      );
      assert.equal((await directory.user('owner'))?.email, 'me@example.com');
      assert.deepEqual(await directory.setBan('owner', true), { ok: true });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('finds an Access account through the invite it took', async () => {
    // Codex review of internal PR 337: every admin tool asked Clerk, which an Access
    // copy does not have.
    const rows = new Map([
      ['taken@example.com', 'access-sub-1'],
      ['waiting@example.com', null],
    ]);
    const db = {
      prepare(sql: string) {
        return {
          bind(value: string) {
            return {
              async first() {
                if (sql.includes('WHERE email')) {
                  return rows.has(value)
                    ? { redeemed_by_user_id: rows.get(value) }
                    : null;
                }
                for (const [email, id] of rows) {
                  if (id === value) return { email };
                }
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const directory = accountDirectoryFor({
      VIBLD_AUTH: 'access',
      VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
      VIBLD_ACCESS_AUD: AUD,
      DB: db,
    });
    assert.equal(directory.configured, true);
    assert.deepEqual(await directory.lookupByEmail('taken@example.com'), {
      ok: true,
      userId: 'access-sub-1',
    });
    assert.match(
      (await directory.lookupByEmail('waiting@example.com')).ok
        ? ''
        : (
            (await directory.lookupByEmail('waiting@example.com')) as {
              error: string;
            }
          ).error,
      /nobody has signed in with yet/,
    );
    assert.equal(
      (await directory.user('access-sub-1'))?.email,
      'taken@example.com',
    );
  });
});

describe('the sixth review of #337', async () => {
  const { boundedText } = await import('../worker/owner-auth.ts');
  const { deletionDepsFor } = await import('../worker/account-deletion.ts');
  const { accountDirectoryFor } =
    await import('../worker/account-directory.ts');

  it('reads a sign-in body only up to its limit', async () => {
    const post = (body: BodyInit, headers: Record<string, string> = {}) =>
      new Request(BUILDER, { method: 'POST', body, headers });
    assert.equal(
      await boundedText(post('{"password":"x"}'), 64),
      '{"password":"x"}',
    );
    assert.equal(await boundedText(post('x'.repeat(65)), 64), null);
    // A declared length over the limit is refused unread.
    assert.equal(
      await boundedText(post('short', { 'content-length': '999999' }), 64),
      null,
    );
    // A stream with no length is cut off, not read to its end.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(32));
      },
    });
    assert.equal(
      await boundedText(
        new Request(BUILDER, {
          method: 'POST',
          body: endless,
          // @ts-expect-error Node needs this for a streamed body.
          duplex: 'half',
        }),
        64,
      ),
      null,
    );
    assert.ok(pulled < 10, `read ${pulled} chunks`);
  });

  it('keeps the Clerk deletion step pending when sign-in is not configured', async () => {
    for (const env of [
      {},
      { VIBLD_AUTH: 'clerk' },
      { VIBLD_AUTH: 'typo', CLERK_FRONTEND_API_URL: 'https://c.example' },
    ]) {
      const deps = deletionDepsFor({ ...env, DB: {} as D1Database });
      assert.equal((await deps.deleteClerkUser('user_1')).ok, false);
    }
  });

  it('lets the default owner be found through an email field', async () => {
    const directory = accountDirectoryFor({
      VIBLD_AUTH: 'owner',
      VIBLD_OWNER_PASSWORD: PASSWORD,
    });
    assert.deepEqual(await directory.lookupByEmail('owner@localhost'), {
      ok: true,
      userId: 'owner',
    });
  });

  it('finds an Access person let in without an invite', async () => {
    const seen = new Map([['admin@example.com', 'access-sub-admin']]);
    const db = {
      prepare(sql: string) {
        return {
          bind(value: string) {
            return {
              async first() {
                if (sql.includes('FROM access_accounts WHERE email')) {
                  return seen.has(value) ? { user_id: seen.get(value) } : null;
                }
                if (sql.includes('FROM access_accounts WHERE user_id')) {
                  for (const [email, id] of seen) {
                    if (id === value) return { email };
                  }
                }
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const directory = accountDirectoryFor({
      VIBLD_AUTH: 'access',
      VIBLD_ACCESS_TEAM_DOMAIN: TEAM,
      VIBLD_ACCESS_AUD: AUD,
      DB: db,
    });
    assert.deepEqual(await directory.lookupByEmail('Admin@Example.com'), {
      ok: true,
      userId: 'access-sub-admin',
    });
    assert.equal(
      (await directory.user('access-sub-admin'))?.email,
      'admin@example.com',
    );
  });
});

describe("the admin tools accept a self-hosted copy's account ids (D123)", async () => {
  const { ACCOUNT_ID } = await import('../worker/admin-users.ts');

  it("takes Clerk's, the owner's and an Access id, and nothing else", () => {
    // Codex review of internal PR 337: only `user_...` was accepted, so the owner's
    // and Access's accounts were refused before their page could open.
    for (const id of [
      'user_2abcDEF',
      'owner',
      '7335d417-61da-459d-899c-0a01c76a2f94',
    ]) {
      assert.ok(ACCOUNT_ID.test(id), id);
    }
    for (const id of ['', 'a@b.com', '../x', '<b>', 'a b', 'x'.repeat(65)]) {
      assert.ok(!ACCOUNT_ID.test(id), id);
    }
  });
});
