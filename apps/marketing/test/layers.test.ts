import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BACKDROPS } from '@vibld/ai/backdrops';
import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';

import { LAYERS } from '../app/layers.ts';
import { ROUTES } from '../app/site.ts';
import { BACKDROP_COMPONENT_DIR } from '../scripts/backdrops.ts';

const PUBLIC = new URL('../public', import.meta.url).pathname;

describe('the layers on /templates (D101)', () => {
  it('serves each layer’s reference page, prompt and screenshot', () => {
    for (const layer of LAYERS) {
      for (const path of [
        `${layer.livePath}/index.html`,
        layer.promptPath,
        layer.screenshot,
      ]) {
        assert.ok(existsSync(PUBLIC + path), `${layer.slug}: ${path}`);
      }
    }
  });

  it('keeps each reference page one self-contained file', () => {
    // A layer's promise is one HTML file with nothing to build: no script
    // from anywhere, and nothing but Google Fonts from outside.
    for (const layer of LAYERS) {
      const html = readFileSync(
        `${PUBLIC}${layer.livePath}/index.html`,
        'utf8',
      );
      assert.doesNotMatch(html, /<script[^>]+src=/i, layer.slug);
      const hosts = new Set(
        [...html.matchAll(/https:\/\/([^/"'\s)]+)/g)].map((m) => m[1]),
      );
      for (const host of hosts) {
        assert.match(host!, /^fonts\.(googleapis|gstatic)\.com$/, layer.slug);
      }
    }
  });

  it('shares no page with a design in the catalog', () => {
    const ids = new Set(DESIGN_TEMPLATE_INDEX.map((t) => t.id));
    const names = new Set(
      DESIGN_TEMPLATE_INDEX.map((t) => t.name.toLowerCase()),
    );
    for (const layer of LAYERS) {
      assert.ok(!ids.has(layer.slug), layer.slug);
      assert.ok(!names.has(layer.name.toLowerCase()), layer.name);
    }
  });

  it('declares a page for each one', () => {
    const paths = new Set(ROUTES.map((route) => route.path));
    for (const layer of LAYERS) {
      assert.ok(paths.has(`/templates/${layer.slug}`), layer.slug);
    }
  });
});

describe('the moving backgrounds on /styles (D101)', () => {
  it('runs exactly the file a build writes into a project', () => {
    for (const recipe of BACKDROPS) {
      const path = `${BACKDROP_COMPONENT_DIR}/${recipe.id}.tsx`;
      assert.ok(existsSync(path), `${recipe.id}: run scripts/backdrops.ts`);
      assert.equal(
        readFileSync(path, 'utf8'),
        recipe.source,
        `${recipe.id} differs from packages/ai: run scripts/backdrops.ts`,
      );
    }
  });

  it('keeps no background the builder no longer has', () => {
    assert.deepEqual(
      readdirSync(BACKDROP_COMPONENT_DIR).sort(),
      BACKDROPS.map((recipe) => `${recipe.id}.tsx`).sort(),
    );
  });
});
