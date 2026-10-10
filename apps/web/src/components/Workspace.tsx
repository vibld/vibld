import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { locatePicks } from '@vibld/core';
import type { LocatedPick, ProjectSnapshot } from '@vibld/core';
import type { BuilderState, DraftPreview } from '../generation/session.ts';
import {
  showingChecked as isShowingChecked,
  showingStaged as isShowingStaged,
} from '../generation/ship-note.ts';
import {
  servingOlderThan,
  shouldUpdateLive,
  usePreviewSandbox,
} from '../generation/use-preview-sandbox.ts';
import { useBrowserPreview } from '../generation/use-browser-preview.ts';
import { onClerkSessionChange } from '../auth/clerk-token.ts';
import { detectDeploymentConfig } from '../generation/remote-provider.ts';
import type { PreviewMode } from '../generation/remote-provider.ts';
import { CodeViewer } from './CodeViewer.tsx';
import { FileList } from './FileList.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';
import { noteFor } from '../generation/pane-gaps.ts';
import { RunHistory } from './RunHistory.tsx';
import { CheckpointHistory } from './CheckpointHistory.tsx';

const TABS = [
  { id: 'preview', label: 'Preview' },
  { id: 'code', label: 'Code' },
  { id: 'console', label: 'Console' },
  { id: 'problems', label: 'Problems' },
  { id: 'history', label: 'History' },
  { id: 'runs', label: 'Runs' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Workspace({
  state,
  hidden = false,
  onCheckpointRestored,
  onCheckpointRestoring,
  onPick,
}: {
  state: BuilderState;
  /**
   * Something pointed at in the live preview (D188), located in the code
   * the preview is running, for the composer to attach.
   */
  /** A pick, located in the files of `revision`, the one it was made on. */
  onPick?: (pick: LocatedPick, revision: string | null) => void;
  /**
   * A checkpoint restored from the History tab (D152), for the session to
   * hold as the accepted one, so the preview and the next build follow it.
   */
  onCheckpointRestored?: (
    projectId: string,
    snapshot: ProjectSnapshot,
  ) => boolean | Promise<boolean>;
  /** A restore from the History tab sets off; answers its release. */
  onCheckpointRestoring?: () => () => void;
  /**
   * Off screen without being taken apart. The preview sandbox, the chosen
   * tab and the selected file are all live state this component owns, and
   * a trip to the admin page (internal issue 184) should cost none of it. The stylesheet
   * carries `[hidden] { display: none !important }`, which is what makes
   * the attribute beat `.workspace`'s own layout rules.
   */
  hidden?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('preview');
  const [requestedPath, setRequestedPath] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Owned here, not by PreviewPanel: this component does not unmount when a
  // tab switch hides PreviewPanel, so a running sandbox survives switching
  // to Code and back (see use-preview-sandbox.ts's own doc comment).
  // A deployment without sandbox containers runs the preview in this
  // browser instead (D125). Both hooks are always called, since hooks
  // cannot be chosen between; the one not in use is never asked to run.
  // Asked again on signing in: the probe is refused signed out, and a
  // sign-in from the header's modal does not reload the page.
  const [previewMode, setPreviewMode] = useState<PreviewMode>('sandbox');
  useEffect(() => {
    let live = true;
    const ask = () =>
      detectDeploymentConfig().then(
        (config) => {
          if (live) setPreviewMode(config.preview);
        },
        () => undefined,
      );
    void ask();
    let wasSignedIn: boolean | undefined;
    const unsubscribe = onClerkSessionChange((signedIn) => {
      if (signedIn === wasSignedIn) return;
      wasSignedIn = signedIn;
      if (signedIn) void ask();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const containerSandbox = usePreviewSandbox();
  const browserPreview = useBrowserPreview();
  const sandbox = previewMode === 'browser' ? browserPreview : containerSandbox;

  // A new revision reaches the running preview by itself (D74): an accepted
  // checkpoint, or a build's code shown early while it is checked (D69), is
  // written into the sandbox in place rather than left for a restart that
  // somebody has to notice they need. Here rather than in `PreviewPanel`
  // because the panel is unmounted on a tab switch, and the preview goes
  // on running while it is; `shouldUpdateLive` says when, and the hook
  // falls back to a restart when an update cannot be done in place.
  const code = state.early ?? state.acceptedSnapshot;
  const updateLive = useRef(sandbox.update);
  updateLive.current = sandbox.update;
  const projectId = state.projectId ?? null;
  const wantsUpdate = shouldUpdateLive(sandbox, code, projectId);
  const codeRef = useRef(code);
  codeRef.current = code;
  // What a pick is located in (D188): the revision the preview is actually
  // serving. A live update starts before the frame has the new files, and
  // a pick made in that gap is from the old page, so it is located in the
  // old files, or in none rather than the wrong ones.
  // In the browser, a change that fails to bundle leaves the old page up
  // while `ranRevision` moves on, so the page's own revision is the one
  // its status reports.
  const servedRevision =
    sandbox.mode === 'browser'
      ? sandbox.status?.status === 'ready'
        ? (sandbox.status.revision ?? null)
        : null
      : sandbox.ranRevision;
  const served = useRef<typeof code>(null);
  for (const candidate of [state.early, state.acceptedSnapshot, code]) {
    if (candidate && candidate.revision === servedRevision) {
      served.current = candidate;
    }
  }
  // While an update is going in (written, then typechecked) the page may
  // already show the new code or still the old: neither is known, so a
  // pick made then is not located and not kept.
  const ranRevision = useRef(servedRevision);
  ranRevision.current = sandbox.updating ? null : servedRevision;
  const servedFiles = () =>
    served.current && served.current.revision === ranRevision.current
      ? served.current.files
      : [];
  useEffect(() => {
    const next = codeRef.current;
    if (wantsUpdate && next) {
      updateLive.current(next.files, next.revision, projectId);
    }
  }, [wantsUpdate, code?.revision, projectId]);

  // A sandbox is a live copy of one project's checkpoint, and there is one
  // per account. Opening another project stops it, rather than leaving the
  // last project running under the new one's name and its share links
  // serving code the person has moved away from.
  const shownProject = useRef(state.projectId);
  const stopSandbox = useRef(sandbox.stop);
  stopSandbox.current = sandbox.stop;
  const sandboxRunning = sandbox.status !== null;
  const runningRef = useRef(sandboxRunning);
  runningRef.current = sandboxRunning;
  useEffect(() => {
    const left = shownProject.current;
    shownProject.current = state.projectId;
    if (left !== null && left !== state.projectId && runningRef.current) {
      stopSandbox.current();
    }
  }, [state.projectId]);

  // The draft preview (docs/decisions.md, 2026-09-28) gives way to the
  // live preview for good once that has run. Remembered here, which stays
  // mounted across tab switches, because afterwards the sandbox can be
  // stopped, and a pane that then went back to the sketch would be showing
  // a guess at a site somebody has already seen for real. Only once the
  // build is over: during a first build, a sandbox that is up is left over
  // from before and says nothing about this draft.
  const [retiredDraft, setRetiredDraft] = useState<DraftPreview | null>(null);
  const sandboxReady = sandbox.status?.status === 'ready';
  useEffect(() => {
    if (sandboxReady && !state.running && state.draft) {
      setRetiredDraft(state.draft);
    }
  }, [sandboxReady, state.running, state.draft]);
  const draft =
    state.draft && state.draft !== retiredDraft ? state.draft : null;

  // Derive the selection instead of storing it: when a run replaces the file
  // set, a selection that no longer exists falls back to the first file
  // rather than leaving the viewer pointed at a stale path.
  const files = state.stagedFiles;
  const selected =
    files.find((file) => file.path === requestedPath) ?? files[0] ?? null;
  /**
   * The list is a build's own code, shown while its check runs (D69, "show
   * early, badge it"): marked as being checked rather than as staged.
   */
  const showingChecked = isShowingChecked(state);
  /** The list is showing work that has not been accepted yet. */
  const showingStaged = isShowingStaged(state);

  function onTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    const lastIndex = TABS.length - 1;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight')
      nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === 'ArrowLeft')
      nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = TABS[nextIndex];
    setActiveTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <section className="workspace" aria-label="Workspace" hidden={hidden}>
      <div className="tabs" role="tablist" aria-label="Workspace views">
        {TABS.map((tab, index) => {
          const isActive = tab.id === activeTab;
          // A running sandbox is worth flagging on its tab specifically
          // because it keeps running while another tab is in view -- unlike
          // the problems/console counts, this is not otherwise visible at
          // all once the user has looked away from Preview.
          //
          // Which is exactly why it cannot say "live" for a sandbox serving
          // a checkpoint that has been moved on from. The panel says so on
          // its own face, but the whole point of this badge is the person
          // who is not looking at the panel, and to them "live" reads as
          // "your project is running" rather than "an older one is".
          const badge =
            tab.id === 'problems'
              ? state.problems.length || null
              : tab.id === 'console'
                ? state.timeline.length || null
                : tab.id === 'preview' && sandbox.updating
                  ? 'updating'
                  : tab.id === 'preview' && sandbox.status?.status === 'ready'
                    ? servingOlderThan(sandbox, code?.revision)
                      ? 'older'
                      : 'live'
                    : null;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-controls={`panel-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`tabs__tab${isActive ? ' tabs__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {tab.label}
              {badge !== null ? (
                <span className="tabs__count">{badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className="workspace__panel"
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'preview' ? (
          <PreviewPanel
            state={state}
            sandbox={sandbox}
            draft={draft}
            onPick={
              onPick
                ? (pick) =>
                    onPick(
                      locatePicks(pick, servedFiles()),
                      ranRevision.current,
                    )
                : undefined
            }
          />
        ) : null}

        {activeTab === 'code' ? (
          <div className="codepane">
            <div className="codepane__files">
              <h2 className="pane-title">
                Files
                {showingChecked ? (
                  <span className="pill pill--checking">being checked</span>
                ) : showingStaged ? (
                  <span className="pill pill--staged">staged</span>
                ) : null}
              </h2>
              {state.acceptedSnapshot ? (
                /*
                 * Export, publish and push used to sit here, and a real
                 * person looking for them could not find them (D72): they
                 * are under Ship, in the top bar, now, and only there, so
                 * one project never has two publish buttons disagreeing
                 * about its site. This says where they went, and, when the
                 * list below is not what they act on, says that too.
                 */
                <p className="pane-note">
                  Export, publish and push to GitHub are under Ship, at the top.
                  {showingChecked && showingStaged
                    ? ' They act on the last finished checkpoint, not the files listed below, which are still being checked.'
                    : showingStaged
                      ? ' They act on the last accepted checkpoint, not the staged files listed below.'
                      : null}
                </p>
              ) : null}
              <FileList
                files={files}
                selectedPath={selected?.path ?? null}
                onSelect={setRequestedPath}
              />
            </div>
            <div className="codepane__code">
              <CodeViewer file={selected} />
            </div>
          </div>
        ) : null}

        {activeTab === 'console' ? (
          <div className="console">
            <h2 className="pane-title">Console</h2>
            <p className="pane-note">{noteFor('console')}</p>
            {state.timeline.length === 0 ? (
              <p className="empty">No events yet.</p>
            ) : (
              <ol className="console__list">
                {state.timeline.map((entry) => (
                  <li
                    key={entry.id}
                    className={`console__entry console__entry--${entry.level}`}
                  >
                    {entry.message}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <CheckpointHistory
            runCount={state.runCount}
            projectId={state.projectId}
            // A reply on its way counts too: its brief was written for the
            // code a restore would replace. So does a restore still on its
            // way from before this pane was last shown, whose result would
            // land over a second one's, and a project still opening, whose
            // read could land after a restore and put the older code back
            // (Codex review of internal PR 360).
            building={
              state.running ||
              state.chatting ||
              state.restoring ||
              state.opening
            }
            transcript={state.transcript}
            {...(onCheckpointRestored
              ? { onRestored: onCheckpointRestored }
              : {})}
            {...(onCheckpointRestoring
              ? { onRestoring: onCheckpointRestoring }
              : {})}
          />
        ) : null}

        {activeTab === 'runs' ? (
          <RunHistory runCount={state.runCount} projectId={state.projectId} />
        ) : null}

        {activeTab === 'problems' ? (
          <div className="problems">
            <h2 className="pane-title">Problems</h2>
            <p className="pane-note">{noteFor('problems')}</p>
            {state.problems.length === 0 ? (
              <p className="empty">No problems reported.</p>
            ) : (
              <ul className="problems__list">
                {state.problems.map((problem) => (
                  <li key={problem} className="problems__item">
                    {problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
