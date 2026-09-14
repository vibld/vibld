import { Show } from '@clerk/react';
import { useEffect, useState } from 'react';
import {
  beginConnect,
  bindRepository,
  claimHandoff,
  completeClaimedConnect,
  disconnectRepository,
  fetchGitHubStatus,
} from '../github/github-client.ts';
import type {
  ConnectOffer,
  GitHubStatus,
  RepositoryChoice,
} from '../github/github-client.ts';
import { clerkConfigured } from '../auth/clerk-token.ts';

/**
 * Connecting a repository, and the receiving half of the callback handoff
 * (issues #13 and #121).
 *
 * The worker's `/api/github/callback` cannot be authenticated, because
 * GitHub returns through a top-level navigation that carries no bearer
 * token. It therefore does no work: it puts the code and state in the
 * fragment and redirects here, and this panel completes the exchange with a
 * request that can be authenticated. Without this half the flow has no
 * receiver at all.
 *
 * `github-client.ts` holds the part of that with teeth: the browser
 * remembers the state it was issued and refuses one it was not, which is
 * what stops a crafted link completing somebody else's authorization inside
 * this session.
 *
 * Mounted inside `Show when="signed-in"` like `BillingStatusWidget`, so a
 * fresh mount is always a fresh fetch and there is no sign-in re-fetch to
 * keep in step.
 */
export function GitHubPanel() {
  if (!clerkConfigured) return null;
  return (
    <Show when="signed-in">
      <GitHubConnection />
    </Show>
  );
}

type Phase =
  | { at: 'loading' }
  | { at: 'idle' }
  | { at: 'working'; note: string }
  | { at: 'choosing'; offer: ConnectOffer }
  | { at: 'problem'; error: string; install?: boolean };

function GitHubConnection() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ at: 'loading' });

  // Finishing a return from GitHub, if that is what this page load is.
  useEffect(() => {
    let cancelled = false;

    // Claimed rather than read: StrictMode runs this effect twice in
    // development, and a plain read would have the first pass clear the
    // fragment and the replay find nothing. The claim also takes it off the
    // URL, because a single-use code in the address bar invites a reload
    // that can only fail.
    const handoff = claimHandoff(globalThis.location?.hash ?? '');

    void (async () => {
      const current = await fetchGitHubStatus();
      if (cancelled) return;
      setStatus(current);

      if (!handoff) {
        setPhase({ at: 'idle' });
        return;
      }
      setPhase({ at: 'working', note: 'Finishing the GitHub connection…' });
      // Shared between both StrictMode passes: completing twice would spend
      // the stored state on the first and fail the second's own check.
      const finished = await completeClaimedConnect(handoff);
      if (cancelled) return;
      if (!finished.ok) {
        setPhase({
          at: 'problem',
          error: finished.error,
          ...(finished.install ? { install: true } : {}),
        });
        return;
      }
      setPhase({ at: 'choosing', offer: finished.offer });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setPhase({ at: 'working', note: 'Sending you to GitHub…' });
    const started = await beginConnect();
    if (!started.ok) {
      setPhase({ at: 'problem', error: started.error });
      return;
    }
    globalThis.location.assign(started.url);
  }

  async function choose(choice: RepositoryChoice, ticket: string) {
    setPhase({
      at: 'working',
      note: `Connecting ${choice.owner}/${choice.repo}…`,
    });
    const bound = await bindRepository(ticket, choice);
    if (!bound.ok) {
      setPhase({ at: 'problem', error: bound.error });
      return;
    }
    setStatus(await fetchGitHubStatus());
    setPhase({ at: 'idle' });
  }

  async function disconnect() {
    setPhase({ at: 'working', note: 'Disconnecting…' });
    const done = await disconnectRepository();
    if (!done.ok) {
      setPhase({ at: 'problem', error: done.error });
      return;
    }
    setStatus(await fetchGitHubStatus());
    setPhase({ at: 'idle' });
  }

  if (phase.at === 'loading') return null;

  // A connection in flight outranks the status probe. `/api/github/status`
  // is only how the panel decides what to offer; it is not what makes the
  // panel meaningful. If it failed transiently while the exchange succeeded,
  // hiding everything strands somebody whose code and state are already
  // spent, holding a ticket they cannot see and cannot use before it
  // expires.
  const busy =
    phase.at === 'working' || phase.at === 'problem' || phase.at === 'choosing';

  // Otherwise: nothing to offer on a deployment without GitHub configured,
  // the same silence `BillingStatusWidget` keeps when billing is not.
  if (!busy && !status?.configured) return null;

  return (
    <section className="github-panel">
      <h3>GitHub</h3>

      {phase.at === 'working' && <p role="status">{phase.note}</p>}

      {phase.at === 'problem' && (
        <p role="alert" className="github-panel__problem">
          {phase.error}
          {phase.install && (
            <>
              {' '}
              <a
                href="https://github.com/apps/vibld/installations/new"
                target="_blank"
                rel="noreferrer noopener"
              >
                Install the Vibld app
              </a>
            </>
          )}
        </p>
      )}

      {phase.at === 'choosing' && (
        <RepositoryPicker
          offer={phase.offer}
          onChoose={(choice) => void choose(choice, phase.offer.ticket)}
        />
      )}

      {status?.configured &&
        phase.at !== 'choosing' &&
        phase.at !== 'working' && (
          <>
            {status.connected ? (
              <p>
                {/*
                `canPush` rather than `connected` alone. A deployment with the
                OAuth half and no App key lets a repository be connected and
                answers every push with a 503, so saying "pushing to" it would
                be describing something that cannot happen.
              */}
                {status.canPush ? 'Pushing to ' : 'Connected to '}
                <strong>
                  {status.owner}/{status.repo}
                </strong>{' '}
                on <code>{status.defaultBranch}</code>.
                {!status.canPush &&
                  ' Pushing is not configured on this deployment.'}{' '}
                <button type="button" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              </p>
            ) : (
              <p>
                No repository connected.{' '}
                {status.canConnect ? (
                  <button type="button" onClick={() => void connect()}>
                    Connect a repository
                  </button>
                ) : (
                  // Said rather than shown as a button that cannot work:
                  // pushing and connecting are configured separately.
                  <span>Connecting is not configured on this deployment.</span>
                )}
              </p>
            )}
          </>
        )}
    </section>
  );
}

function RepositoryPicker({
  offer,
  onChoose,
}: {
  offer: ConnectOffer;
  onChoose: (choice: RepositoryChoice) => void;
}) {
  if (offer.repositories.length === 0) {
    return (
      <p role="alert">
        None of the repositories Vibld can reach are ones you can push to. Check
        the app’s repository access on GitHub, then connect again.
      </p>
    );
  }
  return (
    <div>
      <p>Choose a repository to push to:</p>
      <ul className="github-panel__choices">
        {offer.repositories.map((choice) => (
          <li key={`${choice.installationId}:${choice.owner}/${choice.repo}`}>
            <button type="button" onClick={() => onChoose(choice)}>
              {choice.owner}/{choice.repo}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
