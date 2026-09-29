-- Admin controls over one account (docs/decisions.md D73): a gifted plan,
-- a ban, per-user overrides of the plan's limits, and the audit log every
-- admin action is written to.
--
-- Additive: four new tables and nothing existing altered, so a Worker
-- deployed before this reads and writes exactly what it did.
--
-- Every row keys on the Clerk user id (L3), never an email address. The
-- admin's own verified email is stored as the actor, the way
-- `billing_admin_credits.granted_by_email` and `published_projects.held_by`
-- already store it, because that is the identity `VIBLD_PLATFORM_ADMINS`
-- names. No project content and no prompt is written to any of them.

-- A paid tier given by an admin with no Stripe charge behind it.
--
-- A table of its own rather than a row in `billing_subscriptions`, for the
-- reason `billing_admin_credits` is not a row in `billing_topups`: every
-- row there mirrors Stripe, and the nightly reconcile and the webhook
-- replay both assume so. A gift has nothing in Stripe to reconcile.
--
-- Never deleted while the account exists, only ended: `revoked_at` for an
-- admin taking it back, `ends_at` for one that runs out. The history is
-- what the user page shows. At most one is in force at a time; giving a
-- new one revokes the old in the same batch (`AdminStore.giveGift`).
CREATE TABLE plan_gifts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'build' or 'ship'. Free is not a gift.
  tier TEXT NOT NULL CHECK (tier IN ('build', 'ship')),
  -- ISO 8601, exclusive. NULL is a gift with no end date.
  ends_at TEXT,
  granted_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  revoke_reason TEXT
);

-- The one read on the hot path: this account's gift still in force, asked
-- wherever the tier is asked.
CREATE INDEX idx_plan_gifts_user ON plan_gifts (user_id, revoked_at);

-- What an admin set for one account in place of its plan's defaults. NULL
-- in either column is "the plan decides", which is also what no row means.
CREATE TABLE user_overrides (
  user_id TEXT PRIMARY KEY,
  -- Projects this account may have unarchived at once, in place of
  -- `ACTIVE_PROJECT_LIMIT` for its tier.
  active_project_limit INTEGER CHECK (active_project_limit >= 0),
  -- Micro-USD this account may spend from its monthly allowance, in place
  -- of the tier's included amount. Top-up credit is still spendable on top.
  monthly_spend_cap_micro_usd INTEGER
    CHECK (monthly_spend_cap_micro_usd >= 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A ban: the account may not sign in (Clerk is asked to ban it too) and
-- every authenticated request from it is refused (`principal.ts`), whatever
-- session it still holds.
--
-- One row per account, lifted rather than deleted, so that "was this
-- account ever banned, by whom and why" survives an unban. Banning again
-- after a lift overwrites the row; the audit log keeps every one.
CREATE TABLE user_bans (
  user_id TEXT PRIMARY KEY,
  banned_at TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  lifted_at TEXT,
  lifted_by TEXT,
  lift_reason TEXT
);

-- Every admin action, one row each, in the order they were taken.
--
-- `target_user_id` is the account acted on, where there is one: a site hold
-- names the owner of the slug when the slug has one. `target` is what the
-- action named when that is not an account (a slug, or a share link's
-- project), and is never an email address or a share token: the token is
-- the grant, and a log that held it would be a list of working links.
--
-- `detail` is a small JSON object of facts about the action (a tier, an
-- amount, an end date, what a ban stopped), never content.
CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target TEXT,
  reason TEXT,
  detail TEXT
);

CREATE INDEX idx_admin_audit_log_target
  ON admin_audit_log (target_user_id, id);

-- Append-only, held by the database rather than only by the code that
-- writes it: a row cannot be deleted, and no column of one can be changed
-- except `target_user_id`. That one exception is the account purge
-- (docs/decisions.md L32), which re-keys the rows about a deleted account
-- to its tombstone as it does the billing records, so the log keeps what
-- was done without keeping whose account it was.
CREATE TRIGGER admin_audit_log_no_delete
BEFORE DELETE ON admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_log is append-only');
END;

CREATE TRIGGER admin_audit_log_no_rewrite
BEFORE UPDATE OF id, at, admin_email, action, target, reason, detail
ON admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'admin_audit_log is append-only');
END;
