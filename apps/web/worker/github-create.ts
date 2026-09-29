/**
 * Creating a repository for a project that has none (D72, "Create a new
 * repository").
 *
 * Only ever called with the user-to-server token, during the one request
 * that holds it (`handleGitHubComplete`). That is not a preference. GitHub's
 * `POST /user/repos` accepts a user access token and nothing else: an
 * installation token cannot create a repository on a personal account at
 * all, only on an organisation. And it needs the App to hold the
 * **Administration: write** repository permission, which the App did not
 * request before D72 (docs/decisions.md L42a). Until it does, GitHub
 * answers 403 and this reports that plainly rather than as a failure to
 * retry.
 *
 * The token is used and dropped here as it is everywhere else in the
 * connect flow (`github-connect.ts`). Nothing is stored.
 */

import {
  GITHUB_API,
  GITHUB_USER_AGENT,
  rateLimitMessage,
  type GitHubFailure,
} from './github-app.ts';
import type { RepositoryChoice } from './github-connect.ts';

/**
 * What GitHub accepts as a repository name, checked before it is sent.
 *
 * GitHub allows letters, digits, `-`, `_` and `.`, up to 100 characters,
 * and refuses `.` and `..`. It quietly rewrites other characters to `-`,
 * which is worth refusing here instead: a person who typed a name should
 * get that name or be told why not, not discover later that the repository
 * is called something else.
 */
export function repositoryNameProblem(name: string): string | null {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    return 'A repository name can use letters, numbers, hyphens, underscores and dots, up to 100 characters.';
  }
  if (name === '.' || name === '..') {
    return 'A repository name cannot be only dots.';
  }
  return null;
}

/** What asking GitHub to create a repository came to. */
export type CreatedRepository =
  | { ok: true; repository: RepositoryChoice }
  /** A repository of that name is already on the account. */
  | { ok: false; kind: 'taken'; error: string }
  /**
   * GitHub will not let the App create repositories: the permission is not
   * granted, or the installation has not accepted it. Not a retry.
   */
  | { ok: false; kind: 'refused'; error: string }
  | { ok: false; kind: 'failed'; error: string; reason: GitHubFailure };

/**
 * Said when the App cannot create repositories, with the way round it.
 *
 * Exported so the route and its tests say the same sentence. It names the
 * other choice rather than the permission: the person reading it cannot
 * change the App, and "Use an existing repository" is something they can
 * do right now.
 */
export const CREATE_REFUSED =
  'vibld is not allowed to create repositories on GitHub yet. Create one on GitHub yourself, then choose "Use an existing repository".';

interface UserReply {
  status: number;
  body: Record<string, unknown>;
  limited: string | null;
}

