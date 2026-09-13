-- Which GitHub repository a user's work pushes to (issue #13, docs/decisions
-- L30/L42a, docs/push-and-deploy-plan.md phase 1).
--
-- Nothing in here is a secret, which is the whole reason this table can
-- exist at all. ADR-0006 separates two credential classes, and the GitHub
-- App's private key is the Vibld-infrastructure kind: a Worker secret, never
-- stored per user. An installation access token is minted from it per push
-- and expires in an hour. What is left to persist is the binding itself --
-- which installation, which repository, which branch -- and an installation
-- id is a number GitHub shows in a URL.
--
-- The plan specifies a Durable Object for this. That was written when this
-- Worker had no database at all; D1 has been the control plane since
-- migration 0001, this is low-write metadata read once per push, and a
-- second storage system for one row per user would be its own thing to
-- reason about. Same table shape either way.
CREATE TABLE github_bindings (
  -- One repository per Clerk user, the same convention `handlePlan` and
  -- `handlePublish` already use: there is no multi-project UI yet.
  user_id TEXT PRIMARY KEY,

  -- The App installation, and the repository inside it the user approved.
  -- An installation can cover many repositories; this is the only one Vibld
  -- is allowed to touch, and it is what the minted token gets scoped to.
  installation_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  default_branch TEXT NOT NULL,

  -- ADR-0006 asks a grant to record when, and by whom, and to expire.
  -- `granted_by_email` is the Clerk-verified identity that approved it, the
  -- same shape `billing_admin_credits` uses, never a free-text field.
  granted_at TEXT NOT NULL,
  granted_by_email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- Set rather than deleted: a revoked grant is a fact worth keeping, and
  -- blocking new work on a row that is still there is easier to reason
  -- about than inferring intent from a row that is gone.
  revoked_at TEXT
);

-- The in-flight push, and the last one that finished.
--
-- This is what makes a retry safe (ADR-0007: "use stable operation
-- identifiers and recorded results for external side effects"). The
-- interesting column is `base_sha`: the parent a push resolved before it
-- started writing. Without it recorded here, an attempt that commits and
-- then loses its reply has nothing to pin, and its retry re-reads a base
-- branch that may have moved -- which makes the "same" commit a different
-- object and the push happen twice.
--
-- Keyed by the destination as well as the revision, because the operation is
-- "push this checkpoint *to this repository*". A sha names a commit in one
-- repository and nothing at all in another, so a user who reconnects from one
-- repository to another and pushes the same checkpoint must resolve a fresh
-- parent: reusing the recorded one builds a commit on a parent the new
-- destination has never heard of, GitHub refuses it, and every retry reads
-- the same stale row and refuses again.
CREATE TABLE github_pushes (
  user_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  revision TEXT NOT NULL,

  -- Resolved once, before the first ambiguous write, and reused by every
  -- retry.
  base_sha TEXT NOT NULL,
  branch TEXT NOT NULL,

  -- Filled in when the push is known to have landed. A row with these null
  -- is an attempt whose outcome is unknown, which is exactly the state the
  -- reconciliation in `github-push.ts` is written to resolve.
  commit_sha TEXT,
  tree_sha TEXT,
  pull_request_url TEXT,

  started_at TEXT NOT NULL,
  finished_at TEXT,

  PRIMARY KEY (user_id, owner, repo, revision)
);

CREATE INDEX idx_github_pushes_user ON github_pushes(user_id, started_at);
