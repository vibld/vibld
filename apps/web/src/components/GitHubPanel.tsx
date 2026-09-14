import { Show } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
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
import { createStatusGate, decidePanel } from '../github/panel-view.ts';
import type { PanelPhase } from '../github/panel-view.ts';
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

function GitHubConnection() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [phase, setPhase] = useState<PanelPhase>({ at: 'loading' });

  // Which answer about the connection is allowed to win. The rule and its
  // tests are in `panel-view.ts`; this is only where it is held, in a ref
  // rather than state because changing it must never draw anything.
  const gate = useRef(createStatusGate());

  /**
   * Read the status, and commit it only if no write has landed since.
   *
   * Without the gate the first probe races every write. It starts alongside
   * the callback exchange, so it can still be in flight when a repository is
   * bound, and it would then overwrite a confirmed binding with the
   * `connected: false` it read beforehand: a write that landed, shown as one
   * that never happened.
   */
  async function refreshStatus() {
    const commit = gate.current.begin();
    const current = await fetchGitHubStatus();
    if (current && commit()) setStatus(current);
  }

  // Finishing a return from GitHub, if that is what this page load is.
  useEffect(() => {
    let cancelled = false;

    // Claimed rather than read: StrictMode runs this effect twice in
    // development, and a plain read would have the first pass clear the
    // fragment and the replay find nothing. The claim also takes it off the
    // URL, because a single-use code in the address bar invites a reload
    // that can only fail.
    const handoff = claimHandoff(globalThis.location?.hash ?? '');

    // Started before anything is awaited, and deliberately not after the
    // status probe. The fragment is claimed and cleared by now and the signed
    // state expires in ten minutes, so letting a slow or hanging
    // `/api/github/status` sit in front of the exchange means a perfectly
    // good callback can be thrown away by a request that has nothing to do
    // with it. Shared between both StrictMode passes: completing twice would
    // spend the stored state on the first and fail the second's own check.
    const completing = handoff ? completeClaimedConnect(handoff) : null;
    if (handoff) {
      setPhase({ at: 'working', note: 'Finishing the GitHub connection…' });
    }

    // Alongside, never in front of it. The status only decides what the panel
    // offers once there is nothing in flight, and it is gated so that landing
    // late cannot undo a binding written while it was away.
    void (async () => {
      const commit = gate.current.begin();
      const current = await fetchGitHubStatus();
      if (!cancelled && current && commit()) setStatus(current);
    })();

    void (async () => {
      if (!completing) {
        if (!cancelled) setPhase({ at: 'idle' });
        return;
      }
      const finished = await completing;
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
    // Built from the reply rather than from a refresh. The write has already
    // landed, so a status request that fails here must not leave somebody
    // staring at nothing, unable to tell whether their repository connected.
    // A refresh is still attempted, and only used if it answers.
    //
    // Superseding first, so a probe started before this write cannot land
    // afterwards and put `connected: false` back over a repository that is
    // connected. What the reply does not say, it does not say: `canPush`
    // stays undefined here when nothing has reported it, and `decidePanel`
    // keeps that as unknown rather than reading it as a no.
    gate.current.supersede();
    setStatus((previous) => ({
      configured: true,
      canPush: previous?.canPush,
      canConnect: previous?.canConnect,
      connected: true,
      owner: bound.bound.owner,
      repo: bound.bound.repo,
      defaultBranch: bound.bound.defaultBranch,
      ...(bound.bound.expiresAt ? { expiresAt: bound.bound.expiresAt } : {}),
    }));
    setPhase({ at: 'idle' });
    await refreshStatus();
  }

  async function disconnect() {
    setPhase({ at: 'working', note: 'Disconnecting…' });
    const done = await disconnectRepository();
    if (!done.ok) {
      setPhase({ at: 'problem', error: done.error });
      return;
    }
    // Same rule as binding: the write landed, so say so without depending on
    // a second request succeeding, and supersede any read still in flight so
    // it cannot put the disconnected repository back.
    gate.current.supersede();
    setStatus((previous) =>
      previous
        ? { ...previous, connected: false, reason: 'revoked' }
        : previous,
    );
    setPhase({ at: 'idle' });
    await refreshStatus();
  }

  // Every decision about what appears lives in `decidePanel`, which is a
  // plain function with tests. Four findings on this feature were decisions
  // made in this file, where the test runner cannot reach them: it strips
  // TypeScript types and errors on JSX, so a component is typechecked and
  // never exercised. Below this line nothing reads `phase` or `status`, only
  // the view, so there is nothing left here to get wrong that a test could
  // not have caught.
  const view = decidePanel(phase, status);
  if (!view.show) return null;
  // Held in a const so the callback below closes over a definite offer rather
  // than reaching back into the view for a ticket TypeScript can no longer
  // prove is there.
  const picker = view.picker;

  return (
    <section className="github-panel">
      <h3>GitHub</h3>

      {view.working && <p role="status">{view.working}</p>}

      {view.problem && (
        <>
          <p role="alert" className="github-panel__problem">
            {view.problem.error}
            {view.problem.install && (
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
          {view.problem.retry && (
            <p>
              <button type="button" onClick={() => void connect()}>
                Try connecting again
              </button>
            </p>
          )}
        </>
      )}

      {picker && (
        <RepositoryPicker
          offer={picker}
          onChoose={(choice) => void choose(choice, picker.ticket)}
        />
      )}

      {view.summary?.connected === true && (
        <p>
          {view.summary.pushing === 'yes' ? 'Pushing to ' : 'Connected to '}
          <strong>
            {view.summary.owner}/{view.summary.repo}
          </strong>{' '}
          on <code>{view.summary.defaultBranch}</code>.
          {view.summary.pushing === 'no' &&
            ' Pushing is not configured on this deployment.'}{' '}
          <button type="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </p>
      )}

      {view.summary?.connected === false && (
        <p>
          No repository connected.{' '}
          {view.summary.canConnect ? (
            <button type="button" onClick={() => void connect()}>
              Connect a repository
            </button>
          ) : (
            // Said rather than shown as a button that cannot work: pushing
            // and connecting are configured separately.
            <span>Connecting is not configured on this deployment.</span>
          )}
        </p>
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
