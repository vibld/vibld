import type { ProjectSnapshot, TranscriptTurn } from '@vibld/core';
import type { StyleDna } from '@vibld/ai/style-dna';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { getClerkToken } from '../auth/clerk-token.ts';
import type { Tier } from '../billing/billing-client.ts';

/**
 * The builder's half of `/api/projects` (docs/decisions.md, 2026-09-28,
 * projects): listing, opening, saving and the rest.
 *
 * JSX-free for the reason `billing-client.ts` gives: this project's test
 * runner strips types only and errors on JSX, so anything a `*.test.ts`
 * file imports has to stay clear of it.
 *
 * Every call answers rather than throws. A failure carries what kind of
 * failure it was, because the builder does different things with them: a
 * limit offers an upgrade, a missing project goes back to the list, and
 * anything else is shown and can be tried again.
 */

export interface ProjectSettings {
  style: StylePresetId | null;
  referenceUrl: string | null;
  model: string | null;
  /** Null for "never set", which the builder fills from this browser. */
  knowledge: string | null;
  styleDna: StyleDna | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  /** The later of the last save and the last accepted build. */
  editedAt: string;
  lastOpenedAt: string;
  hasCode: boolean;
  turns: number;
  settings: ProjectSettings;
  /**
   * The project's share link. `url` is null while it is off; `held` is an
   * operator's hold, which the owner cannot lift. Absent from a Worker
   * older than sharing, which reads as off.
   */
  share?: ProjectShare;
  /** The project's published site, or null for one never published. */
  site?: ProjectSite | null;
}

export interface ProjectShare {
  on: boolean;
  url: string | null;
  held: boolean;
}

export type SiteState = 'live' | 'down' | 'held';

export interface ProjectSite {
  slug: string;
  state: SiteState;
  url: string;
}

export interface ProjectLimits {
  tier: Tier;
  active: number;
  /** Null for no limit. */
  maxActive: number | null;
}

export interface ProjectList {
  projects: ProjectSummary[];
  limits: ProjectLimits;
}

export interface OpenedProject {
  project: ProjectSummary;
  transcript: TranscriptTurn[];
  snapshot: ProjectSnapshot | null;
  /**
   * A build still running in the project, which carried on after the page
   * that started it went away; null for none, and from a Worker older than
   * builds that outlive their page.
   */
  build: { runId: string; startedAt: string } | null;
}

/** What a save may carry; every field is optional and independent. */
export interface ProjectPatch {
  name?: string;
  archived?: boolean;
  settings?: Partial<ProjectSettings>;
  transcript?: TranscriptTurn[];
}

export type ProjectFailure =
  /** The free tier's limit on active projects (`project-limit`). */
  | { kind: 'limit'; message: string; limit: number }
  /** Gone, or never the caller's: the Worker answers both the same. */
  | { kind: 'not-found'; message: string }
  /** This deployment has no projects (no storage, or no Worker at all). */
  | { kind: 'unavailable'; message: string }
  /** Anything else: the message is the Worker's, or a plain fallback. */
  | { kind: 'failed'; message: string; status: number };

export type ProjectResult<T> =
  { ok: true; value: T } | { ok: false; failure: ProjectFailure };

export interface ClientDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
}

const GENERIC = 'Could not reach your projects. Try again shortly.';

/** Under the 64 KiB browsers allow a keepalive request, with room to spare. */
const KEEPALIVE_BYTES = 60_000;

async function call(
  path: string,
  init: { method?: string; body?: unknown },
  deps: ClientDeps,
): Promise<ProjectResult<unknown>> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const token = await (deps.getToken ?? getClerkToken)();
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body } : {}),
      // Lets a save sent as the page goes away outlive it. Browsers refuse
      // a keepalive body over 64 KiB outright, so a long conversation is
      // sent without it and takes its chances, like any request would.
      ...(body !== undefined && body.length < KEEPALIVE_BYTES
        ? { keepalive: true }
        : {}),
    });
  } catch {
    return { ok: false, failure: { kind: 'unavailable', message: GENERIC } };
  }

  let answer: unknown = null;
  try {
    answer = await response.json();
  } catch {
    answer = null;
  }
  const record =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : {};
  // A success that is not JSON is not this Worker answering: the static
  // dev server serves the shell's HTML for any path it does not know.
  if (response.ok && answer === null && response.status !== 204) {
    return { ok: false, failure: { kind: 'unavailable', message: GENERIC } };
  }
  if (response.ok) return { ok: true, value: record };

  const message =
    typeof record.error === 'string' && record.error.length > 0
      ? record.error
      : GENERIC;
  if (record.code === 'project-limit' && typeof record.limit === 'number') {
    return {
      ok: false,
      failure: { kind: 'limit', message, limit: record.limit },
    };
  }
  if (response.status === 404) {
    return { ok: false, failure: { kind: 'not-found', message } };
  }
  // A 404 has been taken above. What is left of "this deployment cannot"
  // is a Worker that says it is not configured, or no Worker at all (the
  // static dev server answers an API path with the shell's HTML, which is
  // not JSON).
  if (response.status === 503 || answer === null) {
    return { ok: false, failure: { kind: 'unavailable', message } };
  }
  return {
    ok: false,
    failure: { kind: 'failed', message, status: response.status },
  };
}

