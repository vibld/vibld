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
import { fetchMedia, removeMedia } from '../generation/media-client.ts';
import {
  fetchPreviewShares,
  fetchPreviewStatus,
  revokePreviewShare,
  stopSandboxPreview,
} from '../generation/preview-client.ts';
import type { AccessStatus as AccessStatusValue } from '../access/access-client.ts';
import {
  cancelAccountDeletion,
  fetchDeletionSchedule,
  formatPurgeDate,
  requestAccountDeletion,
} from '../account/deletion-client.ts';
import type { DeletionSchedule } from '../account/deletion-client.ts';
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
  // Bumped by the retry control below. An unknown answer is the one outcome
  // somebody can do something about, and asking again is the something.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    void fetchAccess().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [configured, attempt]);

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
  // Its own screen, before the other two: the account is refused because
  // it asked to be, and neither "not on the list" nor "could not check" is
  // true of it. The wind-down controls are not offered here, because every
  // route behind them now refuses this account; the deletion already does
  // all of what they would.
  if (status.deletion) {
    return (
      <DeletionScheduledNotice
        purgeAfter={status.deletion.purgeAfter}
        kept={() => setAttempt((n) => n + 1)}
        signOut={signOut}
      />
    );
  }
  /*
   * Two different screens, because they are two different facts. The gate
   * stays shut either way: an unknown answer is not a yes, and showing a
   * builder that refuses every action is the worse of the two failures.
   * What must not happen is telling an invited customer they are on a
   * waiting list because D1 was unavailable for a moment.
   */
  if (!status.decided) {
    return (
      <UnknownNotice retry={() => setAttempt((n) => n + 1)} signOut={signOut} />
    );
  }
  return <ClosedNotice status={status} signOut={signOut} />;
}

/**
 * What an account that asked to be deleted sees when it signs in again
 * (docs/decisions.md L32).
 *
 * The date the purge happens, what has not finished yet with a way to
 * finish it, and, while the purge has not started, the way to keep the
 * account. Keeping it gives back the account and its data; what was
 * already stopped (the subscription, the published site, the GitHub
 * connection, pending referral rewards) stays stopped, and it says so.
 */
