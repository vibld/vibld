/**
 * Connecting a repository: proving who is connecting before anything is
 * bound (issue #121).
 *
 * This file exists because of one fact about GitHub. After someone installs
 * a GitHub App, GitHub redirects to the App's setup URL with
 * `?installation_id=N` on the query string. That redirect is a plain GET.
 * It is not signed, it carries no secret, and nothing about it proves the
 * browser making the request had anything to do with the installation.
 *
 * So `installation_id` from the query is a hint and never an authority. Any
 * signed-in user could request the callback with somebody else's
 * installation id; if that wrote a binding, every later push would mint a
 * token scoped to that installation and commit into a stranger's
 * repository.
 *
 * What actually establishes the right to bind is a user-to-server token:
 * the person authorizes Vibld as themselves, and `GET /user/installations`
 * then answers, from GitHub, which installations *that account* can reach.
 * The binding is chosen from that answer. A forged id is simply absent from
 * it.
 *
 * The user token is used for those reads and discarded. It is never stored
 * and never written down: it proves who is connecting, and the push path
 * has its own credential (an installation token minted per push from the
 * App key, scoped to one repository). ADR-0006 keeps those classes apart,
 * and a user's GitHub token is the class this product does not hold.
 */

import {
  GITHUB_API,
  GITHUB_USER_AGENT,
  rateLimitMessage,
  type GitHubFailure,
} from './github-app.ts';

const GITHUB_OAUTH = 'https://github.com';

/** How long the CSRF nonce on the authorize leg stays good. */
const STATE_LIFETIME_MS = 10 * 60 * 1000;

export interface GitHubOAuthEnv {
  VIBLD_GITHUB_CLIENT_ID?: string;
  VIBLD_GITHUB_CLIENT_SECRET?: string;
}

export interface GitHubOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The OAuth half of the App, or null when this deployment has not been given
 * it. Null rather than throwing, the same fail-closed shape
 * `githubAppCredentials` uses: an unconfigured deployment does not offer the
 * feature.
 */
