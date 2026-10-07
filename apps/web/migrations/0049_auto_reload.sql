-- Opt-in auto-reload (docs/decisions.md, D166): with it on, the saved card
-- is charged for the $10 top-up when what an account can still spend drops
-- below $1, never more than the monthly cap the account chose.
--
-- One row per account that has ever set it. Absent and `enabled = 0` mean the
-- same thing: nothing is charged without the account having asked.
CREATE TABLE billing_auto_reload (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- A whole number of top-ups: $10 to $100.
  monthly_cap_usd_cents INTEGER NOT NULL DEFAULT 3000
    CHECK (monthly_cap_usd_cents BETWEEN 1000 AND 10000
           AND monthly_cap_usd_cents % 1000 = 0),
  -- The card charged, resolved from Stripe when it was turned on, so a
  -- charge never has to guess which of an account's cards was meant.
  payment_method_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  -- Why it turned itself off: 'declined', 'authentication_required' or
  -- 'no_card'. NULL while on, and when the account turned it off.
  disabled_reason TEXT,
  -- One more on every save by the account, so a claim can say exactly which
  -- save its card came from (`settings_version` below).
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Every automatic charge this deployment started. The claim that inserts a
-- row is the only way a charge starts, and the two constraints below are what
-- keep two runs settling at once from both charging.
CREATE TABLE billing_auto_reload_attempts (
  -- A random id, also the Stripe idempotency key's suffix. Not built from
  -- the user id, so re-keying a purged account's rows leaves none behind.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- The UTC month (`monthKey`) the attempt was claimed in, which numbers it.
  period TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed')),
  -- The UTC month Stripe made the charge in, set when it succeeds, which the
  -- cap counts within. Not always `period`: a charge claimed just before
  -- midnight on the last of the month and asked about again after it is
  -- made, and counted, in the new month.
  charged_period TEXT,
  -- The card and the amount the claim was made for, read in the claim's own
  -- statement. Every request about this attempt sends these, so a setting
  -- saved again in the meantime never changes the card charged, and asking
  -- again with the same idempotency key sends the same request.
  payment_method_id TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  -- The setting's `version` the claim read its card from. A failure turns
  -- auto-reload off only while the setting is still that one, so a decline
  -- about a card saved over in the meantime leaves the new one on.
  settings_version INTEGER NOT NULL,
  payment_intent_id TEXT,
  failure_code TEXT,
  -- The last time a check sent, or was about to send, this attempt's
  -- request to Stripe. Until that is long enough ago that no such request
  -- can still be in flight, nothing ends the attempt without its charge:
  -- one ended early would free the next claim while a charge under this
  -- one's key could still be made.
  dispatched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, period, seq)
);

-- At most one charge in flight per account.
CREATE UNIQUE INDEX idx_billing_auto_reload_one_pending
  ON billing_auto_reload_attempts (user_id) WHERE state = 'pending';