async function callAsUser(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  doFetch: typeof fetch,
  body?: unknown,
): Promise<UserReply | null> {
  let response: Response;
  try {
    response = await doFetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': GITHUB_USER_AGENT,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });
  } catch {
    return null;
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = ((await response.json()) ?? {}) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return {
    status: response.status,
    body: parsed,
    limited: rateLimitMessage(response.status, response.headers, parsed),
  };
}

/**
 * The login of the person the token belongs to, or null if GitHub would not
 * say.
 *
 * Null rather than a failure: it names the account on the panel and
 * decides where a created repository goes, and a connection that cannot
 * learn it is still a connection. Creating is what refuses without it.
 */
export async function viewerLogin(
  token: string,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  const reply = await callAsUser(token, 'GET', '/user', doFetch);
  if (!reply || reply.status !== 200) return null;
  return typeof reply.body.login === 'string' && reply.body.login
    ? reply.body.login
    : null;
}

/** Whether a 422 from `POST /user/repos` is GitHub saying the name is taken. */
function nameTaken(body: Record<string, unknown>): boolean {
  const errors = Array.isArray(body.errors) ? body.errors : [];
  return errors.some((entry) => {
    const record = (entry ?? {}) as { field?: unknown; message?: unknown };
    return (
      record.field === 'name' &&
      typeof record.message === 'string' &&
      /already exists/i.test(record.message)
    );
  });
}

/**
 * Create a repository on the signed-in person's own account.
 *
 * Private unless asked otherwise (D72), and initialised with a README.
 * The README is not decoration: a push resolves the default branch's head
 * as the parent of its commit (`resolveBase`), and an empty repository has
 * no branch to resolve, so a repository created empty could not be pushed
 * to at all.
 */
export async function createUserRepository(
  token: string,
  request: { name: string; private: boolean; description?: string },
  doFetch: typeof fetch = fetch,
): Promise<CreatedRepository> {
  const reply = await callAsUser(token, 'POST', '/user/repos', doFetch, {
    name: request.name,
    private: request.private,
    auto_init: true,
    ...(request.description ? { description: request.description } : {}),
  });
  if (!reply) {
    return {
      ok: false,
      kind: 'failed',
      error: 'GitHub could not be reached.',
      reason: 'unreachable',
    };
  }
  if (reply.limited) {
    return {
      ok: false,
      kind: 'failed',
      error: reply.limited,
      reason: 'rate-limited',
    };
  }
  if (reply.status === 422 && nameTaken(reply.body)) {
    return {
      ok: false,
      kind: 'taken',
      error: `There is already a repository called ${request.name} on your GitHub account.`,
    };
  }
  if (reply.status === 422) {
    return {
      ok: false,
      kind: 'failed',
      error:
        'GitHub would not create a repository with that name. Try a different one.',
      reason: 'invalid',
    };
  }
  // 403 is GitHub's "Resource not accessible by integration": the App does
  // not hold Administration: write, or this installation has not accepted
  // it. 404 is how some of the same refusals arrive for a user token. Both
  // mean the same thing to the person reading it, and neither is fixed by
  // trying again.
  if (reply.status === 403 || reply.status === 404) {
    return { ok: false, kind: 'refused', error: CREATE_REFUSED };
  }
  if (reply.status === 401) {
    return {
      ok: false,
      kind: 'failed',
      error: 'That GitHub sign-in has expired. Try again.',
      reason: 'invalid',
    };
  }
  if (reply.status !== 201 && reply.status !== 200) {
    return {
      ok: false,
      kind: 'failed',
      error: `GitHub refused the request (${reply.status}).`,
      reason: 'refused',
    };
  }

  // What GitHub made, read from its reply rather than from the request:
  // the name as GitHub stored it, and the branch the README went onto.
  const owner = (reply.body.owner ?? {}) as { login?: unknown };
  if (typeof reply.body.name !== 'string' || typeof owner.login !== 'string') {
    return {
      ok: false,
      kind: 'failed',
      error: 'GitHub returned a reply vibld could not read.',
      reason: 'unreadable',
    };
  }
  return {
    ok: true,
    repository: {
      owner: owner.login,
      repo: reply.body.name,
      defaultBranch:
        typeof reply.body.default_branch === 'string' &&
        reply.body.default_branch
          ? reply.body.default_branch
          : 'main',
    },
  };
}

/** How many edited names to try before giving up on suggesting one. */
const SUGGESTION_TRIES = 8;

/**
 * A name close to `name` that is free on `owner`, to offer in its place.
 *
 * Asked as the user, so a private repository of theirs counts as taken:
 * GitHub answers 404 for a name that is free and 200 for one that is not.
 * Anything else (a rate limit, an unreachable GitHub) ends the search with
 * no suggestion rather than with a guess, because offering a name that
 * turns out to be taken is the thing this is for avoiding.
 */
export async function freeName(
  token: string,
  owner: string,
  name: string,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  // The suffix goes on a name short enough to carry it.
  const stem = name.slice(0, 96);
  for (let attempt = 2; attempt < 2 + SUGGESTION_TRIES; attempt += 1) {
    const candidate = `${stem}-${attempt}`;
    const reply = await callAsUser(
      token,
      'GET',
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(candidate)}`,
      doFetch,
    );
    if (!reply || reply.limited) return null;
    if (reply.status === 404) return candidate;
    if (reply.status !== 200 && reply.status !== 301) return null;
  }
  return null;
}
