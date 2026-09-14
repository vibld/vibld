import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * Calls the Worker's `/api/github/*` endpoints (issues #13 and #121).
 *
 * JSX-free for the same reason `billing-client.ts` is: the test runner
 * strips TypeScript types only and errors on JSX, so anything a `*.test.ts`
 * might import has to stay clear of it. `components/GitHubPanel.tsx` is the
 * JSX half.
 *
 * This file holds one piece of the connect flow's security rather than just
 * its plumbing, and it is the reason the flow cannot be server-side alone.
 * Completing the exchange from the app means a crafted link could hand
 * somebody else's `code` to a signed-in user and offer them a stranger's
 * repositories to push their own work into. What stops that is the browser
 * remembering the `state` it was issued and refusing one it was not: see
 * `rememberState` and `takeRememberedState` below.
 */

export interface GitHubStatus {
  configured: boolean;
  canPush?: boolean;
  canConnect?: boolean;
  connected?: boolean;
  reason?: 'none' | 'revoked' | 'expired';
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  expiresAt?: string;
}

export interface RepositoryChoice {
  installationId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface ConnectOffer {
  repositories: RepositoryChoice[];
  ticket: string;
}

/** What came back on the URL after GitHub sent the browser here. */
export interface CallbackHandoff {
  code: string;
  state: string;
  installation?: string;
}

/**
 * Where the issued `state` waits while the browser is away at GitHub.
 *
 * `sessionStorage` rather than a cookie or a module variable: a cookie would
 * travel on every request for no reason, and a module variable does not
 * survive the full-page navigation GitHub sends the browser through, which
 * is the entire span this has to cover.
 */
const STATE_KEY = 'vibld.github.state';

export function rememberState(
  state: string,
  storage: Storage | null = safeStorage(),
): void {
  try {
    storage?.setItem(STATE_KEY, state);
  } catch {
    // A browser refusing storage is not a reason to fail the whole flow; it
    // is a reason for the comparison below to refuse, which it does.
  }
}

/**
 * The remembered `state`, removed as it is read.
 *
 * Removed because it is good for exactly one return trip. Leaving it behind
 * would let a second, later link be walked into the same session using a
 * `state` the browser has already spent.
 */
export function takeRememberedState(
  storage: Storage | null = safeStorage(),
): string | null {
  try {
    const value = storage?.getItem(STATE_KEY) ?? null;
    storage?.removeItem(STATE_KEY);
    return value;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Storage can throw rather than be absent, in a private window or with
    // site data blocked.
    return null;
  }
}

/**
 * What GitHub put on the URL, if this looks like a return from it.
 *
 * Read from the fragment, which browsers never send to a server, so a
 * single-use authorization code does not travel through request logs on its
 * way here.
 */
export function readHandoff(hash: string): CallbackHandoff | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const code = params.get('github');
  const state = params.get('state');
  if (!code || !state || code === 'incomplete') return null;
  const installation = params.get('installation');
  return { code, state, ...(installation ? { installation } : {}) };
}

/**
 * The handoff for this page load, read once however often this is called.
 *
 * React runs effects twice in StrictMode, which development builds enable.
 * The first pass would read the fragment and clear it, and the replay would
 * find nothing, so the connection stalls with no error anywhere: a bug that
 * only appears when running locally, which is exactly where it would be
 * blamed on GitHub.
 *
 * Caching the first read rather than not clearing the URL, because the URL
 * genuinely should be cleared: a single-use code sitting in the address bar
 * invites a reload that can only fail.
 */
let claimed: CallbackHandoff | null = null;

export function claimHandoff(hash: string): CallbackHandoff | null {
  const fresh = readHandoff(hash);
  if (fresh) {
    claimed = fresh;
    clearHandoff();
  }
  return claimed;
}

/**
 * The completion for this handoff, started once however often this is
 * called.
 *
 * The second half of the same StrictMode problem, and the one that would
 * have survived fixing only the first. `completeConnect` spends the stored
 * state, so two passes racing it would have the first succeed and the second
 * fail its own check, reporting that the connection did not come from this
 * browser when it did. Both passes share one promise instead.
 */
let completion: Promise<CompleteResult> | null = null;

export function completeClaimedConnect(
  handoff: CallbackHandoff,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  storage: Storage | null = safeStorage(),
): Promise<CompleteResult> {
  completion ??= completeConnect(handoff, fetchImpl, getToken, storage);
  return completion;
}

/** Only for tests, which need each case to start from nothing. */
export function forgetHandoffClaim(): void {
  claimed = null;
  completion = null;
}

