-- Top-ups paid by a delayed method (a bank debit) that have completed but
-- not settled (docs/decisions.md, D167): Checkout completes them `unpaid`,
-- and the credit is written only when the payment arrives
-- (`checkout.session.async_payment_succeeded`). Auto-subscribe waits while
-- one is here and not yet credited in `billing_topups`, however long the
-- bank takes, so it never starts a plan beside a top-up still on its way.
-- A failed payment removes its row.
CREATE TABLE billing_unsettled_topups (
  stripe_checkout_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX billing_unsettled_topups_user
  ON billing_unsettled_topups (user_id);
