-- What became of a pull request vibld opened (#13).
--
-- Until this, a pull request's link was reported once, by the push that
-- opened it, and never again. Merge it, close it, and vibld goes on offering
-- the same link as though it were still waiting for somebody: the one fact a
-- link is supposed to carry, whether there is anything left to do, was the
-- one fact this could not say.
--
-- Recorded against the push that opened it rather than in a table of its
-- own. A pull request here is not an independent object: it exists because a
-- checkpoint was pushed, and the row for that push is what a caller already
-- looks up.
ALTER TABLE github_pushes ADD COLUMN pull_request_number INTEGER;

-- `open`, `closed` or `merged`. Merged is deliberately its own value rather
-- than closed with a flag beside it: they are different news, and a person
-- reading "closed" about work that shipped would go looking for what went
-- wrong.
ALTER TABLE github_pushes ADD COLUMN pull_request_state TEXT;

-- When GitHub said so, by its own clock. Kept so a delivery that arrives out
-- of order cannot move a pull request backwards: webhook delivery is
-- at-least-once and unordered, and "closed" arriving after "merged" would
-- otherwise overwrite the better answer with the worse one.
ALTER TABLE github_pushes ADD COLUMN pull_request_updated_at TEXT;

-- A webhook branch is what connects a delivery to a push: a delivery knows
-- the repository and the head ref, and nothing about the user.
CREATE INDEX idx_github_pushes_branch ON github_pushes(owner, repo, branch);

-- GitHub redelivers. Its own documentation says a delivery may arrive more
-- than once, and a redelivery can be triggered by hand from the App's
-- settings page. This is the dedup the issue's "verified/deduplicated
-- webhooks" asks for, checked before anything is applied.
--
-- The delivery id rather than the event: one pull request produces many
-- events over its life, and keying on anything coarser would drop the
-- second real change as a duplicate of the first.
CREATE TABLE github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  received_at TEXT NOT NULL
);
