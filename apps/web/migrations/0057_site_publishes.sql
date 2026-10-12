-- D219: every publish of a project's site, so its owner can put an
-- earlier one back. The checkpoint (`revision`) is what is published
-- again: its files are read back from the project's history and built,
-- as the first publish was. A revision the history no longer holds
-- (past MAX_CHECKPOINTS) is listed and cannot be published again.
-- Kept to the newest 50 per project by the publish that writes a row.
-- `generation` is the revision the publish service put up for it, so the
-- history says "Live now" only for the row that is still being served
-- (`published_projects.generation`); null when the service did not say.
CREATE TABLE site_publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  revision TEXT NOT NULL,
  published_at TEXT NOT NULL,
  generation TEXT
);

CREATE INDEX idx_site_publishes_project ON site_publishes(project_id, id);
