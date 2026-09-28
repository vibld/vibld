import type { ProjectSnapshot } from '@vibld/core';
import { getClerkToken } from '../auth/clerk-token.ts';
import type { ProjectSummary } from './projects-client.ts';
import type { ShareIntent } from './share-route.ts';

/**
 * The share page's half of `/api/share/:token` (docs/decisions.md,
 * "Resolved 2026-09-28", sharing): reading a shared project, its live
 * preview, and remixing it.
 *
 * JSX-free for the reason `projects-client.ts` gives. Every call answers
 * rather than throws, as that file's do.
 *
 * The view and the preview's state send no credentials: the token is the
 * grant, and a page that sent the viewer's session with them would be
 * telling the Worker who is looking at somebody else's project for no
 * reason. Starting the preview and remixing are signed: a remix makes
 * something in the viewer's account, and starting a preview needs somebody
 * signed in (docs/decisions.md, 2026-09-28).
 */

export interface SharedProject {
  name: string;
  snapshot: ProjectSnapshot | null;
  /** Whether this deployment can run a live preview of it. */
  livePreview: boolean;
}

export type SharedPreviewStatus =
  | { status: 'queued'; position: number }
  | { status: 'ready-to-start' }
  | { status: 'installing' }
  | { status: 'starting' }
  | { status: 'ready'; url: string; expiresAt: number }
  | { status: 'failed'; error: string };

export type ShareFailure =
  /** Off, held, gone, or never existed: the Worker answers them alike. */
  | { kind: 'gone'; message: string }
  /** The free tier's limit on active projects (`project-limit`). */
  | { kind: 'limit'; message: string }
  /** Signed in, but not somebody this deployment lets start new work. */
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

export type ShareResult<T> =
  { ok: true; value: T } | { ok: false; failure: ShareFailure };

export interface ShareClientDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
}

const GENERIC = 'Could not reach this project. Try again shortly.';

function path(token: string, rest = ''): string {
  return `/api/share/${encodeURIComponent(token)}${rest}`;
}

async function call(
  url: string,
  init: { method?: string; signed?: boolean },
  deps: ShareClientDeps,
): Promise<ShareResult<Record<string, unknown>>> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const token = init.signed ? await (deps.getToken ?? getClerkToken)() : null;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.method === 'POST'
          ? { 'content-type': 'application/json' }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init.method === 'POST' ? { body: '{}' } : {}),
    });
  } catch {
    return { ok: false, failure: { kind: 'failed', message: GENERIC } };
  }
  const answer: unknown = await response.json().catch(() => null);
  const record =
    typeof answer === 'object' && answer !== null
      ? (answer as Record<string, unknown>)
      : null;
  if (response.ok && record) return { ok: true, value: record };
  const message =
    record && typeof record.error === 'string' && record.error.length > 0
      ? record.error
      : GENERIC;
  if (response.status === 404) {
    return { ok: false, failure: { kind: 'gone', message } };
  }
  if (record?.code === 'project-limit') {
    return { ok: false, failure: { kind: 'limit', message } };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, failure: { kind: 'refused', message } };
  }
  return { ok: false, failure: { kind: 'failed', message } };
}

export async function openShared(
  token: string,
  deps: ShareClientDeps = {},
): Promise<ShareResult<SharedProject>> {
  const result = await call(path(token), {}, deps);
  if (!result.ok) return result;
  const { project, snapshot, livePreview } = result.value as {
    project?: { name?: unknown };
    snapshot?: unknown;
    livePreview?: unknown;
  };
  if (typeof project?.name !== 'string') {
    return {
      ok: false,
      failure: {
        kind: 'failed',
        message: 'This link sent something unexpected.',
      },
    };
  }
  const code = snapshot as ProjectSnapshot | null | undefined;
  return {
    ok: true,
    value: {
      name: project.name,
      snapshot:
        code && typeof code.revision === 'string' && Array.isArray(code.files)
          ? code
          : null,
      livePreview: livePreview === true,
    },
  };
}

function isPreviewStatus(value: unknown): value is SharedPreviewStatus {
  const status = (value as { status?: unknown } | null)?.status;
  return (
    status === 'queued' ||
    status === 'ready-to-start' ||
    status === 'installing' ||
    status === 'starting' ||
    status === 'failed' ||
    (status === 'ready' && typeof (value as { url?: unknown }).url === 'string')
  );
}

/** The live preview's state (GET, unsigned), or starting it (POST, signed). */
export async function sharedPreview(
  token: string,
  start: boolean,
  deps: ShareClientDeps = {},
): Promise<ShareResult<SharedPreviewStatus>> {
  const result = await call(
    path(token, '/preview'),
    start ? { method: 'POST', signed: true } : {},
    deps,
  );
  if (!result.ok) return result;
  return isPreviewStatus(result.value)
    ? { ok: true, value: result.value }
    : {
        ok: false,
        failure: {
          kind: 'failed',
          message: 'The preview service sent something unexpected.',
        },
      };
}

/** Copy the shared project into the caller's account. */
export async function remixShared(
  token: string,
  deps: ShareClientDeps = {},
): Promise<ShareResult<ProjectSummary>> {
  const result = await call(
    path(token, '/remix'),
    { method: 'POST', signed: true },
    deps,
  );
  if (!result.ok) return result;
  const project = result.value.project as ProjectSummary | undefined;
  return project && typeof project.id === 'string'
    ? { ok: true, value: project }
    : {
        ok: false,
        failure: {
          kind: 'failed',
          message: 'The remix sent something unexpected.',
        },
      };
}

/**
 * Something asked for while signed out (a remix, or starting the live
 * preview), kept across the sign-in that has to come first.
 *
 * The share link itself carries it back when sign-in returns to it (the
 * `remix` or `preview` query, `share-route.ts`); this is the same intent
 * kept in the tab, for a sign-in that ends somewhere else, such as the
 * sign-up form's own page. Session storage, so it lasts as long as the tab
 * and no longer: something nobody finished signing in for should not
 * happen days later.
 */
const PENDING_KEY = 'vibld:pending-share';

export interface PendingShare {
  token: string;
  intent: ShareIntent;
}

export interface ShareStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function shareStorage(): ShareStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // A browser that refuses storage altogether: the query still carries it.
    return null;
  }
}

export function rememberIntent(
  storage: ShareStorage | null,
  pending: PendingShare,
) {
  try {
    storage?.setItem(PENDING_KEY, `${pending.intent}:${pending.token}`);
  } catch {
    // Full or refused: the query still carries it.
  }
}

function parsePending(value: string | null): PendingShare | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  const intent = value.slice(0, colon);
  const token = value.slice(colon + 1);
  return (intent === 'remix' || intent === 'preview') && token.length > 0
    ? { intent, token }
    : null;
}

/** What is waiting for sign-in, left where it is. */
export function peekPendingIntent(
  storage: ShareStorage | null,
): PendingShare | null {
  try {
    return parsePending(storage?.getItem(PENDING_KEY) ?? null);
  } catch {
    return null;
  }
}

/** What is waiting for sign-in, forgotten as it is read. */
export function takePendingIntent(
  storage: ShareStorage | null,
): PendingShare | null {
  try {
    const pending = parsePending(storage?.getItem(PENDING_KEY) ?? null);
    storage?.removeItem(PENDING_KEY);
    return pending;
  } catch {
    return null;
  }
}
