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
import type { Principal } from './principal.ts';

/** How long a grant lasts before it has to be approved again (ADR-0006). */
const GRANT_DAYS = 90;

export interface GitHubHandlerEnv extends GitHubAppEnv {
  DB?: D1Database;
  GITHUB_BURST?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export function githubConfigured(env: GitHubHandlerEnv): boolean {
  return Boolean(env.DB && githubAppCredentials(env));
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
