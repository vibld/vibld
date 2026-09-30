/**
 * The signature half of verifying an RS256 JSON Web Token, shared by the
 * two issuers a deployment can trust for sign-in: Clerk (clerk-auth.ts) and
 * Cloudflare Access (access-auth.ts, D123). Each checks its own claims
 * afterwards; what they have in common is that the token must be three
 * segments, declare RS256 and nothing else, name a key the issuer
 * publishes, and carry a signature that key verifies.
 */

export interface Rs256Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/**
 * The token's payload, once its signature is proven. Every failure throws
 * `fail(message)`, so a caller cannot mistake an unverified token for a
 * verified one.
 */
export async function verifyRs256Signature(
  token: string,
  keys: Rs256Jwk[],
  fail: (message: string) => Error,
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw fail('Malformed token');
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
    throw fail('Token segments are not valid JSON');
  }
  if (!payload || typeof payload !== 'object') {
    throw fail('Token payload is not an object');
  }

  // Pin the algorithm. Accepting whatever the token declares is how "alg: none"
  // and HMAC-for-RSA confusion attacks work.
  if (header.alg !== 'RS256') {
    throw fail(`Unsupported signing algorithm: ${String(header.alg)}`);
  }
  if (typeof header.kid !== 'string') throw fail('Token has no key id');

  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw fail('Token was signed by an unknown key');

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
  if (!valid) throw fail('Token signature is invalid');
  return payload;
}

/** Expiry, issued-at and not-before, with the same leeway both issuers get. */
export function checkTokenTimes(
  payload: Record<string, unknown>,
  now: number,
  leeway: number,
  fail: (message: string) => Error,
): void {
  if (typeof payload.exp !== 'number' || payload.exp + leeway < now) {
    throw fail('Token has expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat - leeway > now) {
    throw fail('Token is not valid yet');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - leeway > now) {
    throw fail('Token is not valid yet');
  }
}
