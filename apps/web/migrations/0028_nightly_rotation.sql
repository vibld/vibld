-- Whose turn it is in the nightly billing pass, when the query budget is too
-- small for every phase to run on the same night (#176).
--
-- The pass has four phases (parked events, stranded payouts, the
-- subscription reconcile, the event replay) and splits one D1 query
-- allowance between them, a quarter each. At the default allowance of 40,
-- which has to stay under the 50 queries Workers Free allows an invocation,
-- a quarter buys no payout, no subscription and no page of events. The same
-- split recurs every night, so those phases did nothing on every run, for
-- ever, while each night reported success.
--
-- The fix chosen was to rotate. When the split cannot buy every phase an
-- item, the parked queue keeps its floor every night (money already taken
-- should not wait) and the rest of the allowance goes to one of payout,
-- reconcile and replay a night, in turn. Below the budget at which that floor
-- leaves room for a subscription, all four take turns instead. Either way
-- the pass needs to know whose turn went last, and nothing in it could say. A turn
-- derived from the date would need no table, but it would be a claim about
-- the Cron Trigger's schedule that nothing checks: a schedule that ran every
-- second day would only ever reach two of the phases, and every fourth day
-- one of them, which is the starvation this exists to end, moved somewhere
-- quieter. A counter that advances once per run is true whatever the
-- schedule is.
--
-- A counter rather than a phase name, and the phase is the counter modulo
-- the number of phases taking turns (three, or four below the floor's
-- threshold). Adding a phase later, or moving between the two modes, then
-- shifts whose turn comes next and loses nothing, where a stored name that
-- is no longer in the rotation would need a rule for what it means.
--
-- Advanced before the phase runs, never after, for the reason
-- `markUnattributedAttempted` stamps before its attempt: a phase that throws
-- on its night must not keep the turn and starve the others.
--
-- One row, keyed by what is being rotated, so a second rotation later is a
-- new id and not a schema change: the shape 0017_reconcile_cursor.sql and
-- 0026_publish_sweep_cursor.sql settled on.
CREATE TABLE billing_nightly_rotation (
  id TEXT PRIMARY KEY,

  -- Runs that have taken a turn, less one: the first run writes 0 and takes
  -- the first phase. Only runs on an allowance too small for the split
  -- advance it, so a deployment that raises its allowance leaves it where it
  -- was rather than resetting it.
  nights INTEGER NOT NULL,

  updated_at TEXT NOT NULL
);
