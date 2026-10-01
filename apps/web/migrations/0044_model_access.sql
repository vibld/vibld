-- Model access set from the admin panel (docs/decisions.md D133, D135,
-- D136).
--
-- plan_models holds the models each plan includes, saved as a whole: all
-- three rows or none. With no rows, `VIBLD_MODEL_POLICY` and the plan rule
-- in code (D66, `TIER_MODELS` in model-access.ts) decide, as they did
-- before the panel. A deployment that sells no plans uses the Free row
-- (D135).
--
-- user_models holds the extra models an admin granted one account, on top
-- of its plan's (D136). Deleted with the account.
--
-- Both keep model ids as a JSON array. A model these name that the
-- deployment has no key for is not offered; it is not an error.
CREATE TABLE plan_models (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'build', 'ship')),
  models TEXT NOT NULL CHECK (json_valid(models) AND json_type(models) = 'array'),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE user_models (
  user_id TEXT PRIMARY KEY,
  models TEXT NOT NULL CHECK (json_valid(models) AND json_type(models) = 'array'),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
