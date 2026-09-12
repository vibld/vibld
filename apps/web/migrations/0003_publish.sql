-- Cloudflare auto-publish, primary path (ADR-0010, docs/decisions.md L40).
--
-- The slug -> project mapping apps/publish's public fetch handler resolves
-- every request against. Lives in this database, not a new one: ADR-0010
-- deliberately reuses the control plane's existing D1 database and R2
-- bucket rather than provisioning parallel infrastructure for one more
-- fact. File content itself lives in R2 under `published/{slug}/...`
-- (publish-store.ts); this table only ever holds metadata.
--
-- A project's slug is fixed at first publish and never changes afterward
-- (ADR-0010's Consequences: "a slug is a durable, semi-public identifier").
-- `project_id` is UNIQUE for exactly that reason -- one project, one slug,
-- for its whole lifetime; a later publish looks this row up by
-- `project_id` and reuses `slug` rather than claiming a new one.
CREATE TABLE published_projects (
  slug TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_published_projects_user ON published_projects(user_id);
