/**
 * The routes behind "push this to GitHub" (issue #13).
 *
 * Kept out of `index.ts` for the same reason `billing-handlers.ts` is: the
 * router should read as a list of paths, not as the bodies of the things
 * they call.
 *
 * The order here is the point, and it is the order ADR-0007 asks for. The
 * base commit is resolved and written down *before* the first call that can
 * succeed without saying so, so a retry has the parent the first attempt
 * used rather than whatever the branch points at now. Everything after that
 * is `pushCheckpoint`'s reconciliation, which was built to be re-entered.
 */

import { parsePreviewRequest } from './request-guard.ts';
import {
  githubAppCredentials,
  mintInstallationToken,
  type GitHubAppEnv,
  type GitHubFailure,
  type InstallationToken,
} from './github-app.ts';
import {
  branchForRevision,
  pushCheckpoint,
  resolveBase,
  type PushConflict,
  type PushTarget,
} from './github-push.ts';
import { GitHubStore, type BindingState } from './github-store.ts';
import {
  authorizeUrl,
  exchangeCode,
  githubOAuthCredentials,
  installationRepositories,
  signChoice,
  signState,
  userInstallations,
  verifyChoice,
  verifyState,
  type GitHubOAuthEnv,
  type RepositoryChoice,
} from './github-connect.ts';
import type { Principal } from './principal.ts';

/** How long a grant lasts before it has to be approved again (ADR-0006). */
const GRANT_DAYS = 90;

export interface GitHubHandlerEnv extends GitHubAppEnv, GitHubOAuthEnv {
  DB?: D1Database;
  GITHUB_BURST?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export function githubConfigured(env: GitHubHandlerEnv): boolean {
  return Boolean(env.DB && githubAppCredentials(env));
}

/**
 * Connecting needs the OAuth half as well as the App half, and is reported
 * separately: a deployment can be able to push on a binding it already has
 * while being unable to make new ones.
 */
export function githubConnectConfigured(env: GitHubHandlerEnv): boolean {
  return Boolean(env.DB && githubOAuthCredentials(env));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * What to tell someone whose binding cannot be used.
 *
 * The failure-mode table asks for a re-connect rather than a 401, so a
 * revoked or expired grant is a 409 with a sentence and a flag the UI can
 * act on, not an authentication error the browser will try to fix by
 * reloading.
 */
function bindingProblem(state: Extract<BindingState, { usable: false }>) {
  if (state.reason === 'none') {
    return json(
      { error: 'No GitHub repository is connected yet.', reconnect: true },
      409,
    );
  }
  if (state.reason === 'revoked') {
    return json(
      {
        error: "Vibld's access to that repository was revoked.",
        reconnect: true,
      },
      409,
    );
  }
  return json(
    {
      error: 'The GitHub connection has expired and needs approving again.',
      reconnect: true,
    },
    409,
  );
}

/**
 * What to tell someone whose push could not get a token.
 *
 * Only a lost grant is worth re-approving. `github-app.ts` is careful to
 * tell a rate limit apart from revoked access, and collapsing every failure
 * into one 409 with `reconnect: true` throws that away and sends someone off
 * to reinstall a working App because GitHub was briefly unreachable. So the
 * reason picks the status, and `reconnect` is set only when reconnecting is
 * actually the fix.
 */
function statusFor(reason: GitHubFailure): number {
  switch (reason) {
    case 'invalid':
      return 400;
    // Something is there that this push would overwrite, or the grant is
    // gone. Both need a person, not a retry.
    case 'conflict':
    case 'access':
      return 409;
    case 'rate-limited':
      return 429;
    case 'config':
      return 503;
    // Unreachable, refused, or a reply that could not be read: GitHub's
    // problem or a passing one, and retrying is the thing to do rather than
    // asking the user to fix anything.
    case 'unreachable':
    case 'refused':
    case 'unreadable':
      return 502;
  }
}

/** Only a lost grant is worth reconnecting for. */
function githubProblem(failure: {
  error: string;
  reason: GitHubFailure;
  conflict?: PushConflict;
}): Response {
  return json(
    {
      error: failure.error,
      ...(failure.reason === 'access' ? { reconnect: true } : {}),
      ...(failure.conflict ? { conflict: failure.conflict } : {}),
    },
    statusFor(failure.reason),
  );
}

function mintProblem(token: Extract<InstallationToken, { ok: false }>) {
  return githubProblem(token);
}

/**
 * A revision from the browser, checked before it names anything.
 *
 * `branchForRevision` already refuses what git would, and this is the same
 * rule applied one step earlier so the answer is a 400 about the request
 * rather than a failure part-way through a push.
 */
function parseRevision(body: unknown): string | null {
  const { revision } = (body ?? {}) as { revision?: unknown };
  if (typeof revision !== 'string') return null;
  return branchForRevision(revision) ? revision.trim() : null;
}

/**
 * Push an accepted checkpoint to the connected repository.
 *
 * The caller has already been identified; this takes the principal rather
 * than resolving it, so the identity rules stay in one place in `index.ts`
 * and this file stays testable without a Clerk session.
 */
export async function handleGitHubPush(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  doFetch: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!githubConfigured(env)) {
    return json(
      { error: 'Pushing to GitHub is not configured for this deployment.' },
      503,
    );
  }
  const credentials = githubAppCredentials(env)!;
  const store = new GitHubStore(env.DB!);

  // Its own gate, like publishing has: a push is several GitHub calls and a
  // write to somebody's repository, priced per caller rather than per flood,
  // so it is checked after identity rather than before it.
  if (env.GITHUB_BURST) {
    try {
      const allowed = await env.GITHUB_BURST.limit({
        key: `github:${principal.userId}`,
      });
      if (!allowed.success) {
        return json({ error: 'Too many pushes. Try again shortly.' }, 429);
      }
    } catch (error) {
      console.error('github rate limiter unavailable', error);
    }
  }

  const state = await store.usableBinding(principal.userId, now);
  if (!state.usable) return bindingProblem(state);
  const { binding } = state;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }

