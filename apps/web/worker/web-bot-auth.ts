/**
 * Web Bot Auth: the builder says who it is when it fetches somebody else's
 * site (https://datatracker.ietf.org/wg/webbotauth/about/).
 *
 * The only requests this Worker sends to sites it does not run are the
 * reference fetches (`reference-fetch.ts`): the page a person pasted as a
 * reference, and that page's stylesheets. Each is signed with an Ed25519
 * key under RFC 9421 HTTP Message Signatures, covering the host it goes to
 * and the `Signature-Agent` that names where the key is published. The
 * public half is published at `/.well-known/http-message-signatures-directory`,
 * itself signed, so a site can check a request came from vibld.
 *
 * The key is the Worker secret `WEB_BOT_AUTH_KEY`, an Ed25519 private JWK
 * that only `.github/workflows/web-bot-auth-key.yml` writes. Without it,
 * requests go unsigned exactly as before and the directory answers 404:
 * signing is additive, and nothing here invents a key.
 */

/** Where the key is published, and what every signed request names. */
export const SIGNATURE_AGENT = 'https://app.vibld.com';
export const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';
const DIRECTORY_TYPE = 'application/http-message-signatures-directory+json';

/** How long a signature is good for, in seconds. */
const LIFETIME_S = 300;

export interface WebBotAuthEnv {
  WEB_BOT_AUTH_KEY?: string;
}

interface Ed25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
}

export interface SigningKey {
  /** RFC 7638 thumbprint of the public key, the `keyid` verifiers look up. */
  keyid: string;
  /** The public key as published. */
  publicJwk: Ed25519Jwk & { kid: string; alg: 'ed25519'; use: 'sig' };
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array>;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** RFC 7638: SHA-256 over the required members, in lexical order. */
export async function thumbprint(jwk: Ed25519Jwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return base64url(new Uint8Array(digest));
}

const keys = new Map<string, Promise<SigningKey | null>>();

/**
 * The signing key from `WEB_BOT_AUTH_KEY`, or null when it is unset or not
 * an Ed25519 private JWK. Imported once per isolate. A malformed secret is
 * logged by name only, never by value.
 */
export function signingKey(env: WebBotAuthEnv): Promise<SigningKey | null> {
  const secret = env.WEB_BOT_AUTH_KEY;
  if (!secret) return Promise.resolve(null);
  let cached = keys.get(secret);
  if (!cached) {
    cached = importKey(secret).catch(() => {
      console.error('WEB_BOT_AUTH_KEY is not an Ed25519 private JWK');
      return null;
    });
    keys.set(secret, cached);
  }
  return cached;
}

async function importKey(secret: string): Promise<SigningKey> {
  const jwk = JSON.parse(secret) as Ed25519Jwk;
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x || !jwk.d) {
    throw new Error('not an Ed25519 private JWK');
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const keyid = await thumbprint(jwk);
  return {
    keyid,
    publicJwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: jwk.x,
      kid: keyid,
      // The HTTP Signature Algorithms registry's identifier, which the
      // directory format requires; JOSE's `Ed25519`/`EdDSA` are not it.
      alg: 'ed25519',
      use: 'sig',
    },
    async sign(data) {
      return new Uint8Array(
        await crypto.subtle.sign({ name: 'Ed25519' }, key, data),
      );
    },
  };
}

/** The signature label, and the `Signature-Agent` member keyed to it. */
const LABEL = 'sig1';

function nonce(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The `Signature-Input` and `Signature` for a message, per RFC 9421: the
 * covered components each on a line, then `@signature-params`. Each
 * component is given by its serialized identifier (`"@authority"`, or
 * `"@authority";req` on a response) and its value.
 */
async function signature(
  key: SigningKey,
  components: [string, string][],
  tag: string,
  now: number,
): Promise<{ input: string; signature: string }> {
  const created = Math.floor(now / 1000);
  const params =
    `(${components.map(([id]) => id).join(' ')})` +
    `;created=${created};expires=${created + LIFETIME_S}` +
    `;keyid="${key.keyid}";alg="ed25519";nonce="${nonce()}";tag="${tag}"`;
  const base = [
    ...components.map(([id, value]) => `${id}: ${value}`),
    `"@signature-params": ${params}`,
  ].join('\n');
  const signed = await key.sign(new TextEncoder().encode(base));
  return {
    input: `${LABEL}=${params}`,
    signature: `${LABEL}=:${base64(signed)}:`,
  };
}

/**
 * The headers that sign a request to `url`: `Signature-Agent`,
 * `Signature-Input` and `Signature`, covering `@authority` and the
 * `Signature-Agent` member keyed to this signature's label, with the
 * `web-bot-auth` tag. `Signature-Agent` is a Structured Fields dictionary
 * (draft-ietf-webbotauth-httpsig-protocol 5.2.1); the bare-string form is
 * legacy that verifiers only may accept.
 */
export async function requestSignatureHeaders(
  key: SigningKey,
  url: URL,
  now = Date.now(),
): Promise<Record<string, string>> {
  const agent = `"${SIGNATURE_AGENT}"`;
  const signed = await signature(
    key,
    [
      ['"@authority"', url.host.toLowerCase()],
      [`"signature-agent";key="${LABEL}"`, agent],
    ],
    'web-bot-auth',
    now,
  );
  return {
    'signature-agent': `${LABEL}=${agent}`,
    'signature-input': signed.input,
    signature: signed.signature,
  };
}

/**
 * `fetch` with every HTTPS request signed, or `fetch` unchanged when there
 * is no key. Each hop of a redirect and each stylesheet is its own request,
 * so each is signed for its own host. A plain `http:` request goes
 * unsigned: the signature covers only the host, so anyone watching the
 * wire could replay it there for its lifetime (the draft's 6.1 asks for TLS).
 */
export function signedFetch(
  doFetch: typeof fetch,
  key: SigningKey | null,
): typeof fetch {
  if (!key) return doFetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== 'https:') return doFetch(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    for (const [name, value] of Object.entries(
      await requestSignatureHeaders(key, url),
    )) {
      headers.set(name, value);
    }
    return doFetch(input, { ...init, headers });
  }) as typeof fetch;
}

/**
 * The key directory: the public key as a JWK Set, signed with the
 * directory's own tag over the host it was asked of and the body's
 * `Content-Digest`, as the protocol draft requires (Appendix B), so the
 * key set can neither be re-served under another host nor swapped under a
 * captured signature. 404 when there is no key, so nobody is pointed at an
 * empty set.
 *
 * GET only. A HEAD's proof would have to be over its empty content, and a
 * shared cache may freshen a stored GET with HEAD's headers (RFC 9111
 * 4.3.5), pairing the key set with a digest of nothing.
 */
export async function handleDirectory(
  request: Request,
  env: WebBotAuthEnv,
  now = Date.now(),
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: {
        allow: 'GET',
        'content-type': 'application/json; charset=utf-8',
      },
    });
  }
  const key = await signingKey(env);
  if (!key) {
    return new Response(JSON.stringify({ error: 'Not found.' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const body = JSON.stringify({ keys: [key.publicJwk] });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  const contentDigest = `sha-256=:${base64(new Uint8Array(digest))}:`;
  const signed = await signature(
    key,
    [
      ['"@authority";req', new URL(request.url).host.toLowerCase()],
      ['"content-digest"', contentDigest],
    ],
    'http-message-signatures-directory',
    now,
  );
  return new Response(body, {
    headers: {
      'content-type': DIRECTORY_TYPE,
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
      'content-digest': contentDigest,
      'signature-input': signed.input,
      signature: signed.signature,
    },
  });
}
