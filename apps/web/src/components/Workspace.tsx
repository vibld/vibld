import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BuilderState } from '../generation/session.ts';
import { CodeViewer } from './CodeViewer.tsx';
import { ExportButton } from './ExportButton.tsx';
import { FileList } from './FileList.tsx';
import { PreviewPanel } from './PreviewPanel.tsx';

const TABS = [
  { id: 'preview', label: 'Preview' },
  { id: 'code', label: 'Code' },
  { id: 'console', label: 'Console' },
  { id: 'problems', label: 'Problems' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Workspace({ state }: { state: BuilderState }) {
  const [activeTab, setActiveTab] = useState<TabId>('preview');
  const [requestedPath, setRequestedPath] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Derive the selection instead of storing it: when a run replaces the file
  // set, a selection that no longer exists falls back to the first file
  // rather than leaving the viewer pointed at a stale path.
  const files = state.stagedFiles;
  const selected =
    files.find((file) => file.path === requestedPath) ?? files[0] ?? null;

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
          const count =
            tab.id === 'problems'
              ? state.problems.length
              : tab.id === 'console'
                ? state.timeline.length
                : 0;
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
              {count > 0 ? <span className="tabs__count">{count}</span> : null}
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
        {activeTab === 'preview' ? <PreviewPanel state={state} /> : null}

        {activeTab === 'code' ? (
          <div className="codepane">
            <div className="codepane__files">
              <h2 className="pane-title">
                Files
                {state.status !== 'accepted' && files.length > 0 ? (
                  <span className="pill pill--staged">staged</span>
                ) : null}
              </h2>
              {state.acceptedSnapshot ? (
                <ExportButton snapshot={state.acceptedSnapshot} />
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
              Generation lifecycle events. Sandbox process output will appear
              here once sandbox execution exists.
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
