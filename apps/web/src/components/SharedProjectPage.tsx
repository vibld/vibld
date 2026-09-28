import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProjectFile } from '@vibld/core';

import { SignInToContinue, useSignedIn } from '../auth/clerk.tsx';
import { navigate } from '../admin/use-pathname.ts';
import { Mark, WORDMARK } from './Mark.tsx';
import { CodeViewer } from './CodeViewer.tsx';
import { FileList } from './FileList.tsx';
import { PROJECTS_PATH, projectPath } from '../projects/project-route.ts';
import {
  intentFromSearch,
  sharePath,
  shareIntentPath,
} from '../projects/share-route.ts';
import type { ShareIntent } from '../projects/share-route.ts';
import {
  openShared,
  peekPendingIntent,
  rememberIntent,
  remixShared,
  shareStorage,
  sharedPreview,
  takePendingIntent,
} from '../projects/share-client.ts';
import type {
  ShareFailure,
  SharedPreviewStatus,
  SharedProject,
} from '../projects/share-client.ts';

/**
 * A shared project, as whoever its owner sent the link to sees it
 * (docs/decisions.md, "Resolved 2026-09-28", sharing): its live preview,
 * its code read-only, and a way to copy it into their own account.
 *
 * A page of its own rather than the builder with things switched off. It
 * renders for somebody who is not signed in, which the builder never does
 * (`AuthGate`), and it carries none of the builder's state, so there is
 * nothing of anybody's own work on screen beside somebody else's.
 *
 * **The live preview waits to be asked**, as the builder's does, and only
 * somebody signed in can ask (docs/decisions.md, 2026-09-28): a press
 * starts the one sandbox the link has (`share-handlers.ts`). Anybody may
 * watch it once it runs, so the page asks after it on arrival and shows a
 * preview somebody else already started, signed in or not. It is polled
 * while it installs, and shown in a frame from the preview domain, which
 * never shares cookies with this one.
 *
 * **Remix and starting the preview sign in first.** Signed out, either
 * press shows the sign-in form in place and remembers what was asked;
 * signing in (or up) comes back here with it (`?remix=1` or `?preview=1`,
 * and the tab's own storage for a sign-up that ends elsewhere), and it
 * carries on without a second press. A remix then opens the new project in
 * the builder.
 */

const POLL_MS = 3_000;

type Remix =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'failed'; failure: ShareFailure };

/** What the link's query asks to carry on with, after a sign-in. */
function intentInAddress(): ShareIntent | null {
  if (typeof window === 'undefined') return null;
  return intentFromSearch(window.location.search);
}

const SIGN_IN_NOTE: Record<ShareIntent, string> = {
  remix:
    'Sign in to copy this project into your account. You come back here, and the remix carries on.',
  preview:
    'Sign in to run the live preview. You come back here, and it starts.',
};

function isRunning(status: SharedPreviewStatus): boolean {
  return (
    status.status === 'ready' ||
    status.status === 'queued' ||
    status.status === 'installing' ||
    status.status === 'starting'
  );
}

function describePreview(status: SharedPreviewStatus | null): string {
  if (!status) return '';
  switch (status.status) {
    case 'queued':
      return `Queued for a sandbox (position ${status.position})…`;
    case 'ready-to-start':
    case 'installing':
      return 'Installing…';
    case 'starting':
      return 'Starting…';
    default:
      return '';
  }
}

export function SharedProjectPage({ token }: { token: string }) {
  return (
    <SharedProjectView
      token={token}
      signedIn={useSignedIn()}
      signIn={(returnTo) => <SignInToContinue returnTo={returnTo} />}
    />
  );
}

/**
 * The page itself, told whether somebody is signed in and how to ask them
 * to, rather than reading Clerk: so it can be exercised without a Clerk
 * session, which is the part of it no test here can supply.
 */
