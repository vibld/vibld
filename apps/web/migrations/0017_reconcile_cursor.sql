-- Where the nightly subscription reconcile has got to (#47).
--
-- `reconcileSubscriptions` used to walk every subscription the deployment
-- knows about, on every run, with no bound at all. The three phases before
-- it in the same invocation share one D1 allowance; this one took whatever
-- was left and kept going. At roughly ten queries a subscription that runs
-- out somewhere past a hundred of them, D1 throws, and the throw is caught
-- and logged by the scheduled handler -- so the reconcile simply stops
-- happening, and nothing says so. Subscription drift goes uncorrected and a
-- payout whose `invoice.paid` never arrived is never recovered.
--
-- A bound on its own would be worse, and 0009_event_replay.sql already
-- carries the reason written from three previous failures: a bound turns
-- "never finishes" into "stops early and reports success", and the
-- subscriptions past the bound are never reached on any night.
--
-- So this is a resume point, the same shape that table settled on. The ids
-- are walked in one stable order, a run records the last one it reached,
-- and the next run starts after it. When a run reaches the end it clears
-- the cursor and the next starts from the top, which makes the walk a
-- round-robin: every subscription is visited within one full lap, however
-- many nights that takes, and none is skipped over.
CREATE TABLE billing_reconcile_cursor (
  -- One row. Named rather than implicit, for the reason
  -- `billing_event_replay` gives: a second walk is a new id, not a schema
  -- change.
  id TEXT PRIMARY KEY,

  -- The last subscription id this walk reached, in ascending id order.
  -- NULL means start from the top, which is both a fresh deployment and the
  -- run after a lap completes.
  after_id TEXT,

  updated_at TEXT NOT NULL
);