  const files = parsePreviewRequest(body);
  if (!files.ok) return json({ error: files.error }, files.status);

  const revision = parseRevision(body);
  if (!revision) {
    return json(
      { error: '"revision" must name a checkpoint that can become a branch.' },
      400,
    );
  }

  const token = await mintInstallationToken(
    credentials,
    binding.installationId,
    { owner: binding.owner, repo: binding.repo },
    doFetch,
    now.getTime(),
  );
  if (!token.ok) return mintProblem(token);

  const target: PushTarget = {
    owner: binding.owner,
    repo: binding.repo,
    baseBranch: binding.defaultBranch,
  };

  // Resolve the parent, then write it down, then push. An attempt that
  // resolves its own parent and loses the reply to the commit call leaves
  // nothing to pin, and its retry reads a branch that may have moved: the
  // same files then commit onto a different parent and become a second
  // commit. `beginPush` inserts or does nothing, so the first attempt's
  // parent is the one every retry gets back.
  // The destination is part of which push this is, not a detail of it: a sha
  // from one repository names nothing in another, so a user who reconnects
  // elsewhere and pushes the same checkpoint resolves a fresh parent there.
  const key = {
    userId: principal.userId,
    owner: binding.owner,
    repo: binding.repo,
    revision,
  };
  const recorded = await store.push(key);
  let baseSha = recorded?.baseSha;
  if (!baseSha) {
    const base = await resolveBase(token.token, target, doFetch);
    if (!base.ok) return githubProblem(base);
    baseSha = base.sha;
  }

  const attempt = await store.beginPush({
    ...key,
    baseSha,
    branch: branchForRevision(revision)!,
    startedAt: now.toISOString(),
  });

