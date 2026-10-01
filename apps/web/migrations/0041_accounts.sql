-- Every account this deployment knows, for the platform admins' account
-- list (docs/decisions.md D128).
--
-- Nothing listed the accounts before. Under Clerk the people are in Clerk's
-- directory; everything this Worker keeps about them (projects, runs,
-- subscriptions, gifts, bans) is keyed by their id and says nothing about
-- who they are or when they last came. So the builder records each account
-- it lets in, with the address it signed in with, the first time it sees it
-- and, at most hourly, the last. An admin can also import Clerk's directory
-- into it, for the people who have not been back since.
--
-- It replaces 0040's access_accounts, which kept the same thing for copies
-- behind Cloudflare Access only (D123) and is folded in here.
CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  -- NULL when an account is known only by its id: one found through its
  -- projects or its billing, before it has signed in again.
  email TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX accounts_email ON accounts (email);
CREATE INDEX accounts_last_seen ON accounts (last_seen_at);

-- 0040 kept a row per address, so an account whose address changed has
-- more than one: it keeps the newest address and the widest span of dates.
INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT a.user_id,
         (SELECT b.email FROM access_accounts b
           WHERE b.user_id = a.user_id
           ORDER BY b.last_seen_at DESC, b.email LIMIT 1),
         MIN(a.first_seen_at),
         MAX(a.last_seen_at)
  FROM access_accounts a
  GROUP BY a.user_id
  ON CONFLICT (user_id) DO NOTHING;

-- The accounts this deployment already has data for, by id alone, from
-- every table that keys a row by the account it belongs to: what they made,
-- bought, were given or were banned from, and a deletion still waiting out
-- its 30 days (which can be cancelled, and meanwhile cannot sign in to be
-- recorded). Each is dated by the oldest and newest of those rows.
--
-- One statement a table rather than one UNION of them all: D1 refuses a
-- compound SELECT of that many terms.
--
-- An account carried from 0040 keeps its address and last visit, and takes
-- the older first date where its data is older; the others take the widest
-- span their rows give.
--
-- Never an account being deleted. A purge re-keys the rows kept for
-- accounting to a random tombstone (0031), so a tombstone is not an account
-- and is left out, as is any id whose purge has begun: it cannot be
-- cancelled, and its step that deletes this row may already have run.
INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM projects
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM billing_customers
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM billing_subscriptions
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM billing_topups
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM billing_admin_credits
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM billing_signup_cards
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(opened_at), MAX(opened_at) FROM billing_signup_offers
  WHERE user_id IS NOT NULL AND user_id <> '' AND opened_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(started_at), MAX(started_at) FROM billing_purchase_starts
  WHERE user_id IS NOT NULL AND user_id <> '' AND started_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM plan_gifts
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(updated_at), MAX(updated_at) FROM user_overrides
  WHERE user_id IS NOT NULL AND user_id <> '' AND updated_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(banned_at), MAX(banned_at) FROM user_bans
  WHERE user_id IS NOT NULL AND user_id <> '' AND banned_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM referral_codes
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT referred_user_id, NULL, MIN(created_at), MAX(created_at) FROM referral_attributions
  WHERE referred_user_id IS NOT NULL AND referred_user_id <> '' AND created_at IS NOT NULL
    AND referred_user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND referred_user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY referred_user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(connected_at), MAX(connected_at) FROM github_connections
  WHERE user_id IS NOT NULL AND user_id <> '' AND connected_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM published_projects
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(created_at), MAX(created_at) FROM project_media
  WHERE user_id IS NOT NULL AND user_id <> '' AND created_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT redeemed_by_user_id, NULL, MIN(redeemed_at), MAX(redeemed_at) FROM access_invites
  WHERE redeemed_by_user_id IS NOT NULL AND redeemed_by_user_id <> '' AND redeemed_at IS NOT NULL
    AND redeemed_by_user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND redeemed_by_user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY redeemed_by_user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

INSERT INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT user_id, NULL, MIN(requested_at), MAX(requested_at) FROM account_deletions
  WHERE user_id IS NOT NULL AND user_id <> '' AND requested_at IS NOT NULL
    AND user_id NOT IN (SELECT tombstone FROM account_deletions)
    AND user_id NOT IN (
      SELECT user_id FROM account_deletions
       WHERE cancelled_at IS NULL
         AND (purge_step > 0 OR purged_at IS NOT NULL))
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    first_seen_at = MIN(accounts.first_seen_at, excluded.first_seen_at),
    last_seen_at = CASE WHEN accounts.email IS NULL
                        THEN MAX(accounts.last_seen_at, excluded.last_seen_at)
                        ELSE accounts.last_seen_at END;

DROP TABLE access_accounts;

-- Every account an admin acts on is listed, signed in or not: a gift, a
-- ban, credit or overrides are data held about it. A trigger, because the
-- admin actions write their audit row in more than one way (alone, or in
-- the same batch as the change it records), and this way none is missed.
-- Not for a deletion, which is the account leaving, nor for an account
-- whose purge has begun or a purge's tombstone (0031). Dated by the action;
-- an account already listed is left as it is.
CREATE TRIGGER accounts_from_admin_action
AFTER INSERT ON admin_audit_log
WHEN NEW.target_user_id IS NOT NULL AND NEW.action <> 'delete'
BEGIN
  INSERT OR IGNORE INTO accounts (user_id, email, first_seen_at, last_seen_at)
  SELECT NEW.target_user_id, NULL, NEW.at, NEW.at
  WHERE NOT EXISTS (
      SELECT 1 FROM account_deletions d
       WHERE d.user_id = NEW.target_user_id AND d.cancelled_at IS NULL
         AND (d.purge_step > 0 OR d.purged_at IS NOT NULL))
    AND NOT EXISTS (
      SELECT 1 FROM account_deletions d WHERE d.tombstone = NEW.target_user_id);
END;
