import { ClerkProvider, Show, SignIn, SignUp, UserButton } from '@clerk/react';
import type { ReactNode } from 'react';
import {
  PUBLISHABLE_KEY,
  SIGN_UP_PATH,
  clerkConfigured,
  isSignUpPath,
} from './clerk-token.ts';
import { usePathname } from '../admin/use-pathname.ts';
import { Mark, WORDMARK } from '../components/Mark.tsx';

export {
  clerkConfigured,
  getClerkToken,
  onClerkSessionChange,
} from './clerk-token.ts';

/** Wraps the app in `ClerkProvider` only when a key is actually present. */
export function ClerkRoot({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) return children;
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      // Both forms live in this shell rather than on Clerk's hosted Account
      // Portal, so "Sign up" on vibld.com and the link under the sign-in
      // form land on the same page, on this domain.
      signInUrl="/"
      signUpUrl={SIGN_UP_PATH}
    >
      {children}
    </ClerkProvider>
  );
}

/**
 * Gates `children` behind sign-in. A generation costs real model or sandbox
 * spend (docs/decisions.md L5/L7), so the builder itself -- not just the
 * endpoints it calls -- should be unreachable signed out, rather than
 * relying on every caller to notice the small `AuthStatus` affordance and a
 * 401 is enough of a gate.
 *
 * An unconfigured deployment (no publishable key: local `pnpm dev`, or a
 * preview build with no Clerk secret set) renders `children` directly --
 * there is no session to gate on, and `/api/plan` already falls back to the
 * deterministic fake rather than answering for real.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  if (!clerkConfigured) return children;
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <SignInLanding />
      </Show>
    </>
  );
}

function SignInLanding() {
  // A path rather than a toggle, so vibld.com can link straight to the
  // sign-up form (`SITE.signUpUrl` in apps/marketing). The builder is
  // unreachable signed out either way; which form shows is the only thing
  // the path decides.
  const signingUp = isSignUpPath(usePathname());
  return (
    <div className="auth-gate">
      <div className="auth-gate__brand">
        <span className="shell__logo">
          <Mark size={22} />
        </span>
        <div>
          <p className="shell__name">{WORDMARK}</p>
          <p className="shell__tagline">Vibe. Build. Ship.</p>
        </div>
      </div>
      {signingUp ? (
        <SignUp signInUrl="/" />
      ) : (
        <SignIn signUpUrl={SIGN_UP_PATH} />
      )}
    </div>
  );
}

/**
 * The header's sign-out affordance. Signing in itself now happens on
 * `SignInLanding` above (docs/decisions.md L5) -- the only thing a
 * signed-out caller can reach once `AuthGate` wraps the app -- so this is
 * just `UserButton`, wrapped the same defensive `Show` every other
 * signed-in-only widget in the header uses.
 */
export function AuthStatus() {
  if (!clerkConfigured) return null;
  return (
    <div className="shell__auth">
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
