/**
 * Principal resolution for the Worker's protected endpoints.
 *
 * docs/decisions.md L5: Cloudflare Access is off for app.vibld.com, and
 * Clerk is its gate. A self-hosted copy may use one of two others instead
 * (D123, `signInMode`): one owner's password, or Cloudflare Access in front
 * of the copy. Clerk's token is verified the same way access.ts verified Access tokens (ADR-0006: prove
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
import {
  accessToken,
  fetchAccessKeys,
  verifyAccessJwt,
} from './access-auth.ts';
import {
  OWNER_USER_ID,
  ownerIdentity,
  ownerSignedIn,
  sameOrigin,
  type OwnerEnv,
} from './owner-auth.ts';
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
  /**
   * An assistant acting for this account through `/mcp` (D182). It has no
   * verified email, so it can claim no invite; the invite gate admits it
   * only to an account that already redeemed one (`decideAccessFor`).
   */
  viaAssistant?: true;
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

export interface PrincipalEnv extends OwnerEnv {
  /** Clerk's Frontend API URL -- both the JWT issuer and the JWKS base. */
  CLERK_FRONTEND_API_URL?: string;
  /**
   * Which sign-in this deployment uses (docs/decisions.md D123): `clerk`,
   * `owner` (one password, VIBLD_OWNER_PASSWORD) or `access` (Cloudflare
   * Access). Unset means Clerk when CLERK_FRONTEND_API_URL is set, which is
   * how app.vibld.com and every deployment before D123 are configured.
   */
  VIBLD_AUTH?: string;
  /** Cloudflare Access: `<team>.cloudflareaccess.com`. */
  VIBLD_ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access: the application's audience (AUD) tag. */
  VIBLD_ACCESS_AUD?: string;
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

// The mode itself lives in sign-in-mode.ts, which imports nothing heavy:
// the deploy's access preflight reaches it before dependencies are
// installed (via platform-admins.ts).
import { signInMode, type SignInMode } from './sign-in-mode.ts';
export { signInMode, type SignInMode };

export function signInConfigured(env: PrincipalEnv): boolean {
  return signInMode(env) !== undefined;
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/**
 * Requests the Worker makes to itself on somebody's behalf, and whom for.
 *
 * The MCP endpoint (`mcp-server.ts`, docs/decisions.md D182) verifies an
 * OAuth access token, then serves each tool by calling the builder's own
 * routes as that person, so a build started from an assistant passes every
 * check one started in the builder does: the invite gate, the plan, the
 * ledger, the rate limits. Keyed on the Request object itself, which only
 * code inside this Worker can hold: nothing a caller sends can put an entry
 * here, so this is not a header or a token anybody can forge.
 *
 * Only the identity is taken from here. The ban and the deletion below are
 * still checked, on every request, as they are for a session.
 */
const actingFor = new WeakMap<Request, Principal>();

export function actAs(request: Request, principal: Principal): Request {
  actingFor.set(request, principal);
  return request;
}

/**
 * Keeps an internal request's identity across a copy the router makes of it
 * (`withClientAddress`), which is a new Request object.
 */
export function carryActing(from: Request, to: Request): Request {
  const principal = actingFor.get(from);
  if (principal && from !== to) actingFor.set(to, principal);
  return to;
}

export async function resolvePrincipal(
  request: Request,
  env: PrincipalEnv,
  options: ResolveOptions = {},
): Promise<PrincipalDenied | PrincipalGranted> {
  const acting = actingFor.get(request);
  if (acting) return checkedAccount(acting, env, options);

  const mode = signInMode(env);
  if (!mode) {
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

  const identified =
    mode === 'owner'
      ? await ownerPrincipal(request, env)
      : mode === 'access'
        ? await accessPrincipal(request, env)
        : await clerkPrincipal(request, env);
  if (identified.denied) return identified;
  return checkedAccount(identified.principal, env, options);
}

async function checkedAccount(
  principal: Principal,
  env: PrincipalEnv,
  options: ResolveOptions,
): Promise<PrincipalDenied | PrincipalGranted> {
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

function notSignedIn(): PrincipalDenied {
  return {
    denied: json({ error: 'Sign in required.', reason: 'not-signed-in' }, 401),
  };
}

// Deliberately opaque: a verification failure should not tell a caller
// which check failed. The reason is the same identifier the missing-token
// case carries, for that reason: one machine-readable value for "this
// request has no usable identity", not two that split it apart again.
function verificationFailed(): PrincipalDenied {
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

async function clerkPrincipal(
  request: Request,
  env: PrincipalEnv,
): Promise<PrincipalDenied | PrincipalGranted> {
  const token = bearerToken(request);
  if (!token) return notSignedIn();
  try {
    const issuer = env.CLERK_FRONTEND_API_URL!;
    const keys = await fetchClerkKeys(issuer);
    const claims = await verifyClerkJwt(token, { keys, issuer });
    // A session token, and nothing else Clerk signs with the same keys.
    // Once OAuth applications are on (D182), Clerk also signs OAuth access
    // tokens and ID tokens for other clients with this issuer and these
    // keys. Those carry no session id, and must not open the builder's
    // API: an assistant's token reaches it only through `/mcp`, which
    // checks it with Clerk and acts within what the tools allow.
    if (!claims.sid) return verificationFailed();
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
    return verificationFailed();
  }
}

/**
 * The owner, from the session cookie (owner-auth.ts). A cookie rides along
 * on any request the browser makes to this origin, so a request that
 * changes something must also say it came from the builder's own origin.
 */
async function ownerPrincipal(
  request: Request,
  env: PrincipalEnv,
): Promise<PrincipalDenied | PrincipalGranted> {
  if (!sameOrigin(request)) return verificationFailed();
  if (!(await ownerSignedIn(request, env))) return notSignedIn();
  const identity = ownerIdentity(env);
  return {
    denied: null,
    principal: {
      userId: OWNER_USER_ID,
      email: identity,
      emailVerified: true,
      policyIdentity: identity,
    },
  };
}

/**
 * The person Cloudflare Access let through, from the token it signed
 * (access-auth.ts). Access only issues one once the identity provider has
 * verified the address, so the address counts as verified. The same
 * origin rule as the owner's applies, since Access's own cookie also rides
 * along on any request to this origin.
 */
async function accessPrincipal(
  request: Request,
  env: PrincipalEnv,
): Promise<PrincipalDenied | PrincipalGranted> {
  if (!sameOrigin(request)) return verificationFailed();
  const token = accessToken(request);
  if (!token) return notSignedIn();
  try {
    const teamDomain = env.VIBLD_ACCESS_TEAM_DOMAIN!;
    const keys = await fetchAccessKeys(teamDomain);
    const claims = await verifyAccessJwt(token, {
      keys,
      teamDomain,
      audience: env.VIBLD_ACCESS_AUD!.trim(),
    });
    return {
      denied: null,
      principal: {
        userId: claims.sub,
        email: claims.email,
        emailVerified: true,
        policyIdentity: claims.email.toLowerCase(),
      },
    };
  } catch {
    return verificationFailed();
  }
}
