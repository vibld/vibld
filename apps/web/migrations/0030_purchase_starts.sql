-- "This account has started paying for something", as a fact of its own.
--
-- The referral barrier (worker/purchase-barrier.ts) used to read a row in
-- `billing_customers` as a started purchase, because until the card-first
-- welcome credit the only thing that created a Stripe customer was a plan or
-- top-up Checkout. Saving a card for the welcome credit creates one too, and
-- sells nothing, so every account that took its dollar could never claim a
-- referral afterwards. The customer mapping still means what it always did
-- (who this user is in Stripe); this table is what the barrier reads instead.
--
-- One row per account, written when a plan or top-up Checkout Session is
-- created and before its URL is returned (billing-checkout.ts), so no charge
-- can precede it. Never written by the card-setup session. Never deleted by
-- anything that abandons or expires a checkout: "started, then abandoned"
-- still counts, which is the conservative direction purchase-barrier.ts
-- already documents.
CREATE TABLE billing_purchase_starts (
  user_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);

-- Every account that already has a customer is carried over as started.
--
-- A customer row created before this migration cannot be told apart: it may
-- be a plan or top-up checkout that was abandoned, which the barrier has
-- always counted, or only a saved card. Counting all of them keeps every
-- existing account exactly as blocked or unblocked as it was the moment
-- before this ran, so the fix applies to cards saved from here on and never
-- opens the barrier for somebody who had begun a purchase.
INSERT INTO billing_purchase_starts (user_id, started_at)
  SELECT user_id, created_at FROM billing_customers;
