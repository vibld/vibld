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
  /**
   * Accounts the server's read budget did not reach, by login.
   *
   * Almost always empty. When it is not, this list is the difference between
   * a short offer and a silently wrong one: the user token is gone by now,
   * so an unread account's repositories cannot be fetched later, and the
   * only route to them is installing again on that account, which returns an
   * installation id the server reads directly and outside the budget.
   */
  omitted?: string[];
  /**
   * Some list GitHub paginates was cut short by the server's page bound.
   *
   * Different from `omitted` and deliberately not merged with it: an omitted
   * account can be reached by installing again, and this cannot, because the
   * next read follows the same bound. Saying so is all that is available,
   * and it beats presenting a partial list as the whole one.
   */
  truncated?: boolean;
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

/**
 * How long that cache is allowed to live: as long as something is using it.
 *
 * Module-level and never cleared was a leak with teeth. The panel mounts
 * inside `Show when="signed-in"`, so signing out unmounts it and signing in
 * mounts it again, with no page load in between and nothing resetting a
 * module variable. Whoever signed in next was handed the previous person's
 * handoff, and `completeClaimedConnect` handed back their completed offer:
 * one account's repository names shown to another. The milder version of the
 * same thing replays a spent ticket to the person who earned it, which can
 * only fail by the time they click it.
 *
 * Counted, because the two StrictMode passes overlap and either may be the
 * last to let go. Cleared on a deferred task rather than immediately,
 * because StrictMode's unmount and remount happen with nothing in between:
 * a clear that ran there would take the replay's handoff away, which is the
 * bug this cache exists to stop.
 */
let holders = 0;
let cancelClear: (() => void) | null = null;

/** Schedules the clear, and hands back a way to call it off. */
export type Defer = (run: () => void) => () => void;

const deferToTask: Defer = (run) => {
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
};

/**
 * Hold the claimed handoff for the life of a mount. Release when it unmounts.
 *
 * The returned release is idempotent: a cleanup that somehow runs twice must
 * not free a hold belonging to a mount that is still there.
 */
export function holdHandoff(defer: Defer = deferToTask): () => void {
  holders += 1;
  cancelClear?.();
  cancelClear = null;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders > 0) return;
    cancelClear = defer(() => {
      cancelClear = null;
      claimed = null;
      completion = null;
    });
  };
}

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
  cancelClear?.();
  cancelClear = null;
  holders = 0;
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
async function issueState(
  fetchImpl: typeof fetch,
  getToken: () => Promise<string | null>,
  storage: Storage | null,
): Promise<
  { ok: true; url: string; state: string } | { ok: false; error: string }
> {
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
  return { ok: true, url: body.url, state: body.state };
}

export async function beginConnect(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  storage: Storage | null = safeStorage(),
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const started = await issueState(fetchImpl, getToken, storage);
  return started.ok ? { ok: true, url: started.url } : started;
}

/**
 * The App's installation page, which is where repository access is granted.
 *
 * The slug lives here rather than being configured, because it is the name
 * in a public URL rather than a deployment secret.
 */
const INSTALL_URL = 'https://github.com/apps/vibld/installations/new';

/**
 * Send somebody to install the App, with a `state` that comes back.
 *
 * A plain link here is a dead end, and that is subtle enough to be worth
 * spelling out. GitHub passes a `state` through the installation flow only
 * if one was supplied, so a stateless install returns to the callback with
 * an `installation_id` and no `state`; the callback turns anything missing
 * either half into `github=incomplete`, and the app discards it. The
 * installation happens and nothing hears about it.
 *
 * That matters most in the case this exists for. When an account was skipped
 * by the read budget, the whole point of installing again is that the id
 * comes back, because a named installation is read directly and outside the
 * budget. Without the state, the id never arrives and re-installing changes
 * nothing: GitHub's list may still order that account past the budget, so it
 * is skipped again, forever.
 *
 * So this issues a fresh state the same way `beginConnect` does, stores it
 * for the comparison on the way back, and carries it on the URL. Fresh
 * rather than reused: the completion that produced this offer spent the
 * stored one, and a state is good for exactly one return trip.
 */
