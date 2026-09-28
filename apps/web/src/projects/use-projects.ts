import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { isAdminPath } from '../admin/route.ts';
import { navigate } from '../admin/use-pathname.ts';
import type { BuilderSession, BuilderState } from '../generation/session.ts';
import { loadKnowledge } from '../generation/knowledge-store.ts';
import { loadModelChoice } from '../generation/model-choice-store.ts';
import { loadStyleDna } from '../generation/style-dna-store.ts';
import { Autosaver } from './autosave.ts';
import type { SaveOutcome, SaveStatus } from './autosave.ts';
import {
  changedSince,
  marksFor,
  pathAction,
  settingsToRestore,
} from './project-state.ts';
import type { SavedMarks } from './project-state.ts';
import {
  PROJECTS_PATH,
  isProjectsPath,
  projectPath,
  withPath,
} from './project-route.ts';
import {
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  openProject,
  saveProject,
} from './projects-client.ts';
import type {
  ProjectFailure,
  ProjectList,
  ProjectPatch,
  ProjectSummary,
} from './projects-client.ts';

/**
 * Projects in the builder (docs/decisions.md, 2026-09-28, projects): which
 * one is open, what the address bar says, the list, and the autosave.
 *
 * **Server or local.** Projects live on the Worker, so they exist only
 * where the deployment generates with a model: that deployment is the one
 * with D1, R2 and Clerk behind it (`isConfigured`). A deployment that runs
 * the deterministic fake (`generation: 'fake'`: local development, the
 * static-only deploy) builds entirely in the browser, has no server copy of
 * the code to restore, and so keeps working exactly as it did before
 * projects: in memory, with nothing saved. A model deployment whose
 * project list cannot be read falls back the same way rather than
 * stopping the builder, and says that this session is not being saved.
 *
 * **The address is the source of truth.** `/p/<id>` opens that project,
 * `/projects` shows the list, and anything else shows the open project, or
 * on a fresh load the one opened last (made if there is none), and then
 * corrects the address to it. A refresh therefore reopens whatever was on
 * screen.
 *
 * **Leaving a project saves it first.** The autosave is flushed before
 * another project is opened, so switching never drops the last change.
 */

export type ProjectsMode = 'pending' | 'local' | 'server';

export interface ProjectsController {
  mode: ProjectsMode;
  /** The open project, as the Worker last described it. */
  current: ProjectSummary | null;
  list: ProjectList | null;
  saveStatus: SaveStatus;
  /** The last thing that went wrong, for the view to show. */
  notice: ProjectFailure | null;
  /** An action is in flight on this project id, so its buttons wait. */
  busy: string | null;
  clearNotice(): void;
  refreshList(): Promise<void>;
  showList(): void;
  open(id: string): void;
  create(): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

const idleSubscribe = () => () => undefined;

/** What this browser last chose, which a new project starts from. */
function browserDefaults() {
  return {
    model: loadModelChoice(),
    knowledge: loadKnowledge(),
    styleDna: loadStyleDna(),
  };
}

function currentLocation(): { search: string; hash: string } {
  return typeof window === 'undefined'
    ? { search: '', hash: '' }
    : window.location;
}

export function useProjects(
  session: BuilderSession,
  state: BuilderState,
  pathname: string,
): ProjectsController {
  const [mode, setMode] = useState<ProjectsMode>('pending');
  const [current, setCurrent] = useState<ProjectSummary | null>(null);
  const [list, setList] = useState<ProjectList | null>(null);
  const [notice, setNotice] = useState<ProjectFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saver, setSaver] = useState<Autosaver | null>(null);

  // Read by the effects and actions below without being dependencies of
  // them: the path effect must not run again every time the list or the
  // open project is refreshed, or showing the list would refresh it for
  // ever.
  const currentRef = useRef<ProjectSummary | null>(null);
  currentRef.current = current;
  const listRef = useRef<ProjectList | null>(null);
  listRef.current = list;
  const saverRef = useRef<Autosaver | null>(null);
  const marks = useRef<SavedMarks>({ settings: null, transcript: null });
  const openToken = useRef(0);
  const openingId = useRef<string | null>(null);
  const creating = useRef(false);

  const saveStatus = useSyncExternalStore(
    saver?.subscribe ?? idleSubscribe,
    () => saver?.status ?? 'idle',
    () => 'idle' as const,
  );

