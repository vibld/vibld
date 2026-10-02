-- The style gallery style a project builds in (docs/decisions.md, D142,
-- D144): its stable `id` in packages/ai/data/style-gallery.json, or NULL for
-- none. A name is never stored, because names are display text and may
-- change between imports. An id the gallery no longer has reads as none.
ALTER TABLE projects ADD COLUMN style_gallery TEXT;
