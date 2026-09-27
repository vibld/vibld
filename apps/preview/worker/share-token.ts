/**
 * The "signed" half of L10 ("Preview sharing is a signed, revocable,
 * time-limited URL"): an HMAC-SHA256 over a share id and its expiry, so a
 * share URL cannot be forged or tampered with in transit -- only minted by
 * this Worker, which alone holds `PREVIEW_SHARE_SECRET`.
 *
 * Pure and storage-free, the same split `fleet.ts` makes from
 * `preview-fleet.ts`: this is the part that is testable without a Workers
 * runtime. "Revocable" is deliberately not this file's job -- a
 * syntactically-valid signature over an id nobody has revoked yet still
 * verifies here; `PreviewSandbox`'s own `shares` table (`preview-sandbox.ts`)
 * is the stateful half that actually makes revocation take effect, checked
 * separately on every proxied request.
 */

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/** A random, unguessable share id -- 16 bytes, the same size class `generatePortToken` in `@cloudflare/sandbox` uses for its own preview tokens. */
export function randomShareId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/** Sign `shareId` and its `expiresAt` together, so neither can be altered without invalidating the signature. */
export async function signShare(
  secret: string,
  shareId: string,
  expiresAt: number,
): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${shareId}.${expiresAt}`),
  );
  return toBase64Url(signature);
}

/**
 * Verified with `crypto.subtle.verify`, not a `===` string compare --
 * comparing a secret-derived value with `===` leaks timing information a
 * constant-time comparison does not.
 */
export async function verifyShare(
  secret: string,
  shareId: string,
  expiresAt: number,
  signature: string,
): Promise<boolean> {
  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(`${shareId}.${expiresAt}`),
  );
}
