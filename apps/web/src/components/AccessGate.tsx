import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchAccess } from '../access/access-client.ts';
import { AuthStatus } from '../auth/clerk.tsx';
import { clerkConfigured } from '../auth/clerk-token.ts';
import { openBillingPortal } from '../billing/billing-client.ts';
import type { AccessStatus as AccessStatusValue } from '../access/access-client.ts';
import { Mark, WORDMARK } from './Mark.tsx';

/**
 * The screen between signing in and the builder, while the list is closed.
 *
 * Separate from `AuthGate` because they answer different questions and have
 * different answers for the person reading them. "You are not signed in" is
 * something they can fix in ten seconds. "You are signed in and not on the
 * list" is not, and showing them a builder that refuses every action would be
 * worse than saying so.
 *
 * `useBuilderSession` must not mount behind this, for the same reason it does
 * not mount behind `AuthGate`: it probes on mount, and those probes are
 * exactly what an uninvited account may not do.
 */
export function AccessGate({
  children,
  /**
   * Whether this deployment has an identity provider at all. Taken as a prop
   * rather than read directly for the same reason `ReferralStore` takes its
   * randomness: the unconfigured path is a real behaviour and a test that
   * cannot reach it is not testing it. The harness builds these components
   * with a key present, so nothing else could drive this branch.
   */
  configured = clerkConfigured,
  /**
   * The sign-out control. A prop for the same reason `configured` is: the
   * real one is Clerk's `UserButton`, which throws without a provider above
   * it, and a refusal screen that cannot be rendered in a test is a refusal
   * screen nobody checks.
   */
  signOut = <AuthStatus />,
}: {
  children: ReactNode;
  configured?: boolean;
  signOut?: ReactNode;
}) {
  const [status, setStatus] = useState<AccessStatusValue | null>(null);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    void fetchAccess().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [configured]);

  /*
   * An unconfigured deployment renders the builder, the same as `AuthGate`
   * does and for the same reason: there is no identity to check, so there is
   * no list to be on. This is the local `pnpm dev` path, and it is not a hole
   * -- the Worker refuses every endpoint that costs anything without Clerk
   * (principal.ts), and the router's own gate is a separate check that does
   * not consult this component at all.
   *
   * Without this the shell would show a signed-out developer a waiting-list
   * notice for a deployment that has no waiting list.
   */
  if (!configured) return children;

  // Nothing at all while it is unknown. A flash of the builder followed by a
  // refusal reads as a product that broke, rather than one that is closed.
  if (status === null) return null;
  if (status.allowed) return children;
  return <ClosedNotice status={status} signOut={signOut} />;
}

function ClosedNotice({
  status,
  signOut,
}: {
  status: AccessStatusValue;
  signOut: ReactNode;
}) {
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
      <div className="banner" role="status">
        <p className="banner__title">You are on the waiting list</p>
        <p className="banner__detail">
          {status.message ??
            'This deployment is invite-only at the moment. Your account is ready and will work the moment it is let in.'}
        </p>
        {/*
          It used to say "nothing has been charged". That is true of somebody
          who has never paid and false of a subscriber whose invite was
          withdrawn, and revocation does not cancel anything in Stripe. The
          screen cannot tell which it is talking to, so it says what is true
          of both and gives the second one the way out below.
        */}
        <p className="banner__detail">
          Nothing you do here costs anything while access is closed. If you
          already have a subscription it is still running, and you can manage or
          cancel it below.
        </p>
        {/*
          Somewhere to go, rather than a dead end. The waitlist on the
          marketing site is the list invitations are issued from, so it is the
          answer to "what do I do now" instead of a support address nobody
          reads.
        */}
        <p className="banner__detail">
          <a href="https://vibld.com" rel="noopener noreferrer">
            Ask for access at vibld.com
          </a>
        </p>
      </div>
      {/*
        The two things somebody locked out still needs, and neither existed
        here. This screen replaces the whole builder, so it also replaced the
        only control that opens the billing portal and the only one that signs
        out. Ungating the portal route did nothing on its own while no button
        reached it, and an account that signed in as the wrong person had no
        way to become the right one.
      */}
      <ManageBilling />
      {signOut}
    </div>
  );
}

/**
 * A way out for somebody still being charged.
 *
 * Revocation does not cancel a Stripe subscription, so this is the only
 * thing standing between a withdrawn invite and a card that keeps being
 * billed. `/api/billing/portal` is deliberately ungated for the same reason.
 *
 * An account that never subscribed has no Stripe customer and the request
 * fails; the message says so plainly rather than looking broken.
 */
function ManageBilling() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await openBillingPortal();
    } catch {
      setBusy(false);
      setError('No subscription found for this account.');
    }
  }

  return (
    <p className="banner__detail">
      <button type="button" onClick={() => void open()} disabled={busy}>
        {busy ? 'Opening...' : 'Manage or cancel a subscription'}
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}
