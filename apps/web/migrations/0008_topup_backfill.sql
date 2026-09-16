-- When the top-up recovery last looked at this customer.
--
-- `backfillTopupPayments` repairs what a migration cannot: a top-up leaves
-- no local record of money taken (`billing_topups` records the credit
-- granted, and a coupon-covered Checkout writes one having been charged
-- nothing), so the amount has to be read back from Stripe per customer.
--
-- This started as a one-time backfill with a "done" stamp, and that was the
-- wrong shape twice over. A customer is mapped when Checkout *begins*, so
-- the first pass can see a session that has not settled yet and mark the
-- customer permanently finished; when it settles, nothing looks again. And
-- a top-up taken after the stamp has no recovery at all, which is the
-- gap the mechanism exists to close, reopened one night later.
--
-- So there is no finished state. The pass rotates: least recently looked at
-- first, a bounded number per night, for ever. Nobody is permanently
-- excluded, the nightly cost is capped rather than growing, and a customer
-- who already has a recorded payment is skipped without a Stripe call at
-- all, so the rotation covers only accounts that could still need one.
--
-- Stamped before the read rather than after, deliberately: a customer whose
-- read throws is exactly the one that must go to the back of the queue, and
-- stamping afterwards would keep it at the front for ever, holding a slot
-- under the limit so later customers are never reached. The same reason
-- `referral_attributions` stamps `last_attempt_at` before it tries.
ALTER TABLE billing_customers ADD COLUMN topups_checked_at TEXT;

-- The rotation asks for "least recently checked first". This is the column
-- that answers it.
CREATE INDEX idx_billing_customers_topup_check
  ON billing_customers (topups_checked_at);