/** Take the handoff off the URL, so a reload cannot replay it. */
export function clearHandoff(): void {
  try {
    globalThis.history?.replaceState(
      null,
      '',
      globalThis.location.pathname + globalThis.location.search,
    );
  } catch {
    // Nothing here is worth failing the connection over.
  }
}

async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function problemFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Fall through to the generic sentence.
  }
  return 'Something went wrong talking to GitHub. Try again shortly.';
}

/** What the builder needs to decide which affordances to show. */
export async function fetchGitHubStatus(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<GitHubStatus | null> {
  try {
    const response = await fetchImpl('/api/github/status', {
      headers: await authHeaders(getToken),
    });
    if (!response.ok) return null;
    return (await response.json()) as GitHubStatus;
  } catch {
    return null;
  }
}

/**
 * Begin connecting: remember the state, then hand back where to send the
 * browser.
 *
 * The navigation is the caller's to perform, because this file is the half
 * that has no business touching `location`. What it does own is that the
 * state is stored *before* the browser leaves, since a state stored after
 * the navigation would never be stored at all.
 */
export async function beginConnect(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  storage: Storage | null = safeStorage(),
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl('/api/github/connect', {
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: 'Could not reach Vibld. Try again shortly.' };
  }
  if (!response.ok) return { ok: false, error: await problemFrom(response) };

  const body = (await response.json()) as { url?: unknown; state?: unknown };
  if (typeof body.url !== 'string' || typeof body.state !== 'string') {
    return { ok: false, error: 'Vibld could not start that connection.' };
  }
  rememberState(body.state, storage);
  return { ok: true, url: body.url };
}

export type CompleteResult =
  | { ok: true; offer: ConnectOffer }
  | { ok: false; error: string; install?: boolean };

/**
 * Finish the exchange, but only for a `state` this browser issued.
 *
 * The comparison is the point, and it happens before anything is sent. A
 * link somebody else crafted carries a `state` this browser never stored, so
 * the code beside it is never exchanged and its repositories are never
 * offered. Without this the server would happily complete an authorization
 * belonging to somebody else inside this session.
 */
export async function completeConnect(
  handoff: CallbackHandoff,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  storage: Storage | null = safeStorage(),
): Promise<CompleteResult> {
  const remembered = takeRememberedState(storage);
  if (!remembered || remembered !== handoff.state) {
    return {
      ok: false,
      error:
        'That connection link did not come from this browser. Start again.',
    };
  }

  let response: Response;
  try {
    response = await fetchImpl('/api/github/complete', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({
        code: handoff.code,
        state: handoff.state,
        ...(handoff.installation ? { installation: handoff.installation } : {}),
      }),
    });
  } catch {
    return { ok: false, error: 'Could not reach Vibld. Try again shortly.' };
  }

  if (!response.ok) {
    let install = false;
    let error = 'Something went wrong talking to GitHub. Try again shortly.';
    try {
      const body = (await response.json()) as {
        error?: unknown;
        install?: unknown;
      };
      if (typeof body.error === 'string' && body.error) error = body.error;
      install = body.install === true;
    } catch {
      // Keep the generic sentence.
    }
    return { ok: false, error, ...(install ? { install: true } : {}) };
  }

  const body = (await response.json()) as {
    repositories?: unknown;
    ticket?: unknown;
  };
  if (!Array.isArray(body.repositories) || typeof body.ticket !== 'string') {
    return { ok: false, error: 'Vibld could not read GitHub’s reply.' };
  }
  return {
    ok: true,
    offer: {
      repositories: body.repositories as RepositoryChoice[],
      ticket: body.ticket,
    },
  };
}

/** Write the binding for the repository the person picked. */
export async function bindRepository(
  ticket: string,
  choice: Pick<RepositoryChoice, 'owner' | 'repo'>,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl('/api/github/bind', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({ ticket, owner: choice.owner, repo: choice.repo }),
    });
  } catch {
    return { ok: false, error: 'Could not reach Vibld. Try again shortly.' };
  }
  if (!response.ok) return { ok: false, error: await problemFrom(response) };
  return { ok: true };
}

/** Stop pushing to the connected repository. */
export async function disconnectRepository(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl('/api/github/disconnect', {
      method: 'POST',
      headers: await authHeaders(getToken),
    });
  } catch {
    return { ok: false, error: 'Could not reach Vibld. Try again shortly.' };
  }
  if (!response.ok) return { ok: false, error: await problemFrom(response) };
  return { ok: true };
}
