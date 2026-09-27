-- Where the replay of Stripe's own event log has got to.
--
-- A webhook delivery can be missed outright, and Stripe stops retrying a
-- failing endpoint after a few days. Everything that delivery would have
-- carried is still in Stripe's event log, so the recovery is to read that
-- log and feed it through the same handler the webhook uses.
--
-- Three previous attempts read each customer's Checkout and invoice history
-- instead, and every one of them failed the same way: an unbounded read
-- inside a run with a fixed budget, then a bound that turned "never
-- finishes" into "stops early and reports success". A customer whose history
-- was long enough exhausted the budget at the same page every night, so a
-- payment behind it was never reached, and nothing said so.
--
-- What makes this table different is that it is a resume point rather than a
-- bound. Stripe lists events newest first, so a run descends through them;
-- when the budget runs out the run records exactly where it stopped, and the
-- next one carries on from there rather than starting again at the top. Each
-- run therefore covers ground no run has covered, and the region below the
-- cursor is never skipped over.
CREATE TABLE billing_event_replay (
  -- One row. Named rather than implicit so a second cursor (a different
  -- event source, a re-scan) is a new id and not a schema change.
  id TEXT PRIMARY KEY,

  -- Every Stripe event created before this second has been replayed. Seconds
  -- since the epoch, which is what Stripe's `created` filter takes.
  --
  -- Zero on a fresh deployment, which asks for everything. That is not the
  -- unbounded read the previous attempts died of: Stripe keeps events for
  -- about 30 days, so "everything" is a bounded list however old the account
  -- is, and it is walked across as many nights as it takes either way.
  done_below INTEGER NOT NULL,

  -- The top of the descent in progress, and what `done_below` becomes when
  -- it finishes. Null when no descent is in progress.
  --
  -- Held apart from `done_below` on purpose. Advancing the floor to the top
  -- of a descent that has not reached the bottom is precisely the mistake
  -- this table exists to prevent: it would declare the unread middle
  -- covered.
  sweep_top INTEGER,

  -- Stripe's `starting_after` for the next page of the descent, which is the
  -- id of the oldest event the last run read. Null at the start of a
  -- descent.
  --
  -- An id rather than a timestamp because a page can end on a second that
  -- holds more events than fit in it. Resuming by timestamp would read that
  -- second again and, if it alone filled a page, would never get past it.
  sweep_after_id TEXT,

  updated_at TEXT NOT NULL
);
