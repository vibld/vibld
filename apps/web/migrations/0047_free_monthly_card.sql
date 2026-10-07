-- The Free plan's monthly allowance waits for a card on file (docs/
-- decisions.md, D159): an account whose card was first saved by another
-- account is still on the trial. `BillingStore.freeCardOf` asks, for each of
-- an account's saved cards, whether another account saved that card first,
-- and this index is what it looks that up by.
CREATE INDEX idx_billing_signup_cards_fingerprint
  ON billing_signup_cards(card_fingerprint, created_at);
