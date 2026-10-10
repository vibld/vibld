-- Builds started from an assistant through `/mcp` (docs/decisions.md D182):
-- which account, which OAuth client the person authorized, and when. What
-- the per-account daily cap on such builds counts, and how an operator can
-- tell an assistant's builds from the builder's. The run itself is
-- `generation_stages`'s, as every build's is; this adds only where it came
-- from.
CREATE TABLE mcp_builds (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL
);

CREATE INDEX mcp_builds_user_started ON mcp_builds (user_id, started_at);
