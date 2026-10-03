import { findModel } from '@vibld/ai/model-catalogue';
import type { StylePresetId } from '@vibld/ai/style-presets';

import catalogueFile from '../../../examples/catalogue.json';

/**
 * The examples page (/examples), read from `examples/catalogue.json`.
 *
 * One file drives the page, the publish workflow
 * (`scripts/examples.mjs`) and the test that holds each entry to the eval
 * case it claims to come from, so the prompt shown here is the prompt that
 * was sent. A second list on this site would be a claim about what vibld
 * built, written somewhere nothing checks it.
 */

export interface CatalogueEntry {
  slug: string;
  /** The eval case (packages/eval/src/cases.ts) it was generated from. */
  case: string;
  title: string;
  kind: 'site' | 'app';
  /** A model id from the catalogue in @vibld/ai. */
  model: string;
  /** The GitHub Actions run that generated it. */
  run: number;
  /** ISO date. */
  generatedOn: string;
  prompt: string;
  /** Anything a visitor should know before believing the page, as generated. */
  notes: string[];
  /**
   * Set on a sample gallery entry (internal issue 186, D153): one cell of the grid of
   * site types by styles, built from the case `gallery-<siteType>-<style>`.
   */
  gallery?: { siteType: string; style: StylePresetId };
}

export interface Example extends CatalogueEntry {
  modelLabel: string;
  liveUrl: string;
  sourceZip: string;
  screenshot: string;
}

const PUBLISH_HOSTNAME = 'vibld-preview.dev';

export function examples(
  entries: readonly CatalogueEntry[] = catalogueFile.examples as CatalogueEntry[],
): Example[] {
  return entries.map((entry) => {
    const model = findModel(entry.model);
    if (!model) {
      // A build failure rather than a blank label: an example credited to a
      // model the catalogue does not know is a claim nobody can check.
      throw new Error(
        `Example ${entry.slug} names unknown model ${entry.model}`,
      );
    }
    return {
      ...entry,
      modelLabel: model.label,
      liveUrl: `https://example-${entry.slug}.${PUBLISH_HOSTNAME}/`,
      sourceZip: `/examples/${entry.slug}.zip`,
      screenshot: `/examples/${entry.slug}.webp`,
    };
  });
}