  const pushed = await pushCheckpoint(
    token.token,
    {
      target,
      files: files.value,
      revision,
      // The recorded parent, not the one just resolved: on a retry they are
      // the same, and where they differ the recorded one is right.
      baseSha: attempt.baseSha,
      message: `Vibld checkpoint ${revision}`,
      // Fixed from the attempt's own start time, so the commit object is the
      // same on every try.
      committer: {
        name: 'Vibld',
        email: 'noreply@vibld.com',
        date: attempt.startedAt,
      },
      pullRequest: {
        title: `Vibld: ${revision}`,
        body: `Generated by Vibld from checkpoint \`${revision}\`.`,
      },
    },
    doFetch,
  );

  if (!pushed.ok) return githubProblem(pushed);

  await store.finishPush(key, {
    commitSha: pushed.pushed.commitSha,
    treeSha: pushed.pushed.treeSha,
    ...(pushed.pushed.pullRequestUrl
      ? { pullRequestUrl: pushed.pushed.pullRequestUrl }
      : {}),
    finishedAt: new Date().toISOString(),
  });

  return json({
    branch: pushed.pushed.branch,
    commitSha: pushed.pushed.commitSha,
    // False when the branch was already there carrying this tree, which is
    // what a retry of a push whose reply was lost looks like.
    created: pushed.pushed.created,
    ...(pushed.pushed.pullRequestUrl
      ? { pullRequestUrl: pushed.pushed.pullRequestUrl }
      : {}),
  });
}

/**
 * What the builder needs to show the GitHub panel: the connected repository,
 * or why there is not one.
 */
export async function handleGitHubStatus(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!githubConfigured(env)) return json({ configured: false });

  const store = new GitHubStore(env.DB!);
  const state = await store.usableBinding(principal.userId, now);
  if (!state.usable) {
    return json({ configured: true, connected: false, reason: state.reason });
  }
  return json({
    configured: true,
    connected: true,
    owner: state.binding.owner,
    repo: state.binding.repo,
    defaultBranch: state.binding.defaultBranch,
    expiresAt: state.binding.expiresAt,
  });
}

/** When a grant approved now should stop being usable. */
export function grantExpiry(now: Date = new Date()): string {
  return new Date(
    now.getTime() + GRANT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * Where GitHub sends the browser back to. Derived from the request rather
 * than configured, so preview and production each come back to themselves.
 */
function callbackUrl(request: Request): string {
  return new URL(
    '/api/github/callback',
    new URL(request.url).origin,
  ).toString();
}

/**
 * Step one: hand the browser somewhere to go.
 *
 * Deliberately does not redirect. The caller is an authenticated `fetch`
 * from the builder carrying a bearer token, and a 302 to GitHub would be
 * followed by that fetch rather than by the person, sending the
 * Authorization header somewhere it does not belong. The URL goes back as
 * data and the page navigates.
 */
export async function handleGitHubConnect(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!githubConnectConfigured(env)) {
    return json(
      { error: 'Connecting a GitHub repository is not configured here.' },
      503,
    );
  }
  const credentials = githubOAuthCredentials(env)!;
  const state = await signState(credentials, principal.userId, now.getTime());
  return json({ url: authorizeUrl(credentials, state, callbackUrl(request)) });
}

/**
 * Step two: find out who came back, and what they may choose.
 *
 * The `installation_id` GitHub puts on this redirect is read as a
 * preference and never as permission. What decides anything is the user
 * token: `userInstallations` answers, from GitHub, which installations this
 * account can actually reach, and an id that is not in that answer is
 * ignored exactly as a forged one would be.
 */
export async function handleGitHubCallback(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  doFetch: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  if (!githubConnectConfigured(env)) {
    return json(
      { error: 'Connecting a GitHub repository is not configured here.' },
      503,
    );
  }
  const credentials = githubOAuthCredentials(env)!;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return json({ error: 'That connection link is incomplete.' }, 400);
  }

  // Checked against the signed-in caller, not merely checked. A state that
  // verifies but names somebody else is somebody else's authorization being
  // walked into this session, which is the thing it exists to stop.
  const startedBy = await verifyState(credentials, state, now.getTime());
  if (!startedBy || startedBy !== principal.userId) {
    return json(
      { error: 'That connection attempt has expired. Start again.' },
      400,
    );
  }

  const token = await exchangeCode(credentials, code, doFetch);
  if (!token.ok) return githubProblem(token);

  const installations = await userInstallations(token.token, doFetch);
  if (!installations.ok) return githubProblem(installations);
  if (installations.value.length === 0) {
    return json(
      {
        error:
          'The Vibld GitHub App is not installed on any account you can reach. Install it, then connect again.',
        install: true,
      },
      409,
    );
  }

  // The hint from the redirect, honoured only when it is one of the
  // installations GitHub just said this person can reach.
  const hinted = Number(url.searchParams.get('installation_id'));
  const chosen =
    installations.value.find((candidate) => candidate.id === hinted) ??
    installations.value[0]!;

  const repositories = await installationRepositories(
    token.token,
    chosen.id,
    doFetch,
  );
  if (!repositories.ok) return githubProblem(repositories);

  return json({
    installation: { id: chosen.id, account: chosen.account },
    // Every installation this person has, so the builder can offer a switch
    // without starting the whole flow again.
    installations: installations.value,
    repositories: repositories.value,
    // What the bind call may choose from, signed. See `signChoice`.
    ticket: await signChoice(
      credentials,
      principal.userId,
      chosen.id,
      repositories.value,
      now.getTime(),
    ),
  });
}

