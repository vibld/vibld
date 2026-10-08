/**
 * Chris's clean-room layers (docs/decisions.md, D101), shown on /templates
 * beside the design catalog.
 *
 * A layer is one prompt that directs an AI to produce one self-contained HTML
 * file, and the reference output of that prompt. Both are copied unchanged
 * from Drummond-IT/designs-v1 (`layers/`, at `DESIGNS_V1_COMMIT`) into
 * `public/layers/<slug>/`, apart from one em-dash in Nocturne's `<title>`,
 * which the house rule bans and which became a colon. The reference page is
 * served as it is at `/layers/<slug>` (the Worker keeps it out of search
 * indexes: it is a demonstration of a made-up product, not a page about
 * vibld), and its prompt is shown on `/templates/<slug>`.
 *
 * The other three layers in that folder (aurora-mesh, grain-blobs and
 * particle-galaxy) and Nocturne's ribbons are the starting point of the four
 * animated backgrounds (packages/ai/src/backdrops.ts), which /styles runs
 * live. They are not listed here, since vibld ships its own versions of them.
 */

export const DESIGNS_V1_COMMIT = '595b234de9d86ebf8d0fd33ebaaeac7d77c529ac';

export interface Layer {
  slug: string;
  name: string;
  /** A whole page, or a section that drops into one. */
  kind: 'page' | 'section';
  /** One sentence, for the card and the page's description. */
  summary: string;
  /** What it is built with, from the prompt's own frontmatter. */
  stack: string;
  /** The reference output, served as it is. */
  livePath: string;
  /** The prompt, served as it is, and read at build time for the page. */
  promptPath: string;
  /** Under public/, 1440 by 900, of the reference output. */
  screenshot: string;
}

const layer = (
  slug: string,
  fields: Omit<Layer, 'slug' | 'livePath' | 'promptPath' | 'screenshot'>,
): Layer => ({
  slug,
  ...fields,
  livePath: `/layers/${slug}`,
  promptPath: `/layers/${slug}/prompt.md`,
  screenshot: `/layers/${slug}/screenshot.webp`,
});

export const LAYERS: readonly Layer[] = [
  layer('nocturne', {
    name: 'Nocturne',
    kind: 'page',
    summary:
      'A dark landing page for a made-up observability product for AI agents, with oscilloscope ribbons of light behind the hero and everything arriving on springs.',
    stack: 'One HTML file: a WebGL hero and spring-driven reveals',
  }),
  layer('stacked-cards', {
    name: 'Stacked cards',
    kind: 'section',
    summary:
      'A four-step process section in which each color card pins as you scroll and the next slides over it, like sheets of paper.',
    stack: 'One HTML file: CSS sticky positioning and springs',
  }),
];
