-- Stripe events this deployment could not work out the owner of, kept so
-- that not knowing yet never means losing.
--
-- The replay reads Stripe's event log newest first, so a missed
-- `invoice.paid` can be read before the older Checkout that creates its
-- customer mapping. The handler has nobody to attribute it to and writes
-- nothing. Two things were tried and both are wrong:
--
--   Marking it done on that normal return loses a real payment for ever.
--   The mapping arrives moments later and nothing looks at the invoice
--   again.
--
--   Freezing the sweep until it resolves looks safer and is not. Stripe
--   keeps events for about 30 days, so a freeze does not hold the ground
--   still: it holds the cursor still while the retention boundary moves,
--   and every payment that crosses it during the freeze is lost too. An
--   event that can never be attributed, a subscription on a price this
--   deployment does not know, turns one stuck event into every future
--   payment.
--
-- So the event is taken out of Stripe's custody and put into ours. The
-- payload is stored, the sweep carries on, and a local pass retries the
-- parked rows every night at no request cost. Once it resolves the row goes
-- and the event is marked processed like any other. Until then it is a
-- visible queue with a count and an age, which is a thing somebody can act
-- on, rather than a number in a log or a silence.
--
-- Nothing here is money that has been credited. It is money Stripe says
-- moved that this deployment cannot yet put a name to.
CREATE TABLE billing_unattributed_events (
  stripe_event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  -- Stripe's own creation second, kept so the retry can apply the oldest
  -- first, the same ordering rule the replay follows within a page.
  created INTEGER NOT NULL,
  -- The whole event as Stripe sent it. Stored rather than re-fetched by id,
  -- and that is the point: re-fetching works only while Stripe still has the
  -- event, which is the retention window this table exists to escape. Once
  -- the row is here the payment can be recovered however long it takes to
  -- work out whose it is.
  --
  -- It holds what the rest of the billing tables already hold, a customer
  -- id and an amount, and no card data: Stripe does not put a PAN in an
  -- event.
  payload TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  -- How many times the retry has tried. Never used to give up, only to say
  -- how long something has been waiting. Giving up is the behaviour this
  -- table replaces.
  attempts INTEGER NOT NULL DEFAULT 0
);

-- The retry applies the oldest first.
CREATE INDEX idx_billing_unattributed_created
  ON billing_unattributed_events (created);
