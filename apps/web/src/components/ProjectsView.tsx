import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { PROJECT_NAME_MAX_CHARS } from '@vibld/core';

import { startCheckout } from '../billing/billing-client.ts';
import { formatEdited } from '../projects/project-state.ts';
import { projectPath } from '../projects/project-route.ts';
import type { ProjectSummary } from '../projects/projects-client.ts';
import type { ProjectsController } from '../projects/use-projects.ts';

/**
 * The list of the account's projects (docs/decisions.md, 2026-09-28,
 * projects): the active ones with what can be done to each, and the
 * archived ones below them.
 *
 * A page rather than a panel, the way the admin tools are (internal issue 184): the
 * builder session lives above it and survives the visit, and a list that
 * grows has room to on a page of its own.
 *
 * Deleting is permanent and is confirmed in the page, not with
 * `confirm()`: the question names the project and says what goes, and the
 * button that answers it says "Delete for good" rather than "OK". Archiving
 * needs no confirmation, because it is undone with one click.
 */
export function ProjectsView({ projects }: { projects: ProjectsController }) {
  const { list, current, notice, busy } = projects;
  const [now, setNow] = useState(() => Date.now());

  // "3 minutes ago" goes stale on a page left open; a minute is as fine as
  // the wording is.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const active = list?.projects.filter((project) => !project.archived) ?? [];
  const archived = list?.projects.filter((project) => project.archived) ?? [];
  const limits = list?.limits ?? null;
  const atLimit =
    limits !== null &&
    limits.maxActive !== null &&
    limits.active >= limits.maxActive;

  return (
    <section className="projectspage" aria-label="Projects">
      <div className="projectspage__head">
        <div>
          <h1 className="projectspage__title">Projects</h1>
          {limits && limits.maxActive !== null ? (
            <p className="pane-note">
              {limits.active} of {limits.maxActive} active projects on your
              plan. Archived projects do not count.
            </p>
          ) : null}
        </div>
        <div className="projectspage__actions">
          {current ? (
            <button
              type="button"
              className="linkbutton"
              onClick={() => projects.open(current.id)}
            >
              Back to {current.name}
            </button>
          ) : null}
          <button
            type="button"
            className="button button--primary"
            onClick={() => void projects.create()}
            disabled={busy !== null}
            title={
              atLimit
                ? 'Archive a project or upgrade to start another'
                : undefined
            }
          >
            New project
          </button>
        </div>
      </div>

      {notice ? <Notice projects={projects} /> : null}

      {list === null ? (
        <p className="pane-note" role="status">
          Loading your projects.
        </p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="empty">No active projects. Start a new one.</p>
          ) : (
            <ul className="projectlist" aria-label="Active projects">
              {active.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  projects={projects}
                  now={now}
                  isOpen={current?.id === project.id}
                />
              ))}
            </ul>
          )}

          {archived.length > 0 ? (
            <>
              <h2 className="projectspage__subtitle">Archived</h2>
              <ul className="projectlist" aria-label="Archived projects">
                {archived.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    projects={projects}
                    now={now}
                    isOpen={false}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * The last thing that went wrong. For the free tier's limit, the way on as
 * well as the reason: the upgrade is the same Checkout the billing widget
 * starts, so it is one click from here to a plan with no limit.
 */
function Notice({ projects }: { projects: ProjectsController }) {
  const notice = projects.notice!;
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function upgrade() {
    setPending(true);
    setProblem(null);
    try {
      window.location.href = await startCheckout({
        kind: 'subscription',
        tier: 'build',
        interval: 'monthly',
      });
    } catch (error) {
      setPending(false);
      setProblem(
        error instanceof Error
          ? error.message
          : 'The billing request failed. Try again shortly.',
      );
    }
  }

  return (
    <div
      className={`projectnotice${notice.kind === 'limit' ? '' : ' projectnotice--error'}`}
      role="alert"
    >
      <p className="projectnotice__text">{notice.message}</p>
      <div className="projectnotice__actions">
        {notice.kind === 'limit' ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void upgrade()}
            disabled={pending}
          >
            Upgrade for unlimited projects
          </button>
        ) : null}
        <button
          type="button"
          className="linkbutton"
          onClick={projects.clearNotice}
        >
          Dismiss
        </button>
      </div>
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function ProjectRow({
  project,
  projects,
  now,
  isOpen,
}: {
  project: ProjectSummary;
  projects: ProjectsController;
  now: number;
  isOpen: boolean;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(project.name);
  const nameId = useId();
  const busy = projects.busy === project.id;
  const disabled = projects.busy !== null;

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > 0 && trimmed !== project.name) {
      void projects.rename(project.id, trimmed);
    }
    setMode('view');
  }

  return (
    <li
      className={`projectlist__item${isOpen ? ' projectlist__item--open' : ''}`}
    >
      {mode === 'rename' ? (
        <form className="projectlist__rename" onSubmit={submitRename}>
          <label className="visually-hidden" htmlFor={nameId}>
            Project name
          </label>
          <input
            id={nameId}
            className="prompt__input"
            value={name}
            maxLength={PROJECT_NAME_MAX_CHARS}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setName(project.name);
                setMode('view');
              }
            }}
            autoFocus
          />
          <button type="submit" className="button button--primary">
            Save
          </button>
          <button
            type="button"
            className="linkbutton"
            onClick={() => {
              setName(project.name);
              setMode('view');
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="projectlist__main">
          {project.archived ? (
            <span className="projectlist__name">{project.name}</span>
          ) : (
            <a
              className="projectlist__name"
              href={projectPath(project.id)}
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
                projects.open(project.id);
              }}
            >
              {project.name}
            </a>
          )}
          <span className="projectlist__meta">
            {isOpen ? 'Open now · ' : ''}
            Edited {formatEdited(project.editedAt, now)}
            {busy ? ' · Working…' : ''}
          </span>
        </div>
      )}

      {mode === 'delete' ? (
        <div
          className="projectlist__confirm"
          role="group"
          aria-label="Confirm delete"
        >
          <p className="projectlist__question">
            Delete &ldquo;{project.name}&rdquo; for good? Its code and its
            conversation are removed and cannot be recovered. A site you
            published from it is taken down first.
          </p>
          <button
            type="button"
            className="button button--danger"
            disabled={disabled}
            onClick={() => {
              setMode('view');
              void projects.remove(project.id);
            }}
          >
            Delete for good
          </button>
          <button
            type="button"
            className="linkbutton"
            onClick={() => setMode('view')}
          >
            Keep it
          </button>
        </div>
      ) : mode === 'view' ? (
        <div
          className="projectlist__actions"
          role="group"
          aria-label={`Actions for ${project.name}`}
        >
          {project.archived ? (
            <button
              type="button"
              className="chip"
              disabled={disabled}
              onClick={() => void projects.setArchived(project.id, false)}
            >
              Unarchive
            </button>
          ) : (
            <>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => projects.open(project.id)}
              >
                Open
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => {
                  setName(project.name);
                  setMode('rename');
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => void projects.duplicate(project.id)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="chip"
                disabled={disabled}
                onClick={() => void projects.setArchived(project.id, true)}
              >
                Archive
              </button>
            </>
          )}
          <button
            type="button"
            className="chip chip--danger"
            disabled={disabled}
            onClick={() => setMode('delete')}
          >
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}
