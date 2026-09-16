-- A completion marker for the one-time top-up backfill.
--
-- `backfillTopupPayments` repairs what a migration cannot: a top-up taken
-- before `billing_payments` existed leaves no local record of money taken,
-- so the amount has to be read back from Stripe per customer.
--
-- Without a marker that is a repair with no end. Every night it re-read
-- every customer's entire Checkout history, which grows without bound, and
-- offered every already-paid customer to the referral payout again. The
-- D1 writes were no-ops on conflict, but the Stripe calls and the payout
-- calls were not, and past some number of customers a single scheduled run
-- cannot finish the set at all -- so the accounts at the end of it would
-- stay unreconciled for ever, which is the failure the backfill exists to
-- prevent.
--
-- Stamped only after a customer's history has been read through to the end,
-- so a customer whose read failed is retried rather than silently skipped.
-- The nightly cost falls to nothing once the set is covered: a new top-up
-- after that arrives by webhook and needs no backfill.
ALTER TABLE billing_customers ADD COLUMN topups_backfilled_at TEXT;

-- The backfill asks for "customers not yet done", oldest first, under a
-- limit. This is the column that answers it.
CREATE INDEX idx_billing_customers_backfill
  ON billing_customers (topups_backfilled_at, created_at);
