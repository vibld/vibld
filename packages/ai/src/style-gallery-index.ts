/**
 * Every style in the style gallery by name, and no more (D143): its id,
 * name, theme, group and category. For code that runs on every page and
 * must not carry the gallery itself (`data/style-gallery.json` is several
 * megabytes). Generated beside it by `bin/import-style-gallery.ts`.
 */
import index from '../data/style-gallery-index.ts';
import type { StyleGalleryName } from './style-gallery.ts';

export type { StyleGalleryName } from './style-gallery.ts';

export const STYLE_GALLERY_INDEX: readonly StyleGalleryName[] =
  index as unknown as StyleGalleryName[];
