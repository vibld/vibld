/**
 * Authenticating as the Vibld GitHub App, from inside a Worker.
 *
 * Two steps, and they are different credentials. The App's private key signs
 * a short-lived JWT that proves "I am this App"; that JWT buys an
 * installation access token, which is what every repository call actually
 * uses. The token expires in an hour and is minted per push rather than
 * stored, so nothing user-secret is persisted anywhere (ADR-0006: the App
 * key is Vibld infrastructure, a Worker secret, and the installation id it
 * is paired with is not a secret at all).
 *
 * No SDK. Workers' WebCrypto signs `RSASSA-PKCS1-v1_5` with SHA-256
 * directly, which is exactly what RS256 is, so the whole of this is a
 * base64url encoder and one `crypto.subtle.sign`. That also keeps the
 * ADR-0003 boundary intact: no vendor client outside the places allowed to
 * hold one.
 *
 * The private key never appears in an error. Same rule the provider clients
 * follow, and for a stronger reason: this key is not scoped to one user's
 * spend, it is the App itself.
 */

/** What a caller needs to act as the App. Neither field is per-user. */
export interface GitHubAppCredentials {
  /** The App's numeric id, from its settings page. Not a secret. */
  appId: string;
  /** The App's private key, PEM. A Worker secret. */
  privateKey: string;
}

export interface GitHubAppEnv {
  VIBLD_GITHUB_APP_ID?: string;
  VIBLD_GITHUB_PRIVATE_KEY?: string;
}

/**
 * The App credentials this deployment is configured with, or null.
 *
 * Null rather than throwing, so a deployment without the App configured
 * simply does not offer the feature, the same way `autoPublishConfigured`
 * decides whether publishing is on.
 */
export function githubAppCredentials(
  env: GitHubAppEnv,
): GitHubAppCredentials | null {
  const appId = env.VIBLD_GITHUB_APP_ID?.trim();
  const privateKey = env.VIBLD_GITHUB_PRIVATE_KEY?.trim();
  if (!appId || !privateKey) return null;
  if (!/^\d+$/.test(appId)) return null;
  return { appId, privateKey };
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlFromText(text: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1)
    bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/**
 * DER length bytes for a value of this size.
 *
 * Short form below 128, long form above it. Only needed by the PKCS#1
 * wrapping below, which is the one place this file writes DER rather than
 * reading it.
 */
function derLength(size: number): number[] {
  if (size < 0x80) return [size];
  const bytes: number[] = [];
  let remaining = size;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function derSequence(contents: Uint8Array): Uint8Array {
  const header = [0x30, ...derLength(contents.length)];
  const out = new Uint8Array(header.length + contents.length);
  out.set(header, 0);
  out.set(contents, header.length);
  return out;
}

/**
 * A PKCS#1 RSA key wrapped as PKCS#8, which is the only form WebCrypto
 * imports.
 *
 * This exists because of what GitHub actually hands you. "Generate a private
 * key" on an App's settings page downloads a PKCS#1 PEM, headed
 * `BEGIN RSA PRIVATE KEY`, and `crypto.subtle.importKey` cannot read it. The
 * alternative was to ask for a converted key, which means asking someone to
 * run `openssl` on a file that must never be pasted anywhere; doing the
 * conversion here means the key that GitHub downloads is the key that goes
 * into the secret, unmodified and unhandled.
 *
 * The wrapper is fixed: version 0, the `rsaEncryption` algorithm identifier,
 * and the original key as an octet string.
 */
function pkcs8FromPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  // OID 1.2.840.113549.1.1.1 (rsaEncryption), followed by NULL parameters.
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const octetHeader = [0x04, ...derLength(pkcs1.length)];
  const contents = new Uint8Array(
    version.length + algorithm.length + octetHeader.length + pkcs1.length,
  );
  let at = 0;
  contents.set(version, at);
  at += version.length;
  contents.set(algorithm, at);
  at += algorithm.length;
  contents.set(octetHeader, at);
  at += octetHeader.length;
  contents.set(pkcs1, at);
  return derSequence(contents);
}

/** The DER bytes of a PEM key, and which of the two shapes it was in. */
function readPem(pem: string): Uint8Array | null {
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(pem);
  if (!match) return null;
  const label = match[1] ?? '';
  const body = (match[2] ?? '').replace(/\s+/g, '');
  if (body.length === 0) return null;

  let der: Uint8Array;
  try {
    der = bytesFromBase64(body);
  } catch {
    return null;
  }
  if (label === 'RSA PRIVATE KEY') return pkcs8FromPkcs1(der);
  if (label === 'PRIVATE KEY') return der;
  return null;
}

/**
 * How long an App JWT is good for.
 *
 * GitHub refuses anything over ten minutes. Nine leaves room for a clock
 * that is a little fast without ever presenting an expired token; `iat` is
 * backdated a minute for a clock that is a little slow, which GitHub's own
 * documentation recommends.
 */
const JWT_LIFETIME_SECONDS = 9 * 60;
const JWT_BACKDATE_SECONDS = 60;

/**
 * A signed App JWT, or null if the key cannot be read.
 *
 * Null, not a thrown error carrying the key: a malformed key is a
 * configuration problem the caller reports as "GitHub is not configured
 * correctly", never as a message with key material in it.
 */
export async function signAppJwt(
  credentials: GitHubAppCredentials,
  now: number = Date.now(),
): Promise<string | null> {
  const der = readPem(credentials.privateKey);
  if (!der) return null;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      der.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    // A key that will not import is a key this cannot use. The reason is not
    // reportable without risking the material itself.
    return null;
  }

  const issuedAt = Math.floor(now / 1000) - JWT_BACKDATE_SECONDS;
  const header = base64UrlFromText(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  );
  const payload = base64UrlFromText(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + JWT_BACKDATE_SECONDS + JWT_LIFETIME_SECONDS,
      iss: credentials.appId,
    }),
  );
  const signed = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

