/**
 * Cloudflare Access token verification.
 *
 * Access checks requests at the edge, but the Worker verifies the assertion
 * again rather than trusting a header. ADR-0006 requires proving that a raw
 * URL cannot bypass access control, and a header is trivially forgeable by
 * anyone who reaches the origin directly. Verification is what makes the
 * check real; the edge check is defence in depth, not the other way round.
 */

export interface AccessJwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

export interface AccessClaims {
  aud: string[];
  email?: string;
  iss: string;
  exp: number;
  iat: number;
}

export interface VerifyOptions {
  keys: AccessJwk[];
  audience: string;
  issuer: string;
  /** Injected so expiry is testable without waiting. Seconds since epoch. */
  now?: number;
  /** Tolerance for clock skew, in seconds. */
  leewaySeconds?: number;
}

export class AccessVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessVerificationError';
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return value as string[];
  }
  return [];
}

/**
 * Verify a Cloudflare Access JWT and return its claims.
 *
 * Every failure throws rather than returning a falsy value, so a caller
 * cannot accidentally treat an unverified request as authorized.
 */
export async function verifyAccessJwt(
  token: string,
  options: VerifyOptions,
): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AccessVerificationError('Malformed token');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];

  let header: { alg?: unknown; kid?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = decodeJsonSegment(encodedHeader) as typeof header;
    payload = decodeJsonSegment(encodedPayload) as Record<string, unknown>;
  } catch {
    throw new AccessVerificationError('Token segments are not valid JSON');
  }

  // Pin the algorithm. Accepting whatever the token declares is how "alg: none"
  // and HMAC-for-RSA confusion attacks work.
  if (header.alg !== 'RS256') {
    throw new AccessVerificationError(
      `Unsupported signing algorithm: ${String(header.alg)}`,
    );
  }
  if (typeof header.kid !== 'string') {
    throw new AccessVerificationError('Token has no key id');
  }

  const jwk = options.keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new AccessVerificationError('Token was signed by an unknown key');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBytes = base64UrlToBytes(encodedSignature);
  const signature = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength,
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    signed as unknown as ArrayBuffer,
  );
  if (!valid) {
    throw new AccessVerificationError('Token signature is invalid');
  }

  const audience = asStringArray(payload.aud);
  if (!audience.includes(options.audience)) {
    throw new AccessVerificationError(
      'Token was issued for a different application',
    );
  }
  if (payload.iss !== options.issuer) {
    throw new AccessVerificationError('Token was issued by a different team');
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const leeway = options.leewaySeconds ?? 60;
  if (typeof payload.exp !== 'number' || payload.exp + leeway < now) {
    throw new AccessVerificationError('Token has expired');
  }
  if (typeof payload.iat === 'number' && payload.iat - leeway > now) {
    throw new AccessVerificationError('Token is not valid yet');
  }

  return {
    aud: audience,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    iss: payload.iss,
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
  };
}

/** Cache the signing keys per team domain; they rotate rarely. */
const keyCache = new Map<string, { keys: AccessJwk[]; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

export async function fetchAccessKeys(
  teamDomain: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<AccessJwk[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && now - cached.fetchedAt < KEY_TTL_MS) {
    return cached.keys;
  }

  const response = await fetchImpl(
    `https://${teamDomain}/cdn-cgi/access/certs`,
  );
  if (!response.ok) {
    throw new AccessVerificationError(
      `Could not load Access signing keys (${response.status})`,
    );
  }

  const body = (await response.json()) as { keys?: AccessJwk[] };
  const keys = body.keys ?? [];
  if (keys.length === 0) {
    throw new AccessVerificationError('Access returned no signing keys');
  }

  keyCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

/** Test seam: drop cached keys so a suite does not leak state between cases. */
export function resetAccessKeyCache(): void {
  keyCache.clear();
}
