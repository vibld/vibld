import {
  checkTokenTimes,
  verifyRs256Signature,
  type Rs256Jwk,
} from './rs256.ts';

/**
 * Clerk session token verification.
 *
 * The same shape as access-auth.ts's Cloudflare Access verification, and for the
 * same reason: ADR-0006 requires proving a raw URL cannot bypass access
 * control, so the Worker verifies the token itself rather than trusting
 * that some earlier layer already checked it.
 *
 * Clerk's session token has no fixed "audience" claim naming an application
 * the way Access's does. Its equivalent is `azp` (authorized party): the
 * origin the token's request came from. Everything else -- RS256 pinning,
 * JWKS caching, the expiry/not-before checks -- is shared with it (rs256.ts),
 * because it is the same problem with a different token shape.
 */

export type ClerkJwk = Rs256Jwk;

export interface ClerkClaims {
  /** The user id, e.g. "user_2abc...". This is the ledger key -- see L3. */
  sub: string;
  /** The session id. Not currently used, kept for when session revocation matters. */
  sid?: string;
  iss: string;
  azp?: string[];
  exp: number;
  iat: number;
  /**
   * Present only if the Clerk instance's session token has been customized
   * to include it -- see the README for the exact dashboard configuration.
   * Absent, not empty-string, when the customization is missing: a caller
   * must not be able to mistake "not configured" for "no email".
   */
  email?: string;
  /**
   * True only when the custom claim both exists and says so. An admin
   * check must never treat "the claim is missing" as "verified" -- see
   * `isPlatformAdmin`.
   */
  emailVerified?: boolean;
}

export interface VerifyClerkOptions {
  keys: ClerkJwk[];
  /** The Clerk instance's Frontend API URL, e.g. "https://your-app.clerk.accounts.dev". */
  issuer: string;
  /**
   * The origin(s) a legitimate request's token may declare via `azp`. When
   * omitted, `azp` is not checked -- Clerk itself does not always set it
   * (its docs note this is normal for some non-browser flows), so an empty
   * list here means "not enforced" rather than "reject everything".
   */
  allowedOrigins?: string[];
  /** Injected so expiry is testable without waiting. Seconds since epoch. */
  now?: number;
  /** Tolerance for clock skew, in seconds. */
  leewaySeconds?: number;
}

export class ClerkVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClerkVerificationError';
  }
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
 * Verify a Clerk session token and return its claims.
 *
 * Every failure throws rather than returning a falsy value, so a caller
 * cannot accidentally treat an unverified request as authorized.
 */
export async function verifyClerkJwt(
  token: string,
  options: VerifyClerkOptions,
): Promise<ClerkClaims> {
  const fail = (message: string) => new ClerkVerificationError(message);
  const payload = await verifyRs256Signature(token, options.keys, fail);

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new ClerkVerificationError('Token has no subject');
  }
  if (payload.iss !== options.issuer) {
    throw new ClerkVerificationError(
      'Token was issued by a different Clerk instance',
    );
  }

  const azp = asStringArray(payload.azp);
  if (
    options.allowedOrigins &&
    options.allowedOrigins.length > 0 &&
    azp.length > 0 &&
    !azp.some((origin) => options.allowedOrigins!.includes(origin))
  ) {
    // Only enforced when the token actually declares an azp -- see the
    // option's own doc comment on why an absent azp is not itself a
    // rejection.
    throw new ClerkVerificationError('Token was issued for a different origin');
  }

  checkTokenTimes(
    payload,
    options.now ?? Math.floor(Date.now() / 1000),
    options.leewaySeconds ?? 60,
    fail,
  );

  return {
    sub: payload.sub,
    sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    iss: payload.iss as string,
    azp: azp.length > 0 ? azp : undefined,
    // Both checked by checkTokenTimes above.
    exp: payload.exp as number,
    iat: payload.iat as number,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified:
      typeof payload.email_verified === 'boolean'
        ? payload.email_verified
        : undefined,
  };
}

/** Cache the signing keys per Clerk instance; they rotate rarely. */
const keyCache = new Map<string, { keys: ClerkJwk[]; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

/**
 * Fetches the JWKS at `<issuer>/.well-known/jwks.json` -- the standard OIDC
 * discovery path, and how Clerk publishes its signing keys for manual
 * verification (the alternative, `https://api.clerk.com/v1/jwks`, needs the
 * secret key as a bearer credential per request; this needs nothing, which
 * is why it is the one worth caching in a Worker).
 */
export async function fetchClerkKeys(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<ClerkJwk[]> {
  const cached = keyCache.get(issuer);
  if (cached && now - cached.fetchedAt < KEY_TTL_MS) {
    return cached.keys;
  }

  const response = await fetchImpl(
    new URL('/.well-known/jwks.json', issuer).toString(),
  );
  if (!response.ok) {
    throw new ClerkVerificationError(
      `Could not load Clerk signing keys (${response.status})`,
    );
  }

  const body = (await response.json()) as { keys?: ClerkJwk[] };
  const keys = body.keys ?? [];
  if (keys.length === 0) {
    throw new ClerkVerificationError('Clerk returned no signing keys');
  }

  keyCache.set(issuer, { keys, fetchedAt: now });
  return keys;
}

/** Test seam: drop cached keys so a suite does not leak state between cases. */
export function resetClerkKeyCache(): void {
  keyCache.clear();
}
