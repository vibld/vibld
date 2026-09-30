/**
 * Who an account is, for the admin tools: an address an admin typed as the
 * account id everything keys on, the account's address and dates, and a
 * ban at the sign-in provider.
 *
 * Under Clerk (app.vibld.com) that is Clerk's Backend API, as it always
 * was. A self-hosted copy signed in another way (D123) has no Clerk to ask
 * (Codex review of internal PR 337), so:
 *
 * - an owner copy has one account, the owner's;
 * - a copy behind Cloudflare Access knows everyone it has let in, whose
 *   address and Access id it records (0040), and the people who took an
 *   invite. A ban is recorded here and refuses them here (`principal.ts`
 *   reads it); Access itself is the owner's to change.
 */

import { AccessStore } from './access-store.ts';
import {
  clerkLookupConfigured,
  fetchClerkUser,
  findClerkUserIdByEmail,
  setClerkBan,
  type ClerkBanResult,
  type ClerkLookupEnv,
  type ClerkLookupResult,
  type ClerkUserSummary,
} from './clerk-lookup.ts';
import { OWNER_USER_ID, ownerIdentity } from './owner-auth.ts';
import { signInMode, type PrincipalEnv } from './principal.ts';

export interface AccountDirectory {
  /** Whether accounts can be looked up here at all. */
  configured: boolean;
  lookupByEmail: (email: string) => Promise<ClerkLookupResult>;
  user: (userId: string) => Promise<ClerkUserSummary | null>;
  setBan: (userId: string, banned: boolean) => Promise<ClerkBanResult>;
}

export interface AccountDirectoryEnv extends ClerkLookupEnv, PrincipalEnv {
  DB?: D1Database;
}

const nothingToBan = async (): Promise<ClerkBanResult> => ({ ok: true });

export function accountDirectoryFor(
  env: AccountDirectoryEnv,
): AccountDirectory {
  const mode = signInMode(env);

  if (mode === 'owner') {
    const owner = ownerIdentity(env);
    return {
      configured: true,
      lookupByEmail: async (email) =>
        email.trim().toLowerCase() === owner
          ? { ok: true, userId: OWNER_USER_ID }
          : {
              ok: false,
              error: "This copy has one account, its owner's.",
            },
      user: async (userId) =>
        userId === OWNER_USER_ID
          ? { email: owner, createdAt: null, lastSignInAt: null, banned: null }
          : null,
      // The password is the only sign-in, and it is the owner's.
      setBan: nothingToBan,
    };
  }

  if (mode === 'access') {
    const db = env.DB;
    return {
      configured: Boolean(db),
      lookupByEmail: async (email) => {
        if (!db) {
          return { ok: false, error: 'User lookup is not configured.' };
        }
        const store = new AccessStore(db);
        const seen = await store.accessAccountFor(email);
        if (seen) return { ok: true, userId: seen };
        const invite = await store.redeemedUserId(email);
        if (invite.userId) return { ok: true, userId: invite.userId };
        return {
          ok: false,
          error: invite.exists
            ? 'That address has an invite nobody has signed in with yet.'
            : 'Nobody has signed in here with that address.',
        };
      },
      user: async (userId) => {
        if (!db) return null;
        const store = new AccessStore(db);
        const email =
          (await store.accessEmailFor(userId)) ??
          (await store.emailForUser(userId));
        return { email, createdAt: null, lastSignInAt: null, banned: null };
      },
      setBan: nothingToBan,
    };
  }

  return {
    configured: clerkLookupConfigured(env),
    lookupByEmail: (email) => findClerkUserIdByEmail(env, email),
    user: (userId) => fetchClerkUser(env, userId),
    setBan: (userId, banned) => setClerkBan(env, userId, banned),
  };
}