function isSummary(value: unknown): value is ProjectSummary {
  const project = value as ProjectSummary;
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.archived === 'boolean' &&
    typeof project.editedAt === 'string' &&
    typeof project.settings === 'object' &&
    project.settings !== null
  );
}

const MALFORMED: ProjectResult<never> = {
  ok: false,
  failure: {
    kind: 'failed',
    message: 'The projects service sent something unexpected.',
    status: 200,
  },
};

function project(
  result: ProjectResult<unknown>,
): ProjectResult<ProjectSummary> {
  if (!result.ok) return result;
  const value = (result.value as { project?: unknown }).project;
  return isSummary(value) ? { ok: true, value } : MALFORMED;
}

/** Every project the caller has, most recently opened first. */
export async function listProjects(
  deps: ClientDeps = {},
): Promise<ProjectResult<ProjectList>> {
  const result = await call('/api/projects', {}, deps);
  if (!result.ok) return result;
  const { projects, limits } = result.value as {
    projects?: unknown;
    limits?: ProjectLimits;
  };
  if (!Array.isArray(projects) || typeof limits !== 'object' || !limits) {
    return MALFORMED;
  }
  // A malformed row is dropped rather than failing the list: one unreadable
  // project must not hide the rest.
  return { ok: true, value: { projects: projects.filter(isSummary), limits } };
}

export async function createProject(
  body: { name?: string; settings?: Partial<ProjectSettings> } = {},
  deps: ClientDeps = {},
): Promise<ProjectResult<ProjectSummary>> {
  return project(await call('/api/projects', { method: 'POST', body }, deps));
}

/** Open a project: its settings, its conversation and its accepted code. */
export async function openProject(
  id: string,
  deps: ClientDeps = {},
): Promise<ProjectResult<OpenedProject>> {
  const result = await call(
    `/api/projects/${encodeURIComponent(id)}`,
    {},
    deps,
  );
  if (!result.ok) return result;
  const {
    project: summary,
    transcript,
    snapshot,
    build,
  } = result.value as {
    project?: unknown;
    transcript?: unknown;
    snapshot?: unknown;
    build?: unknown;
  };
  if (!isSummary(summary) || !Array.isArray(transcript)) return MALFORMED;
  const code = snapshot as ProjectSnapshot | null | undefined;
  const running = build as { runId?: unknown; startedAt?: unknown } | null;
  return {
    ok: true,
    value: {
      project: summary,
      transcript: transcript as TranscriptTurn[],
      snapshot:
        code && typeof code.revision === 'string' && Array.isArray(code.files)
          ? code
          : null,
      build:
        running &&
        typeof running.runId === 'string' &&
        typeof running.startedAt === 'string'
          ? { runId: running.runId, startedAt: running.startedAt }
          : null,
    },
  };
}

export async function saveProject(
  id: string,
  patch: ProjectPatch,
  deps: ClientDeps = {},
): Promise<ProjectResult<ProjectSummary>> {
  return project(
    await call(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: patch },
      deps,
    ),
  );
}

export async function deleteProject(
  id: string,
  deps: ClientDeps = {},
): Promise<ProjectResult<true>> {
  const result = await call(
    `/api/projects/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    deps,
  );
  return result.ok ? { ok: true, value: true } : result;
}

export async function duplicateProject(
  id: string,
  deps: ClientDeps = {},
): Promise<ProjectResult<ProjectSummary>> {
  return project(
    await call(
      `/api/projects/${encodeURIComponent(id)}/duplicate`,
      { method: 'POST', body: {} },
      deps,
    ),
  );
}

/**
 * Turn the project's share link on, or off. Off is for good: the link that
 * was sent stops working, and turning it on again makes a new one.
 */
export async function setProjectShared(
  id: string,
  on: boolean,
  deps: ClientDeps = {},
): Promise<ProjectResult<ProjectSummary>> {
  return project(
    await call(
      `/api/projects/${encodeURIComponent(id)}/share`,
      on ? { method: 'POST', body: {} } : { method: 'DELETE' },
      deps,
    ),
  );
}
