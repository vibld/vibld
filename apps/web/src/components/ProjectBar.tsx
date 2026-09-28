import { useEffect, useId, useRef, useState } from 'react';
import { PROJECT_NAME_MAX_CHARS } from '@vibld/core';

import { PROJECTS_PATH } from '../projects/project-route.ts';
import type { SaveStatus } from '../projects/autosave.ts';
import type { ProjectsController } from '../projects/use-projects.ts';

/**
 * The open project, in the header: the way back to the list, its name,
 * which can be edited where it stands, and one quiet word about whether it
 * is saved.
 *
 * In the header because it is what somebody is working on, which is the
 * header's job since internal PR 170 moved configuration behind the gear; nothing here
 * configures anything. The save state is deliberately small and never
 * interrupts: autosave is meant to be forgotten about, and a word that
 * changes is enough to show it is working, and to show when it is not.
 */

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Couldn’t save',
};

export function ProjectBar({ projects }: { projects: ProjectsController }) {
  if (projects.mode === 'local' && projects.notice) {
    // A model deployment whose projects could not be read: the builder
    // still works, and says plainly that nothing is being kept.
    return (
      <p className="projectbar__offline" role="status">
        Projects are unavailable, so this session is not being saved.
      </p>
    );
  }
  if (projects.mode !== 'server') return null;
  const { current } = projects;

  return (
    <nav className="projectbar" aria-label="Project">
      <a
        className="projectbar__all"
        href={PROJECTS_PATH}
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          ) {
            return;
          }
          event.preventDefault();
          projects.showList();
        }}
      >
        Projects
      </a>
      {current ? (
        <>
          <span className="projectbar__sep" aria-hidden="true">
            /
          </span>
          <ProjectName
            key={current.id}
            name={current.name}
            onRename={(name) => void projects.rename(current.id, name)}
          />
          <span
            className={`projectbar__status projectbar__status--${projects.saveStatus}`}
            role="status"
            aria-live="polite"
          >
            {STATUS_LABEL[projects.saveStatus]}
          </span>
        </>
      ) : null}
    </nav>
  );
}

/**
 * The name, as a button that becomes a field. Enter or leaving the field
 * keeps what was typed; Escape puts the name back.
 */
function ProjectName({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const fieldId = useId();
  const field = useRef<HTMLInputElement | null>(null);
  // One answer per edit. Escape takes the field away, and a browser that
  // reports the blur of a removed field would otherwise keep what Escape
  // was pressed to throw away.
  const finished = useRef(false);

  useEffect(() => {
    if (editing) field.current?.select();
  }, [editing]);

  function finish(keep: boolean) {
    if (finished.current) return;
    finished.current = true;
    const trimmed = draft.trim();
    if (keep && trimmed.length > 0 && trimmed !== name) onRename(trimmed);
    setDraft(name);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="projectbar__name"
        title="Rename this project"
        onClick={() => {
          finished.current = false;
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  }

  return (
    <>
      <label className="visually-hidden" htmlFor={fieldId}>
        Project name
      </label>
      <input
        id={fieldId}
        ref={field}
        className="projectbar__field"
        value={draft}
        maxLength={PROJECT_NAME_MAX_CHARS}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        }}
      />
    </>
  );
}
