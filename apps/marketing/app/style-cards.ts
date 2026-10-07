import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';

/**
 * The style gallery's cards on /templates (D162) are listed with their
 * names and facts, but their previews are drawn from files of this many,
 * fetched as a reader reaches them: inline, all 1,300+ made every page
 * that lists them megabytes.
 */
export const STYLE_CARD_CHUNK = 48;

/** The style gallery's entries, listed as a source of their own (D162). */
export const STYLE_BATCH = 'style-gallery';

/** The files, `/templates/style-cards/<n>.json`, one per chunk. */
export const STYLE_CARD_PATHS: string[] = Array.from(
  { length: Math.ceil(STYLE_GALLERY_INDEX.length / STYLE_CARD_CHUNK) },
  (_, n) => `/templates/style-cards/${n}.json`,
);
