-- Removing what a refunded or disputed payment bought (Chris, 2026-09-28).
--
-- Until this, a refund or a lost dispute took back a referral reward and
-- nothing else: the top-up credit, the plan and its allowance all stayed
-- with somebody whose money had gone back to them. The refund policy now
-- says the credit, allowance or plan a refunded or disputed payment bought is
-- removed automatically, and that a lost dispute lets vibld suspend the
-- account until it is resolved. This is the record of each of those.

-- Which subscription an invoice paid for, written by `invoice.paid`.
--
-- A refund names a charge, and a charge on a subscription invoice has to end
-- that subscription, not whichever one the account happens to hold now. The
-- invoice is the only object that says which, and it is not on the refund.
-- Null for rows written before this column existed and for top-ups; the
-- reversal path then asks Stripe for the invoice once rather than guessing.
ALTER TABLE billing_payments ADD COLUMN stripe_subscription_id TEXT;

-- One row per reversal applied: what was reversed, what was removed for it,
-- and what could not be.
--
-- The rows are the ledger, not a log beside one. Top-up credit is summed net
-- of `credit_removed_usd_cents` (`BillingStore.totalTopupCreditMicroUsd`), a
-- subscription named here stops counting as an allowance
-- (`findActiveSubscription`), and an account with an unlifted `suspends` row
-- is refused paid features (`spendable.ts`). So nothing else has to be kept
-- in step with this table, and an operator reading it sees exactly what was
-- done.
CREATE TABLE billing_clawbacks (
  -- Deterministic, which is the whole of the idempotency. A refund is keyed
  -- on the charge and Stripe's cumulative refunded amount, so a redelivery,
  -- a replay and a parked retry of the same refund are one row, and a second
  -- partial refund on the same charge is a second row. A dispute is keyed on
  -- the dispute id.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'refund' | 'dispute'. Only a lost dispute is ever recorded.
  cause TEXT NOT NULL,
  -- The event that caused it, so an operator can find it in Stripe.
  stripe_event_id TEXT,
  stripe_charge_id TEXT NOT NULL,
  -- The `billing_payments` key the charge was tied to: the Checkout Session
  -- of a top-up, or the Invoice of a subscription payment.
  stripe_object_id TEXT NOT NULL,
  -- 'topup' | 'subscription'.
  kind TEXT NOT NULL,
  -- The charge's own amount, and the money this event says went back: the
  -- cumulative `amount_refunded` for a refund, the dispute's amount for a
  -- dispute. Both in USD cents, as Stripe states them.
  charge_usd_cents INTEGER NOT NULL,
  reversed_usd_cents INTEGER NOT NULL,
  -- For a top-up: the credit this row took away, and the part of what was
  -- owed that could not be taken because the balance was already spent. The
  -- shortfall is recorded rather than collected: nobody is shown a debt.
  credit_removed_usd_cents INTEGER NOT NULL DEFAULT 0,
  credit_shortfall_usd_cents INTEGER NOT NULL DEFAULT 0,
  -- When the top-up that granted the credit was bought. The removal expires
  -- with the credit it removed (the same 12-month window), so an old
  -- reversal can never eat into credit bought later.
  credit_granted_at TEXT,
  -- For a subscription payment: the subscription whose paid access ended.
  stripe_subscription_id TEXT,
  -- 1 for a lost dispute: the account is refused paid features until an
  -- operator lifts it. Lifting stamps these two columns rather than deleting
  -- the row, so the record of the dispute stays.
  suspends INTEGER NOT NULL DEFAULT 0,
  lifted_at TEXT,
  lifted_by_email TEXT,
  created_at TEXT NOT NULL
);

-- The admin panel's history for one account, and the suspension check every
-- paid request makes.
CREATE INDEX idx_billing_clawbacks_user
  ON billing_clawbacks (user_id, created_at);

-- Every earlier reversal of the same charge, which is what decides how much
-- of a second partial refund is still owed.
CREATE INDEX idx_billing_clawbacks_charge
  ON billing_clawbacks (stripe_charge_id);

-- The allowance check: is this subscription one a reversal ended?
CREATE INDEX idx_billing_clawbacks_subscription
  ON billing_clawbacks (stripe_subscription_id);
