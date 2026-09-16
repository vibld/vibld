/**
 * Pushing an accepted checkpoint to GitHub as a branch and a pull request.
 *
 * Workers cannot run `git`, so this is the Git Data API: build a tree, commit
 * it, create a ref, open a pull request. For a project of this size the file
 * contents go inline in the tree, so there is no separate blob upload and the
 * whole push is four calls.
 *
 * Two rules shape everything here, both from ADR-0007.
 *
 * **Exactly once.** "Workflows retries alone do not provide exactly-once
 * commits, PR creation or deployment." Three properties make a retry safe:
 * the branch name is derived from the revision rather than from a clock, so
 * two attempts at the same checkpoint target the same ref; trees are
 * content-addressed, so building the same files twice yields the same sha and
 * an ambiguous "did that land?" is answered by comparing rather than
 * guessing; and the ref is read before it is written, so a push that already
 * succeeded is reported as a success instead of committed twice.
 *
 * **Nothing is overwritten.** "Do not silently force-push, merge, publish a
 * repository or change its visibility." Ref creation is create-only. There is
 * no `force` on any call in this file. The base branch is never written, the
 * repository is never created or renamed, and its visibility is never
 * touched. A branch that exists and points somewhere else is a conflict to
 * report, with both shas, not a thing to resolve.
 */

import type { ProjectFile } from '@vibld/core';

import {
  GITHUB_API,
  GITHUB_USER_AGENT,
  rateLimitMessage,
  type GitHubFailure,
} from './github-app.ts';

/** Where a push is going. None of this is secret. */
export interface PushTarget {
  owner: string;
  repo: string;
  /** The branch the work is based on, and the pull request's base. */
  baseBranch: string;
}

export interface PushRequest {
  target: PushTarget;
  /** The accepted snapshot, exactly as it will appear on the branch. */
  files: readonly ProjectFile[];
  /** The checkpoint this came from. Decides the branch name. */
  revision: string;
  /** The commit subject. */
  message: string;
  /**
   * The commit to build on. Required, and resolved by `resolveBase` before
   * this is called.
   *
   * The other half of making a retry produce the same commit, and it has to
   * be the caller's to hold rather than something read in here. Fixing the
   * dates is not enough while the parent is still read from the remote: if
   * the base branch advances between an attempt whose reply was lost and the
   * next one, the "same" commit is built on a different parent and is a
   * different object.
   *
   * It was optional for one commit, which was worse than either choice: the
   * documented first-attempt path read the base internally, so a caller
   * whose reply was lost had nothing to pin and re-read a branch that may
   * have moved. Resolving it is a separate step now, so the value exists
   * before the write that can go missing, and the caller can record it.
   */
  baseSha: string;
  /**
   * Who the commit is by, and when.
   *
   * Fixed rather than left to GitHub, because it is what makes the commit
   * object deterministic. Git objects are content-addressed, so a commit
   * with the same message, tree, parents, author and committer is the same
   * sha; leaving the date out means GitHub fills in the clock, and two
   * attempts produce two different commits. With the date supplied, a
   * commit created by an attempt whose reply was lost is re-created
   * identically by the next one, and the orphan is the same object rather
   * than a second one.
   */
  committer: { name: string; email: string; date: string };
  /** The pull request title and body. */
  pullRequest?: { title: string; body: string };
}

export interface PushedBranch {
  branch: string;
  commitSha: string;
  treeSha: string;
  /**
   * False when the branch was already there pointing at this exact tree,
   * which is what a retry of an ambiguous push looks like from here.
   */
  created: boolean;
  pullRequestUrl?: string;
}

export interface PushConflict {
  branch: string;
  /** Where the branch points now. */
  existingSha: string;
  /** Where this push wanted it to point. */
  attemptedTreeSha: string;
}

export type PushResult =
  | { ok: true; pushed: PushedBranch }
  | {
      ok: false;
      error: string;
      /**
       * What kind of failure, so the caller can pick a status. Without it
       * every failure here reads as a conflict, and a rate limit or a
       * dropped connection is reported as something the user has to resolve
       * rather than something to retry.
       */
      reason: GitHubFailure;
      conflict?: PushConflict;
    };

/**
 * The branch a revision pushes to.
 *
 * Derived, not generated: the same checkpoint always names the same branch,
 * which is what makes a retry converge instead of littering the repository
 * with near-identical branches. The revision is restricted to characters git
 * allows in a ref so a checkpoint id can never smuggle in a path.
 */
export function branchForRevision(revision: string): string | null {
  const cleaned = revision.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(cleaned)) return null;
  // Refs cannot end in `.lock`, contain `..`, or begin with a dot.
  if (cleaned.startsWith('.') || cleaned.includes('..')) return null;
  if (cleaned.endsWith('.lock')) return null;
  return `vibld/${cleaned}`;
}