export const GITHUB_API = 'https://api.github.com';

/**
 * Whether a refusal is GitHub asking for patience rather than saying no, and
 * what to tell the caller if it is.
 *
 * In one place because both this file and `github-push.ts` have to read it
 * the same way, and because it took three tries to get right. A 403 means
 * revoked access or a rate limit; a 429 means a rate limit; and a secondary
 * limit can arrive as a 403 with neither `retry-after` nor a zeroed
 * `x-ratelimit-remaining`, which is documented and which a predicate gated
 * on those two headers calls revoked access. GitHub says so in the body in
 * that case, so the body is read too.
 *
 * Getting this backwards tells someone to reconnect an App that is working
 * perfectly well, and leaves them no wiser about the wait that would have
 * fixed it.
 */
export function rateLimitMessage(
  status: number,
  headers: Headers,
  body: Record<string, unknown>,
): string | null {
  const retryAfter = headers.get('retry-after');
  const message = typeof body.message === 'string' ? body.message : '';
  const limited =
    status === 429 ||
    (status === 403 &&
      (headers.get('x-ratelimit-remaining') === '0' ||
        retryAfter !== null ||
        /rate limit/i.test(message)));
  if (!limited) return null;
  return retryAfter
    ? `GitHub is rate limiting this app. Try again in ${retryAfter} seconds.`
    : 'GitHub is rate limiting this app. Try again shortly.';
}

/**
 * The User-Agent GitHub asks every API client to send. Its docs make this a
 * requirement rather than a courtesy, and requests without one are refused.
 */
export const GITHUB_USER_AGENT = 'Vibld (+https://vibld.com)';

