import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/react';
import type { ReactNode } from 'react';

/**
 * Present only once the deployment has been given a publishable key -- see
 * apps/web/README.md's Clerk setup section. Absent means "not configured
 * yet", not broken: every component here degrades to rendering nothing
 * rather than throwing, because the app must keep working exactly as it
 * always has whether or not this key exists. Cloudflare Access is still the
 * only thing that gates `/api/plan` (docs/decisions.md L5) -- nothing below
 * changes that on its own.
 */
const PUBLISHABLE_KEY = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY as
  string | undefined;

export const clerkConfigured = Boolean(PUBLISHABLE_KEY);

/** Wraps the app in `ClerkProvider` only when a key is actually present. */
export function ClerkRoot({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) return children;
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}

/**
 * The header's sign-in affordance. Deliberately inert beyond itself: signing
 * in here proves the Clerk side of the cutover works, but does not yet grant
 * access to anything -- that switch flips once the L29 abuse controls land
 * alongside it, not before (L5).
 */
export function AuthStatus() {
  if (!clerkConfigured) return null;
  return (
    <div className="shell__auth">
      <Show when="signed-in">
        <UserButton />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className="button">
            Sign in
          </button>
        </SignInButton>
      </Show>
    </div>
  );
}
