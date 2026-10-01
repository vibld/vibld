import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuilderState, DraftPreview } from '../generation/session.ts';
import { buildPreviewDocument } from '../generation/preview.ts';
import {
  PREVIEW_MESSAGE,
  PREVIEW_SANDBOX,
} from '../browser-preview/document.ts';
import { PACKAGE_CDN } from '../browser-preview/import-map.ts';
import type { BrowserPreviewPage } from '../generation/use-browser-preview.ts';
import { servingOlderThan } from '../generation/use-preview-sandbox.ts';
import type { PreviewSandbox } from '../generation/use-preview-sandbox.ts';
import {
  DRAFT_BUILDING_LABEL,
  DRAFT_BUILT_LABEL,
  DraftPreview as DraftView,
} from './DraftPreview.tsx';
import { BuildCheckBadge } from './BuildCheckBadge.tsx';
import { LifecycleBar } from './LifecycleBar.tsx';
import { ProgressMeter } from './ProgressMeter.tsx';

function describeStatus(
  status: PreviewSandbox['status'],
  mode: PreviewSandbox['mode'] = 'sandbox',
): string | null {
  if (!status) return null;
  if (mode === 'browser' && status.status === 'starting') {
    return 'Bundling your app in this browser…';
  }
  switch (status.status) {
    case 'queued':
      return `Queued for a sandbox (position ${status.position})…`;
    case 'ready-to-start':
      return 'Waiting for a sandbox…';
    case 'installing':
      return 'Installing dependencies…';
    case 'starting':
      return 'Starting the dev server…';
    case 'ready':
      return null; // The frame itself is the status, once it is up.
    case 'failed':
      return status.error;
  }
}

/**
 * Real sandbox execution (docs/decisions.md L7-L11, ADR-0004) once it is
 * running, otherwise the same local mock this panel has always shown. The
 * two are mutually exclusive on screen -- a stale mock sitting next to a
 * live, installed copy of the same project would only invite confusion
 * about which one is actually being looked at.
 */