/**
 * Why something failed, for a caller deciding what to do about it.
 *
 * The sentence is for the person; this is for the code. Only `access` means
 * the grant is actually broken and worth re-approving. Telling someone to
 * reconnect a working App because GitHub was briefly unreachable is the
 * mistake `rateLimitMessage` above exists to avoid, and it is just as easy
 * to make one layer up by treating every failure as the same failure.
 *
 * One vocabulary shared by `github-app.ts` and `github-push.ts` rather than
 * one each: two lists of reasons that mean the same things drift, and the
 * caller then needs two mappings that have to agree.
 */
export type GitHubFailure =
  /** This deployment cannot talk to GitHub at all. */
  | 'config'
  /** The request could never work, whatever GitHub is doing. */
  | 'invalid'
  /** Something is already there, and it is not what this push would write. */
  | 'conflict'
  | 'rate-limited'
  /** 401/403: the grant really is gone, and reconnecting is the fix. */
  | 'access'
  | 'unreachable'
  | 'refused'
  | 'unreadable';

export type InstallationToken =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string; reason: GitHubFailure };

/**
 * An installation access token for this installation, or a reason it could
 * not be minted.
 *
 * The reasons are deliberately plain sentences rather than status codes.
 * "The App is no longer installed" is something a person can act on; a 404
 * from an endpoint they have never heard of is not, and the failure modes
 * table in docs/push-and-deploy-plan.md asks for the former by name.
 */
export async function mintInstallationToken(
  credentials: GitHubAppCredentials,
  installationId: number,
  /**
   * The one repository this token may touch, and nothing else.
   *
   * An installation can cover many repositories, and a token minted without
   * this covers all of them with every permission the installation holds.
   * The push destination is a single repository the user approved, so the
   * token is cut down to it: a token that leaks, or is reused by mistake,
   * can then do to that repository what the user already agreed to and can
   * do nothing at all to the rest.
   */
  scope: { owner: string; repo: string },
  doFetch: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<InstallationToken> {
  const jwt = await signAppJwt(credentials, now);
  if (!jwt) {
    return {
      ok: false,
      error: 'Vibld is not configured to talk to GitHub correctly.',
      reason: 'config',
    };
  }

  let response: Response;
  try {
    response = await doFetch(
      `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': GITHUB_USER_AGENT,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          repositories: [scope.repo],
          // The least this feature can work with. `contents` writes the
          // tree, the commit and the ref; `pull_requests` opens the pull
          // request. Nothing here reads issues, actions, secrets or
          // members, so nothing here asks for them.
          permissions: { contents: 'write', pull_requests: 'write' },
        }),
      },
    );
  } catch {
    return {
      ok: false,
      error: 'GitHub could not be reached.',
      reason: 'unreachable',
    };
  }

  // Read the body first: a secondary rate limit can come back as a 403 with
  // no useful headers at all, and only its message says so.
  let refusal: Record<string, unknown> = {};
  if (!response.ok) {
    try {
      refusal = ((await response.clone().json()) ?? {}) as Record<
        string,
        unknown
      >;
    } catch {
      refusal = {};
    }
  }
  const limited = rateLimitMessage(response.status, response.headers, refusal);
  if (limited) return { ok: false, error: limited, reason: 'rate-limited' };

  if (response.status === 404 || response.status === 401) {
    return {
      ok: false,
      error: 'Vibld no longer has access to that repository on GitHub.',
      reason: 'access',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `GitHub refused the request (${response.status}).`,
      reason: 'refused',
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      error: 'GitHub returned a reply Vibld could not read.',
      reason: 'unreadable',
    };
  }
  const record = (body ?? {}) as { token?: unknown; expires_at?: unknown };
  if (typeof record.token !== 'string' || record.token.length === 0) {
    return {
      ok: false,
      error: 'GitHub returned a reply Vibld could not read.',
      reason: 'unreadable',
    };
  }
  return {
    ok: true,
    token: record.token,
    expiresAt:
      typeof record.expires_at === 'string' ? record.expires_at : 'unknown',
  };
}
