/**
 * Principal resolution for the Worker's protected endpoints.
 *
 * docs/decisions.md L5: Cloudflare Access is off. Clerk is the only gate now
 * -- verified the same way access.ts verified Access tokens (ADR-0006: prove
 * a raw URL cannot bypass access control, rather than trusting a header), but
 * against Clerk's JWKS instead of Access's, and via `Authorization: Bearer`
 * instead of a cookie: the browser's session cookie is scoped to Clerk's own
 * Frontend API domain, not this Worker's origin, so it never arrives on its
 * own the way Access's did.
 *
 * L3: the budget ledger and every ownership row key on the Clerk **user id**
 * (`sub`), never email -- see `Principal.userId`. `VIBLD_MODEL_POLICY` and
 * `VIBLD_PLATFORM_ADMINS` (L4) are the exception: both predate Clerk, are
 * human-edited by email address, and are not ownership rows, so they still
 * key on `Principal.policyIdentity` -- the verified email, or the shared
 * 'unknown' bucket Access used for the same reason when no email was
 * available: every such caller then competes for one ceiling instead of each
 * getting a fresh one.
 */

import { fetchClerkKeys, verifyClerkJwt } from './clerk-auth.ts';

export interface Principal {
  /** The Clerk user id, e.g. "user_2abc...". The ledger/ownership key (L3). */
  userId: string;
  /** Present only when the custom session claim is configured -- see README. */
  email?: string;
  /** True only when Clerk both carries and verifies the claim. */
  emailVerified?: boolean;
  /**
   * The identity `VIBLD_MODEL_POLICY` and `isPlatformAdmin` should be checked
   * against: the verified email, or 'unknown' when it is missing or
   * unverified. Never the raw, possibly-absent `email` field -- a policy or
   * admin check must not silently treat "no claim" as "no restriction".
   */
  policyIdentity: string;
}

export interface PrincipalDenied {
  denied: Response;
}
export interface PrincipalGranted {
  denied: null;
  principal: Principal;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface PrincipalEnv {
  /** Clerk's Frontend API URL -- both the JWT issuer and the JWKS base. */
  CLERK_FRONTEND_API_URL?: string;
}

/**
 * Generation is available only when Clerk is configured. Missing
 * configuration means unavailable, never "open" -- an unauthenticated
 * endpoint on a public URL lets anyone spend the account's model budget, so
 * the failure has to be closed.
 */
export function clerkConfigured(env: PrincipalEnv): boolean {
  return Boolean(env.CLERK_FRONTEND_API_URL);
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

export async function resolvePrincipal(
  request: Request,
  env: PrincipalEnv,
): Promise<PrincipalDenied | PrincipalGranted> {
  if (!clerkConfigured(env)) {
    return {
      denied: json(
        { error: 'Model generation is not configured for this deployment.' },
        403,
      ),
    };
  }

  const token = bearerToken(request);
  if (!token) {
    return { denied: json({ error: 'Sign in required.' }, 401) };
  }

  try {
    const issuer = env.CLERK_FRONTEND_API_URL!;
    const keys = await fetchClerkKeys(issuer);
    const claims = await verifyClerkJwt(token, { keys, issuer });
    const verifiedEmail =
      claims.email && claims.emailVerified === true ? claims.email : undefined;
    return {
      denied: null,
      principal: {
        userId: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified,
        policyIdentity: verifiedEmail ?? 'unknown',
      },
    };
  } catch {
    // Deliberately opaque: a verification failure should not tell a caller
    // which check failed.
    return { denied: json({ error: 'Sign-in verification failed.' }, 403) };
  }
}