  // Server or local, once the deployment has said what it generates with.
  useEffect(() => {
    if (mode !== 'pending') return;
    if (state.generation === 'fake') {
      setMode('local');
      return;
    }
    if (state.generation !== 'model') return;
    let cancelled = false;
    void listProjects().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setList(result.value);
        setMode('server');
        return;
      }
      setMode('local');
      setNotice(result.failure);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, state.generation]);

  async function refreshList(): Promise<void> {
    const result = await listProjects();
    if (result.ok) setList(result.value);
    else setNotice(result.failure);
  }

  /** Save the open project and stop saving it. */
  async function leaveCurrent({ keep = true } = {}): Promise<void> {
    const leaving = saverRef.current;
    saverRef.current = null;
    setSaver(null);
    if (!leaving) return;
    if (keep) await leaving.flush().catch(() => undefined);
    leaving.dispose();
  }

  async function persist(
    id: string,
    patch: ProjectPatch,
  ): Promise<SaveOutcome> {
    const result = await saveProject(id, patch);
    if (result.ok) {
      // The name shown is kept unless this save carried one. A rename is
      // shown the moment it is typed and saved a second later, so a save
      // of something else that answers in between would otherwise put
      // the old name back for that second.
      setCurrent((shown) =>
        shown?.id === id
          ? { ...result.value, name: patch.name ?? shown.name }
          : shown,
      );
      return 'saved';
    }
    return result.failure.kind === 'not-found' ? 'gone' : 'retry';
  }

  async function openById(
    id: string,
    options: { correctAddress?: boolean } = {},
  ): Promise<void> {
    if (openingId.current === id) return;
    openingId.current = id;
    const token = (openToken.current += 1);
    await leaveCurrent();
    session.setOpening(true);
    const result = await openProject(id);
    if (token !== openToken.current) return;
    const settle = () => {
      openingId.current = null;
      session.setOpening(false);
    };
    if (!result.ok || result.value.project.archived) {
      settle();
      setCurrent(null);
      setNotice(
        result.ok
          ? {
              kind: 'failed',
              status: 409,
              message:
                'That project is archived. Unarchive it to keep building in it.',
            }
          : result.failure,
      );
      navigate(PROJECTS_PATH, { replace: true });
      return;
    }

    const opened = result.value;
    const before = session.getState();
    const restored = settingsToRestore(
      opened.project.settings,
      browserDefaults(),
      before.models,
      before.model,
    );
    await session.restore({
      id,
      transcript: opened.transcript,
      snapshot: opened.snapshot,
      ...restored,
    });
    if (token !== openToken.current) return;

    marks.current = marksFor(opened.project.settings, opened.transcript);
    const next = new Autosaver((patch) => persist(id, patch));
    saverRef.current = next;
    setSaver(next);
    setCurrent(opened.project);
    setNotice(null);
    settle();
    if (options.correctAddress) {
      navigate(withPath(currentLocation(), projectPath(id)), { replace: true });
    }
  }

  async function create(options: { replace?: boolean } = {}): Promise<void> {
    if (creating.current) return;
    creating.current = true;
    try {
      const defaults = browserDefaults();
      const result = await createProject({
        settings: {
          model: defaults.model,
          knowledge: defaults.knowledge,
          styleDna: defaults.styleDna,
        },
      });
      if (!result.ok) {
        setNotice(result.failure);
        if (!isProjectsPath(pathname)) navigate(PROJECTS_PATH);
        return;
      }
      setNotice(null);
      void refreshList();
      navigate(projectPath(result.value.id), options);
    } finally {
      creating.current = false;
    }
  }

  // The address bar decides what is shown.
  useEffect(() => {
    if (mode !== 'server') return;
    const action = pathAction(
      pathname,
      isAdminPath(pathname),
      currentRef.current?.id ?? null,
      listRef.current?.projects ?? null,
    );
    if (action.kind === 'open') void openById(action.id);
    if (action.kind === 'open-recent') {
      void openById(action.id, { correctAddress: true });
    }
    if (action.kind === 'address') {
      navigate(withPath(currentLocation(), projectPath(action.id)), {
        replace: true,
      });
    }
    if (action.kind === 'create') void create({ replace: true });
    if (action.kind === 'list') void refreshList();
    // `openById`, `create` and `refreshList` read what they need through
    // refs; listing them would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pathname]);

  // Autosave: after a turn settles (an accepted build, a reply, a failure),
  // and whenever a setting changes.
  useEffect(() => {
    const target = saverRef.current;
    if (mode !== 'server' || !target || !current) return;
    if (state.opening || state.projectId !== current.id) return;
    const changed = changedSince(
      marks.current,
      session.settings(),
      state.transcript,
    );
    if (!changed) return;
    marks.current = changed.marks;
    target.schedule(changed.patch);
    // `session.settings()` reads the fields listed, and the pending
    // reference that only changes with the transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    current?.id,
    saver,
    state.opening,
    state.projectId,
    state.transcript,
    state.style,
    state.referenceUrl,
    state.model,
    state.knowledge,
    state.styleDna,
  ]);

  // A page going away sends what is queued. The request is made with
  // `keepalive` where the body allows (`projects-client.ts`), so it can
  // outlive the page that made it.
  useEffect(() => {
    const flush = () => void saverRef.current?.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  async function withBusy(id: string, action: () => Promise<void>) {
    setBusy(id);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  return {
    mode,
    current,
    list,
    saveStatus,
    notice,
    busy,
    clearNotice: () => setNotice(null),
    refreshList,
    showList: () => navigate(PROJECTS_PATH),
    open: (id) => {
      setNotice(null);
      navigate(projectPath(id));
    },
    create: () => create(),
    async rename(id, name) {
      if (currentRef.current?.id === id && saverRef.current) {
        setCurrent({ ...currentRef.current, name });
        saverRef.current.schedule({ name });
        return;
      }
      await withBusy(id, async () => {
        const result = await saveProject(id, { name });
        if (!result.ok) setNotice(result.failure);
        await refreshList();
      });
    },
    async duplicate(id) {
      await withBusy(id, async () => {
        // The source's latest conversation, if it is the one open.
        if (currentRef.current?.id === id) {
          await saverRef.current?.flush();
        }
        const result = await duplicateProject(id);
        if (!result.ok) setNotice(result.failure);
        else setNotice(null);
        await refreshList();
      });
    },
    async setArchived(id, archived) {
      await withBusy(id, async () => {
        if (archived && currentRef.current?.id === id) {
          await leaveCurrent();
          setCurrent(null);
        }
        const result = await saveProject(id, { archived });
        if (!result.ok) setNotice(result.failure);
        else setNotice(null);
        await refreshList();
      });
    },
    async remove(id) {
      await withBusy(id, async () => {
        const result = await deleteProject(id);
        if (!result.ok) {
          setNotice(result.failure);
          return;
        }
        if (currentRef.current?.id === id) {
          // Nothing left to save it into.
          await leaveCurrent({ keep: false });
          setCurrent(null);
        }
        setNotice(null);
        await refreshList();
      });
    },
  };
}
