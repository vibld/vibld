/**
 * Which repository a user's work pushes to, and what a push has already
 * done.
 *
 * A thin wrapper over the two tables `migrations/0005_github.sql` declares,
 * the same shape `billing-store.ts` has: no SQL anywhere else, nothing
 * GitHub-shaped in here (no tokens, no API types), so it is testable against
 * a real SQLite schema with no network and no credential.
 *
 * Nothing stored here is a secret. The App's private key is a Worker secret
 * and an installation token is minted per push and never written down, so
 * what is left is a binding: an installation id, a repository, a branch, and
 * when the grant was made (ADR-0006).
 */

export interface RepositoryBinding {
  userId: string;
  installationId: number;
  owner: string;
  repo: string;
  defaultBranch: string;
  grantedAt: string;
  grantedByEmail: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface BindingRow {
  user_id: string;
  installation_id: number;
  owner: string;
  repo: string;
  default_branch: string;
  granted_at: string;
  granted_by_email: string;
  expires_at: string;
  revoked_at: string | null;
}

/** What an attempt at one checkpoint has established so far. */
export interface PushAttempt {
  userId: string;
  owner: string;
  repo: string;
  revision: string;
  /** The parent this push resolved before it began writing. */
  baseSha: string;
  branch: string;
  commitSha: string | null;
  treeSha: string | null;
  pullRequestUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface PushRow {
  user_id: string;
  owner: string;
  repo: string;
  revision: string;
  base_sha: string;
  branch: string;
  commit_sha: string | null;
  tree_sha: string | null;
  pull_request_url: string | null;
  started_at: string;
  finished_at: string | null;
}

function toBinding(row: BindingRow): RepositoryBinding {
  return {
    userId: row.user_id,
    installationId: row.installation_id,
    owner: row.owner,
    repo: row.repo,
    defaultBranch: row.default_branch,
    grantedAt: row.granted_at,
    grantedByEmail: row.granted_by_email,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function toAttempt(row: PushRow): PushAttempt {
  return {
    userId: row.user_id,
    owner: row.owner,
    repo: row.repo,
    revision: row.revision,
    baseSha: row.base_sha,
    branch: row.branch,
    commitSha: row.commit_sha,
    treeSha: row.tree_sha,
    pullRequestUrl: row.pull_request_url,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Which push, exactly: one checkpoint aimed at one repository.
 *
 * The destination is part of the identity rather than a detail of it. The
 * recorded parent only means anything inside the repository it came from, so
 * "revision r7" is not one operation, "r7 into acme/site" is.
 */
export interface PushKey {
  userId: string;
  owner: string;
  repo: string;
  revision: string;
}

/**
 * Why a binding cannot be used, in the words the failure-mode table asks
 * for. `usable` is the only shape a caller may push with.
 */
export type BindingState =
  | { usable: true; binding: RepositoryBinding }
  | { usable: false; reason: 'none' | 'revoked' | 'expired' };

export class GitHubStore {
  #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Record the repository a user approved.
   *
   * Replaces rather than refuses: connecting a different repository is an
   * ordinary thing to do, and it is the user's own grant to change. The
   * grant metadata is rewritten with it, so a reconnect is a fresh grant
   * with a fresh expiry rather than an old one silently extended.
   */
  async bind(binding: Omit<RepositoryBinding, 'revokedAt'>): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO github_bindings (
           user_id, installation_id, owner, repo, default_branch,
           granted_at, granted_by_email, expires_at, revoked_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
         ON CONFLICT(user_id) DO UPDATE SET
           installation_id = excluded.installation_id,
           owner = excluded.owner,
           repo = excluded.repo,
           default_branch = excluded.default_branch,
           granted_at = excluded.granted_at,
           granted_by_email = excluded.granted_by_email,
           expires_at = excluded.expires_at,
           revoked_at = NULL`,
      )
      .bind(
        binding.userId,
        binding.installationId,
        binding.owner,
        binding.repo,
        binding.defaultBranch,
        binding.grantedAt,
        binding.grantedByEmail,
        binding.expiresAt,
      )
      .run();
  }

  /** The binding as stored, whatever state it is in. */
  async binding(userId: string): Promise<RepositoryBinding | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM github_bindings WHERE user_id = ?1`)
      .bind(userId)
      .first<BindingRow>();
    return row ? toBinding(row) : null;
  }

  /**
   * The binding a push may actually use, or why it may not.
   *
   * Expiry and revocation are checked here rather than by each caller,
   * because "is this grant still good?" is one question with one answer and
   * a caller that forgets to ask is a caller that pushes on a revoked grant.
   */
  async usableBinding(userId: string, now = new Date()): Promise<BindingState> {
    const binding = await this.binding(userId);
    if (!binding) return { usable: false, reason: 'none' };
    if (binding.revokedAt) return { usable: false, reason: 'revoked' };
    const expiry = Date.parse(binding.expiresAt);
    // An unreadable expiry is treated as expired. A grant whose lifetime
    // cannot be established is not one to push on.
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      return { usable: false, reason: 'expired' };
    }
    return { usable: true, binding };
  }

  /**
   * Revoke a grant, keeping the row.
   *
   * Idempotent, and it never moves the timestamp: revoking twice is the same
   * revocation, and the first one is when it happened.
   */
  async revoke(userId: string, at = new Date()): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE github_bindings SET revoked_at = ?2
         WHERE user_id = ?1 AND revoked_at IS NULL`,
      )
      .bind(userId, at.toISOString())
      .run();
  }

  /**
   * Revoke a grant, but only if it is still the repository the caller named.
   *
   * The check and the write in one statement, because apart they are a
   * race: a bind landing between reading the binding and revoking it would
   * have the revocation take the newly bound repository, which is the exact
   * outcome naming one is meant to prevent. The name is part of the `WHERE`
   * clause, so the database decides.
   *
   * Returns whether a row changed. False does not say why: nothing bound,
   * already revoked, and bound elsewhere all look the same from here, and
   * telling them apart is the caller's business and only affects what it
   * reports.
   *
   * `lower()` because GitHub resolves an owner and a name without regard to
   * case, and SQLite's `=` does not. Both are ASCII, which is all `lower()`
   * folds.
   */
  async revokeRepository(
    userId: string,
    repository: { owner: string; repo: string },
    at = new Date(),
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE github_bindings SET revoked_at = ?2
         WHERE user_id = ?1 AND revoked_at IS NULL
           AND lower(owner) = lower(?3) AND lower(repo) = lower(?4)`,
      )
      .bind(userId, at.toISOString(), repository.owner, repository.repo)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  /**
   * The attempt at this checkpoint, started if it is not already there.
   *
   * The heart of the exactly-once story, and the reason it returns the row
   * rather than nothing: the first caller writes the base sha it resolved,
   * and every retry gets that same row back. `ON CONFLICT DO NOTHING` makes
   * the difference, because the second attempt must not overwrite the parent
   * the first one committed against.
   */
  async beginPush(
    attempt: PushKey & Pick<PushAttempt, 'baseSha' | 'branch' | 'startedAt'>,
  ): Promise<PushAttempt> {
    await this.#db
      .prepare(
        `INSERT INTO github_pushes (
           user_id, owner, repo, revision, base_sha, branch, started_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, owner, repo, revision) DO NOTHING`,
      )
      .bind(
        attempt.userId,
        attempt.owner,
        attempt.repo,
        attempt.revision,
        attempt.baseSha,
        attempt.branch,
        attempt.startedAt,
      )
      .run();

    const row = await this.#db
      .prepare(
        `SELECT * FROM github_pushes
         WHERE user_id = ?1 AND owner = ?2 AND repo = ?3 AND revision = ?4`,
      )
      .bind(attempt.userId, attempt.owner, attempt.repo, attempt.revision)
      .first<PushRow>();
    if (!row) {
      // The insert either wrote a row or found one already there, so this
      // cannot happen without the database losing a write.
      throw new Error('push attempt vanished immediately after being recorded');
    }
    return toAttempt(row);
  }

  /** What a push established, once it is known to have landed. */
  async finishPush(
    key: PushKey,
    result: {
      commitSha: string;
      treeSha: string;
      pullRequestUrl?: string;
      finishedAt: string;
    },
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE github_pushes
         SET commit_sha = ?5, tree_sha = ?6, pull_request_url = ?7,
             finished_at = ?8
         WHERE user_id = ?1 AND owner = ?2 AND repo = ?3 AND revision = ?4`,
      )
      .bind(
        key.userId,
        key.owner,
        key.repo,
        key.revision,
        result.commitSha,
        result.treeSha,
        result.pullRequestUrl ?? null,
        result.finishedAt,
      )
      .run();
  }

  /** An attempt, for a caller deciding whether there is anything to resume. */
  async push(key: PushKey): Promise<PushAttempt | null> {
    const row = await this.#db
      .prepare(
        `SELECT * FROM github_pushes
         WHERE user_id = ?1 AND owner = ?2 AND repo = ?3 AND revision = ?4`,
      )
      .bind(key.userId, key.owner, key.repo, key.revision)
      .first<PushRow>();
    return row ? toAttempt(row) : null;
  }
}
