-- A person's color edits to the project's style gallery style (docs/
-- decisions.md, D147): a JSON object of color tokens to 6-digit hexes, each
-- checked against the style's contrast pairs before it was saved and again
-- before a build uses it. NULL for none.
ALTER TABLE projects ADD COLUMN style_gallery_colors TEXT;
