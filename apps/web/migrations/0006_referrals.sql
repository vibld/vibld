-- The referral program (docs/decisions.md, resolved 2026-09-16): both sides
-- earn, and nothing is paid until the referred account's first purchase
-- clears.
--
-- Two tables rather than one, because they answer different questions and
-- have different lifetimes. A code belongs to an account forever and is
-- shared publicly; an attribution belongs to the referred account and is
-- written once, at signup, long before anyone knows whether it will ever pay.

-- One code per account. Issued lazily, the first time somebody looks at their
-- own referral surface, so an account that never shares gets no row.
CREATE TABLE referral_codes (
  user_id TEXT PRIMARY KEY,
  -- Uppercase, 8 characters, from an alphabet with no 0/O/1/I/L: a code's
  -- job is to survive being read off a screen and typed back in. UNIQUE
  -- rather than merely indexed, because two accounts sharing a code would
  -- make every payout ambiguous and there would be no way to tell afterwards
  -- which of them earned it.
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Who sent whom, and whether it has been paid for.
CREATE TABLE referral_attributions (
  -- The referred account is the key, which is the rule rather than a
  -- convenience: one attribution per account, ever, written once and never
  -- replaced. An account that can be re-attributed can be sold to whichever
  -- referrer asks last.
  referred_user_id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  -- The code as it was at the time. Kept even though it is derivable from
  -- referrer_user_id, because a code could be reissued and this row is the
  -- record of what was actually clicked.
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- NULL until this attribution takes one of its referrer's capped slots,
  -- which happens at the start of a payout rather than at the end of it.
  --
  -- The cap cannot be a count read in one statement and compared in another:
  -- two purchases clearing at the same moment both read the same count and
  -- both pay, and a burst passes the ceiling by however many arrive at once.
  -- The claim is therefore made by a single conditional UPDATE that carries
  -- the count in its own WHERE clause, and SQLite's one-writer-at-a-time rule
  -- makes the second attempt see the first. This column is what that
  -- statement sets and what it counts.
  --
  -- Separate from paid_at because it is a reservation, not a receipt. A
  -- payout that fails after claiming its slot has to be able to resume and
  -- still be owed the slot it took.
  claimed_at TEXT,
  -- NULL until both credits have actually been written. The presence of a
  -- timestamp here is what makes a redelivered Stripe webhook a no-op rather
  -- than a second payout, alongside the deterministic grant id in
  -- referral.ts. Both, because neither alone is enough: the grant id stops a
  -- duplicate credit row, and this stops the payout path running again and
  -- reporting a payout that did not happen.
  paid_at TEXT
);

-- The cap's own subquery counts this account's claimed slots on every cleared
-- purchase, and the readout counts its paid ones. Both narrow by referrer
-- first, so one index on that leading column serves them.
CREATE INDEX referral_attributions_referrer
  ON referral_attributions (referrer_user_id, claimed_at);
