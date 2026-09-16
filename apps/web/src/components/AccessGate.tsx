import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchAccess } from '../access/access-client.ts';
import { AuthStatus } from '../auth/clerk.tsx';
import { clerkConfigured } from '../auth/clerk-token.ts';
import {
  fetchBillingStatus,
  formatUsd,
  openBillingPortal,
} from '../billing/billing-client.ts';
import {
  disconnectRepository,
  fetchGitHubStatus,
} from '../github/github-client.ts';
import {
  fetchPreviewShares,
  fetchPreviewStatus,
  revokePreviewShare,
  stopSandboxPreview,
} from '../generation/preview-client.ts';
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
      <WindDown />
      {signOut}
    </div>
  );
}

/**
 * Everything a locked-out account still owns, and the control for each.
 *
 * This screen replaces the whole builder, so it replaces every control in
 * it. Opening the routes was not enough and reporting that as a fix was
 * wrong twice over: an endpoint nobody can press is not a way out, and the
 * person on this screen cannot construct an authenticated POST.
 *
 * Only what applies is rendered. An account with no subscription, no
 * sandbox, no public link and no repository grant sees none of this, which
 * is the common case and should stay quiet.
 */
function WindDown() {
  const [credit, setCredit] = useState<number | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [billing, preview, shareList, github] = await Promise.all([
        fetchBillingStatus().catch(() => null),
        fetchPreviewStatus().catch(() => null),
        fetchPreviewShares().catch(() => []),
        fetchGitHubStatus().catch(() => null),
      ]);
      if (!live) return;
      setCredit(billing?.topupRemainingMicroUsd ?? null);
      setSandbox(preview !== null && preview.status !== 'failed');
      setShares(shareList.filter((s) => !s.revoked).map((s) => s.shareId));
      setRepo(
        github?.connected && github.owner && github.repo
          ? { owner: github.owner, repo: github.repo }
          : null,
      );
    })();
    return () => {
      live = false;
    };
  }, []);

  async function run(what: string, act: () => Promise<unknown>) {
    setNote(null);
    try {
      await act();
      setNote(`${what} done.`);
    } catch (error) {
      // The thrown message, not a guess. Telling somebody "no subscription"
      // when Stripe is down is a false diagnosis on the only screen they
      // have left.
      setNote(error instanceof Error ? error.message : `${what} failed.`);
    }
  }

  return (
    <div className="banner" role="group" aria-label="Your account">
      <p className="banner__title">What is still yours</p>
      {credit !== null ? (
        <p className="banner__detail">
          Unspent credit: {formatUsd(credit)}. It stays on the account.
        </p>
      ) : null}
      <p className="banner__detail">
        <button
          type="button"
          onClick={() =>
            void run('Opening the billing portal', async () => {
              window.location.href = await openBillingPortal();
            })
          }
        >
          Manage or cancel a subscription
        </button>
      </p>
      {sandbox ? (
        <p className="banner__detail">
          <button
            type="button"
            onClick={() =>
              void run('Stopping the sandbox', async () => {
                await stopSandboxPreview();
                setSandbox(false);
              })
            }
          >
            Stop the running sandbox
          </button>
        </p>
      ) : null}
      {shares.length > 0 ? (
        <p className="banner__detail">
          <button
            type="button"
            onClick={() =>
              void run('Removing the public links', async () => {
                for (const id of shares) await revokePreviewShare(id);
                setShares([]);
              })
            }
          >
            Remove {shares.length} public link
            {shares.length === 1 ? '' : 's'} to your code
          </button>
        </p>
      ) : null}
      {repo ? (
        <p className="banner__detail">
          <button
            type="button"
            onClick={() =>
              void run('Disconnecting the repository', async () => {
                const result = await disconnectRepository(repo);
                if (!result.ok) throw new Error(result.error);
                setRepo(null);
              })
            }
          >
            Disconnect {repo.owner}/{repo.repo}
          </button>
        </p>
      ) : null}
      {note ? (
        <p className="banner__detail" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
