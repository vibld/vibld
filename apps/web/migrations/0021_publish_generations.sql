-- Each publish writes its own R2 prefix, and a pointer says which one serves.
--
-- Until now a publish overwrote `published/<slug>/` in place, which made the
-- write itself the moment of change and left no way to be conditional about
-- it. Two consequences, and the second is why this is here rather than in a
-- later change.
--
-- There was no previous revision, so there was nothing to roll back to.
--
-- And an operator hold could be raced. `handlePublish` reads the state and
-- then writes the files, which are two round trips; a hold committing in
-- between found the request already writing over the bytes the hold exists
-- to keep. Narrowing that window was the best a check could do, because the
-- content lives in R2 and the flag lives in D1 and no write spans them.
-- Deciding *after* the bytes are written is what removes the race, and that
-- needs the bytes to land somewhere that is not yet serving.
--
-- So: files go to `published/<slug>/<generation>/`, and `published_projects.
-- generation` names the one the public gets. Promotion is a compare-and-set
-- on that column with `held_at IS NULL`, so a publish that lost the race
-- changes nothing a reader can see, and its objects are discarded.
--
-- NULL generation means nothing is published under this slug yet, which is
-- the state between claiming the name and the first successful publish.
ALTER TABLE published_projects ADD COLUMN generation TEXT;

-- What exists under a slug, newest last by `id`.
--
-- Ordered by insertion rather than by a timestamp on purpose. Retention has
-- to know which revisions are the newest, and two publishes in the same
-- millisecond, or a clock that steps, would make a timestamp answer that
-- wrongly. `created_at` is kept because it is the readable half, and it is
-- not what anything sorts on.
CREATE TABLE published_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  generation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_published_generations_slug_generation
  ON published_generations (slug, generation);
