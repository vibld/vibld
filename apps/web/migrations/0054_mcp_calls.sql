-- The editing tools' calls through `/mcp` (docs/decisions.md D190): which
-- account, which OAuth client the person authorized, which tool, which
-- project, and when. What the per-plan daily cap on them counts (D201);
-- only the last 24 hours are kept (`McpCallStore`).
CREATE TABLE mcp_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  project_id TEXT NOT NULL,
  called_at TEXT NOT NULL
);

CREATE INDEX mcp_calls_user_called ON mcp_calls (user_id, called_at);

-- A plan's daily cap on those calls, as an admin set it (D134). NULL keeps
-- the cap in code (`MCP_DAILY_EDIT_CALLS` in entitlement.ts), so a plan an
-- admin changed before this column existed follows the code until its cap
-- is set too.
ALTER TABLE plan_limits ADD COLUMN mcp_daily_edit_calls INTEGER
  CHECK (mcp_daily_edit_calls >= 0);
