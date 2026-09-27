-- Votes on the public roadmap (/roadmap), in the vibld-marketing-roadmap
-- database. Applied by .github/workflows/deploy-marketing.yml before every
-- deploy, the way deploy-web-preview.yml applies apps/web's.
--
-- Nothing here identifies a person. A browser is known by the SHA-256 of a
-- random id held in its own cookie, never by the id itself, so a copy of this
-- database cannot be used to act as any browser. No raw IP address is stored
-- anywhere; see roadmap_rate below.

-- A browser that has passed Turnstile once. Registered only by the Worker,
-- after a check, so a cookie a client made up is not a voter until it has
-- passed one too (worker/roadmap.ts).
CREATE TABLE roadmap_voters (
  -- Hex SHA-256 of the cookie's value.
  voter_hash TEXT PRIMARY KEY,
  -- Milliseconds since the epoch.
  created_at INTEGER NOT NULL
) WITHOUT ROWID;

-- One row per item a browser has voted for. The primary key is what makes it
-- one vote per item per browser: a second insert of the same pair is ignored
-- rather than counted.
--
-- Voter first, because the one query that reads this table by anything other
-- than the whole key is "which items has this browser voted for", on every
-- visit to the page.
CREATE TABLE roadmap_votes (
  voter_hash TEXT NOT NULL,
  -- An id from apps/marketing/app/roadmap.ts. Checked by the Worker, not
  -- here: the list lives in code, and a constraint would need a migration
  -- every time an item is added.
  item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (voter_hash, item_id)
) WITHOUT ROWID;

-- The running total per item, so the page's counts are one read of about
-- twenty rows however many votes there are, rather than a COUNT(*) over every
-- vote on every page view.
--
-- Kept in step with roadmap_votes inside the same batch that changes a vote,
-- and each change here is conditional on the vote's own row, so two requests
-- racing cannot count one vote twice (worker/roadmap-store.ts).
CREATE TABLE roadmap_counts (
  item_id TEXT PRIMARY KEY,
  votes INTEGER NOT NULL DEFAULT 0 CHECK (votes >= 0)
) WITHOUT ROWID;

-- The salt the rate limiter hashes IP addresses with. A fresh random value
-- each UTC day, and the previous day's is deleted, so a hash from yesterday
-- can no longer be matched to an address or to today's hash of the same one.
CREATE TABLE roadmap_salts (
  -- YYYY-MM-DD, UTC.
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
) WITHOUT ROWID;

-- Votes per hashed IP per ten-minute window. A row is deleted once its window
-- has closed: by the next vote, or by the Worker's scheduled sweep when no
-- vote comes, so no hash outlives the window it was counted in by more than
-- one sweep.
--
-- Window first in the key, so that sweep is a range delete on the key.
CREATE TABLE roadmap_rate (
  -- Milliseconds since the epoch, the start of the window.
  window_start INTEGER NOT NULL,
  -- Hex SHA-256 of the day's salt and the address. Never the address.
  ip_hash TEXT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (window_start, ip_hash)
) WITHOUT ROWID;