export async function beginInstall(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
  storage: Storage | null = safeStorage(),
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const started = await issueState(fetchImpl, getToken, storage);
  if (!started.ok) return started;
  const url = new URL(INSTALL_URL);
  url.searchParams.set('state', started.state);
  return { ok: true, url: url.toString() };
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
    omitted?: unknown;
    truncated?: unknown;
  };
  if (!Array.isArray(body.repositories) || typeof body.ticket !== 'string') {
    return { ok: false, error: 'Vibld could not read GitHub’s reply.' };
  }
  const omitted = Array.isArray(body.omitted)
    ? body.omitted.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    ok: true,
    offer: {
      repositories: body.repositories as RepositoryChoice[],
      ticket: body.ticket,
      ...(omitted.length > 0 ? { omitted } : {}),
      ...(body.truncated === true ? { truncated: true } : {}),
    },
  };
}

/** Write the binding for the repository the person picked. */
const connectionListeners = new Set<() => void>();

/**
 * Hear that the connection changed, from wherever it was changed.
 *
 * Two places in the builder read `/api/github/status` and each keeps its own
 * copy: the panel in the header and the push button in the Code tab. Until
 * this, only the one that made the change learned of it. Binding a
 * repository from the panel with the Code tab already open left the button
 * hidden, because the status it read on mount said there was nothing to push
 * to and nothing ever told it otherwise; disconnecting left the button up,
 * naming a repository that is no longer connected.
 *
 * Published by the writes themselves rather than by the panel that calls
 * them, because a bind changing the connection is a fact about the bind. A
 * second caller elsewhere would otherwise have to remember to announce it,
 * and the failure of remembering is silent.
 *
 * Returns the unsubscribe.
 */
