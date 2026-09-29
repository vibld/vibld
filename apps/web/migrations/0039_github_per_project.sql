-- A repository per project, and the GitHub connection on the account
-- (docs/decisions.md, D72, "Per project, create or pick").
--
-- Until now `github_bindings` (0005) was one row per user, so an account
-- was bound to one repository and every project it had pushed there. Two
-- things were folded into that row, and D72 pulls them apart:
--
--  - **The account's connection**: that this person proved, through GitHub,
--    who they are and which App installations they reach. It belongs to the
--    account, and ending it ends every project's binding with it.
--  - **Which repository a project pushes to.** It belongs to the project, so
--    two projects can push to two repositories, and disconnecting one of
--    them leaves the others where they were.
--
-- **Additive.** `github_bindings` is left exactly as it is and nothing reads
-- it from this release on: the rows below are copied out of it, and dropping
-- it is a later migration's business once nobody could want to roll back to
-- a Worker that still reads it. The account purge keeps deleting from it,
-- because a person's repository names are still theirs to have removed.

-- The account half. One row per person who has completed the GitHub sign-in
-- at least once.
--
-- Nothing in here is a secret either, for the reason 0005 gives: the user
-- token that proved the identity is used during the exchange and discarded,
-- and the push path mints its own installation token per push.
CREATE TABLE github_connections (
  user_id TEXT PRIMARY KEY,
  -- The GitHub login that completed the sign-in, for the panel to name and
  -- for "Create a new repository", which creates under this account. NULL
  -- for a connection copied out of `github_bindings`, which never recorded
  -- it, until that person next signs in through GitHub.
  login TEXT,
  -- The App installation on that login's own account, if there is one: the
  -- installation a created repository is pushed through. NULL when the App
  -- is only installed on organisations, or not known yet.
  installation_id INTEGER,
  connected_at TEXT NOT NULL,
  granted_by_email TEXT NOT NULL,
  -- Set, not deleted, the same rule 0005 keeps for a grant: a disconnected
  -- account is a fact worth keeping, and completing the sign-in again
  -- clears it.
  revoked_at TEXT
);

-- The project half: 0005's binding, keyed by the project instead of the
-- user. Same columns and the same meaning, so the grant rules (who approved
-- it, when, and when it expires) carry over untouched.
CREATE TABLE github_project_bindings (
  project_id TEXT PRIMARY KEY,
  -- The project's owner, kept on the row so every read can ask for "this
  -- project, and this person's" in one statement: a project id somebody
  -- else guessed finds nothing, without a second query against `projects`.
  user_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  granted_by_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Disconnecting the account revokes every binding it has, and the account
-- purge deletes them: both are one account's rows.
CREATE INDEX idx_github_project_bindings_user
  ON github_project_bindings (user_id);

-- Which project a push came from, so "the last pull request" is asked per
-- project. NULL for a push that predates this and could not be attributed
-- below.
--
-- Not part of the key. The key is still "this checkpoint into this
-- repository" (0005), because a revision is a hash of the files: two
-- projects holding identical files, pushed to the same repository, build the
-- same tree onto the same branch, and that is one push, recorded against the
-- project that made it first.
ALTER TABLE github_pushes ADD COLUMN project_id TEXT;

CREATE INDEX idx_github_pushes_project
  ON github_pushes (project_id, started_at);

-- The backfill, in three statements, each safe to run against a database
-- that already has some of it (a fresh one has none of it).
--
-- 1. Every account that had a binding has a connection, in the same state
--    its binding was in: an account whose binding was revoked is an account
--    that disconnected.
INSERT INTO github_connections (
  user_id, login, installation_id, connected_at, granted_by_email, revoked_at
)
SELECT b.user_id, NULL, NULL, b.granted_at, b.granted_by_email, b.revoked_at
  FROM github_bindings AS b
 WHERE true
ON CONFLICT(user_id) DO NOTHING;

-- 2. Each account's binding moves onto one of its projects: the one most
--    recently worked on, which is the project it was being pushed from.
--    "Worked on" is the later of the project's own row (a rename or a save)
--    and its build pointer (`generation_projects`, which a build moves and
--    the project row does not), the same pair the project list sorts by.
--    Archived projects come last whatever their dates, because archiving
--    itself moves `updated_at`, and putting a project away should not be
--    what carries the repository off to it.
--
--    Revoked and expired bindings move too, in the state they were in: the
--    project then says "revoked" or "expired" rather than pretending it was
--    never connected. An account with no project at all keeps its
--    connection and binds nothing, because there is nowhere to put it.
INSERT INTO github_project_bindings (
  project_id, user_id, installation_id, owner, repo, default_branch,
  granted_at, granted_by_email, expires_at, revoked_at
)
SELECT (
         SELECT p.id
           FROM projects AS p
           LEFT JOIN generation_projects AS g ON g.id = p.id
          WHERE p.user_id = b.user_id
          ORDER BY (p.archived_at IS NULL) DESC,
                   max(p.updated_at, coalesce(g.updated_at, '')) DESC,
                   p.id
          LIMIT 1
       ),
       b.user_id, b.installation_id, b.owner, b.repo, b.default_branch,
       b.granted_at, b.granted_by_email, b.expires_at, b.revoked_at
  FROM github_bindings AS b
 WHERE EXISTS (SELECT 1 FROM projects AS p WHERE p.user_id = b.user_id)
ON CONFLICT(project_id) DO NOTHING;

-- 3. Pushes into the repository that moved are that project's pushes, so
--    its last pull request is still reported after the move. A push into a
--    repository the account had already moved away from stays unattributed:
--    it was not news about the connected repository before this either
--    (`handleGitHubStatus` only reported one that matched).
UPDATE github_pushes
   SET project_id = (
         SELECT pb.project_id
           FROM github_project_bindings AS pb
          WHERE pb.user_id = github_pushes.user_id
            AND lower(pb.owner) = lower(github_pushes.owner)
            AND lower(pb.repo) = lower(github_pushes.repo)
       )
 WHERE project_id IS NULL;
