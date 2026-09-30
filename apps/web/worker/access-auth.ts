/**
 * Cloudflare Access as the sign-in for a self-hosted copy (docs/decisions.md
 * D123): a copy that needs no account anywhere but Cloudflare.
 *
 * Access stands in front of the builder at Cloudflare's edge and lets a
 * request through only once the person has signed in with whatever the
 * owner configured (a one-time PIN by email, GitHub, Google). It then adds
 * `Cf-Access-Jwt-Assertion`, a token it signs, to every request it passes.
 * The Worker verifies that token itself rather than trusting that a
 * request reached it through Access (ADR-0006): anything that reaches the
 * Worker's own `workers.dev` address, or a route Access does not cover,
 * carries no valid token and is refused.
 *
 * The team domain and the application's audience tag are both public
 * identifiers, not secrets: the domain is in every sign-in URL, and the tag
 * is in every token.
 */

import {
  checkTokenTimes,
  verifyRs256Signature,
  type Rs256Jwk,
} from './rs256.ts';

export interface AccessClaims {
  /** Access's stable id for the person. The ledger key, as Clerk's `sub` is. */
  sub: string;
  /**
   * The address the person signed in with. Access only issues a token once
   * the identity provider has verified it, so it counts as verified.
   */
  email: string;
}

export interface VerifyAccessOptions {
  keys: Rs256Jwk[];
  /** `<team>.cloudflareaccess.com`, with or without `https://`. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
  /** Seconds since epoch; injected so expiry is testable. */
  now?: number;
  leewaySeconds?: number;
}

export class AccessVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessVerificationError';
  }
}

/** `https://<team>.cloudflareaccess.com`, however the owner wrote it. */
export function accessIssuer(teamDomain: string): string {
  const host = teamDomain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return `https://${host}`;
}

export async function verifyAccessJwt(
  token: string,
  options: VerifyAccessOptions,
): Promise<AccessClaims> {
  const fail = (message: string) => new AccessVerificationError(message);
  const payload = await verifyRs256Signature(token, options.keys, fail);

  if (payload.iss !== accessIssuer(options.teamDomain)) {
    throw fail('Token was issued by a different Access team');
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(options.audience)) {
    // The same team signs tokens for every application it protects, so
    // without this a token for the owner's wiki would open the builder.
    throw fail('Token was issued for a different Access application');
  }
  // A service token is a credential, not a person: there is nobody to keep
  // a ledger for or to hold to an invite. It carries `common_name` (its
  // client id) and no email, and its `sub` may be empty or not (Codex review
  // of internal PR 337), so it is recognized by its shape rather than by `sub` alone.
  if (typeof payload.common_name === 'string' && payload.common_name !== '') {
    throw fail('Token is a service token, not a person');
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw fail('Token names no person');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw fail('Token has no subject');
  }
  checkTokenTimes(
    payload,
    options.now ?? Math.floor(Date.now() / 1000),
    options.leewaySeconds ?? 60,
    fail,
  );

  return { sub: payload.sub, email: payload.email };
}

/**
 * The token Access attached: its header on a request it proxied, or its
 * `CF_Authorization` cookie, which the browser sends along too. Either is
 * verified the same way, so taking the cookie grants nothing the header
 * would not.
 */
export function accessToken(request: Request): string | undefined {
  const header = request.headers.get('Cf-Access-Jwt-Assertion')?.trim();
  if (header) return header;
  return cookieValue(request, 'CF_Authorization');
}

export function cookieValue(
  request: Request,
  name: string,
): string | undefined {
  const cookies = request.headers.get('Cookie') ?? '';
  for (const part of cookies.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

const keyCache = new Map<string, { keys: Rs256Jwk[]; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

/** Access publishes its signing keys at `/cdn-cgi/access/certs`. */
export async function fetchAccessKeys(
  teamDomain: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<Rs256Jwk[]> {
  const issuer = accessIssuer(teamDomain);
  const cached = keyCache.get(issuer);
  if (cached && now - cached.fetchedAt < KEY_TTL_MS) return cached.keys;

  const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) {
    throw new AccessVerificationError(
      `Could not load Access signing keys (${response.status})`,
    );
  }
  const body = (await response.json()) as { keys?: Rs256Jwk[] };
  const keys = body.keys ?? [];
  if (keys.length === 0) {
    throw new AccessVerificationError('Access returned no signing keys');
  }
  keyCache.set(issuer, { keys, fetchedAt: now });
  return keys;
}

/** Test seam, as `resetClerkKeyCache` is. */
export function resetAccessKeyCache(): void {
  keyCache.clear();
}
