-- Sharing a project: an unlisted view link, and copying it into another
-- account (docs/decisions.md, "Resolved 2026-09-28", sharing).
--
-- 0033 left room for exactly this ("a token column or a table of grants
-- beside this one"), and a column is enough: a project has at most one
-- link at a time, so a table of grants would be a table with one live row
-- per project and a rule saying so.
--
-- **The link carries a token, never the project id.** A project id is not
-- a secret: the backfilled ones are their owner's Clerk user id, and every
-- other one is in the owner's address bar. `share_token` is 32 random bytes
-- in base64url, minted when the owner turns the link on and set to NULL
-- when they turn it off, so a link that was turned off stays dead: turning
-- it on again mints a different one. It is stored as it is rather than as
-- a hash, because the owner has to be able to see and copy their link
-- again, and a hash cannot be turned back into it. It lives in the same
-- database as every project's code, which is what it grants a view of.
--
-- **An operator can hold a link, in columns the owner cannot clear.** The
-- same shape as a published site's hold (0018_operator_hold.sql) and for
-- the same reasons: a phishing page reachable through a share link is as
-- much vibld's problem as one on a published slug, and a hold the owner
-- could lift by turning the link off and on again would be no hold. So the
-- hold is on the project, not on the token: while it stands the link does
-- not serve, the owner can still turn it off (taking less public is never
-- refused, `access-gate.ts`), and cannot turn it on. Releasing it puts the
-- link back if the owner has not turned it off meanwhile.
--
-- Nothing is deleted by a hold, for the reason 0018 gives: the harm is the
-- content being reachable, and the flag stops that the moment it is
-- written.
ALTER TABLE projects ADD COLUMN share_token TEXT;
-- When the current link was turned on. NULL with the token.
ALTER TABLE projects ADD COLUMN shared_at TEXT;
ALTER TABLE projects ADD COLUMN share_held_at TEXT;
ALTER TABLE projects ADD COLUMN share_held_by TEXT;
ALTER TABLE projects ADD COLUMN share_held_reason TEXT;

-- The public view finds a project by nothing else, on every request. UNIQUE
-- as well as an index: two projects answering one token would show a
-- stranger the wrong one, and 256 random bits colliding is not a reason to
-- leave the database able to hold it.
CREATE UNIQUE INDEX idx_projects_share_token ON projects (share_token);

-- What an operator did to a share link, kept after the fact.
--
-- The columns above are the current state; this is the record, appended
-- and never updated, the split 0020_hold_history.sql made for published
-- sites after the first cut lost it. Keyed by project, because the token
-- can change under a hold (the owner turning the link off), and the token
-- beside it so that a release can be asked for with the link the report
-- carried, even after that link was turned off.
--
-- Not deleted by the account purge, like `published_site_holds`: the
-- record has to outlive what it describes. It holds no content and nothing
-- about the owner: a project id, the link, who, why and when.
CREATE TABLE project_share_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  share_token TEXT,
  -- 'held' or 'released'.
  action TEXT NOT NULL,
  -- The platform admin, by the email their Clerk identity was verified
  -- under.
  actor TEXT NOT NULL,
  -- Required on a hold, NULL on a release.
  reason TEXT,
  at TEXT NOT NULL
);

CREATE INDEX idx_project_share_holds_token ON project_share_holds (share_token);
