-- Self-serve account deletion (docs/decisions.md L32, implemented
-- 2026-09-28).
--
-- L32 promised that project content is purged 30 days after an account is
-- deleted and that the audit log is kept for 12 months with the user id
-- tombstoned. Nothing implemented either half, so a person who asked to be
-- deleted had nobody to ask. This is the record the request makes, and the
-- whole of the state the work after it runs from.
--
-- One row per account, keyed by the Clerk user id (L3) while the account
-- exists. Asking is the part that has to land: everything that follows it
-- (Stripe, the preview sandbox, the published site, the GitHub grant, the
-- referral payouts) can fail on its own, and each of them is retried from
-- the columns below until it has happened, by the person asking again and by
-- the nightly pass. A request with no row would be one nothing could finish.
--
-- The refusal of every further request is a read of this table
-- (`principal.ts`), so a row that exists, is not cancelled and is not yet
-- purged is an account that can no longer use the product.
CREATE TABLE account_deletions (
  -- The Clerk user id until the purge, and the tombstone below after it.
  -- L32 keeps the audit record and not the person: once the account's data
  -- is gone, this row must no longer say whose it was.
  user_id TEXT PRIMARY KEY,

  -- Random, minted when the request is made, and what every row this
  -- deployment keeps for accounting is re-keyed to at the purge (billing,
  -- payments, referral payouts). Random rather than a hash of the user id,
  -- because a hash is still a key to anybody holding the id, and the point
  -- is that nobody is.
  tombstone TEXT NOT NULL UNIQUE,

  requested_at TEXT NOT NULL,

  -- requested_at plus 30 days. Stored rather than derived so the admin panel
  -- and the nightly pass read the same date, and a later change to the
  -- period cannot move a promise already made to somebody.
  purge_after TEXT NOT NULL,

  -- Set when the person signed in again within the 30 days and kept the
  -- account. What was already stopped stays stopped; only the purge and the
  -- refusal are withdrawn.
  cancelled_at TEXT,

  -- When each immediate step was established as done. NULL is "not yet",
  -- and a step is retried for as long as it is NULL.
  subscription_done_at TEXT,
  preview_done_at TEXT,
  sites_done_at TEXT,
  github_done_at TEXT,
  referrals_done_at TEXT,

  -- The last thing that failed, for the admin panel. Cleared when a pass
  -- finds nothing left to fail.
  last_error TEXT,

  -- Failed attempts. After seven, the nightly pass tries the request once a
  -- week rather than every night: it is listed for an operator by then,
  -- and a nightly retry of something that keeps failing only holds a share
  -- of the allowance.
  attempts INTEGER NOT NULL DEFAULT 0,

  -- Least recently tried first, so a request that fails every night costs
  -- one attempt a night rather than holding the front of the queue.
  last_attempt_at TEXT,

  -- How far the purge has got, as an index into `PURGE_STEPS`
  -- (account-deletion.ts). Every step is idempotent, and the index is saved
  -- after each one, so a night that runs out of allowance part way through
  -- resumes at the step it had not finished.
  purge_step INTEGER NOT NULL DEFAULT 0,

  purged_at TEXT,

  -- purged_at plus 12 months (L32). After it, this row is deleted as well,
  -- and the tombstone on the kept billing rows no longer leads anywhere.
  forget_after TEXT
);

-- The nightly pass asks, in one query, for requests that still have work,
-- least recently tried first, and for audit records whose 12 months are up.
CREATE INDEX idx_account_deletions_work
  ON account_deletions (purged_at, cancelled_at, last_attempt_at);

CREATE INDEX idx_account_deletions_forget
  ON account_deletions (forget_after);