export function PreviewPanel({
  state,
  sandbox,
  draft = null,
}: {
  state: BuilderState;
  sandbox: PreviewSandbox;
  /**
   * The sketch to show while a first build runs (docs/decisions.md,
   * 2026-09-28, the draft preview), or null. Passed rather than read from
   * `state` because `Workspace` retires it once the live preview has run,
   * and that is knowledge about the sandbox, which the session does not
   * have.
   */
  draft?: DraftPreview | null;
}) {
  const mockDocument = useMemo(() => {
    if (!state.acceptedBrief || !state.acceptedSnapshot) return null;
    return buildPreviewDocument(state.acceptedBrief, state.acceptedSnapshot);
  }, [state.acceptedBrief, state.acceptedSnapshot]);

  const inBrowser = sandbox.mode === 'browser';
  const statusMessage = describeStatus(sandbox.status, sandbox.mode);
  const running = sandbox.status !== null && sandbox.status.status !== 'failed';
  // The code on screen: a build's own while it is being checked (D69, shown
  // early with a badge), and otherwise the accepted checkpoint.
  const code = state.early ?? state.acceptedSnapshot;
  const checking =
    state.running &&
    code !== null &&
    (state.check?.state === 'checking' || state.check?.state === 'repairing');
  const runAccepted = () => {
    if (!code) return;
    sandbox.run(code.files, code.revision, state.projectId ?? null);
  };

  // A sandbox is a live copy of the checkpoint it was started from, and
  // accepting a later one does not change what it is serving. Left unsaid,
  // the frame reads as "this is your project" while showing work that has
  // been moved on from, which is the same thing the push and publish
  // buttons were fixed for: the address is still live, it is just live on
  // the previous checkpoint. The mock beside it is rebuilt from the
  // accepted snapshot every time, so only the sandbox can say this.
  const servingOlder = servingOlderThan(sandbox, code?.revision);

  // The draft, while its build runs. Ahead of a ready sandbox as well: a
  // first build has no checkpoint of its own to be serving, so a sandbox
  // that is up now is left over from before, and the draft is the nearer
  // picture of what is coming.
  // Not once the build's own code is here to run (D69): that is nearer
  // than any sketch, even while it is being checked.
  const draftWhileBuilding = draft !== null && state.running && !checking;
  // And after, until the live preview is running. Accepting the build does
  // not start a sandbox, so without this the sketch would give way to an
  // empty pane with a button in it, which is the waiting state the draft
  // exists to replace. A sandbox that failed shows its failure as it
  // always has, with Try again.
  const draftAfterBuild =
    draft !== null &&
    ((!state.running && state.status === 'accepted') || checking) &&
    code !== null &&
    sandbox.status?.status !== 'ready' &&
    sandbox.status?.status !== 'failed';

  return (
    <div className="preview">
      <BuildCheckBadge check={state.check} />

      {/*
        A new revision on its way into the running preview (D74), said in
        place of the notice below rather than beside it: the sandbox is not
        being left behind, it is being brought up to date, and "restart it"
        would ask somebody to do by hand what is already happening.
      */}
      {sandbox.updating ? (
        <p className="pane-note" role="status">
          Updating preview…
        </p>
      ) : servingOlder ? (
        <p className="pane-note" role="status">
          This sandbox is running the checkpoint it was started from, not the
          one accepted since. Restart it in the sandbox to run the current
          project.
        </p>
      ) : null}
      {/*
        A restart nobody pressed, explained: the update could not be
        applied in place, so the preview was started again, and why.
      */}
      {sandbox.updateNote ? (
        <p className="pane-note" role="status">
          {sandbox.updateNote}
        </p>
      ) : null}

      {draftWhileBuilding ? (
        <DraftView draft={draft} label={DRAFT_BUILDING_LABEL}>
          <LifecycleBar status={state.status} phase={state.progress?.phase} />
          <ProgressMeter progress={state.progress} announce={false} />
        </DraftView>
      ) : sandbox.status?.status === 'ready' && sandbox.page ? (
        <BrowserFrame key={sandbox.page.key} page={sandbox.page} />
      ) : sandbox.status?.status === 'ready' ? (
        <iframe
          className="preview__frame"
          title="Sandbox preview of the generated application"
          src={sandbox.status.url}
        />
      ) : draftAfterBuild ? (
        <DraftView draft={draft} label={DRAFT_BUILT_LABEL}>
          {running ? (
            <>
              <p className="preview__draft-status" role="status">
                {statusMessage}
              </p>
              <span className="preview__working" aria-hidden="true" />
            </>
          ) : (
            <button
              type="button"
              className="button button--primary"
              disabled={sandbox.pending}
              onClick={runAccepted}
            >
              Run live preview
            </button>
          )}
        </DraftView>
      ) : mockDocument ? (
        <>
          <p className="preview__notice">
            <strong>Quick mock.</strong> Static HTML from the plan, with no code
            run.{' '}
            {inBrowser
              ? 'Run the live preview for the real app.'
              : 'Run it in the sandbox for the real app.'}
          </p>
          <iframe
            className="preview__frame"
            title="Local mock preview of the generated application"
            srcDoc={mockDocument}
            sandbox=""
          />
        </>
      ) : (
        // One state in the middle of the pane, with the one thing to do
        // next. It used to be a paragraph about the mock renderer (which a
        // model-built project cannot use) above a small chip at the bottom
        // edge, so the way to see the app was the least visible thing here.
        <div className="preview__empty">
          {!code ? (
            <>
              <p className="preview__empty-title">Nothing to preview yet</p>
              <p className="preview__empty-text">
                Your app appears here once vibld has built it.
              </p>
            </>
          ) : sandbox.status?.status === 'failed' ? (
            <>
              <p className="preview__empty-title">The preview did not start</p>
              <p className="preview__error" role="alert">
                {sandbox.status.error}
              </p>
              <button
                type="button"
                className="button button--primary"
                disabled={sandbox.pending}
                onClick={runAccepted}
              >
                Try again
              </button>
            </>
          ) : running ? (
            <>
              <p className="preview__empty-title" role="status">
                {statusMessage}
              </p>
              <p className="preview__empty-text">
                {inBrowser
                  ? 'The first run loads the bundler, which takes a few seconds.'
                  : sandbox.updating
                    ? "This change touches the project's dependencies, so they are installed before the preview comes back."
                    : 'The first start installs the project, which takes a minute or two.'}
              </p>
              <span className="preview__working" aria-hidden="true" />
            </>
          ) : (
            <>
              <p className="preview__empty-title">Ready to run</p>
              <p className="preview__empty-text">
                {inBrowser
                  ? 'Bundles your app in this browser, so you can click through it.'
                  : 'Installs and starts your app in a private sandbox, so you can click through it.'}
              </p>
              <button
                type="button"
                className="button button--primary"
                disabled={sandbox.pending}
                onClick={runAccepted}
              >
                Run live preview
              </button>
            </>
          )}
        </div>
      )}

      {code && (mockDocument || running) ? (
        <>
          <div className="preview__sandbox">
            {mockDocument || sandbox.status?.status === 'ready' ? (
              <button
                type="button"
                className="chip"
                disabled={sandbox.pending}
                onClick={runAccepted}
              >
                {sandbox.status?.status === 'ready'
                  ? 'Restart'
                  : 'Run live preview'}
              </button>
            ) : null}
            {running ? (
              <button
                type="button"
                className="chip"
                disabled={sandbox.pending}
                onClick={() => sandbox.stop()}
              >
                Stop
              </button>
            ) : null}
            {sandbox.status?.status === 'ready' && inBrowser ? (
              <span className="preview__expiry">
                Running in this browser, with packages from{' '}
                {new URL(PACKAGE_CDN).host}
              </span>
            ) : sandbox.status?.status === 'ready' ? (
              <span className="preview__expiry">
                Expires around{' '}
                {new Date(sandbox.status.expiresAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
          {/* Beside the mock only: without one, the state in the middle of
              the pane already says this. */}
          {mockDocument && statusMessage ? (
            <p
              className={`pane-note${sandbox.status?.status === 'failed' ? ' pane-note--error' : ''}`}
              role={sandbox.status?.status === 'failed' ? 'alert' : undefined}
            >
              {statusMessage}
            </p>
          ) : null}
        </>
      ) : null}

      {code ? (
        <>
          {/*
            A stop that could not be confirmed. Not "the sandbox is still
            running", which a rejected request does not establish: the
            DELETE may have been carried out and its reply lost. What is
            known is that nothing came back to say so, and the sandbox may
            still be up and still serving any share link pointed at it. Stop
            is pressed by somebody who wants it not running, so "done" is
            the one answer that stops them trying again, and the opposite
            certainty would be just as invented.
          */}
          {sandbox.stopError ? (
            <p className="pane-note pane-note--error" role="alert">
              The sandbox may still be running: the stop could not be confirmed.{' '}
              {sandbox.stopError}
            </p>
          ) : null}
          {/*
            The project's own typecheck failed (internal issue 194). Said here rather than
            left for the frame to show, because what the frame shows is
            Vite's own transform error, which reads as Vibld being broken.

            Named as exactly what ran and exactly what it reported (internal PR 195
            review). An earlier draft said the project "does not typecheck,
            so npm run build would fail", and neither half was established:
            the model writes the manifest, the prompt requires a "build" and
            a "typecheck" script without requiring the first to invoke the
            second, and "typecheck" is whatever that manifest declares
            rather than tsc by definition. What is known is that
            npm run typecheck exited non-zero and printed this, so that is
            what this says.

            Not an error state, and deliberately not styled as one: the
            preview is running, the sandbox is up, and the dev server is
            serving. What is wrong is in the project, which is the user's
            to edit, and `npm run build` is where it would otherwise have
            surfaced -- on their own machine, after an export.

            `role="status"` and not `alert`: it arrives with a preview
            somebody asked for and is already looking at, so it is news
            rather than an interruption.
          */}
          {sandbox.status?.status === 'ready' &&
          sandbox.status.typecheckFailure ? (
            <div className="pane-note" role="status">
              <p>
                The preview is running, but this project&rsquo;s own{' '}
                <code>npm run typecheck</code> failed. What it said:
              </p>
              <pre className="preview__typecheck">
                {sandbox.status.typecheckFailure}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}

      {sandbox.status?.status === 'ready' && !inBrowser ? (
        <SharePanel sandbox={sandbox} />
      ) : null}
    </div>
  );
}

/**
 * The in-browser preview's page (D125), in an iframe with no origin of its
 * own (`PREVIEW_SANDBOX`). It asks for its media and public files by
 * message once it has loaded, and reports what the app throws, which is
 * said below the frame: the frame itself has no console anybody sees.
 */
function BrowserFrame({ page }: { page: BrowserPreviewPage }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as {
        source?: unknown;
        kind?: unknown;
        message?: unknown;
      } | null;
      if (
        !frame.current ||
        event.source !== frame.current.contentWindow ||
        data?.source !== PREVIEW_MESSAGE.fromPage
      ) {
        return;
      }
      if (data.kind === 'assets') {
        frame.current.contentWindow?.postMessage(
          {
            source: PREVIEW_MESSAGE.fromBuilder,
            assets: page.assets,
          },
          // The page has no origin to name, which is the point of it.
          '*',
        );
      } else if (data.kind === 'error' && typeof data.message === 'string') {
        setError(data.message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [page]);

  return (
    <>
      <iframe
        ref={frame}
        className="preview__frame"
        title="In-browser preview of the generated application"
        srcDoc={page.document}
        sandbox={PREVIEW_SANDBOX}
      />
      {error ? (
        <p className="pane-note pane-note--error" role="alert">
          The app reported an error: {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * Share links (docs/decisions.md L10): several may be active at once, each
 * independently revocable, unaffected by anything else here -- restarting
 * or stopping the sandbox this panel already handles above, not a share.
 */
function SharePanel({ sandbox }: { sandbox: PreviewSandbox }) {
  const active = sandbox.shares.filter((share) => !share.revoked);

  return (
    <div className="preview__shares">
      <div className="preview__shares-header">
        <button
          type="button"
          className="chip"
          disabled={sandbox.sharePending}
          onClick={() => sandbox.share()}
        >
          Share
        </button>
        {/* ADR-0006: a share grants access to a running, live copy of this
            project's own content -- the warning is part of the flow, not
            an afterthought in a tooltip nobody opens. */}
        <span className="preview__share-warning">
          Anyone with a share link can view this running app and everything it
          shows, until it&apos;s revoked or expires.
        </span>
      </div>

      {active.length > 0 ? (
        <ul className="preview__share-list">
          {active.map((share) => (
            <li key={share.shareId} className="preview__share-item">
              <code className="preview__share-url">{share.url}</code>
              <span className="preview__expiry">
                Expires {new Date(share.expiresAt).toLocaleString()}
              </span>
              <button
                type="button"
                className="chip"
                disabled={sandbox.sharePending}
                onClick={() => sandbox.revokeShare(share.shareId)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {sandbox.shareError ? (
        <p className="pane-note pane-note--error" role="alert">
          {sandbox.shareError}
        </p>
      ) : null}
    </div>
  );
}
