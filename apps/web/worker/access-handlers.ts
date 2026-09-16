/**
 * The access gate as the router applies it, and the tools for running the
 * invite list.
 */
import { AccessStore } from './access-store.ts';
import {
  REFUSED_MESSAGE,
  decideAccess,
  normaliseEmail,
  parseAccessMode,
} from './access.ts';
import type { AccessDecision } from './access.ts';
import { isPlatformAdmin, parsePlatformAdmins } from './platform-admins.ts';
import type { Principal } from './principal.ts';

export interface AccessEnv {
  DB?: D1Database;
  /** "open" opens the deployment. Anything else, including unset, is invite-only. */
  VIBLD_ACCESS_MODE?: string;
  VIBLD_PLATFORM_ADMINS?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Whether this principal may use the product, and the bookkeeping that goes
 * with finding out.
 *
 * A successful invited decision marks the invite redeemed. That write is
 * bookkeeping and must never fail a request somebody is allowed to make, so
 * it is swallowed: losing the "when did they first sign in" timestamp is a
 * worse-reporting problem, while failing the request is an outage for
 * somebody who was invited.
 */
export async function decideAccessFor(
  env: AccessEnv,
  principal: Principal,
): Promise<AccessDecision> {
  const mode = parseAccessMode(env.VIBLD_ACCESS_MODE);
  const isAdmin = isPlatformAdmin(
    { email: principal.email, emailVerified: principal.emailVerified },
    parsePlatformAdmins(env.VIBLD_PLATFORM_ADMINS),
  );

  // Without D1 there is no list to be on. In invite mode that has to refuse
  // rather than open: a deployment missing its database must not become an
  // open one, which is the same fail-closed rule every other gate here
  // follows. An admin still gets in, which is what makes it recoverable.
  const store = env.DB ? new AccessStore(env.DB) : undefined;
  const invited = store
    ? await store.isInvited(principal.policyIdentity)
    : false;

  const decision = decideAccess({
    mode,
    isAdmin,
    identity: principal.policyIdentity,
    invited,
  });

  if (decision.allowed && decision.because === 'invited' && store) {
    try {
      await store.redeem(principal.policyIdentity, principal.userId);
    } catch (error) {
      console.error('could not record an invite redemption', error);
    }
  }

  return decision;
}

/** The refusal a gated route returns. 403, and the same words either way. */
export function refusal(): Response {
  return json({ error: REFUSED_MESSAGE, accessRefused: true }, 403);
}

/**
 * What the shell asks so it can render the right screen.
 *
 * It reports the mode and whether this caller is in, and deliberately not
 * *why* they are out: "your email is unverified" and "you are not on the
 * list" are different facts, and distinguishing them here would let anybody
 * test whether an address has been invited.
 */
export async function handleAccessStatus(
  request: Request,
  env: AccessEnv,
  principal: Principal,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const decision = await decideAccessFor(env, principal);
  return json({
    allowed: decision.allowed,
    mode: parseAccessMode(env.VIBLD_ACCESS_MODE),
    message: decision.allowed ? null : REFUSED_MESSAGE,
  });
}

/** The invite list, for an operator. Assumes the admin check already ran. */
export async function handleInviteList(
  request: Request,
  env: AccessEnv,
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!env.DB) return json({ error: 'Invites are not configured here.' }, 503);
  return json({ invites: await new AccessStore(env.DB).list() });
}

async function emailFromBody(request: Request): Promise<string | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return normaliseEmail(
    typeof body === 'object' && body !== null
      ? (body as { email?: unknown }).email
      : undefined,
  );
}

/** Issue an invite. Assumes the admin check already ran. */
export async function handleInvite(
  request: Request,
  env: AccessEnv,
  adminEmail: string,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.DB) return json({ error: 'Invites are not configured here.' }, 503);

  const email = await emailFromBody(request);
  if (email === null) {
    return json({ error: 'That does not look like an email address.' }, 400);
  }

  const store = new AccessStore(env.DB);
  const created = await store.invite(email, adminEmail);
  // Re-inviting a revoked address is a deliberate act rather than a silent
  // one, so it is reported as its own outcome instead of looking like a
  // fresh invite that did nothing.
  const reinstated = created ? false : await store.reinstate(email);
  return json({ email, created, reinstated });
}

/** Withdraw an invite. Assumes the admin check already ran. */
export async function handleInviteRevoke(
  request: Request,
  env: AccessEnv,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.DB) return json({ error: 'Invites are not configured here.' }, 503);

  const email = await emailFromBody(request);
  if (email === null) {
    return json({ error: 'That does not look like an email address.' }, 400);
  }
  const revoked = await new AccessStore(env.DB).revoke(
    email,
    new Date().toISOString(),
  );
  return json({ email, revoked });
}
