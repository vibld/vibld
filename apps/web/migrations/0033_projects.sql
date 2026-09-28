-- Projects: more than one per account, each with an owner, a name and a
-- memory (docs/decisions.md, "Resolved 2026-09-28", projects).
--
-- Until now an account had exactly one project, and its id was the Clerk
-- user id (`handlePlan` set `projectId = principal.userId`). That made the
-- owner implicit and the question "which project" unaskable, and the
-- builder kept everything else in memory: a reload lost the conversation,
-- the style, the model and the reference page, and restored nothing, even
-- though the code itself was sitting in R2 the whole time.
--
-- **A table of its own rather than columns on `generation_projects`.**
-- That table is the generation store's compare-and-set pointer and nothing
-- else (0001's own comment): `D1GenerationStore.saveStage` creates its row
-- lazily, with `INSERT ... ON CONFLICT DO NOTHING`, from inside a Workflow
-- that knows a project id and nothing about who owns it. An owner column
-- there would either be nullable, which makes every ownership check a
-- question of whether the row was made by the store or by a person, or
-- NOT NULL, which breaks the store's insert. Ownership has to exist before
-- any run can be checked against it, so it belongs in a row the projects
-- routes create, and the two tables share the id one-to-one. The store is
-- left exactly as it was, and so is every revision it keeps: nothing here
-- deletes a snapshot, and version history can read them later.
--
-- **The transcript is in R2, and this row points at it.** A conversation is
-- the one part of a project that grows without a natural bound (every turn
-- is a prompt, an answer and a summary), and D1 is the wrong home for a
-- value of hundreds of kilobytes. It lives at `projects/{id}/transcript.json`,
-- under the same prefix as the project's snapshots, so the one prefix
-- deletion that removes a project's code (`account-deletion.ts`'s
-- `deletePrefix`) removes its conversation with it, and no second place
-- has to be remembered by the purge. `transcript_key` is NULL until the
-- first save, which is how "never saved" differs from "saved empty".
--
-- **The settings are columns, not a blob.** Each is one value the builder
-- restores and the Worker validates with the parser it already uses for the
-- same field on `/api/plan` (`request-guard.ts`), and a column is something
-- the next person can read in the console without decoding anything.
-- `style_dna` is the one JSON value, because it is a closed-set selection
-- of up to nine dimensions and has never been anything but an object.
--
-- Deliberately absent: anything for sharing. An unlisted view link and
-- "copy into my account" (decided separately, and built separately) need a
-- token column or a table of grants beside this one, and a copy into
-- another account is `duplicate` with a different owner. Nothing here
-- assumes a project is only ever read by the account that made it; every
-- read of one today simply asks for that account.
CREATE TABLE projects (
  -- A random UUID for every project made from now on. The backfilled ones
  -- below keep the id they already had, the owner's Clerk user id, because
  -- that is the id their snapshots are stored under.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Set when the owner hides a project without deleting it. An archived
  -- project does not count against the free tier's limit on active ones,
  -- and cannot be built in until it is unarchived (`resolveRunProject`).
  archived_at TEXT,
  created_at TEXT NOT NULL,
  -- The last change to the project's own row: a rename, an archive, a save
  -- of its settings or conversation. A build moves `generation_projects.
  -- updated_at` instead, and the list reads the later of the two.
  updated_at TEXT NOT NULL,
  -- What "open the most recent project" sorts by, and what a request from
  -- an older builder that names no project falls back to.
  last_opened_at TEXT NOT NULL,
  -- The project's settings. NULL is "not chosen", which the builder reads
  -- as the preset-free, no-reference default and, for the model and the
  -- standing preferences, as "use what this browser last chose".
  style_preset TEXT,
  reference_url TEXT,
  model TEXT,
  knowledge TEXT,
  style_dna TEXT,
  transcript_key TEXT,
  -- How many turns the saved transcript holds, so the list can say whether
  -- a project has a conversation without reading R2 once per row.
  transcript_turns INTEGER NOT NULL DEFAULT 0
);

-- The list, and "the most recently opened", are both one account's rows in
-- order of opening: user_id leads so neither ever scans another account.
CREATE INDEX idx_projects_user_opened
  ON projects (user_id, last_opened_at DESC);

-- The free tier's limit counts one account's active projects on every
-- create, duplicate and unarchive.
CREATE INDEX idx_projects_user_archived ON projects (user_id, archived_at);

-- The backfill: each account's one project becomes its first project.
--
-- Every row in `generation_projects` was made by `handlePlan` with the
-- caller's user id as its id, so the id is also the owner, and it keeps
-- that id so that its snapshots at `projects/{user_id}/snapshots/...` are
-- still found. This is the row that gives back what somebody built before
-- projects existed: open the builder, and it opens this.
--
-- The dates are the project's own, so it sorts by when it was really last
-- worked on rather than by when this migration ran. `ON CONFLICT` keeps
-- the statement safe to run against a database that somehow already has
-- the row, which a fresh one never does.
INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
SELECT id, id, 'Untitled project', created_at, updated_at, updated_at
  FROM generation_projects
 WHERE true
ON CONFLICT(id) DO NOTHING;