/** A GitHub call, and the shape of every reply this file reads. */
interface Call {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

type Reply =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; reason: GitHubFailure };

async function call(
  token: string,
  doFetch: typeof fetch,
  { method, path, body }: Call,
): Promise<Reply> {
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
      // Redirects are not followed. Every URL here is one this file
      // constructed against api.github.com, and a redirect would be
      // somewhere it did not choose.
      redirect: 'manual',
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: 'GitHub could not be reached.',
      reason: 'unreachable',
    };
  }

  if (response.status === 204) return { ok: true, status: 204, body: {} };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  const record = (parsed ?? {}) as Record<string, unknown>;

  if (response.ok) return { ok: true, status: response.status, body: record };

  // A 403 means two different things, and sending someone to reconnect an
  // App that is working perfectly well is the wrong one. `rateLimitMessage`
  // holds the whole of that reading, in one place, because this file and
  // `github-app.ts` have to agree about it.
  const limited = rateLimitMessage(response.status, response.headers, record);
  if (limited) {
    return {
      ok: false,
      status: response.status,
      error: limited,
      reason: 'rate-limited',
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      error: 'vibld no longer has access to that repository on GitHub.',
      reason: 'access',
    };
  }
  // GitHub's own message is the useful part of a 422, and it is GitHub's
  // words rather than a caller's, so it is safe to pass through.
  const message =
    typeof record.message === 'string' && record.message.length < 200
      ? record.message
      : `GitHub refused the request (${response.status}).`;
  return {
    ok: false,
    status: response.status,
    error: message,
    reason: 'refused',
  };
}

/**
 * A value placed into a GitHub API path, encoded.
 *
 * Git allows characters in a branch name that mean something else in a URL.
 * `release#1` is a legal ref, and interpolated raw it puts `#1` in the
 * fragment: the request asks for `heads/release`, which either reports the
 * configured branch missing or, if a branch by that shorter name exists,
 * silently pins the wrong parent. The separators are the caller's, so this
 * encodes a segment at a time and leaves the slashes alone.
 */
function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The commit a branch points at, or null when the branch is not there.
 *
 * `notFound` is a real answer rather than a failure: an empty repository has
 * no base ref, and the first commit made to one simply has no parent.
 */
async function refCommit(
  token: string,
  doFetch: typeof fetch,
  target: Pick<PushTarget, 'owner' | 'repo'>,
  ref: string,
): Promise<
  | { found: true; sha: string }
  | { found: false }
  | { error: string; reason: GitHubFailure }
> {
  const reply = await call(token, doFetch, {
    method: 'GET',
    path: `/repos/${encodePath(target.owner)}/${encodePath(target.repo)}/git/ref/${encodePath(ref)}`,
  });
  if (!reply.ok) {
    if (reply.status === 404) return { found: false };
    return { error: reply.error, reason: reply.reason };
  }
  const object = (reply.body.object ?? {}) as { sha?: unknown };
  const sha = asString(object.sha);
  return sha
    ? { found: true, sha }
    : {
        error: 'GitHub returned a ref vibld could not read.',
        reason: 'unreadable',
      };
}

/**
 * The tree a commit points at, for deciding whether a push already landed.
 *
 * The error is a separate answer from the tree, because collapsing them
 * turns a dropped connection into a reported conflict: "the branch points
 * somewhere else" would be said about a branch nobody managed to read. A
 * conflict accuses someone of having moved the branch, so it has to be
 * something this knows rather than something it assumes.
 */
async function commitTree(
  token: string,
  doFetch: typeof fetch,
  target: Pick<PushTarget, 'owner' | 'repo'>,
  commitSha: string,
): Promise<{ sha: string } | { error: string; reason: GitHubFailure }> {
  const reply = await call(token, doFetch, {
    method: 'GET',
    path: `/repos/${encodePath(target.owner)}/${encodePath(target.repo)}/git/commits/${encodePath(commitSha)}`,
  });
  if (!reply.ok) return { error: reply.error, reason: reply.reason };
  const tree = (reply.body.tree ?? {}) as { sha?: unknown };
  const sha = asString(tree.sha);
  return sha
    ? { sha }
    : {
        error: 'GitHub returned a commit vibld could not read.',
        reason: 'unreadable',
      };
}

/**
 * Whether the repository has any branches at all.
 *
 * Asked because a 404 on the base ref has two very different causes: a
 * repository with no commits in it, and a base branch that was renamed or
 * deleted out from under the binding. Treating the second as the first
 * builds a parentless commit on a repository that has history, which is a
 * branch related to nothing and a pull request that cannot be opened.
 */
