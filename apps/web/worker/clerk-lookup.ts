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
