import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import {
  noteConnectionChanged,
  onConnectionChanged,
  previewSnapshot,
  pushSnapshot,
} from '../github/github-client.ts';
// The same latest-wins rule the connect panel needed, deliberately used
// rather than written again: it is one generation counter with tests, and a
// second copy of it here would be a second place for it to be wrong.
import { createStatusGate } from '../github/panel-view.ts';
import { githubStatus } from '../github/github-status.ts';
import {
  afterConnectionChanged,
  decidePreview,
  decidePush,
  previewIsEmpty,
} from '../github/push-view.ts';
import type {
  Destination,
  PreviewPhase,
  PushPhase,
} from '../github/push-view.ts';
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
/**
 * One part of a diff, or nothing at all.
 *
 * An empty list renders as no list rather than as a heading with nothing
 * under it: three headings and one populated list reads as though the other
 * two failed to load.
 */
function DiffList({
  label,
  paths,
  tone,
}: {
  label: string;
  paths: string[];
  tone: 'add' | 'change' | 'remove';
}) {
  if (paths.length === 0) return null;
  return (
    <li className={`github-diff__group github-diff__group--${tone}`}>
      <p className="github-diff__label">
        {label} ({paths.length})
      </p>
      <ul className="github-diff__paths">
        {paths.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function GitHubPushButton({ snapshot }: { snapshot: ProjectSnapshot }) {
  // The panel's copy, not a second one (#34). Before this each kept its own
  // and probed separately, so the two could name different repositories at
  // the same moment: the panel's disconnect path carries a comment saying
  // exactly that.
  const status = useSyncExternalStore(
    githubStatus.subscribe,
    githubStatus.read,
  );
  const [phase, setPhase] = useState<PushPhase>({ at: 'idle' });
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>({
    at: 'none',
  });
  const pushes = useRef(createStatusGate());
  const previews = useRef(createStatusGate());

  // Probed on mount and again whenever the connection changes. This
  // component keeps its own copy of the status and the panel that binds a
  // repository is a sibling of it, so without the subscription a bind made
  // with the Code tab open leaves the button hidden and a disconnect leaves
  // it up, still naming the repository that is gone.
  // Outside the effect because a refused push reads the connection again:
  // the route is the one thing that can tell this browser its destination
  // has moved, which is the case no notification from inside it covers.
  // The store holds the supersede rule and the commit-what-you-got rule, so
  // this is only the ask.
  //
  // What it no longer does is blank the status first. That was this
  // component's way of never naming a repository that might be gone, and it
  // cannot be kept once the status is shared: blanking here would empty the
  // panel too, on every probe. It is safe to drop because the route is the
  // real guard -- a push names where it believes it is going, and
  // `/api/github/push` refuses one aimed at a binding that has moved and
  // says where it moved instead. A briefly stale name cannot become a push
  // to the wrong repository.
  const probe = useCallback(() => {
    void githubStatus.refresh();
  }, []);

  useEffect(() => {
    probe();
    const stop = onConnectionChanged(() => {
      // A push already in the air was aimed at the connection that has just
      // changed. `decidePush` will not describe it beside a destination it
      // did not go to, and this stops it landing on the phase at all, so a
      // rebind does not leave the button busy on account of a request whose
      // answer is about to be thrown away.
      pushes.current.supersede();
      setPhase(afterConnectionChanged);
      probe();
    });
    return () => {
      stop();
    };
  }, [probe]);

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
    // The preview goes with it. `decidePreview` would already refuse to draw
    // one from another checkpoint, and dropping it here means the request
    // behind it cannot land and put it back.
    previews.current.supersede();
    setPreviewPhase({ at: 'none' });
  }, [snapshot.revision]);

  /**
   * Ask what the push would do, on demand rather than on every checkpoint.
   *
   * On demand because it spends the same GitHub quota the push does, and a
   * preview fetched automatically after every generation spends it for
   * people who never look. The button is one click and the answer stays up
   * until the checkpoint or the destination moves.
   */
  async function preview(to: Destination) {
    const revision = snapshot.revision;
    const current = previews.current.begin();
    setPreviewPhase({ at: 'loading', to, revision });
    const result = await previewSnapshot(snapshot.files);
    if (!current()) return;
    setPreviewPhase(
      result.ok
        ? { at: 'ready', to, revision, preview: result.preview }
        : { at: 'problem', to, revision, error: result.error },
    );
  }

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
      // A push is the only thing here that finds out about a change made
      // somewhere else: the notification is per-document, so a rebind in
      // another tab, on another device, or a grant that simply expired
      // never reaches this browser on its own. Saying so refreshes the
      // panel in the header as well as this button, which is where somebody
      // told to reconnect has to go and which would otherwise still be
      // offering them Disconnect.
      //
      // After the phase rather than before it, so the listener has
      // something to keep: `afterConnectionChanged` drops a result and
      // keeps an explanation.
      if (pushed.movedTo) {
        setPhase({ at: 'moved', to: pushed.movedTo, error: pushed.error });
        noteConnectionChanged();
        return;
      }
      if (pushed.reconnect) {
        setPhase({ at: 'problem', to, error: pushed.error, reconnect: true });
        noteConnectionChanged();
        return;
      }
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
  const previewView = decidePreview(
    previewPhase,
    view.destination,
    snapshot.revision,
  );

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

      {/*
       * Offered beside the push rather than inside it. The push writes a
       * branch that is never force-pushed and opens a pull request other
       * people read, and the one thing nobody can see from here is what it
       * deletes: the branch carries the accepted checkpoint and nothing
       * else, so a file the repository has and this project does not is
       * gone from it.
       */}
      <button
        type="button"
        className="chip"
        onClick={() => void preview(view.destination)}
        disabled={previewView.show && previewView.busy}
      >
        {previewView.show && previewView.busy
          ? 'Checking…'
          : 'What would this change?'}
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

      {previewView.show && previewView.error && (
        <p role="alert" className="github-push__problem">
          {previewView.error}
        </p>
      )}

      {previewView.show && previewView.preview && (
        <div className="github-diff">
          <p className="github-diff__where">
            Against <code>{previewView.preview.baseBranch}</code> in{' '}
            <code>
              {previewView.preview.owner}/{previewView.preview.repo}
            </code>
            .
          </p>
          {previewIsEmpty(previewView.preview) ? (
            <p className="github-diff__none">
              Nothing would change: that branch would carry exactly what is
              there now.
            </p>
          ) : (
            <ul className="github-diff__lists">
              <DiffList
                label="Added"
                paths={previewView.preview.added}
                tone="add"
              />
              <DiffList
                label="Changed"
                paths={previewView.preview.changed}
                tone="change"
              />
              {/*
               * Last, and named as deletion rather than as "removed from
               * the list". It is the only part of a push that destroys
               * something, and it is the part a button marked "push" does
               * not say.
               */}
              <DiffList
                label="Deleted from the branch"
                paths={previewView.preview.removed}
                tone="remove"
              />
            </ul>
          )}
          {previewView.preview.unchanged > 0 && (
            <p className="github-diff__same">
              {previewView.preview.unchanged} file
              {previewView.preview.unchanged === 1 ? '' : 's'} unchanged.
            </p>
          )}
          {previewView.preview.truncated && (
            <p className="github-diff__partial">
              GitHub would not list the whole branch, so this is what would
              change among the files it did list. Treat the deletions as a
              floor, not a count.
            </p>
          )}
        </div>
      )}

      {view.lastPullRequest && (
        <p className="github-push__last">
          {/*
           * Named by what became of it rather than by its existence. A link
           * that says nothing about its state is the thing this replaced:
           * a merged pull request drawn exactly like one still waiting for
           * somebody.
           */}
          {view.lastPullRequest.state === 'merged'
            ? 'Merged: '
            : view.lastPullRequest.state === 'closed'
              ? 'Closed without merging: '
              : view.lastPullRequest.state === 'open'
                ? 'Open: '
                : 'Opened earlier: '}
          <a
            href={view.lastPullRequest.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <code>{view.lastPullRequest.branch}</code>
          </a>
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
              <code>{view.problem.conflict.attemptedTreeSha}</code>. vibld never
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
