import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIRECTORY_PATH,
  SIGNATURE_AGENT,
  handleDirectory,
  requestSignatureHeaders,
  signedFetch,
  signingKey,
  thumbprint,
} from '../worker/web-bot-auth.ts';
import { fetchReferenceContext } from '../worker/reference-fetch.ts';

async function generateSecret(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d });
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verifies `sig1` the way a site would: rebuild the base, check Ed25519. */
async function verify(
  publicJwk: JsonWebKey,
  input: string,
  signature: string,
  values: Record<string, string>,
): Promise<boolean> {
  const params = input.replace(/^sig1=/, '');
  const ids = params.slice(1, params.indexOf(')')).split(' ');
  const base = [
    ...ids.map((id) => `${id}: ${values[id]}`),
    `"@signature-params": ${params}`,
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x },
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  const raw = signature.match(/^sig1=:(.+):$/)![1]!;
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    fromBase64(raw),
    new TextEncoder().encode(base),
  );
}

describe('Web Bot Auth key', () => {
  it('is null without a secret, and for a secret that is not a private JWK', async () => {
    assert.equal(await signingKey({}), null);
    assert.equal(await signingKey({ WEB_BOT_AUTH_KEY: 'not json' }), null);
    assert.equal(
      await signingKey({
        WEB_BOT_AUTH_KEY: JSON.stringify({
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'a',
        }),
      }),
      null,
    );
  });

  it('is named by its RFC 7638 thumbprint, and publishes no private half', async () => {
    const key = (await signingKey({
      WEB_BOT_AUTH_KEY: await generateSecret(),
    }))!;
    assert.equal(key.keyid, await thumbprint(key.publicJwk));
    assert.equal(key.publicJwk.kid, key.keyid);
    assert.equal('d' in key.publicJwk, false);
  });

  it('matches the RFC 8037 thumbprint example', async () => {
    assert.equal(
      await thumbprint({
        kty: 'OKP',
        crv: 'Ed25519',
        x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
      }),
      'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
    );
  });
});

describe('signed requests', () => {
  it('cover the host and Signature-Agent, and verify', async () => {
    const key = (await signingKey({
      WEB_BOT_AUTH_KEY: await generateSecret(),
    }))!;
    const now = Date.UTC(2026, 9, 9, 12);
    const headers = await requestSignatureHeaders(
      key,
      new URL('https://Example.com/pricing'),
      now,
    );
    assert.equal(headers['signature-agent'], `sig1="${SIGNATURE_AGENT}"`);
    const input = headers['signature-input']!;
    assert.match(input, /^sig1=\("@authority" "signature-agent";key="sig1"\);/);
    assert.match(input, /;tag="web-bot-auth"/);
    assert.match(input, new RegExp(`;keyid="${key.keyid}"`));
    const created = Number(input.match(/;created=(\d+)/)![1]);
    assert.equal(created, now / 1000);
    assert.equal(Number(input.match(/;expires=(\d+)/)![1]), created + 300);
    assert.ok(
      await verify(key.publicJwk, input, headers.signature!, {
        '"@authority"': 'example.com',
        '"signature-agent";key="sig1"': `"${SIGNATURE_AGENT}"`,
      }),
    );
  });

  it('sign every fetch for its own host, and leave fetch alone without a key', async () => {
    const plain: typeof fetch = async () => new Response('ok');
    assert.equal(signedFetch(plain, null), plain);

    const key = (await signingKey({
      WEB_BOT_AUTH_KEY: await generateSecret(),
    }))!;
    const seen: { url: string; headers: Headers }[] = [];
    const doFetch = signedFetch(
      (async (input, init) => {
        seen.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response('ok');
      }) as typeof fetch,
      key,
    );
    await doFetch('https://a.example/x', { headers: { accept: 'text/html' } });
    await doFetch('https://b.example/y');
    await doFetch('http://c.example/z');
    assert.equal(
      seen[2]!.headers.get('signature'),
      null,
      'http stays unsigned',
    );
    assert.equal(seen[0]!.headers.get('accept'), 'text/html');
    for (const [i, host] of ['a.example', 'b.example'].entries()) {
      const headers = seen[i]!.headers;
      assert.ok(
        await verify(
          key.publicJwk,
          headers.get('signature-input')!,
          headers.get('signature')!,
          {
            '"@authority"': host,
            '"signature-agent";key="sig1"': headers
              .get('signature-agent')!
              .replace(/^sig1=/, ''),
          },
        ),
        host,
      );
    }
  });

  it('are what a reference fetch sends', async () => {
    const key = (await signingKey({
      WEB_BOT_AUTH_KEY: await generateSecret(),
    }))!;
    let sent: Headers | null = null;
    await fetchReferenceContext('https://example.com/', {
      signingKey: key,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        sent = new Headers(init?.headers);
        return new Response('<html><body><p>Hello</p></body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }) as typeof fetch,
    });
    assert.ok(sent);
    assert.equal(
      (sent as Headers).get('signature-agent'),
      `sig1="${SIGNATURE_AGENT}"`,
    );
    assert.match((sent as Headers).get('signature-input')!, /web-bot-auth/);
  });
});

describe('key directory', () => {
  const request = (method = 'GET') =>
    new Request(`https://app.vibld.com${DIRECTORY_PATH}`, { method });

  it('is 404 without a key', async () => {
    const response = await handleDirectory(request(), {});
    assert.equal(response.status, 404);
  });

  it('refuses anything but GET, HEAD included', async () => {
    for (const method of ['POST', 'HEAD']) {
      const response = await handleDirectory(request(method), {});
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get('allow'), 'GET');
    }
  });

  it('publishes the public key, signed for the host it was asked of', async () => {
    const env = { WEB_BOT_AUTH_KEY: await generateSecret() };
    const key = (await signingKey(env))!;
    const response = await handleDirectory(request(), env);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'application/http-message-signatures-directory+json',
    );
    const body = (await response.json()) as { keys: JsonWebKey[] };
    assert.deepEqual(body.keys, [key.publicJwk]);
    assert.equal('d' in body.keys[0]!, false);
    assert.equal(body.keys[0]!.alg, 'ed25519');
    const digest = response.headers.get('content-digest')!;
    const expected = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(body)),
    );
    assert.equal(
      digest,
      `sha-256=:${btoa(String.fromCharCode(...new Uint8Array(expected)))}:`,
    );
    const input = response.headers.get('signature-input')!;
    assert.match(input, /^sig1=\("@authority";req "content-digest"\);/);
    assert.match(input, /;tag="http-message-signatures-directory"/);
    assert.ok(
      await verify(key.publicJwk, input, response.headers.get('signature')!, {
        '"@authority";req': 'app.vibld.com',
        '"content-digest"': digest,
      }),
    );
  });
});
