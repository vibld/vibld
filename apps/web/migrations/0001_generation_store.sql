-- The control plane's generation state (docs/decisions.md L24/L25).
--
-- File content itself lives in R2 (generation-store.ts writes it at
-- `projects/{id}/snapshots/{revision}.json`, content-addressed by revision);
-- these two tables hold only the metadata needed to find it and the pointer
-- that decides which revision is the accepted one.
--
-- Deliberately absent: an `owner_id` column. Nothing in this repository can
-- populate one honestly yet -- there is no authentication. Ownership is a
-- separate concern layered on top once Clerk exists (docs/decisions.md L1),
-- not something this migration should invent a shape for today.

CREATE TABLE generation_projects (
  id TEXT PRIMARY KEY,
  -- NULL until the first successful promotion.
  accepted_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE generation_stages (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  base_revision TEXT,
  state TEXT NOT NULL,
  -- NULL until the run has produced a snapshot (state 'planning' has none yet).
  snapshot_revision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_generation_stages_project ON generation_stages(project_id);
