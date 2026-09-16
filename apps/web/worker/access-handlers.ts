/**
 * The access gate as the router applies it, and the tools for running the
 * invite list.
 */
import { AccessStore } from './access-store.ts';
import { admitToClerk } from './clerk-waitlist.ts';
import type { ClerkAdmission } from './clerk-waitlist.ts';
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
  /**
   * Clerk's Backend API key, for approving an invited person in Clerk as
   * well as here. Optional on purpose: a deployment without it still issues
   * invites, and says that Clerk was not asked.
   */
  CLERK_SECRET_KEY?: string;
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
 * An invited decision is the act of taking the invite, not a read followed
 * by a note that it was taken. `AccessStore.claimInvite` says why.
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

  // Answered before the invite list is touched, because neither answer
  // depends on it. `decideAccess` puts admin and open ahead of invited, and
  // that order was only true of the decision, not of the work: the lookup
  // ran first regardless, so a missing table or an unavailable D1 threw and
  // even a platform admin got an error instead of the admission the order
  // promises. The admin path is the one that makes a broken deployment
  // recoverable, so it must not depend on the database being well.
  if (isAdmin) return { allowed: true, because: 'admin' };
  if (mode === 'open') return { allowed: true, because: 'open' };

  // Without D1 there is no list to be on. In invite mode that has to refuse
  // rather than open: a deployment missing its database must not become an
  // open one, which is the same fail-closed rule every other gate here
  // follows.
  const store = env.DB ? new AccessStore(env.DB) : undefined;

  return decideAccess({
    mode,
    isAdmin,
    identity: principal.policyIdentity,
    // Taking the invite is the admission, so a failure here refuses rather
    // than being swallowed. It used to be bookkeeping recorded after the
    // decision, on the reasoning that losing a timestamp must not fail a
    // request somebody is allowed to make. That was the bug: if the write
    // is not what admits them, two accounts can both be admitted and only
    // one binding lands.
    claimInvite: () =>
      store
        ? store.claimInvite(principal.policyIdentity, principal.userId)
        : Promise.resolve(false),
  });
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
  return json(await new AccessStore(env.DB).list());
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

  // Then Clerk, which is the other half of letting somebody in: a row here
  // gets them past the access gate, and Clerk in Waitlist mode is what
  // decides whether they can create a session at all.
  //
  // After the row and never before it, and its outcome is carried rather
  // than thrown. The invite is this deployment's own record and must not
  // depend on Clerk answering: a deployment with no CLERK_SECRET_KEY is a
  // supported shape, and an operator with a good admin list has to be able
  // to invite somebody whatever Clerk is doing. So the response says what
  // happened on each side and the panel reports both.
  const clerk: ClerkAdmission =
    created || reinstated
      ? await admitToClerk(env, email)
      : // Nothing changed here, so nothing is claimed about Clerk either.
        // Saying "already invited, and approved" would be a second read
        // nobody asked for and a second thing that could be wrong.
        //
        // Said rather than omitted. A missing field and a deliberate silence
        // are different answers, and the browser has to be able to tell
        // them apart: a response that does not mention Clerk at all is one
        // this deployment cannot vouch for, and the panel warns about that
        // rather than saying nothing.
        { admitted: false, reason: 'not-asked' };

  return json({ email, created, reinstated, clerk });
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
