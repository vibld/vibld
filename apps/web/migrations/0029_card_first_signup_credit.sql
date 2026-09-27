-- The welcome credit, granted once a card is on file rather than on account
-- creation (Chris, 2026-09-27: an open paid beta, card first).
--
-- The grant itself is still a row in `billing_admin_credits` under the same
-- deterministic id, `signup:<user id>`, that the on-creation grant used. That
-- is what keeps every account that already received its dollar exactly where
-- it is, and what stops one of them receiving a second: the id is taken
-- already, whichever way it was granted. Nothing here backfills or rewrites
-- those rows.
--
-- Two tables, because two separate questions have to be answered on two
-- separate paths and neither path can ask the other.

-- An account the offer is open to.
--
-- Written on an authenticated request, once Clerk has said the account was
-- created inside the cohort (`VIBLD_SIGNUP_CREDIT_FROM`). The webhook that
-- grants the credit runs as Stripe, with no session and no Clerk answer to
-- hand, so this row is how it knows the account is new without asking Clerk
-- itself. It also stops the status route asking Clerk the same question on
-- every request while the account has not yet added a card, which is the
-- same reason the zero-cent "not in the cohort" marker exists.
--
-- The amount is fixed when the offer opens, so changing
-- VIBLD_SIGNUP_CREDIT_USD_CENTS later changes what new offers are worth and
-- not what an account was already shown.
CREATE TABLE billing_signup_offers (
  user_id TEXT PRIMARY KEY,
  credit_usd_cents INTEGER NOT NULL,
  opened_at TEXT NOT NULL
);

-- Every card saved to claim the offer, and what came of it.
--
-- Keyed on the SetupIntent, because that is the one id every Stripe event
-- about the same saved card carries: `checkout.session.completed` in setup
-- mode names it, and `setup_intent.succeeded` is it. Both are handled and
-- both land here, so a redelivery of either, or one of each, is a no-op on
-- the primary key rather than a second grant.
--
-- `card_fingerprint` is Stripe's own identifier for the card number, the same
-- across customers and accounts. It is what stops one card claiming the
-- credit on many accounts, which an account id alone cannot see.
--
-- `outcome` is one of:
--   granted          this card paid this account its credit
--   card-used        the card had already paid another account
--   account-granted  the account already had its credit, by any route
--   no-offer         the account was never offered it
--
-- Refusals are kept rather than dropped. The builder reads the latest one to
-- tell somebody why adding a card did not give them anything, and an
-- operator reads them to see farming attempts.
CREATE TABLE billing_signup_cards (
  stripe_setup_intent_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Once per card and once per account, enforced by the database rather than
-- by a read before the write. Two deliveries racing, or two accounts saving
-- the same card at the same moment, cannot both pass a check that the
-- other has not written yet; a unique index is not a check.
--
-- Partial, so that refusals, which repeat both columns freely, do not
-- collide with the one row per card and per account that counts.
CREATE UNIQUE INDEX idx_billing_signup_cards_one_per_card
  ON billing_signup_cards(card_fingerprint) WHERE outcome = 'granted';

CREATE UNIQUE INDEX idx_billing_signup_cards_one_per_account
  ON billing_signup_cards(user_id) WHERE outcome = 'granted';

CREATE INDEX idx_billing_signup_cards_user
  ON billing_signup_cards(user_id, created_at);
