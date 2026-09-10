/**
 * The framework-free half of Clerk access: everything `remote-provider.ts`
 * and `useBuilderSession.ts` need, with no JSX.
 *
 * That split is not stylistic. `node --test --experimental-strip-types`
 * (this project's test runner) strips TypeScript *types* only -- it does not
 * transform JSX, and errors on it. Anything imported, even transitively,
 * from a `*.test.ts` file must therefore stay JSX-free all the way down. The
 * components that do need JSX (`ClerkRoot`, `AuthStatus`) live in
 * `clerk.tsx` instead, which imports from here rather than the other way
 * round.
 */

/**
 * Present only once the deployment has been given a publishable key -- see
 * apps/web/README.md's Clerk setup section. Absent means "not configured
 * yet", not broken: every Clerk-touching component degrades to rendering (or
 * doing) nothing rather than throwing.
 *
 * docs/decisions.md L5: Clerk is now the only thing that gates `/api/plan`
 * and `/api/config` -- Cloudflare Access is off.
 */
export const PUBLISHABLE_KEY = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY as
  string | undefined;

export const clerkConfigured = Boolean(PUBLISHABLE_KEY);

/**
 * `ClerkProvider` (in clerk.tsx) sets `window.Clerk` -- the SDK's own
 * documented escape hatch for code outside React. Only the slice each
 * function below actually reads is typed here; the rest of Clerk's `Clerk`
 * class is deliberately not modelled.
 */
interface ClerkGlobal {
  session?: { getToken(): Promise<string | null> } | null;
  addListener(callback: (emission: { session?: unknown }) => void): () => void;
}

function clerkGlobal(): ClerkGlobal | undefined {
  return (globalThis as unknown as { Clerk?: ClerkGlobal }).Clerk;
}

/**
 * `remote-provider.ts` is framework-free (ADR-0006-era code that predates
 * any React dependency), so this is read directly rather than threaded
 * through as a prop -- the same reason `PUBLISHABLE_KEY` above is a
 * module-level read, not a context value. It is what Clerk's own "making
 * authenticated requests" guide recommends for a cross-origin `fetch`, which
 * `/api/plan` and `/api/config` are here: the Worker's origin is not
 * `CLERK_FRONTEND_API_URL`'s, so the session cookie never arrives on its
 * own.
 *
 * Returns `null`, not a rejected promise, when signed out or not yet loaded:
 * both are "no token available" to a caller, not an error.
 */
export async function getClerkToken(): Promise<string | null> {
  if (!clerkConfigured) return null;
  const clerk = clerkGlobal();
  if (!clerk?.session) return null;
  return clerk.session.getToken();
}

/**
 * Notifies `callback` whenever the caller signs in or out, so code outside
 * React (`useBuilderSession.ts`) can re-probe `/api/config` the moment a
 * token becomes available -- without this, the model picker would stay
 * empty after signing in through the header's modal until a full reload,
 * because nothing else invalidates the cached probe.
 *
 * `ClerkProvider` loads the underlying SDK asynchronously, so `window.Clerk`
 * is not guaranteed to exist yet when this is called; it is polled briefly
 * rather than missing an early sign-in. Returns an unsubscribe function.
 */
export function onClerkSessionChange(
  callback: (signedIn: boolean) => void,
): () => void {
  if (!clerkConfigured) return () => {};

  let unsubscribe: (() => void) | undefined;
  let cancelled = false;

  const attach = (clerk: ClerkGlobal): void => {
    unsubscribe = clerk.addListener(({ session }) => {
      // `session` is `undefined` while Clerk is still loading its initial
      // state -- not yet a known answer, so it is not reported either way.
      if (session === undefined) return;
      callback(session !== null);
    });
  };

  const existing = clerkGlobal();
  if (existing) {
    attach(existing);
  } else {
    const interval = setInterval(() => {
      if (cancelled) {
        clearInterval(interval);
        return;
      }
      const clerk = clerkGlobal();
      if (clerk) {
        clearInterval(interval);
        attach(clerk);
      }
    }, 50);
  }

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
