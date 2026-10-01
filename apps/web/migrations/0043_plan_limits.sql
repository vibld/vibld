-- Plan limits set from the admin panel (docs/decisions.md D134).
--
-- One row per plan an admin has changed; a plan with no row keeps the
-- limits in code (`ACTIVE_PROJECT_LIMIT`, `TIER_INCLUDED_MICRO_USD` and the
-- Free allowance in entitlement.ts). Deleting the row puts them back. A
-- per-account override (`user_overrides`, D73) still takes precedence over
-- either.
CREATE TABLE plan_limits (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'build', 'ship')),
  -- Active projects the plan allows at once. NULL is no limit.
  active_project_limit INTEGER CHECK (active_project_limit >= 0),
  monthly_allowance_micro_usd INTEGER NOT NULL
    CHECK (monthly_allowance_micro_usd >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
