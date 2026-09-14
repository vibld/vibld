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
  connectableRepositories,
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
function bindingProblem(
  state: Extract<BindingState, { usable: false }>,
): Response {
  // A switch rather than a chain ending in a bare `return`. With the chain,
  // a fourth reason added to `BindingState` would silently be reported as
  // expired, which is the one failure in this feature the compiler can
  // actually prevent: every instance of it here has otherwise had to be
  // found by review or by breaking the code to watch a test fail.
  switch (state.reason) {
    case 'none':
      return json(
        { error: 'No GitHub repository is connected yet.', reconnect: true },
        409,
      );
    case 'revoked':
      return json(
        {
          error: "Vibld's access to that repository was revoked.",
          reconnect: true,
        },
        409,
      );
    case 'expired':
      return json(
        {
          error: 'The GitHub connection has expired and needs approving again.',
          reconnect: true,
        },
        409,
      );
  }
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
    case 'missing':
    case 'forbidden':
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

/**
 * Only a lost grant is worth reconnecting for.
 *
 * `forbidden` deliberately does not set it. A refusal by an organisation
 * policy and an instruction to sign in again are contradictory advice, and
 * following the flag sends somebody round a loop that ends where it started.
 */
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

  // Two capabilities, reported separately, because they are configured
  // separately and a panel that conflates them offers a button that cannot
  // work. A deployment with the App key but no OAuth credentials can push on
  // a binding it already has and cannot make new ones; one with the OAuth
  // half and no App key is the other way round.
  const canPush = githubConfigured(env);
  const canConnect = githubConnectConfigured(env);
  if (!canPush && !canConnect) {
    return json({ configured: false, canPush: false, canConnect: false });
  }

  const store = new GitHubStore(env.DB!);
  const state = await store.usableBinding(principal.userId, now);
  if (!state.usable) {
    return json({
      configured: true,
      canPush,
      canConnect,
      connected: false,
      reason: state.reason,
    });
  }
  return json({
    configured: true,
    canPush,
    canConnect,
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
  // The state goes back to the caller as well as into the URL. The browser
  // keeps it and compares it on the way back, which is what stops somebody
  // pairing their own `code` with a link they send to a signed-in user: a
  // state the browser did not issue does not match the one it stored.
  return json({
    url: authorizeUrl(credentials, state, callbackUrl(request)),
    state,
  });
}

/**
 * Where GitHub lands, and the only route here that cannot be authenticated.
 *
 * GitHub returns through a top-level browser navigation, which carries no
 * `Authorization` header, so there is no Clerk session to resolve: a route
 * that demanded one would reject every real callback before it did anything.
 *
 * So this one does no work and holds no authority. It hands the `code` and
 * `state` to the app, in the fragment, and the app completes the exchange
 * with a request that *can* be authenticated. The fragment is not sent to
 * any server, which keeps a single-use code out of request logs on the way
 * through.
 *
 * The redirect target is built here rather than taken from the request,
 * because a callback that forwarded to a URL somebody else chose would be an
 * open redirect with an OAuth code attached to it.
 */
export function handleGitHubCallback(request: Request): Response {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  // Forwarded because the bounded read below needs it, not because it is
  // trusted: it only moves an installation to the front of a list GitHub
  // gave us for this user, and one that is not in that list changes nothing.
  const installation = url.searchParams.get('installation_id') ?? '';
  const target = new URL('/', url.origin);
  target.hash =
    `github=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` +
    (installation ? `&installation=${encodeURIComponent(installation)}` : '');
  if (!code || !state) target.hash = 'github=incomplete';
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), 'cache-control': 'no-store' },
  });
}

/**
 * Step three: find out who came back, and what they may choose.
 *
 * Authenticated, unlike the redirect that precedes it, because the app calls
 * it with a `fetch` that carries the Clerk token. The `state` must verify
 * *and* name that caller: verifying alone would let somebody else's
 * authorization be completed inside this session.
 *
 * Nothing from GitHub's redirect is treated as permission. The user token is
 * what decides, and `userInstallations` answers, from GitHub, which
 * installations this account can actually reach.
 */
