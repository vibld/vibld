/**
 * Resolve a Clerk user id from an email address, for the admin credit tool
 * (docs/decisions.md L4) -- the ledger and every ownership row key on the
 * Clerk user id (L3), but an admin looking up a user to help almost always
 * has their email, not their id.
 *
 * Raw `fetch` against Clerk's Backend API rather than `@clerk/backend`: this
 * Worker already hand-rolls Clerk session verification for the same reason
 * (`clerk-auth.ts`'s own comment) -- one GET call does not earn a new
 * dependency in a Worker that otherwise carries none for Clerk at all.
 */

export interface ClerkLookupEnv {
  /**
   * Worker secret, never sent to the browser. Distinct from
   * `CLERK_FRONTEND_API_URL` (a public identifier used only to verify
   * session tokens) -- this one authenticates *to* Clerk's own API.
   */
  CLERK_SECRET_KEY?: string;
}

export function clerkLookupConfigured(env: ClerkLookupEnv): boolean {
  return Boolean(env.CLERK_SECRET_KEY);
}

export type ClerkLookupResult =
  { ok: true; userId: string } | { ok: false; error: string };

interface ClerkUser {
  id?: unknown;
}

export async function findClerkUserIdByEmail(
  env: ClerkLookupEnv,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkLookupResult> {
  if (!clerkLookupConfigured(env)) {
    return {
      ok: false,
      error: 'User lookup is not configured on this deployment.',
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}`,
      {
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return { ok: false, error: 'Could not reach Clerk to look up that user.' };
  }

  if (!response.ok) {
    return { ok: false, error: `Clerk lookup failed (${response.status}).` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Clerk returned an unreadable response.' };
  }

  if (!Array.isArray(body) || body.length === 0) {
    return { ok: false, error: `No user found for ${email}.` };
  }

  // Email/password and most social sign-in flows keep addresses unique per
  // Clerk instance; if that were ever not true, the first match is at least
  // a defensible default rather than an error the admin cannot act on.
  const first = (body as ClerkUser[])[0];
  if (typeof first?.id !== 'string') {
    return { ok: false, error: 'Clerk returned an unexpected response shape.' };
  }
  return { ok: true, userId: first.id };
}

/**
 * When a Clerk account was created, as epoch milliseconds, or null when that
 * cannot be established.
 *
 * Null is deliberately not "assume it is old" or "assume it is new": the
 * caller decides, and `signup-credit.ts` treats it as not-eligible, because
 * an account whose age is unknown is not a new account.
 *
 * `created_at` is documented as epoch milliseconds on Clerk's Backend API.
 * Not verified against a live call from this environment: there is no Clerk
 * secret here.
 */
export async function fetchClerkUserCreatedAt(
  env: ClerkLookupEnv,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!clerkLookupConfigured(env)) return null;

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const createdAt = (body as { created_at?: unknown }).created_at;
  return typeof createdAt === 'number' && Number.isFinite(createdAt)
    ? createdAt
    : null;
}

/** What a ban or an unban at Clerk came to. */
export type ClerkBanResult = { ok: true } | { ok: false; error: string };

/**
 * Ban or unban a user at Clerk (Backend API `POST /v1/users/{id}/ban` and
 * `/unban`), with the same secret the lookup above uses (docs/decisions.md
 * D73).
 *
 * Clerk documents a ban as revoking every session the user has and refusing
 * any new sign-in, which is the half of a ban this Worker cannot do on its
 * own. The other half, refusing a token already issued, is `principal.ts`
 * reading `user_bans`. A 404 is reported rather than taken as success: a
 * user Clerk does not have cannot sign in anyway, but the admin should know
 * the id did not match.
 *
 * Not verified against a live call from this environment: there is no
 * Clerk secret here. The paths are the ones Clerk documents, and the
 * method and bearer header are the ones this file already uses.
 */
export async function setClerkBan(
  env: ClerkLookupEnv,
  userId: string,
  banned: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkBanResult> {
  const verb = banned ? 'ban' : 'unban';
  if (!clerkLookupConfigured(env)) {
    return {
      ok: false,
      error: `CLERK_SECRET_KEY is not set, so Clerk was not asked to ${verb} the user.`,
    };
  }
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/${verb}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return { ok: false, error: `Could not reach Clerk to ${verb} the user.` };
  }
  if (response.ok) return { ok: true };
  return {
    ok: false,
    error: `Clerk refused to ${verb} the user (${response.status}).`,
  };
}

/** The parts of a Clerk user the admin user page shows. */
export interface ClerkUserSummary {
  email: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  /** Clerk's own ban flag, which can disagree with ours if a call failed. */
  banned: boolean | null;
}

/**
 * Read one Clerk user by id, for the admin user page and for checking the
 * address an admin typed to confirm a deletion. Null when that cannot be
 * established, which the caller reports rather than guesses at.
 *
 * The primary address is the one named by `primary_email_address_id`; an
 * account with no primary falls back to its first address.
 */
export async function fetchClerkUser(
  env: ClerkLookupEnv,
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkUserSummary | null> {
  if (!clerkLookupConfigured(env)) return null;
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
      {
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const user = body as {
    primary_email_address_id?: unknown;
    email_addresses?: unknown;
    created_at?: unknown;
    last_sign_in_at?: unknown;
    banned?: unknown;
  };
  const addresses = Array.isArray(user.email_addresses)
    ? (user.email_addresses as { id?: unknown; email_address?: unknown }[])
    : [];
  const primary =
    addresses.find((entry) => entry.id === user.primary_email_address_id) ??
    addresses[0];
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    email:
      typeof primary?.email_address === 'string' ? primary.email_address : null,
    createdAt: number(user.created_at),
    lastSignInAt: number(user.last_sign_in_at),
    banned: typeof user.banned === 'boolean' ? user.banned : null,
  };
}
