-- Opt-in auto-subscribe (docs/decisions.md, D167): with it on, a Free
-- account that runs out of what it can spend is moved to the Build plan,
-- monthly, on the card saved for it. Once: having subscribed it, the
-- setting turns itself off, and a plan cancelled later is not started again.
--
-- One row per account that has ever set it. Absent and `enabled = 0` mean the
-- same thing: nothing is started without the account having asked. The
-- attempt in flight lives on the row itself, since there is at most one per
-- account and every write about it is then a single-row UPDATE.
CREATE TABLE billing_auto_subscribe (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- The card the subscription is started on, resolved from Stripe when it
  -- was turned on.
  payment_method_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  -- Why it turned itself off: 'subscribed' once it started the plan, else
  -- 'declined', 'authentication_required' or 'no_card'. NULL while on, and
  -- when the account turned it off.
  disabled_reason TEXT,
  -- One more on every save by the account (`attempt_version` below).
  version INTEGER NOT NULL DEFAULT 1,
  -- The attempt in flight, if any: a random id, also the Stripe idempotency
  -- key's suffix, claimed by one statement so two checks at once cannot
  -- both start a plan.
  attempt_id TEXT,
  attempt_claimed_at TEXT,
  -- The save the claim read its card from. An answer about an attempt turns
  -- the setting off only while it is still that save.
  attempt_version INTEGER,
  -- The last time a check sent, or was about to send, the attempt's request
  -- to Stripe. Until that is long enough ago that no such request can still
  -- be in flight, nothing gives the attempt up.
  attempt_dispatched_at TEXT,
  -- The subscription it started, once it has.
  stripe_subscription_id TEXT,
  updated_at TEXT NOT NULL
);
