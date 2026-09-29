/**
 * Which repository each project pushes to, whether the account is connected
 * to GitHub at all, and what a push has already done.
 *
 * A thin wrapper over the tables `migrations/0005_github.sql` and
 * `0039_github_per_project.sql` declare, the same shape `billing-store.ts`
 * has: no SQL anywhere else, nothing GitHub-shaped in here (no tokens, no
 * API types), so it is testable against a real SQLite schema with no network
 * and no credential.
 *
 * Nothing stored here is a secret. The App's private key is a Worker secret
 * and an installation token is minted per push and never written down, so
 * what is left is a binding: an installation id, a repository, a branch, and
 * when the grant was made (ADR-0006).
 *
 * `github_bindings`, the one-row-per-user table 0005 made, is not read here
 * any more (D72). 0039 copied each row onto a project, and the account purge
 * is the only thing that still touches it.
 */

export interface RepositoryBinding {
  userId: string;
  /**
   * The project this binding belongs to (D72). A repository is chosen per
   * project, so two projects can push to two repositories and ending one
   * binding leaves the others alone.
   */
  projectId: string;
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
  project_id: string;
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

/**
 * The account's half of the connection (D72): that this person completed
 * the GitHub sign-in, as whom, and through which installation on their own
 * account a repository created for them would be pushed.
 *
 * Kept apart from the bindings because it outlives any one of them. A
 * project can be unbound while the account stays connected, and ending the
 * account's connection ends every binding it has.
 */
export interface AccountConnection {
  userId: string;
  /** Null for a connection copied out of 0005, until the next sign-in. */
  login: string | null;
  installationId: number | null;
  connectedAt: string;
  grantedByEmail: string;
  revokedAt: string | null;
}

interface ConnectionRow {
  user_id: string;
  login: string | null;
  installation_id: number | null;
  connected_at: string;
  granted_by_email: string;
  revoked_at: string | null;
}

/** What an attempt at one checkpoint has established so far. */
export interface PushAttempt {
  userId: string;
  /**
   * The project that made this push, or null for one older than D72 that
   * the migration could not attribute. Not part of the key (see `PushKey`).
   */
  projectId: string | null;
  owner: string;
  repo: string;
  revision: string;
  /** The parent this push resolved before it began writing. */
  baseSha: string;
  branch: string;
  commitSha: string | null;
  treeSha: string | null;
  pullRequestUrl: string | null;
  /** What became of that pull request, once a webhook has said (internal issue 13). */
  pullRequestNumber: number | null;
  pullRequestState: PullRequestState | null;
  /** GitHub's own clock, which is what orders two deliveries. */
  pullRequestUpdatedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * `merged` is its own answer rather than `closed` with a flag beside it.
 *
 * They are different news. Somebody reading "closed" about work that shipped
 * goes looking for what went wrong.
 */
export type PullRequestState = 'open' | 'closed' | 'merged';

export function isPullRequestState(value: unknown): value is PullRequestState {
  return value === 'open' || value === 'closed' || value === 'merged';
}

interface PushRow {
  user_id: string;
  project_id: string | null;
  owner: string;
  repo: string;
  revision: string;
  base_sha: string;
  branch: string;
  commit_sha: string | null;
  tree_sha: string | null;
  pull_request_url: string | null;
  pull_request_number: number | null;
  pull_request_state: string | null;
  pull_request_updated_at: string | null;
  started_at: string;
  finished_at: string | null;
}

function toBinding(row: BindingRow): RepositoryBinding {
  return {
    userId: row.user_id,
    projectId: row.project_id,
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

function toConnection(row: ConnectionRow): AccountConnection {
  return {
    userId: row.user_id,
    login: row.login,
    installationId: row.installation_id,
    connectedAt: row.connected_at,
    grantedByEmail: row.granted_by_email,
    revokedAt: row.revoked_at,
  };
}

function toAttempt(row: PushRow): PushAttempt {
  return {
    userId: row.user_id,
    projectId: row.project_id,
    owner: row.owner,
    repo: row.repo,
    revision: row.revision,
    baseSha: row.base_sha,
    branch: row.branch,
    commitSha: row.commit_sha,
    treeSha: row.tree_sha,
    pullRequestUrl: row.pull_request_url,
    pullRequestNumber: row.pull_request_number,
    // Read back through the guard rather than cast: a value this build does
    // not know is not a state to show somebody, and an unknown one is
    // better reported as nothing than as a word nobody chose.
    pullRequestState: isPullRequestState(row.pull_request_state)
      ? row.pull_request_state
      : null,
    pullRequestUpdatedAt: row.pull_request_updated_at,
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
 *
 * The project is deliberately not (D72). A revision is a hash of the files,
 * so two projects holding the same files and pushing to the same repository
 * build the same tree onto the same branch: one operation, and giving it two
 * keys would record two parents for one branch.
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
   * Record that this person completed the GitHub sign-in (D72).
   *
   * Upserted, and a fresh sign-in clears a revocation: connecting again is
   * how somebody undoes a disconnect. It does not bring back any project's
   * binding, which each project chooses again, because a disconnect was an
   * instruction to stop pushing and a sign-in is not an instruction to
   * start.
   *
   * A login or installation that could not be read this time does not
   * erase one recorded before: the sign-in still proved the same person,
   * and a GitHub that briefly did not say who is not news that they are
   * nobody.
   */
  async connect(
    connection: Omit<AccountConnection, 'revokedAt'>,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO github_connections (
           user_id, login, installation_id, connected_at, granted_by_email,
           revoked_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         ON CONFLICT(user_id) DO UPDATE SET
           login = coalesce(excluded.login, github_connections.login),
           installation_id = coalesce(excluded.installation_id,
                                      github_connections.installation_id),
           connected_at = excluded.connected_at,
           granted_by_email = excluded.granted_by_email,
           revoked_at = NULL`,
      )
      .bind(
        connection.userId,
        connection.login,
        connection.installationId,
        connection.connectedAt,
        connection.grantedByEmail,
      )
      .run();
  }

  /** The account's connection as stored, whatever state it is in. */
  async connection(userId: string): Promise<AccountConnection | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM github_connections WHERE user_id = ?1`)
      .bind(userId)
      .first<ConnectionRow>();
    return row ? toConnection(row) : null;
  }

  /**
   * Whether this person owns this project.
   *
   * Asked before a binding is written, because the binding is what every
   * later push trusts: a repository bound onto a project id somebody else
   * guessed would be written against their project. Reads need no such
   * check, since every one of them asks for the project and the owner
   * together.
   */
  async ownsProject(userId: string, projectId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(`SELECT 1 AS found FROM projects WHERE id = ?1 AND user_id = ?2`)
      .bind(projectId, userId)
      .first<{ found: number }>();
    return row !== null;
  }

  /**
   * Record the repository a user approved for one project.
   *
   * Replaces rather than refuses: connecting a different repository is an
   * ordinary thing to do, and it is the user's own grant to change. The
   * grant metadata is rewritten with it, so a reconnect is a fresh grant
   * with a fresh expiry rather than an old one silently extended.
   *
   * The update only applies to a row that is already this person's. The
   * caller has checked ownership (`ownsProject`), and this is the same
   * rule said again where the write happens, so a row can never change
   * hands through here.
   */
  async bind(binding: Omit<RepositoryBinding, 'revokedAt'>): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO github_project_bindings (
           project_id, user_id, installation_id, owner, repo, default_branch,
           granted_at, granted_by_email, expires_at, revoked_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
         ON CONFLICT(project_id) DO UPDATE SET
           installation_id = excluded.installation_id,
           owner = excluded.owner,
           repo = excluded.repo,
           default_branch = excluded.default_branch,
           granted_at = excluded.granted_at,
           granted_by_email = excluded.granted_by_email,
           expires_at = excluded.expires_at,
           revoked_at = NULL
         WHERE github_project_bindings.user_id = excluded.user_id`,
      )
      .bind(
        binding.projectId,
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

  /** A project's binding as stored, whatever state it is in. */
  async binding(
    userId: string,
    projectId: string,
  ): Promise<RepositoryBinding | null> {
    const row = await this.#db
      .prepare(
        `SELECT * FROM github_project_bindings
          WHERE project_id = ?1 AND user_id = ?2`,
      )
      .bind(projectId, userId)
      .first<BindingRow>();
    return row ? toBinding(row) : null;
  }

  /**
   * The binding a push from this project may actually use, or why it may
   * not.
   *
   * Expiry and revocation are checked here rather than by each caller,
   * because "is this grant still good?" is one question with one answer and
   * a caller that forgets to ask is a caller that pushes on a revoked grant.
   */
  async usableBinding(
    userId: string,
    projectId: string,
    now = new Date(),
  ): Promise<BindingState> {
    const binding = await this.binding(userId, projectId);
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
   * Disconnect the account from GitHub: its connection and every project's
   * binding (D72).
   *
   * Idempotent, and it never moves a timestamp: revoking twice is the same
   * revocation, and the first one is when it happened. One batch, so a
   * failure cannot leave the account disconnected with projects still
   * pushing, or the other way round.
   */
  async disconnectAccount(userId: string, at = new Date()): Promise<void> {
    const when = at.toISOString();
    await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE github_project_bindings SET revoked_at = ?2
            WHERE user_id = ?1 AND revoked_at IS NULL`,
        )
        .bind(userId, when),
      this.#db
        .prepare(
          `UPDATE github_connections SET revoked_at = ?2
            WHERE user_id = ?1 AND revoked_at IS NULL`,
        )
        .bind(userId, when),
    ]);
  }

  /**
   * Revoke one project's grant, but only if it is still the repository the
   * caller named.
   *
   * The check and the write in one statement, because apart they are a
   * race: a bind landing between reading the binding and revoking it would
   * have the revocation take the newly bound repository, which is the exact
   * outcome naming one is meant to prevent. The name is part of the `WHERE`
   * clause, so the database decides.
   *
   * Only this project's row. Another project bound to the same repository
   * keeps pushing (D72): disconnecting is something done to a project.
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
    projectId: string,
    repository: { owner: string; repo: string },
    at = new Date(),
  ): Promise<boolean> {
    const result = await this.#db
      .prepare(
        `UPDATE github_project_bindings SET revoked_at = ?3
         WHERE project_id = ?1 AND user_id = ?2 AND revoked_at IS NULL
           AND lower(owner) = lower(?4) AND lower(repo) = lower(?5)`,
      )
      .bind(
        projectId,
        userId,
        at.toISOString(),
        repository.owner,
        repository.repo,
      )
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
    attempt: PushKey &
      Pick<PushAttempt, 'baseSha' | 'branch' | 'startedAt'> & {
        projectId: string;
      },
  ): Promise<PushAttempt> {
    await this.#db
      .prepare(
        `INSERT INTO github_pushes (
           user_id, owner, repo, revision, base_sha, branch, started_at,
           project_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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
        attempt.projectId,
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

  /**
   * Has this delivery been seen before?
   *
   * GitHub redelivers, and a redelivery can be triggered by hand from the
   * App's settings page. Asked before anything is applied, so a repeat is a
   * no-op rather than a second write.
   */
  async wasDelivered(deliveryId: string): Promise<boolean> {
    const row = await this.#db
      .prepare(
        `SELECT delivery_id FROM github_webhook_deliveries WHERE delivery_id = ?1`,
      )
      .bind(deliveryId)
      .first<{ delivery_id: string }>();
    return row !== null;
  }

  async markDelivered(
    deliveryId: string,
    event: string,
    receivedAt: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO github_webhook_deliveries (delivery_id, event, received_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(delivery_id) DO NOTHING`,
      )
      .bind(deliveryId, event, receivedAt)
      .run();
  }

  /**
   * Record what became of the pull request on a branch.
   *
   * Matched on the branch, because that is all a delivery knows: it names a
   * repository and a head ref and nothing about who pushed it, or from which
   * project. The branch is derived from the checkpoint (`branchForRevision`),
   * so it identifies the push without the user, and every project that
   * pushed that checkpoint there hears about it.
   *
   * The `updated_at` comparison is the part that matters. Webhook delivery
   * is at-least-once and unordered, so `closed` can arrive after `merged`,
   * and without this the worse answer would overwrite the better one. A row
   * with no recorded time yet accepts the first delivery it sees.
   */
  async recordPullRequest(update: {
    owner: string;
    repo: string;
    branch: string;
    number: number;
    url: string;
    state: PullRequestState;
    updatedAt: string;
  }): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE github_pushes
            SET pull_request_number = ?4,
                pull_request_url = ?5,
                pull_request_state = ?6,
                pull_request_updated_at = ?7
          WHERE owner = ?1 AND repo = ?2 AND branch = ?3
            AND (pull_request_updated_at IS NULL
                 OR pull_request_updated_at <= ?7)`,
      )
      .bind(
        update.owner,
        update.repo,
        update.branch,
        update.number,
        update.url,
        update.state,
        update.updatedAt,
      )
      .run();
  }

  /**
   * The most recent push from this project that opened a pull request.
   *
   * What the builder shows after a reload, when the push that opened it
   * happened in a session that is over. Newest first by when the push
   * started, because that is the order the user made them in. Per project
   * (D72), so one project never reports another's pull request as its own.
   */
  async lastPullRequest(
    userId: string,
    projectId: string,
  ): Promise<PushAttempt | null> {
    const row = await this.#db
      .prepare(
        `SELECT * FROM github_pushes
          WHERE user_id = ?1 AND project_id = ?2
            AND pull_request_url IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 1`,
      )
      .bind(userId, projectId)
      .first<PushRow>();
    return row ? toAttempt(row) : null;
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