function sameRepository(
  a: RepositoryChoice,
  b: { owner: string; repo: string },
) {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

/**
 * Step three: write the binding the user picked.
 *
 * The repository is not taken from the request. It is matched against the
 * list the callback signed, and the binding is written from the matched
 * entry, so the destination and its default branch are the ones GitHub
 * reported rather than the ones the browser sent.
 */
export async function handleGitHubBind(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!githubConnectConfigured(env)) {
    return json(
      { error: 'Connecting a GitHub repository is not configured here.' },
      503,
    );
  }
  const credentials = githubOAuthCredentials(env)!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const { ticket, owner, repo } = (body ?? {}) as {
    ticket?: unknown;
    owner?: unknown;
    repo?: unknown;
  };
  if (
    typeof ticket !== 'string' ||
    typeof owner !== 'string' ||
    typeof repo !== 'string'
  ) {
    return json(
      { error: '"ticket", "owner" and "repo" are all required.' },
      400,
    );
  }

  const verified = await verifyChoice(credentials, ticket, now.getTime());
  if (!verified || verified.userId !== principal.userId) {
    return json(
      { error: 'That connection attempt has expired. Start again.' },
      400,
    );
  }

  const match = verified.repositories.find((candidate) =>
    sameRepository(candidate, { owner, repo }),
  );
  if (!match) {
    return json(
      { error: 'That repository was not one of the ones you were offered.' },
      403,
    );
  }

  const store = new GitHubStore(env.DB!);
  await store.bind({
    userId: principal.userId,
    installationId: verified.installationId,
    owner: match.owner,
    repo: match.repo,
    defaultBranch: match.defaultBranch,
    grantedAt: now.toISOString(),
    grantedByEmail: principal.policyIdentity,
    expiresAt: grantExpiry(now),
  });

  return json({
    owner: match.owner,
    repo: match.repo,
    defaultBranch: match.defaultBranch,
    expiresAt: grantExpiry(now),
  });
}

/**
 * Stop pushing to the connected repository.
 *
 * Marks the grant revoked rather than deleting it, and says nothing about
 * whether there was one: "disconnected" is the same answer either way, so
 * this cannot be used to ask whether somebody has connected something.
 */
export async function handleGitHubDisconnect(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!githubConfigured(env) && !githubConnectConfigured(env)) {
    return json(
      { error: 'GitHub is not configured for this deployment.' },
      503,
    );
  }
  await new GitHubStore(env.DB!).revoke(principal.userId, now);
  return json({ connected: false });
}
