import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import type { ProjectSummary } from '../projects/projects-client.ts';
import { connectFlow, shipShouldOpen } from '../github/connect-flow.ts';
import { ExportButton } from './ExportButton.tsx';
import { PublishButton } from './PublishButton.tsx';
import { GitHubPushButton } from './GitHubPushButton.tsx';
import { ProjectRepository } from './GitHubPanel.tsx';

/**
 * Everything that takes a project out of vibld, in one place (D72): export
 * it as a zip, publish it to the web, or push it to GitHub.
 *
 * All three lived at the top of the Code tab's file list, where a real
 * person looking for how to get their site out could not find them: the
 * Code tab is where you read code, not where you would look for "publish".
 * The top bar, beside Share, is where the project's other outward-facing
 * control already is.
 *
 * The same components as before, with the same rules: each acts on the
 * accepted checkpoint only, and there is one publish button per project,
 * keyed by its id, so a slug or a takedown learned in one project is never
 * shown against another. They are no longer in the Code tab as well. Two
 * publish buttons for one project would each keep their own idea of whether
 * a publish is in flight, and could disagree on screen about the same site.
 *
 * A popover built the way `SettingsMenu` is: a button that says whether it
 * is open and what it controls, Escape and a click outside to close, and a
 * panel that is hidden rather than unmounted, so a publish or a push in
 * flight is not thrown away by closing the menu while it runs.
 */
export function ShipMenu({
  project,
  snapshot,
  note = null,
}: {
  /** The open server project, or null where there are none. */
  project: ProjectSummary | null;
  /** The accepted checkpoint, which is all any of these ever act on. */
  snapshot: ProjectSnapshot | null;
  /**
   * Said above the actions when the files on screen are not the ones they
   * act on (the Code tab's staged list, or a build still being checked).
   */
  note?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  // Opened by a trip to GitHub this menu started, when the answer comes
  // back: a picker to choose from, a repository just created, or the reason
  // it was not. The page GitHub returns to is a fresh load with every menu
  // closed, and the answer to a question asked here belongs here.
  const flow = useSyncExternalStore(connectFlow.subscribe, connectFlow.read);
  const wanted = shipShouldOpen(flow);
  useEffect(() => {
    if (wanted) setOpen(true);
  }, [wanted]);

  useEffect(() => {
    if (!open) return;
    // Escape closes and puts focus back on the button that opened it, so a
    // keyboard user is left where they started rather than at the top of
    // the document. A click anywhere else closes too.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && container.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="projectbar__ship" ref={container}>
      <button
        ref={button}
        type="button"
        className="projectbar__shipbutton"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        Ship
      </button>

      <div
        className="projectbar__shippanel"
        id={panelId}
        hidden={!open}
        role="group"
        aria-label="Ship this project"
      >
        {snapshot ? (
          <>
            {note ? <p className="pane-note">{note}</p> : null}
            <section
              className="ship__section"
              aria-labelledby={`${panelId}-export`}
            >
              <h2 className="ship__heading" id={`${panelId}-export`}>
                Export
              </h2>
              <ExportButton snapshot={snapshot} />
            </section>
            <section
              className="ship__section"
              aria-labelledby={`${panelId}-publish`}
            >
              <h2 className="ship__heading" id={`${panelId}-publish`}>
                Publish
              </h2>
              {/*
               * One per project, by key: each project has its own site,
               * and a slug or a "taken down" learned in one must never be
               * shown against another.
               */}
              <PublishButton
                key={project?.id ?? 'local'}
                snapshot={snapshot}
                projectId={project?.id ?? null}
                site={project?.site ?? null}
              />
            </section>
            <section
              className="ship__section"
              aria-labelledby={`${panelId}-github`}
            >
              <h2 className="ship__heading" id={`${panelId}-github`}>
                Push to GitHub
              </h2>
              <GitHubSection project={project} snapshot={snapshot} />
            </section>
          </>
        ) : (
          <p className="pane-note">
            Nothing to ship yet. Once a build has been checked and accepted, you
            can export it, publish it or push it to GitHub from here.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The GitHub part: the push button once the project has a repository, and
 * "create or pick" until it does (D72), with whatever a trip to GitHub
 * started from here came back with.
 */
function GitHubSection({
  project,
  snapshot,
}: {
  project: ProjectSummary | null;
  snapshot: ProjectSnapshot;
}) {
  if (!project) {
    return (
      <p className="pane-note">
        Pushing to GitHub needs a saved project, and projects are not available
        on this deployment.
      </p>
    );
  }
  return (
    <>
      <ProjectRepository
        projectId={project.id}
        projectName={project.name}
        from="ship"
        showSummary={false}
      />
      <GitHubPushButton
        key={project.id}
        snapshot={snapshot}
        projectId={project.id}
      />
    </>
  );
}
