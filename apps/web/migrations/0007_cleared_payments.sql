-- A durable record of money that actually cleared, with the amount.
--
-- The referral recovery could not answer "has this account ever paid?". It
-- read the subscription's *current* status, which is a fact about now rather
-- than about what happened: a subscriber whose first delivery was missed and
-- who then cancelled shows up as `canceled` for ever, so the nightly sweep
-- skipped them and the referral was never paid even though the first invoice
-- cleared.
--
-- The first attempt at a fix put an `ever_paid_at` stamp on the subscription
-- row. That answered the wrong question twice over. It inferred payment from
-- the existence of a row or from a status rather than from a charge, so a
-- Checkout fully covered by a coupon, a zero-amount invoice and a trialing
-- subscription all read as paid and each one would have paid out a referral
-- for nothing. And it hung the record off a subscription row that may not
-- exist yet: `invoice.paid` can arrive before `customer.subscription.created`,
-- and an UPDATE against a row that is not there changes nothing and says
-- nothing.
--
-- So the record is its own table, keyed on the Stripe object that cleared
-- and carrying what it cleared for. Row existence is not the signal; the
-- amount is. Zero-amount settlements are still recorded, because they did
-- happen and the table is a record of what happened. What counts as paid is
-- decided in one place, `CLEARED_PAYMENT_SQL`, which requires a positive
-- amount.
CREATE TABLE billing_payments (
  -- Stripe's own id for the thing that cleared: a Checkout Session id for a
  -- top-up, an Invoice id for a subscription charge. The primary key is what
  -- makes the write idempotent under Stripe's at-least-once delivery and
  -- under the nightly reconcile re-recording the same invoices.
  stripe_object_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- What Stripe actually took, in USD cents. Not the credit granted: a
  -- coupon-covered top-up grants credit and takes nothing.
  amount_usd_cents INTEGER NOT NULL,
  cleared_at TEXT NOT NULL
);

-- The recovery sweep asks "which unpaid attributions belong to somebody who
-- has actually paid", which lands on exactly this pair of columns.
CREATE INDEX idx_billing_payments_user
  ON billing_payments (user_id, amount_usd_cents);