export function githubOAuthCredentials(
  env: GitHubOAuthEnv,
): GitHubOAuthCredentials | null {
  const clientId = env.VIBLD_GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.VIBLD_GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

/** Constant time, so a comparison cannot be walked one byte at a time. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index]! ^ b[index]!;
  }
  return difference === 0;
}

/**
 * The `state` for the authorize leg: who started it, and when.
 *
 * A CSRF token, not a capability. It stops somebody else's authorization
 * from being walked into this user's session, and it is deliberately *not*
 * what decides whether a binding may be written -- that is the installation
 * read below. Signing it means no table and no cleanup: a nonce that has to
 * be stored and swept is a second failure mode for something whose whole job
 * is to be short-lived.
 *
 * Keyed on the client secret rather than a new secret of its own. It is
 * already required for this flow and already a Worker secret, and a
 * deployment that lacks it cannot reach this code at all.
 */
export async function signState(
  credentials: GitHubOAuthCredentials,
  userId: string,
  now: number = Date.now(),
): Promise<string> {
  return signPayload(credentials, { u: userId }, now);
}

/**
 * A value this deployment issued, stamped with when.
 *
 * Signed rather than stored, for both the `state` above and the ticket
 * below: neither needs a table, neither needs sweeping, and the thing they
 * both are is a short-lived statement by this Worker about something it has
 * already checked.
 */
async function signPayload(
  credentials: GitHubOAuthCredentials,
  fields: Record<string, unknown>,
  now: number,
): Promise<string> {
  const payload = base64Url(
    new TextEncoder().encode(JSON.stringify({ ...fields, t: now })),
  );
  const signature = base64Url(await hmac(credentials.clientSecret, payload));
  return `${payload}.${signature}`;
}

async function verifyPayload(
  credentials: GitHubOAuthCredentials,
  token: string,
  now: number,
  lifetimeMs: number,
): Promise<Record<string, unknown> | null> {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = await hmac(credentials.clientSecret, payload);
  const offered = fromBase64Url(signature);
  if (!offered || !sameBytes(expected, offered)) return null;

  const decoded = fromBase64Url(payload);
  if (!decoded) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
  const issued = parsed.t;
  if (typeof issued !== 'number') return null;
  // Expiry is checked after the signature, so an unsigned value is never
  // merely called stale.
  if (now - issued > lifetimeMs || issued > now + 60_000) return null;
  return parsed;
}

/**
 * The user a `state` belongs to, or null if it is not one this deployment
 * issued to that user recently.
 */
export async function verifyState(
  credentials: GitHubOAuthCredentials,
  state: string,
  now: number = Date.now(),
): Promise<string | null> {
  const parsed = await verifyPayload(
    credentials,
    state,
    now,
    STATE_LIFETIME_MS,
  );
  return parsed && typeof parsed.u === 'string' ? parsed.u : null;
}

/** How long a verified choice stays good before connecting again. */
const TICKET_LIFETIME_MS = 15 * 60 * 1000;

/**
 * What the callback established, in a form the bind call can trust.
 *
 * The problem it solves: the callback proves, with a user token, which
 * installation this person controls and which repositories inside it they
 * may write to. The bind call arrives later, as a separate request, and the
 * user token is gone by then because this product does not keep one.
 *
 * The alternatives are worse. Storing the token would make Vibld hold a
 * credential that can act as the user across the whole of GitHub, which is
 * exactly the class ADR-0006 says it does not hold. Re-reading at bind time
 * would need that token anyway. Trusting the repository named in the request
 * body would put us back where we started, with the browser asserting its
 * own authorization.
 *
 * So the callback signs the answer it got: this user, this installation,
 * these repositories, at this time. The bind call may then choose only from
 * the list that was signed, and the set offered is exactly the set that can
 * be bound.
 */
export async function signChoice(
  credentials: GitHubOAuthCredentials,
  userId: string,
  repositories: readonly ConnectableRepository[],
  now: number = Date.now(),
): Promise<string> {
  return signPayload(
    credentials,
    {
      u: userId,
      r: repositories.map((choice) => [
        choice.installationId,
        choice.owner,
        choice.repo,
        choice.defaultBranch,
      ]),
    },
    now,
  );
}

export interface VerifiedChoice {
  userId: string;
  repositories: ConnectableRepository[];
}

/**
 * What a ticket says, if this deployment signed it recently.
 *
 * Returns the whole statement rather than a yes: the caller has to check the
 * user it names against the caller's own identity, and pick from the
 * repositories it lists. A ticket is not a bearer token for binding anything
 * -- it is a record of what was verified, and it is useless for a repository
 * that is not in it.
 */
export async function verifyChoice(
  credentials: GitHubOAuthCredentials,
  ticket: string,
  now: number = Date.now(),
): Promise<VerifiedChoice | null> {
  const parsed = await verifyPayload(
    credentials,
    ticket,
    now,
    TICKET_LIFETIME_MS,
  );
  if (!parsed) return null;
  if (typeof parsed.u !== 'string') return null;
  if (!Array.isArray(parsed.r)) return null;

  const repositories: ConnectableRepository[] = [];
  for (const entry of parsed.r) {
    if (!Array.isArray(entry) || entry.length !== 4) return null;
    const [installationId, owner, repo, defaultBranch] = entry;
    if (
      typeof installationId !== 'number' ||
      typeof owner !== 'string' ||
      typeof repo !== 'string' ||
      typeof defaultBranch !== 'string'
    ) {
      return null;
    }
    repositories.push({ installationId, owner, repo, defaultBranch });
  }
  return { userId: parsed.u, repositories };
}

/**
 * Where to send the browser to start connecting.
 *
 * `/login/oauth/authorize` rather than the App's install page: a user who
 * has already installed the App still has to prove they are that user, and
 * this endpoint handles both, sending them through installation first when
 * there is none.
 */
export function authorizeUrl(
  credentials: GitHubOAuthCredentials,
  state: string,
  redirectUri: string,
): string {
  const url = new URL('/login/oauth/authorize', GITHUB_OAUTH);
  url.searchParams.set('client_id', credentials.clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
}

export type UserToken =
  | { ok: true; token: string }
  | { ok: false; error: string; reason: GitHubFailure };

/**
 * Trade the `code` from the redirect for a token that acts as the user.
 *
 * Nothing here ever puts `client_secret` or the resulting token into a
 * message. Every failure is a fixed sentence, because the one thing an
 * error string must never carry is the credential that produced it.
 */
export async function exchangeCode(
  credentials: GitHubOAuthCredentials,
  code: string,
  doFetch: typeof fetch = fetch,
): Promise<UserToken> {
  let response: Response;
  try {
    response = await doFetch(`${GITHUB_OAUTH}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': GITHUB_USER_AGENT,
      },
      body: JSON.stringify({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
      }),
      redirect: 'manual',
    });
  } catch {
    return {
      ok: false,
      error: 'GitHub could not be reached.',
      reason: 'unreachable',
    };
  }

  let body: Record<string, unknown>;
  try {
    body = ((await response.json()) ?? {}) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const limited = rateLimitMessage(response.status, response.headers, body);
  if (limited) return { ok: false, error: limited, reason: 'rate-limited' };

  // GitHub answers a refused exchange with 200 and an `error` field rather
  // than a status, so the status alone is not the test. An expired or reused
  // code lands here, and the answer is to start again rather than retry.
  if (typeof body.error === 'string' || !response.ok) {
    return {
      ok: false,
      error: 'That GitHub sign-in did not complete. Try connecting again.',
      reason: 'invalid',
    };
  }

  const token = body.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    return {
      ok: false,
      error: 'GitHub returned a reply Vibld could not read.',
      reason: 'unreadable',
    };
  }
  return { ok: true, token };
}

/** An installation the connecting user can actually reach. */
export interface UserInstallation {
  id: number;
  /** The user or organisation it is installed on, for the picker. */
  account: string;
}

export interface RepositoryChoice {
  owner: string;
  repo: string;
  defaultBranch: string;
}

/**
 * A repository the user may connect, and the installation it would be
 * pushed through.
 *
 * The installation travels *with* the repository rather than beside the
 * list, because one person can have the App installed on several accounts
 * and the whole set is offered at once. Carrying a single "chosen
 * installation" instead meant the callback picked one and the others could
 * not be reached at all: reading a second installation's repositories needs
 * the user token, and that is gone by the time anyone could ask.
 */
export interface ConnectableRepository extends RepositoryChoice {
  installationId: number;
}

export type Reachable<T> =
  { ok: true; value: T } | { ok: false; error: string; reason: GitHubFailure };

/** The `next` link of a paginated reply, if there is another page. */
function nextPage(response: Response): string | null {
  const link = response.headers.get('link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function readAsUser(
  token: string,
  path: string,
  doFetch: typeof fetch,
  onPage?: (response: Response) => void,
): Promise<Reachable<Record<string, unknown>>> {
  let response: Response;
  try {
    response = await doFetch(
      path.startsWith('http') ? path : `${GITHUB_API}${path}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': GITHUB_USER_AGENT,
        },
        redirect: 'manual',
      },
    );
  } catch {
    return {
      ok: false,
      error: 'GitHub could not be reached.',
      reason: 'unreachable',
    };
  }
  onPage?.(response);

  let body: Record<string, unknown> = {};
  try {
    body = ((await response.json()) ?? {}) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const limited = rateLimitMessage(response.status, response.headers, body);
  if (limited) return { ok: false, error: limited, reason: 'rate-limited' };

  // A 404 here is the interesting case and the reason this file exists: it
  // is what a forged installation id looks like. GitHub does not say "not
  // yours", it says the installation is not there, because as far as this
  // user is concerned it is not.
  if (response.status === 404 || response.status === 403) {
    return {
      ok: false,
      error: 'That installation is not available to your GitHub account.',
      reason: 'access',
    };
  }
  if (response.status === 401) {
    return {
      ok: false,
      error: 'That GitHub sign-in has expired. Try connecting again.',
      reason: 'invalid',
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `GitHub refused the request (${response.status}).`,
      reason: 'refused',
    };
  }
  return { ok: true, value: body };
}

/**
 * The installations this GitHub account can reach.
 *
 * The authorization check, in one call. Whatever `installation_id` the
 * redirect carried, only what appears here may be bound, so a forged id
 * fails by simply not being in the list.
 */
export async function userInstallations(
  token: string,
  doFetch: typeof fetch = fetch,
): Promise<Reachable<UserInstallation[]>> {
  const reply = await readAsUser(token, '/user/installations', doFetch);
  if (!reply.ok) return reply;

  const raw = reply.value.installations;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'GitHub returned a reply Vibld could not read.',
      reason: 'unreadable',
    };
  }
  const installations: UserInstallation[] = [];
  for (const entry of raw) {
    const record = (entry ?? {}) as { id?: unknown; account?: unknown };
    const account = (record.account ?? {}) as { login?: unknown };
    if (typeof record.id !== 'number') continue;
    installations.push({
      id: record.id,
      account: typeof account.login === 'string' ? account.login : 'unknown',
    });
  }
  return { ok: true, value: installations };
}

