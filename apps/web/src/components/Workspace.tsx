import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ProjectFile } from '@vibld/core';
import type { BuilderState } from '../generation/session.ts';
import {
  servingOlderThan,
  usePreviewSandbox,
} from '../generation/use-preview-sandbox.ts';
import { CodeViewer } from './CodeViewer.tsx';
import { ExportButton } from './ExportButton.tsx';
import { FileList } from './FileList.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';
import { PublishButton } from './PublishButton.tsx';
import { GitHubPushButton } from './GitHubPushButton.tsx';

const TABS = [
  { id: 'preview', label: 'Preview' },
  { id: 'code', label: 'Code' },
  { id: 'console', label: 'Console' },
  { id: 'problems', label: 'Problems' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/**
 * Whether the listed files are the accepted checkpoint's own.
 *
 * Compared rather than inferred from `status`. A submission refused before
 * it starts (the budget reservation in `BuilderSession.submit`) leaves the
 * status `failed` and never touches `stagedFiles`, so after an accepted
 * checkpoint the list is still that checkpoint while the status says
 * otherwise. Reading the status there marks the list "staged" and tells
 * somebody the buttons act on something else, both about the very files
 * they are looking at.
 */
function sameFiles(listed: ProjectFile[], accepted: ProjectFile[]): boolean {
  return (
    listed.length === accepted.length &&
    listed.every(
      (file, index) =>
        file.path === accepted[index]?.path &&
        file.content === accepted[index]?.content,
    )
  );
}

export function Workspace({ state }: { state: BuilderState }) {
  const [activeTab, setActiveTab] = useState<TabId>('preview');
  const [requestedPath, setRequestedPath] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Owned here, not by PreviewPanel: this component does not unmount when a
  // tab switch hides PreviewPanel, so a running sandbox survives switching
  // to Code and back (see use-preview-sandbox.ts's own doc comment).
  const sandbox = usePreviewSandbox();

  // Derive the selection instead of storing it: when a run replaces the file
  // set, a selection that no longer exists falls back to the first file
  // rather than leaving the viewer pointed at a stale path.
  const files = state.stagedFiles;
  const selected =
    files.find((file) => file.path === requestedPath) ?? files[0] ?? null;
  /** The list is showing work that has not been accepted yet. */
  const showingStaged =
    files.length > 0 &&
    (state.acceptedSnapshot === null ||
      !sameFiles(files, state.acceptedSnapshot.files));

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
    <section className="workspace" aria-label="Workspace">
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
                : tab.id === 'preview' && sandbox.status?.status === 'ready'
                  ? servingOlderThan(sandbox, state.acceptedSnapshot?.revision)
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
          <PreviewPanel state={state} sandbox={sandbox} />
        ) : null}

        {activeTab === 'code' ? (
          <div className="codepane">
            <div className="codepane__files">
              <h2 className="pane-title">
                Files
                {showingStaged ? (
                  <span className="pill pill--staged">staged</span>
                ) : null}
              </h2>
              {state.acceptedSnapshot ? (
                <>
                  {/*
                   * All three take the accepted checkpoint, deliberately:
                   * staged files have not been validated, and exporting or
                   * publishing a project that is about to be rejected is
                   * worse than offering nothing. But the list under them is
                   * showing the staged files, so without this the buttons
                   * sit beneath one set of files and act on another. The
                   * pill on the heading marks the list, not them.
                   */}
                  {showingStaged ? (
                    <p className="pane-note">
                      These act on the last accepted checkpoint, not the staged
                      files listed below.
                    </p>
                  ) : null}
                  <ExportButton snapshot={state.acceptedSnapshot} />
                  <PublishButton snapshot={state.acceptedSnapshot} />
                  <GitHubPushButton snapshot={state.acceptedSnapshot} />
                </>
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
            <p className="pane-note">
              Generation lifecycle events. Sandbox execution exists; its process
              output is not piped here yet.
            </p>
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

        {activeTab === 'problems' ? (
          <div className="problems">
            <h2 className="pane-title">Problems</h2>
            <p className="pane-note">
              Validation findings for the staged project. Install, build and
              type errors will appear here once sandbox execution exists.
            </p>
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
