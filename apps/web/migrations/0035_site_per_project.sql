-- One published site per project (docs/decisions.md, "Resolved 2026-09-28",
-- publishing).
--
-- There is nothing to change in `published_projects` itself, and that is
-- the point worth writing down. The publish service has always keyed a
-- site by `project_id` (UNIQUE since 0003_publish.sql: one project, one
-- slug, for its whole life). What made it one site per account was
-- apps/web passing the caller's user id as that project id. Every site
-- published so far therefore has `project_id = user_id`, and 0033 gave
-- every account a project whose id is its user id. So each existing site
-- already belongs, by its key, to the project the backfill made for its
-- account, and apps/web now passing the real project id is all it takes
-- for that project to find its site, at the same slug, still serving.
--
-- What this does add is the one case that key does not cover: a site
-- whose project has no row. 0033 made projects from `generation_projects`,
-- and a site's owner may have none there (a deployment that published
-- before it built through the Worker), or may have deleted that project
-- after 0033 shipped and before this did, when deleting a project did not
-- touch the site. Such a site is serving, and the builder's publish
-- controls are per project now, so without a project to open its owner has
-- no control that reaches it. A project row puts one back: it opens empty,
-- with the site's controls, and deleting it takes the site down.
--
-- Only rows keyed the old way (`project_id = user_id`). A row the account
-- purge re-keyed to its tombstone (`project_id = '<tombstone>:<slug>'`)
-- belongs to nobody, deliberately, and must not grow a project.
--
-- Outside the free tier's limit, as 0033's backfill was: it is somebody's
-- existing site, not a new project they asked for.
INSERT INTO projects (id, user_id, name, created_at, updated_at, last_opened_at)
SELECT s.project_id, s.user_id, 'Untitled project', s.created_at,
       s.updated_at, s.updated_at
  FROM published_projects AS s
 WHERE s.project_id = s.user_id
   AND NOT EXISTS (SELECT 1 FROM projects AS p WHERE p.id = s.project_id)
ON CONFLICT(id) DO NOTHING;