export async function handleGitHubComplete(
  request: Request,
  env: GitHubHandlerEnv,
  principal: Principal,
  doFetch: typeof fetch = fetch,
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
  const { code, state, installation } = (body ?? {}) as {
    code?: unknown;
    state?: unknown;
    installation?: unknown;
  };
  const hinted = Number(installation);
  if (
    typeof code !== 'string' ||
    typeof state !== 'string' ||
    !code ||
    !state
  ) {
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

  // Everything this person could connect, across every installation they
  // reach. Reading them all is a call each, so it is bounded, and the
  // installation named on the way back is handled specially so that bound
  // cannot strand it:
  //
  //   in the list -> it goes first, costing what it always would;
  //   not in the list -> it is read as its own probe, outside the bound.
  //
  // Reading it directly rather than looking for it is what makes it
  // reachable wherever GitHub's list happens to put it, or page it. That
  // gives up nothing, because reading an installation's repositories *as the
  // user* is itself the authorization check: GitHub answers 404 for one they
  // cannot reach, and a forged id gets exactly that.
  const listed = installations.value;
  const named = Number.isInteger(hinted) && hinted > 0;

  // The installation named on the way back is always the probe, whether or
  // not GitHub's list mentions it. Being the probe is what makes its own
  // failure distinguishable from an unrelated one, and that matters most in
  // the ordinary case where it *is* listed: reading it as one of the crowd
  // meant a transient error on exactly the installation somebody chose was
  // indistinguishable from one on an installation they had never heard of,
  // and so was discarded the moment any other succeeded.
  //
  // It also stays outside the budget. A forged or stale id answers 404, and
  // charging that to the budget would let a made-up id in a link cost a real
  // installation its place in the read. The loop below skips it either way,
  // so nothing is read twice.
  const probe = named
    ? (listed.find((candidate) => candidate.id === hinted) ?? {
        id: hinted,
        account: 'unknown',
      })
    : null;

  const repositories = await connectableRepositories(
    token.token,
    listed,
    doFetch,
    probe,
  );
  // Asked after the read, not before it. GitHub's list of a brand-new
  // installation is not always current the instant it redirects, so checking
  // first would tell somebody to install the App they had this second
  // installed. The probe answers that case directly.
  //
  // It also wins over the probe's own failure. With no installations listed,
  // a probe that 404s is confirming there is nothing there, and "that
  // installation is not available to your account" is a true sentence that
  // helps nobody: the thing to say is that the App needs installing.
  // `missing` only, never any failure and not `access` either. A probe that
  // 404s alongside an empty list is confirming there is nothing there. A
  // rate limit or an unreachable GitHub says nothing of the kind. Nor does a
  // 403, which is an organisation policy or an ungranted authorization: that
  // person has an App they cannot reach, and telling them to install it is
  // advice they cannot act on. `github-app.ts` separates these reasons
  // precisely so this branch does not have to guess, and collapsing them
  // here is the mistake this feature has already made twice.
  // "Nothing was read", not "nothing was offered". A probe that succeeds and
  // finds an installation with no pushable repositories in it has proved the
  // App is installed, and telling that person to install it is both wrong
  // and impossible to act on. What they need is the empty picker, which says
  // there is nothing they can push to.
  const nothingThere = repositories.ok
    ? repositories.value.read === 0
    : repositories.reason === 'missing';
  if (nothingThere && listed.length === 0) {
    return json(
      {
        error:
          'The Vibld GitHub App is not installed on any account you can reach. Install it, then connect again.',
        install: true,
      },
      409,
    );
  }
  if (!repositories.ok) return githubProblem(repositories);

  const offered = [...repositories.value.repositories].sort((a, b) =>
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );

  return json({
    installations: installations.value,
    repositories: offered,
    // What the bind call may choose from, signed. See `signChoice`.
    ticket: await signChoice(
      credentials,
      principal.userId,
      offered,
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
    // The installation the matched entry came from, so a repository is
    // always pushed through the installation it was actually read from.
    installationId: match.installationId,
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
