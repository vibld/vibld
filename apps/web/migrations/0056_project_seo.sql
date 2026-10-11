-- What search engines and link previews are told about a published site,
-- set by its owner (docs/decisions.md D194, D202).
--
-- On the project rather than on `published_projects`, so the owner can set
-- them before the first publish and they survive a takedown and a publish
-- again. apps/publish reads them at serve time (`resolveSlug`), so a change
-- shows on the live site at once, with no publish.
--
-- NULL is "not set": the site's own `<title>`, description and preview
-- image stand. `seo_image` is an https URL or a path on the site.
-- `seo_noindex` is the owner's opt-out (D202: indexable by default).
ALTER TABLE projects ADD COLUMN seo_title TEXT;
ALTER TABLE projects ADD COLUMN seo_description TEXT;
ALTER TABLE projects ADD COLUMN seo_image TEXT;
ALTER TABLE projects ADD COLUMN seo_noindex INTEGER NOT NULL DEFAULT 0;
