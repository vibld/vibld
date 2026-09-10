import { ClerkProvider, Show, SignInButton, UserButton } from '@clerk/react';
import type { ReactNode } from 'react';
import { PUBLISHABLE_KEY, clerkConfigured } from './clerk-token.ts';

export {
  clerkConfigured,
  getClerkToken,
  onClerkSessionChange,
} from './clerk-token.ts';

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
 * The header's sign-in affordance. This is the whole gate now
 * (docs/decisions.md L5): signing in here is what lets `/api/plan` and
 * `/api/config` answer at all.
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
