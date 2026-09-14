import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import {
  fetchGitHubStatus,
  onConnectionChanged,
  pushSnapshot,
} from '../github/github-client.ts';
import type { GitHubStatus } from '../github/github-client.ts';
// The same latest-wins rule the connect panel needed, deliberately used
// rather than written again: it is one generation counter with tests, and a
// second copy of it here would be a second place for it to be wrong.
import { createStatusGate } from '../github/panel-view.ts';
import { decidePush } from '../github/push-view.ts';
import type { Destination, PushPhase } from '../github/push-view.ts';
import { clerkConfigured } from '../auth/clerk-token.ts';

/**
 * Send an accepted checkpoint to the connected repository.
 *
 * #120 landed the route and the store and #122 landed the connecting, and
 * until this nothing in the builder called `/api/github/push`: the feature
 * was reachable only with a hand-written request. This is the caller.
 *
 * Offered for an accepted checkpoint only, the same rule `ExportButton`
 * follows. Staged files have not been validated, and opening a pull request
 * full of a project that was about to be rejected is worse than offering
 * nothing.
 *
 * Every decision about whether to appear and what to say lives in
 * `decidePush`, which is a plain function with tests. The runner errors on
 * JSX, so a rule written in here would be typechecked and never run, which
 * is how four findings reached review on the connect panel.
 */
export function GitHubPushButton({ snapshot }: { snapshot: ProjectSnapshot }) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [phase, setPhase] = useState<PushPhase>({ at: 'idle' });
  const probes = useRef(createStatusGate());
  const pushes = useRef(createStatusGate());

  // Probed on mount and again whenever the connection changes. This
  // component keeps its own copy of the status and the panel that binds a
  // repository is a sibling of it, so without the subscription a bind made
  // with the Code tab open leaves the button hidden and a disconnect leaves
  // it up, still naming the repository that is gone.
  useEffect(() => {
    const gate = probes.current;
    function probe() {
      gate.supersede();
      const current = gate.begin();
      // Forgotten before it is read again, so a probe that fails leaves the
      // button hidden rather than naming a repository somebody has just
      // disconnected. An unknown connection and a connection that is gone
      // are not the same thing, but they offer the same thing: nothing.
      setStatus(null);
      void (async () => {
        const read = await fetchGitHubStatus();
        if (current() && read) setStatus(read);
      })();
    }
    probe();
    const stop = onConnectionChanged(() => {
      // A push already in the air was aimed at the connection that has just
      // changed. `decidePush` will not describe it beside a destination it
      // did not go to, and this stops it landing on the phase at all, so a
      // rebind does not leave the button busy on account of a request whose
      // answer is about to be thrown away.
      pushes.current.supersede();
      setPhase({ at: 'idle' });
      probe();
    });
    return () => {
      stop();
      // Nothing in flight may land after this: the last word on an unmounted
      // component is a React warning and nothing a user sees.
      gate.supersede();
    };
  }, []);

  // A different checkpoint is a different push. Without this, the branch
  // named by the last one stays on screen beside a project that has moved
  // on, which reads as though the new work is already on GitHub.
  //
  // Superseding as well as clearing, because clearing alone only hides the
  // stale result until the request behind it lands: a push of the previous
  // snapshot still in flight would then draw its branch beside the new one.
  useEffect(() => {
    pushes.current.supersede();
    setPhase({ at: 'idle' });
  }, [snapshot.revision]);

  async function push(to: Destination) {
    const current = pushes.current.begin();
    setPhase({ at: 'pushing', to });
    const pushed = await pushSnapshot(snapshot, to);
    // The checkpoint this was for is no longer the one on screen. The push
    // itself stands -- the route keys it on the revision and the branch is
    // there -- but saying so beside a different project would be describing
    // work that is not the work in view.
    if (!current()) return;
    if (!pushed.ok) {
      setPhase({
        at: 'problem',
        to,
        error: pushed.error,
        ...(pushed.reconnect ? { reconnect: true } : {}),
        ...(pushed.conflict ? { conflict: pushed.conflict } : {}),
      });
      return;
    }
    setPhase({ at: 'done', to, pushed: pushed.pushed });
  }

  if (!clerkConfigured) return null;
  const view = decidePush(phase, status);
  if (!view.show) return null;

  return (
    <div className="github-push">
      <button
        type="button"
        onClick={() => void push(view.destination)}
        disabled={view.busy}
      >
        {view.busy
          ? 'Pushing…'
          : `Push to ${view.destination.owner}/${view.destination.repo}`}
      </button>

      {view.outcome && (
        <p role="status">
          {view.outcome.created
            ? 'Pushed to '
            : 'Already on GitHub, unchanged, at '}
          <code>{view.outcome.branch}</code>.
          {view.outcome.pullRequestUrl && (
            <>
              {' '}
              <a
                href={view.outcome.pullRequestUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the pull request
              </a>
            </>
          )}
        </p>
      )}

      {view.problem && (
        <p role="alert" className="github-push__problem">
          {view.problem.error}
          {view.problem.conflict && (
            <>
              {' '}
              That branch is at commit{' '}
              <code>{view.problem.conflict.existingSha}</code>, and this
              checkpoint builds tree{' '}
              <code>{view.problem.conflict.attemptedTreeSha}</code>. Vibld never
              overwrites a branch.
            </>
          )}
          {view.problem.reconnect &&
            ' Reconnect the repository in the GitHub panel.'}
        </p>
      )}
    </div>
  );
}
