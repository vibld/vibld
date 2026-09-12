-- Stripe billing mirror (docs/decisions.md L12-L14).
--
-- Card data and payment collection stay entirely on Stripe (L12, Checkout +
-- Billing Portal); this is only the copy of entitlement state the app
-- actually reads (L13) instead of calling Stripe on every request. Stripe
-- remains the source of truth: billing-handlers.ts's nightly
-- `reconcileSubscriptions` re-reads every row here from Stripe's own API and
-- corrects anything a missed or failed webhook delivery left behind.

-- The Clerk-user-id-to-Stripe-customer mapping Vibld owns (L14), rather than
-- Clerk Billing's. `client_reference_id` on Checkout Session creation and
-- this table are the same fact recorded twice, deliberately: this table is
-- durable and queryable without calling Stripe, and is what
-- billing-checkout.ts checks first so a returning customer's second
-- Checkout reuses their existing Stripe customer instead of creating a
-- second one for the same person.
CREATE TABLE billing_customers (
  user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE billing_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  -- 'build' | 'ship' -- derived from the subscribed price's Stripe
  -- lookup_key (stripe-client.ts's TIER_LOOKUP_KEYS), never trusted from
  -- caller input.
  tier TEXT NOT NULL,
  -- Stripe's own status string verbatim: active, trialing, past_due,
  -- canceled, unpaid, incomplete, incomplete_expired, paused.
  status TEXT NOT NULL,
  price_id TEXT NOT NULL,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_billing_subscriptions_user ON billing_subscriptions(user_id);

-- One row per completed top-up Checkout Session (L36's $20/$8, non-
-- recurring). The credit-ledger PR that spends these rows is separate work;
-- this table only needs to durably record that the purchase happened.
CREATE TABLE billing_topups (
  stripe_checkout_session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  credit_usd_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_billing_topups_user ON billing_topups(user_id);

-- Webhook delivery is at-least-once by Stripe's own design ("webhook
-- endpoints might occasionally receive the same event more than once" --
-- docs.stripe.com/webhooks#handle-duplicate-events). This is the dedup
-- table L30's "deduplicate delivery" requirement asks for, checked before
-- an event is applied.
CREATE TABLE billing_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
