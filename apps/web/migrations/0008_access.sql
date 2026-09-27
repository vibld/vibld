-- Invite-only access (launch gate).
--
-- The product hands out model spend on sign-up, so "anyone who can reach the
-- URL can have an account" is a faucet pointed at the provider bill. Until
-- launch opens, an account is created freely (Clerk) but can do nothing until
-- its identity is on this list.
--
-- Keyed on the email rather than the Clerk user id, deliberately: an invite
-- is issued before the person has an account, so there is no user id to key
-- on. The user id is recorded when the invite is first used, which is what
-- makes "who actually took this up" answerable.
CREATE TABLE access_invites (
  -- Lowercased on write. Two rows differing only in case would be two
  -- invites for one person and a redemption that lands on whichever the
  -- lookup happened to find.
  email TEXT PRIMARY KEY,
  invited_by_email TEXT NOT NULL,
  invited_at TEXT NOT NULL,
  -- NULL until somebody signs in with this address. Kept rather than
  -- replacing the row, so an invite that was taken up and an invite that was
  -- never used are distinguishable afterwards.
  redeemed_by_user_id TEXT,
  redeemed_at TEXT,
  -- NULL unless the invite has been withdrawn. A revoked invite keeps its
  -- row and blocks access rather than disappearing, the same rule the GitHub
  -- grants follow: the record of what was authorised stays readable.
  revoked_at TEXT
);

-- "Who has been invited and not yet signed in" is the list an operator reads.
CREATE INDEX access_invites_redeemed ON access_invites (redeemed_at, invited_at);
