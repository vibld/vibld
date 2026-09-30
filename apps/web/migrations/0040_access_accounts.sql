-- The people a copy behind Cloudflare Access has let in (docs/decisions.md
-- D123).
--
-- An admin finds an account by the address it signs in with. Under Clerk
-- that is Clerk's own directory; behind Access there is none to ask, and the
-- invite list only knows the people who took an invite, which the admins
-- and everyone on an open copy never do. So each person the builder lets in
-- is recorded here with the Access id their ledger and projects key on.
--
-- Nothing else reads it, and a deployment signed in by Clerk or by an owner
-- password never writes to it. The account purge deletes the row with the
-- rest of the person's data.
CREATE TABLE access_accounts (
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX access_accounts_user_id ON access_accounts (user_id);
