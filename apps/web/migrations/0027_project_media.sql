-- Media a person uploads for their site: the images and video a generated
-- page references as /media/<name>.
--
-- Every storage path in this product was text until now. A project is a set
-- of `{path, content}` strings, its snapshots are JSON, and publishing reads
-- files back with `text()`. A hero video or a photograph cannot travel that
-- way, so media lives beside the project rather than inside it: the bytes
-- in R2 under media/<user_id>/<id>, and one row here saying what they are.
--
-- `path` is what the page uses, `media/<slug>.<ext>`, unique per account
-- because that is the namespace a page resolves /media/ in. It is derived
-- from the uploaded name by `mediaPathFor` (packages/core/src/media.ts),
-- never taken verbatim. `content_type` is decided from the file's own bytes
-- at upload (`sniffMedia`), not from anything the browser claimed, and it
-- is what every server of the file sends.
--
-- `git_sha` is the name git gives the bytes (sha1 of `blob <size>\0` and
-- the bytes), recorded at upload so a GitHub push preview can say whether
-- the repository already holds this file without reading it back from R2.
--
-- `poster_id` points a video at the still image shown before it plays and
-- in its place for anyone who asked their system to reduce motion. It is
-- cleared, not cascaded, when the poster is deleted: losing the poster does
-- not make the video unusable.
--
-- One account, one project, today (the project id is the Clerk user id), so
-- the rows are keyed by user. A second project per account would add a
-- project_id column; nothing here assumes there never will be one.
CREATE TABLE project_media (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  git_sha TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  poster_id TEXT,
  created_at TEXT NOT NULL,
  -- Also the index every per-account query uses: user_id leads it.
  UNIQUE (user_id, path)
);
