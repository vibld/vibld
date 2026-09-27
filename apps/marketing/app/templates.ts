import { SITE } from './site.ts';

/**
 * The starter templates shown on /examples, after the generated examples
 * and apart from them (Chris, 2026-09-27: Luminous is "both a starter
 * template and shown on /examples, marked as a template").
 *
 * A separate list from `examples/catalogue.json` on purpose. Every entry
 * there is vibld's output from the prompt beside it, with no hand edits, and
 * its tests hold each one to the eval case it came from. These are the
 * opposite: code people wrote by hand under `templates/`, for the builder to
 * start from. Putting them in that catalogue would make its one promise
 * false.
 *
 * The screenshots are of each template's own built output. The licence is
 * stated as the fact its LICENSE file records, nothing more.
 */

export interface Template {
  slug: string;
  name: string;
  /** The made-up business the template's copy is written for. */
  subject: string;
  description: string;
  /** Under public/, 1440 by 900. */
  screenshot: string;
  source: string;
  licence: 'MIT';
}

export const TEMPLATES: Template[] = [
  {
    slug: 'luminous',
    name: 'Luminous',
    subject: 'Emberline, a made-up customer-feedback product',
    description:
      'A marketing site for a software product: a gradient hero, an interactive sample of the product, and sections for features, pricing, an FAQ and contact.',
    screenshot: '/examples/templates/luminous.webp',
    source: `${SITE.repoUrl}/tree/main/templates/luminous`,
    licence: 'MIT',
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    subject: 'Northwind Supply, a made-up parts supplier',
    description:
      'The plain starter: a prerendered React Router site with a page per route, a contact form that says it is a demonstration, and nothing else to take out.',
    screenshot: '/examples/templates/marketing.webp',
    source: `${SITE.repoUrl}/tree/main/templates/marketing`,
    licence: 'MIT',
  },
];