export function onConnectionChanged(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

function announceConnectionChanged(): void {
  // Over a copy, so this dispatch reaches exactly the listeners that were
  // subscribed when the write landed: one that subscribes another while
  // being called is reacting to this change, not asking to be told about it
  // twice. (Removing during iteration needs no copy; a Set handles that.)
  //
  // Each one caught on its own. The write has already landed, and one
  // subscriber throwing is neither a reason to report a successful bind as
  // failed nor a reason for the rest not to hear about it.
  for (const listener of [...connectionListeners]) {
    try {
      listener();
    } catch {
      // Not this write's problem, and not worth a provider's reply in a log.
    }
  }
}

export interface BoundRepository {
  owner: string;
  repo: string;
  defaultBranch: string;
  expiresAt?: string;
}

export async function bindRepository(
  ticket: string,
  // `defaultBranch` as well as the name, because the fallback below needs
  // it. Narrowing this to owner and repo threw away the one authoritative
  // answer already in hand, so a repository on `trunk` whose reply was
  // unreadable and whose refresh then failed was shown as `main`: the
  // fallback added to keep a success visible, showing it wrongly.
  choice: Pick<RepositoryChoice, 'owner' | 'repo' | 'defaultBranch'>,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<
  { ok: true; bound: BoundRepository } | { ok: false; error: string }
> {
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

  // Here rather than beside the return, so an unreadable reply still tells
  // everyone else the connection moved. The write landed either way, and the
  // fallback below is about what to show, not about whether it happened.
  announceConnectionChanged();

  // The binding comes back in the reply, so the caller does not need a
  // second round trip to know what it just connected. That matters: a status
  // refresh that fails after a write has already succeeded would otherwise
  // leave somebody looking at nothing, unable to tell whether it worked.
  let bound: BoundRepository = {
    owner: choice.owner,
    repo: choice.repo,
    defaultBranch: choice.defaultBranch,
  };
  try {
    const body = (await response.json()) as Partial<BoundRepository>;
    if (typeof body.owner === 'string' && typeof body.repo === 'string') {
      bound = {
        owner: body.owner,
        repo: body.repo,
        defaultBranch:
          typeof body.defaultBranch === 'string'
            ? body.defaultBranch
            : choice.defaultBranch,
        ...(typeof body.expiresAt === 'string'
          ? { expiresAt: body.expiresAt }
          : {}),
      };
    }
  } catch {
    // The write landed; an unreadable reply does not undo it.
  }
  return { ok: true, bound };
}

/** What a push wrote, as `/api/github/push` reports it. */
export interface PushedSnapshot {
  branch: string;
  commitSha: string;
  /**
   * False when the branch was already there carrying this exact tree.
   *
   * The route distinguishes these and so does this, because they are
   * different things to tell somebody: one moved their work, the other found
   * it already moved. Collapsing them would report a commit that this push
   * did not make.
   */
  created: boolean;
  pullRequestUrl?: string;
}

/**
 * A branch that is already there and points somewhere else.
 *
 * Carried out of the reply rather than left inside its sentence, because
 * `docs/push-and-deploy-plan.md` commits to surfacing a conflict with both
 * shas, and the sentence names the branch and neither. The reply is the only
 * place they exist: nothing here can ask again, so reading past them loses
 * them for good.
 *
 * The two are different kinds of object and are labelled as such wherever
 * they are shown. `existingSha` is the commit the branch points at;
 * `attemptedTreeSha` is the tree this checkpoint builds. Presenting them as
 * a pair to compare would invite a comparison that means nothing.
 */
export interface PushConflict {
  branch: string;
  /** The commit the branch points at now. */
  existingSha: string;
  /** The tree this push built and wanted the branch to carry. */
  attemptedTreeSha: string;
}

/**
 * All three fields or none of it.
 *
 * A half-read conflict is worse than no conflict: it draws the sentence that
 * promises both shas and then prints a blank where one of them should be,
 * which reads as though the branch points at nothing.
 */
function conflictFrom(value: unknown): PushConflict | null {
  if (typeof value !== 'object' || value === null) return null;
  const { branch, existingSha, attemptedTreeSha } = value as Record<
    string,
    unknown
  >;
  if (typeof branch !== 'string' || !branch) return null;
  if (typeof existingSha !== 'string' || !existingSha) return null;
  if (typeof attemptedTreeSha !== 'string' || !attemptedTreeSha) return null;
  return { branch, existingSha, attemptedTreeSha };
}

export type PushResult =
  | { ok: true; pushed: PushedSnapshot }
  | {
      ok: false;
      error: string;
      reconnect?: boolean;
      conflict?: PushConflict;
    };

/**
 * Push an accepted checkpoint to the connected repository.
 *
 * `revision` and `files` are what the snapshot already holds, sent as they
 * are: the route keys the operation on the revision so a retry of one
 * checkpoint cannot become a second branch, which is the whole reason it is
 * not a client-generated id.
 *
 * `reconnect` is carried through rather than folded into the sentence,
 * because the two are different remedies and the route already separates
 * them: a lost grant wants a fresh connection, and everything else does not.
 *
 * `to` is where the caller believes it is pushing, sent so the route can
 * refuse if that is no longer where the connection points. Required rather
 * than optional: the route reads the binding when the request arrives, and
 * a caller that does not say where it meant to go is asking for whatever is
 * connected by then, which is how a button labelled one repository writes to
 * another. Filtering the reply afterwards would only make the button quiet
 * about it.
 */
export async function pushSnapshot(
  snapshot: { revision: string; files: { path: string; content: string }[] },
  to: { owner: string; repo: string },
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  getToken: () => Promise<string | null> = getClerkToken,
): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/github/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(await authHeaders(getToken)),
      },
      body: JSON.stringify({
        revision: snapshot.revision,
        files: snapshot.files,
        owner: to.owner,
        repo: to.repo,
      }),
    });
  } catch {
    return { ok: false, error: 'Could not reach Vibld. Try again shortly.' };
  }

  if (!response.ok) {
    let error = 'Something went wrong talking to GitHub. Try again shortly.';
    let reconnect = false;
    let conflict: PushConflict | null = null;
    try {
      const body = (await response.json()) as {
        error?: unknown;
        reconnect?: unknown;
        conflict?: unknown;
      };
      if (typeof body.error === 'string' && body.error) error = body.error;
      reconnect = body.reconnect === true;
      conflict = conflictFrom(body.conflict);
    } catch {
      // Keep the generic sentence.
    }
    return {
      ok: false,
      error,
      ...(reconnect ? { reconnect: true } : {}),
      ...(conflict ? { conflict } : {}),
    };
  }

  // Guarded for the same reason the failure branch above is, and with more
  // riding on it: this one is awaited by a button that has already gone
  // busy, so a rejection here is not a thrown error anybody sees. It is a
  // button that stays disabled until the page is reloaded.
  let body: Partial<PushedSnapshot>;
  try {
    body = (await response.json()) as Partial<PushedSnapshot>;
  } catch {
    return { ok: false, error: 'Vibld could not read GitHub’s reply.' };
  }
  if (typeof body.branch !== 'string' || typeof body.commitSha !== 'string') {
    return { ok: false, error: 'Vibld could not read GitHub’s reply.' };
  }
  return {
    ok: true,
    pushed: {
      branch: body.branch,
      commitSha: body.commitSha,
      // Absent is read as "it made one" rather than as false. The route
      // always sends it, so absence means an older deployment, and claiming
      // a push found nothing to do is the more misleading of the two.
      created: body.created !== false,
      ...(typeof body.pullRequestUrl === 'string'
        ? { pullRequestUrl: body.pullRequestUrl }
        : {}),
    },
  };
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
  announceConnectionChanged();
  return { ok: true };
}
