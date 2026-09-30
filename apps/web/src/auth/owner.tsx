import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Mark, WORDMARK } from '../components/Mark.tsx';
import { fetchOwnerSignedIn, ownerSignIn, ownerSignOut } from './mode.ts';

/**
 * The owner's password form, for a self-hosted copy signed in that way
 * (docs/decisions.md D123). Signing in sets an HttpOnly cookie, so the page
 * reloads afterwards rather than carrying anything forward itself.
 */
export function OwnerSignInForm({
  onSignedIn = () => window.location.reload(),
  signIn = ownerSignIn,
}: {
  onSignedIn?: () => void;
  signIn?: typeof ownerSignIn;
}) {
  const fieldId = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(password);
    setBusy(false);
    if (result.ok) {
      onSignedIn();
      return;
    }
    setError(result.error);
  }

  return (
    <form className="owner-sign-in" onSubmit={submit}>
      <label htmlFor={fieldId}>Password</label>
      <input
        id={fieldId}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        autoFocus
      />
      {error ? (
        <p className="owner-sign-in__error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="button button--primary"
        disabled={busy || password.length === 0}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

/** Whether the owner is signed in: `null` until the builder has asked. */
export function useOwnerSignedIn(
  check: () => Promise<boolean> = fetchOwnerSignedIn,
): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void check().then((answer) => {
      if (live) setSignedIn(answer);
    });
    return () => {
      live = false;
    };
  }, [check]);
  return signedIn;
}

/** `AuthGate` for an owner copy: the password form until signed in. */
export function OwnerGate({
  children,
  check = fetchOwnerSignedIn,
}: {
  children: ReactNode;
  check?: () => Promise<boolean>;
}) {
  const signedIn = useOwnerSignedIn(check);
  if (signedIn === null) return null;
  if (signedIn) return children;
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
      <OwnerSignInForm />
    </div>
  );
}

export function OwnerSignOut({
  signOut = ownerSignOut,
  onSignedOut = () => window.location.reload(),
}: {
  signOut?: typeof ownerSignOut;
  onSignedOut?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => {
          setFailed(false);
          void signOut().then((ok) => {
            if (ok) onSignedOut();
            else setFailed(true);
          });
        }}
      >
        Sign out
      </button>
      {failed ? (
        <span className="owner-sign-in__error" role="alert">
          Could not sign out. Try again.
        </span>
      ) : null}
    </>
  );
}
