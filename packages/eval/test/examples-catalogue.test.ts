import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { findModel } from '@vibld/ai/model-catalogue';

import { CASES } from '../src/cases.ts';

/**
 * examples/catalogue.json drives vibld.com/examples and the publish
 * workflow. Every entry is a claim: this model built this project from this
 * prompt. These hold each claim to what the repository can check.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const { examples } = JSON.parse(
  readFileSync(join(ROOT, 'examples', 'catalogue.json'), 'utf8'),
) as {
  examples: {
    slug: string;
    case: string;
    kind: string;
    model: string;
    run: number;
    generatedOn: string;
    prompt: string;
    notes: string[];
  }[];
};

describe('the examples catalogue', () => {
  it('lists at least one example', () => {
    assert.ok(examples.length > 0);
  });

  for (const example of examples) {
    describe(example.slug, () => {
      it('shows the prompt its eval case actually sends', () => {
        const testCase = CASES.find((c) => c.id === example.case);
        assert.ok(testCase, `no eval case named ${example.case}`);
        assert.equal(example.prompt, testCase.prompt);
      });

      it('credits a model the catalogue knows', () => {
        assert.ok(findModel(example.model), `unknown model ${example.model}`);
      });

      it('has its source, as a project someone can install', () => {
        const source = join(ROOT, 'examples', 'generated', example.slug);
        assert.ok(existsSync(join(source, 'package.json')));
      });

      it('has a screenshot for the page', () => {
        assert.ok(
          existsSync(
            join(
              ROOT,
              'apps',
              'marketing',
              'public',
              'examples',
              `${example.slug}.webp`,
            ),
          ),
        );
      });

      it('publishes under a valid DNS label', () => {
        // scripts/examples.mjs publishes at example-<slug>.
        assert.match(
          `example-${example.slug}`,
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
        );
      });

      it('names its kind, run and date', () => {
        assert.ok(example.kind === 'site' || example.kind === 'app');
        assert.ok(Number.isInteger(example.run) && example.run > 0);
        assert.match(example.generatedOn, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(Array.isArray(example.notes));
      });
    });
  }

  it('never lists a slug twice', () => {
    const slugs = examples.map((example) => example.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });
});
