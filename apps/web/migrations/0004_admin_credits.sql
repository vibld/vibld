-- Manually-granted spend credit: a platform admin (docs/decisions.md L4)
-- giving a specific user extra credit outside the Stripe top-up purchase
-- flow (support, goodwill, testing).
--
-- A separate table from `billing_topups`, not a new kind of row in it, on
-- purpose: every row in `billing_topups` came from a real Stripe Checkout
-- Session, which is exactly what `billing-handlers.ts`'s nightly
-- `reconcileSubscriptions` and the whole "Stripe remains the source of
-- truth" comment on that table assume. An admin grant has no Stripe
-- session behind it at all -- keeping it in its own table means nothing
-- downstream of `billing_topups` has to learn to tell the two apart, and
-- this table carries its own audit trail (who granted it, and why) that a
-- Stripe-mirrored row has no need for.
CREATE TABLE billing_admin_credits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credit_usd_cents INTEGER NOT NULL,
  -- The admin's own Clerk-verified email (`principal.policyIdentity`), the
  -- same identity `VIBLD_PLATFORM_ADMINS` is checked against -- never a
  -- free-text "granted by" field a caller could put anything in.
  granted_by_email TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_billing_admin_credits_user ON billing_admin_credits(user_id);