async function hasAnyBranch(
  token: string,
  doFetch: typeof fetch,
  target: Pick<PushTarget, 'owner' | 'repo'>,
): Promise<boolean | { error: string; reason: GitHubFailure }> {
  const reply = await call(token, doFetch, {
    method: 'GET',
    path: `/repos/${encodePath(target.owner)}/${encodePath(target.repo)}/git/matching-refs/heads/`,
  });
  // An empty repository answers 409 here rather than an empty list, which is
  // itself the answer.
  if (!reply.ok) {
    if (reply.status === 409) return false;
    return { error: reply.error, reason: reply.reason };
  }
  return Array.isArray(reply.body) && (reply.body as unknown[]).length > 0;
}

/**
 * The commit the push will build on, resolved once and then held.
 *
 * Its own step, and exported, because the caller has to be able to write it
 * down before anything ambiguous happens. A push that resolves its own
 * parent and then loses the reply to `POST /git/commits` leaves the caller
 * with nothing to pin, and the retry reads a branch that may have moved on:
 * the commit is then built on a different parent and is a different object,
 * which is the whole failure the pinning exists to prevent.
 *
 * The two ways this can come back empty need different sentences, because a
 * base branch renamed or deleted out from under the binding is not an empty
 * repository, and treating it as one would build a commit related to
 * nothing.
 */
export async function resolveBase(
  token: string,
  target: PushTarget,
  doFetch: typeof fetch = fetch,
): Promise<
  | { ok: true; sha: string }
  | { ok: false; error: string; reason: GitHubFailure }
> {
  const repo = { owner: target.owner, repo: target.repo };
  const base = await refCommit(
    token,
    doFetch,
    repo,
    `heads/${target.baseBranch}`,
  );
  if ('error' in base) {
    return { ok: false, error: base.error, reason: base.reason };
  }
  if (base.found) return { ok: true, sha: base.sha };

  const branches = await hasAnyBranch(token, doFetch, repo);
  if (typeof branches !== 'boolean') {
    return { ok: false, error: branches.error, reason: branches.reason };
  }
  return {
    ok: false,
    // Neither a missing base branch nor an empty repository is something
    // retrying fixes: the destination has to change or gain a commit.
    reason: 'invalid',
    error: branches
      ? `The branch ${target.baseBranch} no longer exists in ${repo.owner}/${repo.repo}.`
      : `${repo.owner}/${repo.repo} has no commits yet. Add a first commit there, then push from vibld.`,
  };
}

/**
 * The push, in the order that makes a retry safe.
 *
 * The tree is built before the ref is read, deliberately. Building a tree has
 * no visible effect (an unreferenced tree is garbage collected), it is
 * content-addressed, and having its sha in hand is what turns "the branch
 * already exists" from an error into a question with an answer: if the branch
 * points at a commit carrying this tree, the previous attempt succeeded.
 */
