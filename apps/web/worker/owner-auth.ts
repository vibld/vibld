/**
 * One-owner sign-in for a self-hosted copy (docs/decisions.md D123): a
 * password the owner sets as a secret, and nothing else to sign up for.
 *
 * Signing in with it sets an HttpOnly cookie holding an expiry and an HMAC
 * of that expiry, keyed on the password itself, so changing the password
 * signs every browser out and there is no session table to keep. The
 * cookie is SameSite=Strict, and a request that changes something must
 * also come from the builder's own origin: under Docker a preview is
 * served from another port on the same host, which is the same *site* as
 * the builder, and SameSite alone would let a generated page post to it.
 *
 * One person, by design. Everyone who knows the password is the owner; a
 * copy that more than one person uses wants Cloudflare Access or Clerk.
 */

import { bytesToBase64Url } from './rs256.ts';
import { cookieValue } from './access-auth.ts';

export const OWNER_COOKIE = 'vibld_owner';

/**
 * A shorter password is refused as configuration, not merely warned
 * about: the sign-in route is on the open internet on most copies, and
 * the only thing between it and the owner's model key.
 */
export const MIN_OWNER_PASSWORD_CHARS = 12;

/** How long a sign-in lasts. */
export const OWNER_SESSION_SECONDS = 30 * 24 * 60 * 60;

/** The ledger key every owner request is accounted under. */
export const OWNER_USER_ID = 'owner';

/**
 * The identity the admin list and model policy see when no email is set.
 * Shaped like an address because the admin tools' fields are email inputs,
 * and a browser will not submit `owner` to them (Codex review of internal PR 337).
 */
export const DEFAULT_OWNER_IDENTITY = 'owner@localhost';

const MAX_PASSWORD_BODY_BYTES = 4096;

export interface OwnerEnv {
  /** Worker secret. At least MIN_OWNER_PASSWORD_CHARS characters. */
  VIBLD_OWNER_PASSWORD?: string;
  /**
   * Optional: the owner's email, for the few places an address is shown or
   * used (a GitHub connection, an invite the owner sends). The owner is an
   * admin whatever it says.
   */
  VIBLD_OWNER_EMAIL?: string;
}

export function ownerConfigured(env: OwnerEnv): boolean {
  return (env.VIBLD_OWNER_PASSWORD ?? '').length >= MIN_OWNER_PASSWORD_CHARS;
}

/** The owner's identity for the admin list and the model policy. */
export function ownerIdentity(env: OwnerEnv): string {
  const email = env.VIBLD_OWNER_EMAIL?.trim().toLowerCase();
  return email && email.length > 0 ? email : DEFAULT_OWNER_IDENTITY;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function sessionMessage(expires: number): Uint8Array {
  return new TextEncoder().encode(`vibld-owner-session:${expires}`);
}

/** `<expiry>.<mac>`, where the mac is keyed on the password. */
export async function signOwnerSession(
  password: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const expires = now + OWNER_SESSION_SECONDS;
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(password),
    sessionMessage(expires) as unknown as ArrayBuffer,
  );
  return `${expires}.${bytesToBase64Url(new Uint8Array(mac))}`;
}

function base64UrlBytes(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Whether a session cookie is one this password signed and still current. */
export async function verifyOwnerSession(
  token: string | undefined,
  password: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const [expiresText, macText, ...rest] = token.split('.');
  if (rest.length > 0 || !expiresText || !macText) return false;
  if (!/^\d{1,12}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  if (expires <= now) return false;
  const mac = base64UrlBytes(macText);
  if (!mac) return false;
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(password),
    mac as unknown as ArrayBuffer,
    sessionMessage(expires) as unknown as ArrayBuffer,
  );
}

/**
 * Whether `given` is the password, compared in constant time: both are
 * MACed under a key made for this one comparison, and the platform's
 * verify compares the MACs.
 */
export async function passwordMatches(
  given: string,
  password: string,
): Promise<boolean> {
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(given) as unknown as ArrayBuffer,
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    mac,
    new TextEncoder().encode(password) as unknown as ArrayBuffer,
  );
}

/**
 * Whether a request that changes something came from the builder's own
 * origin. Browsers send `Origin` on every POST, PATCH and DELETE, same
 * origin included, so its absence on one is itself a refusal. Only the host
 * is compared: behind a proxy that ends TLS, the Worker may see `http:`
 * where the browser used `https:`.
 */
export function sameOrigin(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Whether this request carries a current owner session. */
export async function ownerSignedIn(
  request: Request,
  env: OwnerEnv,
): Promise<boolean> {
  if (!ownerConfigured(env)) return false;
  return verifyOwnerSession(
    cookieValue(request, OWNER_COOKIE),
    env.VIBLD_OWNER_PASSWORD!,
  );
}

function sessionCookie(
  request: Request,
  value: string,
  maxAge: number,
): string {
  // Secure wherever the browser will honor it: always over https, and not
  // on plain http, where it would drop the cookie (a copy on a LAN address
  // under Docker). localhost is a secure context either way.
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${OWNER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/**
 * The body as text, or null past `limit` bytes. Read a chunk at a time and
 * abandoned once over, so a large or endless body on this public route is
 * never held whole (Codex review of internal PR 337); a declared length over the limit
 * is refused before reading anything.
 */
export async function boundedText(
  request: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export interface OwnerSessionDeps {
  /** Counts sign-in attempts per address; absent means not counted. */
  limit?: (key: string) => Promise<boolean>;
  now?: number;
}

/**
 * `/api/owner/session`: GET says whether this browser is signed in, POST
 * signs in with `{ password }`, DELETE signs out.
 */
export async function handleOwnerSession(
  request: Request,
  env: OwnerEnv,
  deps: OwnerSessionDeps = {},
): Promise<Response> {
  if (!ownerConfigured(env)) {
    return json(
      { error: 'Owner sign-in is not configured for this deployment.' },
      404,
    );
  }
  if (!sameOrigin(request)) {
    return json({ error: 'Cross-origin request refused.' }, 403);
  }

  if (request.method === 'GET') {
    return json({ signedIn: await ownerSignedIn(request, env) }, 200, {
      'cache-control': 'no-store',
    });
  }

  if (request.method === 'DELETE') {
    return json({ signedIn: false }, 200, {
      'set-cookie': sessionCookie(request, '', 0),
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, {
      allow: 'GET, POST, DELETE',
    });
  }

  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (deps.limit && !(await deps.limit(`owner-sign-in:${address}`))) {
    return json(
      { error: 'Too many sign-in attempts. Wait a minute and try again.' },
      429,
      { 'retry-after': '60' },
    );
  }

  const text = await boundedText(request, MAX_PASSWORD_BODY_BYTES);
  if (text === null) return json({ error: 'Request too large.' }, 413);
  let given: unknown;
  try {
    given = (JSON.parse(text) as { password?: unknown }).password;
  } catch {
    given = undefined;
  }
  if (typeof given !== 'string' || given.length === 0) {
    return json({ error: 'Enter the password.' }, 400);
  }
  if (!(await passwordMatches(given, env.VIBLD_OWNER_PASSWORD!))) {
    return json({ error: 'That password is not right.' }, 401);
  }

  const token = await signOwnerSession(env.VIBLD_OWNER_PASSWORD!, deps.now);
  return json({ signedIn: true }, 200, {
    'set-cookie': sessionCookie(request, token, OWNER_SESSION_SECONDS),
  });
}
