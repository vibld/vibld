import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Example } from '../app/examples.ts';
import { galleryRows } from '../app/gallery.ts';

/**
 * The sample gallery on /examples (internal issue 186, D153): gallery entries are grouped
 * into one row per site type, named by the style they were built in, and
 * kept out of the list of examples above them.
 */

const entry = (over: Partial<Example>): Example => ({
  slug: 'one',
  case: 'coffee-roaster',
  title: 'An indie coffee roaster',
  kind: 'site',
  model: 'deepseek-v4-pro',
  run: 1,
  generatedOn: '2026-10-03',
  prompt: 'A marketing site',
  notes: [],
  modelLabel: 'DeepSeek V4 Pro',
  liveUrl: 'https://example.invalid/',
  sourceZip: '/examples/one.zip',
  screenshot: '/examples/one.webp',
  ...over,
});

const cell = (siteType: string, style: string, title: string) =>
  entry({
    slug: `gallery-${siteType}-${style.toLowerCase()}`,
    case: `gallery-${siteType}-${style.toLowerCase()}`,
    title,
    prompt: `A ${siteType} brief`,
    gallery: { siteType, style: style as never },
  });

describe('the sample gallery', () => {
  it('groups cells by site type in the order they are listed', () => {
    const rows = galleryRows([
      entry({}),
      cell('shop', 'minimalist', 'A shop'),
      cell('docs', 'minimalist', 'A docs site'),
      cell('shop', 'brutalism', 'A shop'),
    ]);
    assert.deepEqual(
      rows.map((row) => [
        row.siteType,
        row.title,
        row.prompt,
        row.cells.map((c) => c.styleName),
      ]),
      [
        ['shop', 'A shop', 'A shop brief', ['Minimalist', 'Brutalism']],
        ['docs', 'A docs site', 'A docs brief', ['Minimalist']],
      ],
    );
  });

  it('leaves the examples above it out', () => {
    assert.deepEqual(galleryRows([entry({})]), []);
  });

  it('refuses a style the presets do not know', () => {
    assert.throws(
      () => galleryRows([cell('shop', 'nonesuch', 'A shop')]),
      /unknown style nonesuch/,
    );
  });
});
