import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
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
import { CodeViewer } from './CodeViewer.tsx';
import { FileList } from './FileList.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';
import { noteFor } from '../generation/pane-gaps.ts';
import { RunHistory } from './RunHistory.tsx';

const TABS = [
  { id: 'preview', label: 'Preview' },
  { id: 'code', label: 'Code' },
  { id: 'console', label: 'Console' },
  { id: 'problems', label: 'Problems' },
  { id: 'runs', label: 'Runs' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Workspace({
  state,
  hidden = false,
}: {
  state: BuilderState;
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
  const sandbox = usePreviewSandbox();

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
          <PreviewPanel state={state} sandbox={sandbox} draft={draft} />
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
