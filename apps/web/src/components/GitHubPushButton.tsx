import { useEffect, useState } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import { fetchGitHubStatus, pushSnapshot } from '../github/github-client.ts';
import type { GitHubStatus } from '../github/github-client.ts';
import { decidePush } from '../github/push-view.ts';
import type { PushPhase } from '../github/push-view.ts';
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await fetchGitHubStatus();
      if (!cancelled && current) setStatus(current);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A different checkpoint is a different push. Without this, the branch
  // named by the last one stays on screen beside a project that has moved
  // on, which reads as though the new work is already on GitHub.
  useEffect(() => {
    setPhase({ at: 'idle' });
  }, [snapshot.revision]);

  async function push() {
    setPhase({ at: 'pushing' });
    const pushed = await pushSnapshot(snapshot);
    if (!pushed.ok) {
      setPhase({
        at: 'problem',
        error: pushed.error,
        ...(pushed.reconnect ? { reconnect: true } : {}),
      });
      return;
    }
    setPhase({ at: 'done', pushed: pushed.pushed });
  }

  if (!clerkConfigured) return null;
  const view = decidePush(phase, status);
  if (!view.show) return null;

  return (
    <div className="github-push">
      <button type="button" onClick={() => void push()} disabled={view.busy}>
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
          {view.problem.reconnect &&
            ' Reconnect the repository in the GitHub panel.'}
        </p>
      )}
    </div>
  );
}
