/**
 * Which sign-in this build of the builder talks to (docs/decisions.md
 * D123), fixed when it is built, as the Clerk key is.
 *
 * - `clerk`: app.vibld.com, and any copy built with a Clerk publishable key.
 * - `owner`: a self-hosted copy signed in with one owner's password. The
 *   Worker sets an HttpOnly cookie, so the builder holds no token at all.
 * - `access`: a self-hosted copy behind Cloudflare Access, which signs the
 *   person in before the page loads and attaches its own token to every
 *   request.
 * - `none`: nothing to sign in to (local `pnpm dev` on the fake provider).
 *
 * Kept free of JSX for the reason `clerk-token.ts` is.
 */

import { PUBLISHABLE_KEY } from './clerk-token.ts';

export type AuthMode = 'clerk' | 'owner' | 'access' | 'none';

export function authModeFor(
  named: string | undefined,
  hasClerkKey: boolean,
): AuthMode {
  const mode = named?.trim().toLowerCase();
  if (!mode || mode === 'clerk') return hasClerkKey ? 'clerk' : 'none';
  if (mode === 'owner' || mode === 'access') return mode;
  // Unknown: the Worker treats an unknown VIBLD_AUTH as no sign-in at all,
  // so the page must not offer one that could never work (Codex review of
  // internal PR 337).
  return 'none';
}

export const AUTH_MODE: AuthMode = authModeFor(
  import.meta.env?.VITE_VIBLD_AUTH,
  PUBLISHABLE_KEY !== undefined,
);

/** Whether there are accounts here at all: anything but `none`. */
export const signInConfigured = AUTH_MODE !== 'none';

/** Where Cloudflare Access signs a person out of every application. */
export const ACCESS_SIGN_OUT_PATH = '/cdn-cgi/access/logout';

export const OWNER_SESSION_PATH = '/api/owner/session';

/** Whether this browser holds a current owner session. */
export async function fetchOwnerSignedIn(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(OWNER_SESSION_PATH, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return false;
    return Boolean(
      ((await response.json()) as { signedIn?: unknown }).signedIn,
    );
  } catch {
    return false;
  }
}

export type OwnerSignInResult = { ok: true } | { ok: false; error: string };

export async function ownerSignIn(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerSignInResult> {
  let response: Response;
  try {
    response = await fetchImpl(OWNER_SESSION_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the builder. Try again.' };
  }
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  return {
    ok: false,
    error:
      typeof body.error === 'string' && body.error.length > 0
        ? body.error
        : 'Could not sign in. Try again.',
  };
}

export async function ownerSignOut(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  // Only a response that cleared the cookie counts: reloading after a
  // refused or failed sign-out would leave the owner signed in without
  // saying so (Codex review of internal PR 337), which matters on a shared browser.
  try {
    const response = await fetchImpl(OWNER_SESSION_PATH, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    return response.ok;
  } catch {
    return false;
  }
}
