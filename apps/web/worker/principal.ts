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
import { AccountDeletionStore } from './account-deletion-store.ts';
import { AdminStore } from './admin-store.ts';
import type { RunRefusal } from '@vibld/core';

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
  /**
   * Where a deletion request is recorded (`0031_account_deletions.sql`).
   * Absent means no request can have been made, so there is nothing to
   * refuse on.
   */
  DB?: D1Database;
}

export interface ResolveOptions {
  /**
   * Answer for an account that has asked to be deleted.
   *
   * Only the deletion routes pass it: asking again (which is how an
   * unfinished step is retried), reading where the request stands, and
   * keeping the account. Everything else refuses such an account, which is
   * what L32's deletion means from the moment it is asked for.
   */
  allowPendingDeletion?: boolean;
}

/**
 * The refusal every other route gives an account that asked to be deleted.
 *
 * 403 rather than 401: the identity is fine, and signing in again is the
 * way to reach the one screen that can undo it. The date is carried so
 * that screen can say when the purge happens without a second request.
 */
export function deletionScheduled(purgeAfter: string): Response {
  return json(
    {
      error:
        'This account is scheduled for deletion. Sign in and choose to keep it before the date shown, or it will be deleted.',
      reason: 'deletion-scheduled' satisfies RunRefusal,
      purgeAfter,
    },
    403,
  );
}

/**
 * The refusal every route gives an account a platform admin banned
 * (docs/decisions.md D73).
 *
 * 403 for the reason `deletionScheduled` gives, and without the reason for
 * the ban: that was written for the admins who read the audit log, not for
 * the person refused.
 */
export const BANNED_MESSAGE =
  'This account has been banned from vibld. If you think this is a mistake, email support@vibld.com.';

export function accountBanned(): Response {
  return json(
    {
      error: BANNED_MESSAGE,
      reason: 'account-banned' satisfies RunRefusal,
    },
    403,
  );
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
  options: ResolveOptions = {},
): Promise<PrincipalDenied | PrincipalGranted> {
  if (!clerkConfigured(env)) {
    return {
      denied: json(
        {
          error: 'Model generation is not configured for this deployment.',
          reason: 'not-configured' satisfies RunRefusal,
        },
        403,
      ),
    };
  }

  const token = bearerToken(request);
  if (!token) {
    return {
      denied: json(
        { error: 'Sign in required.', reason: 'not-signed-in' },
        401,
      ),
    };
  }

  let principal: Principal;
  try {
    const issuer = env.CLERK_FRONTEND_API_URL!;
    const keys = await fetchClerkKeys(issuer);
    const claims = await verifyClerkJwt(token, { keys, issuer });
    const verifiedEmail =
      claims.email && claims.emailVerified === true ? claims.email : undefined;
    principal = {
      userId: claims.sub,
      email: claims.email,
      emailVerified: claims.emailVerified,
      policyIdentity: verifiedEmail ?? 'unknown',
    };
  } catch {
    // Deliberately opaque: a verification failure should not tell a caller
    // which check failed. The reason is the same identifier the missing-token
    // case carries, for that reason: one machine-readable value for "this
    // request has no usable identity", not two that split it apart again.
    return {
      denied: json(
        {
          error: 'Sign-in verification failed.',
          reason: 'not-signed-in' satisfies RunRefusal,
        },
        403,
      ),
    };
  }

  // Here rather than in each route, so that no route can be the one that
  // forgets: every authenticated request comes through this function, and
  // the promise made to somebody who asked to be deleted is that nothing
  // more happens on their account.
  //
  // Fails closed. A deletion that cannot be checked is refused rather than
  // assumed absent, because the other answer lets an account that asked to
  // leave carry on while D1 is unwell, and the routes that matter most need
  // D1 to do anything anyway.
  //
  // A ban (D73) is checked here for the same reason, and ahead of the
  // deletion: a Clerk ban ends the sessions it knows of, but a token already
  // issued stays valid until it expires, and this is what refuses it. No
  // route is exempt, the deletion routes included, because a banned account
  // is refused everything. The two reads are made together, so the ban
  // adds a query to every request but not a round trip's wait.
  if (env.DB) {
    let pending: { purgeAfter: string } | null;
    let banned: boolean;
    try {
      [pending, banned] = await Promise.all([
        options.allowPendingDeletion
          ? null
          : new AccountDeletionStore(env.DB).pending(principal.userId),
        new AdminStore(env.DB).isBanned(principal.userId),
      ]);
    } catch (error) {
      console.error('could not check this account', error);
      return {
        denied: json(
          { error: 'Could not check this account right now. Try again.' },
          503,
        ),
      };
    }
    if (banned) return { denied: accountBanned() };
    if (pending) return { denied: deletionScheduled(pending.purgeAfter) };
  }

  return { denied: null, principal };
}