function DeletionScheduledNotice({
  purgeAfter,
  kept,
  signOut,
}: {
  purgeAfter: string;
  kept: () => void;
  signOut: ReactNode;
}) {
  const [schedule, setSchedule] = useState<DeletionSchedule | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchDeletionSchedule()
      .then((next) => {
        if (live) setSchedule(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const unfinished = schedule?.errors ?? [];
  const cancellable = schedule?.cancellable ?? false;

  async function retry() {
    setBusy(true);
    setNote(null);
    try {
      // A request that already stands needs no phrase: it is finishing
      // what was already confirmed, not deciding anything new.
      const result = await requestAccountDeletion('');
      if (result.ok) {
        setSchedule(result.schedule);
        setNote(
          result.schedule.errors.length === 0
            ? 'Everything that stops straight away has now stopped.'
            : null,
        );
      } else {
        setNote(result.error);
      }
    } catch {
      setNote('The request could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    setBusy(true);
    setNote(null);
    try {
      const result = await cancelAccountDeletion();
      if (result.ok) kept();
      else setNote(result.error);
    } catch {
      setNote('The request could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-gate">
      <GateBrand />
      <div className="banner" role="status">
        <p className="banner__title">This account is scheduled for deletion</p>
        <p className="banner__detail">
          Everything in it will be deleted on {formatPurgeDate(purgeAfter)}.
          Until then it cannot be used.
        </p>
        {unfinished.length > 0 ? (
          <>
            <p className="banner__detail">Not everything has stopped yet:</p>
            <ul className="banner__detail">
              {unfinished.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            <p className="banner__detail">
              <button
                type="button"
                disabled={busy}
                onClick={() => void retry()}
              >
                Try those again
              </button>
            </p>
          </>
        ) : null}
        {cancellable ? (
          <>
            <p className="banner__detail">
              Changed your mind? You can keep the account until then. Your
              projects and files come back as they were. Anything already
              stopped stays stopped: a cancelled subscription, a published site
              taken down, the GitHub connection and referral rewards.
            </p>
            <p className="banner__detail">
              <button type="button" disabled={busy} onClick={() => void keep()}>
                Keep my account
              </button>
            </p>
          </>
        ) : null}
        {note ? (
          <p className="banner__detail" role="status">
            {note}
          </p>
        ) : null}
      </div>
      {signOut}
    </div>
  );
}

/** The brand header both refusal screens carry. */
function GateBrand() {
  return (
    <div className="auth-gate__brand">
      <span className="shell__logo">
        <Mark size={22} />
      </span>
      <div>
        <p className="shell__name">{WORDMARK}</p>
        <p className="shell__tagline">Vibe. Build. Ship.</p>
      </div>
    </div>
  );
}

/**
 * What the shell says when it could not find out.
 *
 * Not a refusal, and it must not read as one. The account may be perfectly
 * fine; what failed is the check. So it says that, offers the one action
 * that can change the answer, and leaves the builder shut in the meantime.
 *
 * It carries the same wind-down controls as the refusal, because the builder
 * is unmounted here too. A fault that does not clear (the access query
 * broken while everything else is fine) otherwise puts a subscriber on a
 * screen with a retry button that keeps failing and no way to stop being
 * charged, stop a sandbox, pull a public link or hand back a repository. The
 * routes behind those controls do not depend on the answer this screen is
 * missing.
 */
function UnknownNotice({
  retry,
  signOut,
}: {
  retry: () => void;
  signOut: ReactNode;
}) {
  return (
    <div className="auth-gate">
      <GateBrand />
      <div className="banner" role="status">
        <p className="banner__title">We could not check your account</p>
        <p className="banner__detail">
          Something went wrong on our side, so we have not been able to confirm
          whether your account has access. This is not a decision about you.
        </p>
        <p className="banner__detail">
          <button type="button" onClick={retry}>
            Try again
          </button>
        </p>
      </div>
      <WindDown />
      {signOut}
    </div>
  );
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
      <GateBrand />
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
 * sandbox, no public link, no repository grant and no uploaded media sees
 * none of this, which
 * is the common case and should stay quiet.
 */
function WindDown() {
  const [credit, setCredit] = useState<number | null>(null);
  // Undefined until the status answers. Only an explicit `false` hides the
  // portal: a status call that failed must not take away the control that
  // stops the charge.
  const [hasCustomer, setHasCustomer] = useState<boolean | undefined>(
    undefined,
  );
  const [sandbox, setSandbox] = useState(false);
  const [shares, setShares] = useState<string[]>([]);
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(
    null,
  );
  // The uploaded images and video, which stay stored until removed.
  const [media, setMedia] = useState<{ id: string; path: string }[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [billing, preview, shareList, github, library] = await Promise.all([
        fetchBillingStatus().catch(() => null),
        fetchPreviewStatus().catch(() => null),
        fetchPreviewShares().catch(() => []),
        fetchGitHubStatus().catch(() => null),
        fetchMedia().catch(() => null),
      ]);
      if (!live) return;
      setMedia(
        (library?.media ?? []).map((item) => ({
          id: item.id,
          path: item.path,
        })),
      );
      setCredit(billing?.topupRemainingMicroUsd ?? null);
      setHasCustomer(billing?.hasStripeCustomer);
      setSandbox(preview !== null && preview.status !== 'failed');
      // Not revoked and not expired. The share list is every grant ever
      // issued, so filtering on `revoked` alone counts links that stopped
      // working months ago and offers to remove exposure that is not there.
      const now = Date.now();
      setShares(
        shareList
          .filter((s) => !s.revoked && s.expiresAt > now)
          .map((s) => s.shareId),
      );
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
      {hasCustomer === false ? null : (
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
      )}
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
      {media.length > 0 ? (
        <div className="banner__detail">
          <p>
            Your media library holds {media.length} file
            {media.length === 1 ? '' : 's'}:{' '}
            {media.map((item) => `/${item.path}`).join(', ')}.
          </p>
          <button
            type="button"
            onClick={() =>
              void run('Deleting your uploaded media', async () => {
                const left: typeof media = [];
                for (const item of media) {
                  if (!(await removeMedia(item.id))) left.push(item);
                }
                setMedia(left);
                if (left.length > 0) {
                  throw new Error(
                    `${left.length} file${left.length === 1 ? '' : 's'} could not be deleted. Try again.`,
                  );
                }
              })
            }
          >
            Delete {media.length === 1 ? 'it' : `all ${media.length}`}
          </button>
        </div>
      ) : null}
      {note ? (
        <p className="banner__detail" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
