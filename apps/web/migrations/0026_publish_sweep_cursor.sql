-- Where the orphan sweep got to, so successive bounded runs cover the whole
-- bucket instead of the same front of it for ever.
--
-- `sweepOrphans` (#177) walks R2 looking for prefixes no catalogue row
-- names, and it is bounded, because a sweep that cannot finish is one that
-- dies partway and leaves the same mess. The first cut started from the top
-- of the listing every night and stopped at its bound, on the reasoning that
-- orphans are rare so a cursor was another thing that could be wrong.
--
-- That reasoning was about the wrong thing. Rarity decides how often an
-- orphan exists; it does not decide whether the sweep can ever reach one.
-- R2 lists in key order and the bound counts revisions examined, so once
-- enough catalogued revisions sort ahead of an orphan the sweep spends its
-- whole allowance on them and stops short, every night, for ever. Three
-- revisions kept per slug means seven published slugs is enough. The sweep
-- would still run nightly, still report honestly, and never collect
-- anything past that point.
--
-- So it resumes. A run records the last key it looked at and the next starts
-- after it; reaching the end of the listing clears the mark, and the walk
-- laps. That is the same shape 0017_reconcile_cursor.sql settled on for the
-- nightly subscription walk, for the same reason: a bound without a resume
-- point is not a bound, it is a blind spot.
--
-- One row, keyed by what is being swept, so a second sweep over some other
-- prefix later needs no migration.
CREATE TABLE publish_sweep_cursor (
  id TEXT PRIMARY KEY,
  -- The last R2 key the previous run examined. NULL means start from the
  -- beginning, which is both the first ever run and every run after one
  -- that reached the end.
  after_key TEXT,
  updated_at TEXT NOT NULL
);