/**
 * The bounds on what one exchange will read, and a warning about adding
 * more of them.
 *
 * Anything not gathered while the user token is alive is not merely
 * unlisted: the token is discarded when the exchange ends, so a repository
 * or an installation left out here cannot be reached afterwards at all. Each
 * of these bounds is therefore a limit only while what somebody wants is
 * inside it, and a dead end the moment it is not. This flow has produced
 * that same failure three times in different places.
 *
 * So a bound added here needs a way for the thing somebody actually asked
 * for to be inside it. The installation they just used is moved to the front
 * before the read below for exactly that reason.
 */
const MAX_INSTALLATIONS_READ = 10;
const MAX_REPOSITORY_PAGES = 5;

/**
 * Everything this person could connect, across every installation they can
 * reach.
 *
 * One call per installation, which is why it is capped. The alternative was
 * to read only one and report the rest as names the user could see and not
 * choose, which is a dead end rather than a limit: the user token is what
 * makes this readable at all, and it is discarded as soon as the callback
 * ends.
 *
 * A single installation failing does not lose the others. One organisation
 * having been removed from under the App should not stop somebody connecting
 * a repository on their own account.
 */
export async function connectableRepositories(
  token: string,
  installations: readonly UserInstallation[],
  doFetch: typeof fetch = fetch,
): Promise<Reachable<ConnectableRepository[]>> {
  const connectable: ConnectableRepository[] = [];
  let lastFailure: Extract<Reachable<never>, { ok: false }> | null = null;
  let read = 0;

  for (const installation of installations) {
    if (read >= MAX_INSTALLATIONS_READ) break;
    read += 1;
    const reply = await installationRepositories(
      token,
      installation.id,
      doFetch,
    );
    if (!reply.ok) {
      lastFailure = reply;
      continue;
    }
    for (const choice of reply.value) {
      connectable.push({ ...choice, installationId: installation.id });
    }
  }

  // Only a failure when it cost every installation. Reporting a partial read
  // as success would quietly hide repositories somebody expected to see, and
  // reporting it as failure would block a connection that can be made.
  if (connectable.length === 0 && lastFailure) return lastFailure;
  return { ok: true, value: connectable };
}