export async function pushCheckpoint(
  token: string,
  request: PushRequest,
  doFetch: typeof fetch = fetch,
): Promise<PushResult> {
  const { target, files, revision, message } = request;
  const branch = branchForRevision(revision);
  if (!branch) {
    return {
      ok: false,
      error: 'That checkpoint cannot be named as a branch.',
      reason: 'invalid',
    };
  }
  if (files.length === 0) {
    return { ok: false, error: 'There is nothing to push.', reason: 'invalid' };
  }

  const repo = { owner: target.owner, repo: target.repo };

  // `base_tree` is deliberately omitted, so the tree is exactly the accepted
  // snapshot. A file Vibld dropped is a file deleted, which is the same
  // semantics the generation machine already has.
  const treeReply = await call(token, doFetch, {
    method: 'POST',
    path: `/repos/${encodePath(repo.owner)}/${encodePath(repo.repo)}/git/trees`,
    body: {
      tree: files.map((file) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        content: file.content,
      })),
    },
  });
  if (!treeReply.ok) {
    return { ok: false, error: treeReply.error, reason: treeReply.reason };
  }
  const treeSha = asString(treeReply.body.sha);
  if (!treeSha) {
    return {
      ok: false,
      error: 'GitHub returned a tree vibld could not read.',
      reason: 'unreadable',
    };
  }

  // Does the branch already exist? This is the reconciliation the plan calls
  // for: after an ambiguous failure the next attempt reads the remote first.
  const existing = await refCommit(token, doFetch, repo, `heads/${branch}`);
  if ('error' in existing) {
    return { ok: false, error: existing.error, reason: existing.reason };
  }
  if (existing.found) {
    const landed = await commitTree(token, doFetch, repo, existing.sha);
    if ('error' in landed) {
      return { ok: false, error: landed.error, reason: landed.reason };
    }
    if (landed.sha === treeSha) {
      // The previous attempt succeeded and its reply was lost. Report what is
      // already there rather than committing the same files again.
      const pullRequestUrl = await ensurePullRequest(
        token,
        doFetch,
        request,
        branch,
      );
      return {
        ok: true,
        pushed: {
          branch,
          commitSha: existing.sha,
          treeSha,
          created: false,
          ...(pullRequestUrl ? { pullRequestUrl } : {}),
        },
      };
    }
    return {
      ok: false,
      error: `The branch ${branch} already exists and points somewhere else.`,
      reason: 'conflict',
      conflict: {
        branch,
        existingSha: existing.sha,
        attemptedTreeSha: treeSha,
      },
    };
  }

  const commitReply = await call(token, doFetch, {
    method: 'POST',
    path: `/repos/${encodePath(repo.owner)}/${encodePath(repo.repo)}/git/commits`,
    body: {
      message,
      tree: treeSha,
      parents: [request.baseSha],
      author: request.committer,
      committer: request.committer,
    },
  });
  if (!commitReply.ok) {
    return { ok: false, error: commitReply.error, reason: commitReply.reason };
  }
  const commitSha = asString(commitReply.body.sha);
  if (!commitSha) {
    return {
      ok: false,
      error: 'GitHub returned a commit vibld could not read.',
      reason: 'unreadable',
    };
  }

  // Create-only. There is no `force` here and there is not going to be one.
  const refReply = await call(token, doFetch, {
    method: 'POST',
    path: `/repos/${encodePath(repo.owner)}/${encodePath(repo.repo)}/git/refs`,
    body: { ref: `refs/heads/${branch}`, sha: commitSha },
  });
  if (!refReply.ok) {
    // A ref that appeared between the read above and this write is another
    // attempt winning the race, not a reason to overwrite it. What it is not
    // necessarily is a conflict: two retries of the same push race each
    // other, and the winner writes the branch this one wanted. So the loser
    // asks what won before calling it one.
    if (refReply.status === 422) {
      const now = await refCommit(token, doFetch, repo, `heads/${branch}`);
      if ('error' in now) {
        return { ok: false, error: now.error, reason: now.reason };
      }
      if (now.found) {
        const landed = await commitTree(token, doFetch, repo, now.sha);
        if ('error' in landed) {
          return { ok: false, error: landed.error, reason: landed.reason };
        }
        if (landed.sha === treeSha) {
          const pullRequestUrl = await ensurePullRequest(
            token,
            doFetch,
            request,
            branch,
          );
          return {
            ok: true,
            pushed: {
              branch,
              commitSha: now.sha,
              treeSha,
              created: false,
              ...(pullRequestUrl ? { pullRequestUrl } : {}),
            },
          };
        }
        return {
          ok: false,
          error: `The branch ${branch} already exists and points somewhere else.`,
          reason: 'conflict',
          conflict: {
            branch,
            existingSha: now.sha,
            attemptedTreeSha: treeSha,
          },
        };
      }
    }
    return { ok: false, error: refReply.error, reason: refReply.reason };
  }

  const pullRequestUrl = await ensurePullRequest(
    token,
    doFetch,
    request,
    branch,
  );
  return {
    ok: true,
    pushed: {
      branch,
      commitSha,
      treeSha,
      created: true,
      ...(pullRequestUrl ? { pullRequestUrl } : {}),
    },
  };
}

/**
 * The pull request for this branch, opening one only if there is not one
 * already.
 *
 * Deduplicated by asking rather than by remembering, for the same reason the
 * branch is: a lost reply must not become a second pull request. Undefined on
 * any failure, because a branch that pushed and a pull request that did not
 * open is a partial success worth reporting as a success with a missing link,
 * not as a failed push.
 */
async function ensurePullRequest(
  token: string,
  doFetch: typeof fetch,
  request: PushRequest,
  branch: string,
): Promise<string | undefined> {
  if (!request.pullRequest) return undefined;
  const { owner, repo, baseBranch } = request.target;

  const open = await call(token, doFetch, {
    method: 'GET',
    path: `/repos/${encodePath(owner)}/${encodePath(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
  });
  if (open.ok) {
    const list = Array.isArray(open.body) ? (open.body as unknown[]) : [];
    for (const entry of list) {
      const url = asString((entry as { html_url?: unknown }).html_url);
      if (url) return url;
    }
  }

  const created = await call(token, doFetch, {
    method: 'POST',
    path: `/repos/${encodePath(owner)}/${encodePath(repo)}/pulls`,
    body: {
      title: request.pullRequest.title,
      body: request.pullRequest.body,
      head: branch,
      base: baseBranch,
    },
  });
  if (!created.ok) return undefined;
  return asString(created.body.html_url) ?? undefined;
}
