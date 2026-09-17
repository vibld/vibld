-- Cancellations this deployment scheduled, and reversals tied to the payment
-- that funded them.
--
-- Two things Stripe cannot tell us and the mirror cannot either.
--
-- `billing_scheduled_cancellations` is provenance. `cancel_at_period_end` is
-- the same boolean whether an admin's revoke set it or the subscriber set it
-- in the Billing Portal, so reading the mirror could not establish who did
-- it, and restoring access cleared a paying customer's own cancellation and
-- let Stripe charge them again. A row here means this deployment scheduled
-- that cancellation and may therefore undo it. No row means hands off.
--
-- `funded_by` on an attribution is the other. The reward was earned by one
-- payment, and the reversal path knew only the account, so refunding a later
-- unrelated top-up took back a reward the original purchase still funds.
CREATE TABLE billing_scheduled_cancellations (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  scheduled_at           TEXT NOT NULL,
  -- Stripe's own `canceled_at` for the cancellation this row records.
  --
  -- The row has to identify one cancellation, not merely assert that this
  -- deployment scheduled something once. A row left behind by a clean-up
  -- that failed would otherwise authorise clearing whatever cancellation
  -- the subscription carries later, including one the subscriber made for
  -- themselves, which is exactly the harm the table exists to prevent.
  --
  -- Null for a row written before this column existed, and for a Stripe
  -- response that carried no timestamp. Restoring refuses on a null rather
  -- than treating it as a match: unidentifiable is not proof of ownership.
  canceled_at            TEXT
);

CREATE INDEX billing_scheduled_cancellations_user
  ON billing_scheduled_cancellations (user_id);

-- Every Stripe id the payment that earned this referral can be recognised
-- by, space separated. Several because a charge names itself differently
-- depending on how it was made: a subscription charge carries its invoice, a
-- Checkout carries its payment intent, and the refund event names the charge.
-- Matching on any one of them is what ties a refund back to the reward.
--
-- Null for rows paid before this existed, which the reversal path treats as
-- "cannot prove this refund is the one that funded it" and therefore does
-- not reverse on.
ALTER TABLE referral_attributions ADD COLUMN funded_by TEXT;