/**
 * The repositories inside one installation that this user may pick.
 *
 * Asked as the user, not as the installation, so it answers "may this
 * person choose this" rather than "does the App have it". Those differ: an
 * App can be installed on a repository by an administrator and reached by
 * nobody else, and binding on the second question would let a user push to
 * a repository they cannot see.
 */
export async function installationRepositories(
  token: string,
  installationId: number,
  doFetch: typeof fetch = fetch,
): Promise<Reachable<RepositoryChoice[]>> {
  const choices: RepositoryChoice[] = [];
  let path: string | null =
    `/user/installations/${encodeURIComponent(String(installationId))}/repositories?per_page=100`;

  // Followed rather than read once, for the same reason every installation
  // is read rather than one: the user token is gone when the callback ends,
  // so a repository left off this list can never be chosen afterwards. An
  // installation with more than a hundred repositories would otherwise have
  // its tail silently unreachable. Bounded, because "follow every link
  // GitHub offers" is not a loop to write against somebody else's server.
  for (let page = 0; page < MAX_REPOSITORY_PAGES && path; page += 1) {
    let following: string | null = null;
    const reply: Reachable<Record<string, unknown>> = await readAsUser(
      token,
      path,
      doFetch,
      (response) => {
        following = nextPage(response);
      },
    );
    if (!reply.ok) return reply;
    path = following;

    const raw = reply.value.repositories;
    if (!Array.isArray(raw)) {
      return {
        ok: false,
        error: 'GitHub returned a reply Vibld could not read.',
        reason: 'unreadable',
      };
    }
    collectRepositories(raw, choices);
  }
  return { ok: true, value: choices };
}

/** One page of GitHub's repository list, filtered to what may be offered. */
function collectRepositories(
  raw: unknown[],
  choices: RepositoryChoice[],
): void {
  for (const entry of raw) {
    const record = (entry ?? {}) as {
      name?: unknown;
      default_branch?: unknown;
      owner?: unknown;
      archived?: unknown;
      permissions?: unknown;
    };
    const owner = (record.owner ?? {}) as { login?: unknown };
    const permissions = (record.permissions ?? {}) as { push?: unknown };
    if (typeof record.name !== 'string' || typeof owner.login !== 'string') {
      continue;
    }
    // A repository this person cannot write to is not one to offer. The push
    // would be refused later, after they had chosen it and waited.
    if (permissions.push !== true) continue;
    // An archived repository is read-only on GitHub's side, so the same.
    if (record.archived === true) continue;
    choices.push({
      owner: owner.login,
      repo: record.name,
      defaultBranch:
        typeof record.default_branch === 'string' && record.default_branch
          ? record.default_branch
          : 'main',
    });
  }
}
