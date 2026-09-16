-- A durable record that a subscription actually took money.
--
-- The referral recovery could not answer "has this account ever paid?" for a
-- subscriber. It read the subscription's *current* status, which is a fact
-- about now rather than about what happened: a subscriber whose first
-- `customer.subscription.created` delivery was missed and who then cancelled
-- shows up as `canceled` for ever, so the nightly sweep skipped them and the
-- referral was never paid even though the first invoice cleared.
--
-- `invoice.paid` is the event that says money moved, and this deployment was
-- already subscribed to it and discarding it. It is now mirrored here.
ALTER TABLE billing_subscriptions ADD COLUMN ever_paid_at TEXT;

-- The recovery sweep asks "which unpaid attributions belong to somebody who
-- has actually paid", which lands on this column for every subscriber.
CREATE INDEX idx_billing_subscriptions_paid
  ON billing_subscriptions (user_id, ever_paid_at);