export function SharedProjectView({
  token,
  signedIn,
  signIn,
}: {
  token: string;
  /** Null until it is known. */
  signedIn: boolean | null;
  signIn: (returnTo: string) => ReactNode;
}) {
  const [project, setProject] = useState<SharedProject | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<SharedPreviewStatus | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [remix, setRemix] = useState<Remix>({ phase: 'idle' });
  const [signingInFor, setSigningInFor] = useState<ShareIntent | null>(null);
  const remixing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void openShared(token).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setProject(result.value);
        setGone(null);
      } else {
        setGone(result.failure.message);
        // Something waiting on a link that no longer works would otherwise
        // bring every later visit to the builder back here.
        if (
          result.failure.kind === 'gone' &&
          peekPendingIntent(shareStorage())?.token === token
        ) {
          takePendingIntent(shareStorage());
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // A preview somebody already started is anybody's to watch: its state is
  // public, so it is asked for once on arrival, and adopted only if it is
  // running or on its way.
  const livePreview = project?.livePreview === true;
  useEffect(() => {
    if (!livePreview) return;
    let cancelled = false;
    void sharedPreview(token, false).then((result) => {
      if (cancelled || !result.ok || !isRunning(result.value)) return;
      setPreview((shown) => shown ?? result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [livePreview, token]);

  // Poll the preview while it is on its way, and stop once it is ready or
  // has failed: nothing about either changes until somebody asks again.
  const pending =
    preview !== null &&
    (preview.status === 'queued' ||
      preview.status === 'installing' ||
      preview.status === 'starting');
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      void sharedPreview(token, false).then((result) => {
        if (result.ok) setPreview(result.value);
        else setPreviewError(result.failure.message);
      });
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [pending, preview, token]);

  async function startPreview() {
    setStarting(true);
    setPreviewError(null);
    const result = await sharedPreview(token, true);
    setStarting(false);
    if (result.ok) setPreview(result.value);
    else setPreviewError(result.failure.message);
  }

  async function doRemix() {
    if (remixing.current) return;
    remixing.current = true;
    setRemix({ phase: 'working' });
    const result = await remixShared(token);
    remixing.current = false;
    if (result.ok) {
      navigate(projectPath(result.value.id));
      return;
    }
    setRemix({ phase: 'failed', failure: result.failure });
  }

  /** Sign in first, remembering what was asked, then carry it on. */
  function signInFor(intent: ShareIntent) {
    rememberIntent(shareStorage(), { token, intent });
    setSigningInFor(intent);
  }

  function askToRemix() {
    if (signedIn) void doRemix();
    else signInFor('remix');
  }

  function askToPreview() {
    if (signedIn) void startPreview();
    else signInFor('preview');
  }

  // Carry on what was asked for before signing in, once, when the page
  // comes back signed in.
  const carried = useRef(false);
  useEffect(() => {
    if (signedIn !== true || !project || carried.current) return;
    const pending = peekPendingIntent(shareStorage());
    const intent =
      intentInAddress() ?? (pending?.token === token ? pending.intent : null);
    if (!intent) return;
    carried.current = true;
    takePendingIntent(shareStorage());
    if (typeof window !== 'undefined' && intentInAddress()) {
      window.history.replaceState(null, '', sharePath(token));
    }
    if (intent === 'remix') void doRemix();
    else if (project.livePreview && project.snapshot) void startPreview();
    // `doRemix` and `startPreview` read only `token`; `carried` makes this
    // happen once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, project, token]);

  const files: ProjectFile[] = project?.snapshot?.files ?? [];
  const file =
    files.find((entry) => entry.path === selected) ??
    files.find((entry) => entry.path === 'src/App.tsx') ??
    files[0] ??
    null;

  return (
    <div className="shared">
      <header className="shell__header shared__header">
        <a className="shell__brand shared__brand" href="/">
          <span className="shell__logo">
            <Mark size={22} />
          </span>
          <p className="shell__name">{WORDMARK}</p>
        </a>
        {project ? (
          <>
            <h1 className="shared__title">{project.name}</h1>
            <div className="shared__actions">
              <button
                type="button"
                className="button"
                onClick={askToRemix}
                disabled={remix.phase === 'working' || signedIn === null}
              >
                {remix.phase === 'working' ? 'Remixing…' : 'Remix'}
              </button>
            </div>
          </>
        ) : null}
      </header>

      <main className="shared__body">
        {gone ? (
          <div className="preview__empty">
            <p className="preview__empty-title">This link is not active</p>
            <p className="preview__empty-text">{gone}</p>
          </div>
        ) : !project ? (
          <p className="empty" role="status">
            Loading…
          </p>
        ) : (
          <>
            {signingInFor && signedIn === false ? (
              <section className="shared__signin" aria-label="Sign in">
                <p className="pane-note">{SIGN_IN_NOTE[signingInFor]}</p>
                {signIn(shareIntentPath(token, signingInFor))}
              </section>
            ) : null}
            {remix.phase === 'failed' ? (
              <p className="pane-note pane-note--error" role="alert">
                {remix.failure.message}{' '}
                {remix.failure.kind === 'limit' ? (
                  <a href={PROJECTS_PATH}>Open your projects</a>
                ) : null}
              </p>
            ) : null}

            <section className="shared__preview" aria-label="Preview">
              {preview?.status === 'ready' ? (
                <iframe
                  className="preview__frame"
                  title={`Live preview of ${project.name}`}
                  src={preview.url}
                />
              ) : (
                <div className="preview__empty">
                  {!project.snapshot ? (
                    <p className="preview__empty-title">
                      Nothing has been built in this project yet
                    </p>
                  ) : !project.livePreview ? (
                    <p className="preview__empty-text">
                      Live previews are not available here. The code is below.
                    </p>
                  ) : (
                    <>
                      {preview?.status === 'failed' ? (
                        <p className="preview__error" role="alert">
                          {preview.error}
                        </p>
                      ) : null}
                      {previewError ? (
                        <p className="preview__error" role="alert">
                          {previewError}
                        </p>
                      ) : null}
                      {pending ? (
                        <p className="preview__empty-text" role="status">
                          {describePreview(preview)}
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="button"
                          onClick={askToPreview}
                          disabled={starting || signedIn === null}
                        >
                          {starting
                            ? 'Starting…'
                            : signedIn === false
                              ? 'Sign in to run the live preview'
                              : 'Run live preview'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="codepane shared__code" aria-label="Code">
              <div className="codepane__files">
                <h2 className="pane-title">Files</h2>
                <FileList
                  files={files}
                  selectedPath={file?.path ?? null}
                  onSelect={setSelected}
                />
              </div>
              <div className="codepane__code">
                <CodeViewer file={file} />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
