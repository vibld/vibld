import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';

import { DEMO_SITES } from '../app/demo-sites.ts';
import { ROUTES } from '../app/site.ts';
import { TEMPLATES } from '../app/templates.ts';
import { USE_CASES } from '../app/use-cases.ts';

/** The examples, read as data: app/examples.ts imports JSON the way Vite does. */
const examples = () =>
  (
    JSON.parse(
      readFileSync(
        new URL('../../../examples/catalogue.json', import.meta.url),
        'utf8',
      ),
    ) as { examples: { slug: string; title: string }[] }
  ).examples;

/** How two names are compared: case, spacing and punctuation ignored. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('the template catalog on vibld.com', () => {
  it('clashes with no name vibld.com already uses', () => {
    // packages/ai/test/design-templates.test.ts checks the builder's own
    // catalogues (style presets, palettes, patterns, backdrops, examples'
    // slugs); these are the names only this site holds.
    const ours = new Map<string, string>();
    const add = (where: string, ...names: string[]) => {
      for (const name of names) ours.set(key(name), `${where}: ${name}`);
    };
    for (const t of TEMPLATES)
      add('hand-built template', t.slug, t.name, t.subject.split(',')[0]!);
    for (const site of Object.values(DEMO_SITES)) {
      add('demo site', site.slug, site.text.brand);
    }
    for (const u of USE_CASES) add('use case', u.slug, u.label);
    for (const e of examples()) add('example', e.slug, e.title);
    for (const design of DESIGN_TEMPLATE_INDEX) {
      for (const name of [design.id, design.name]) {
        assert.equal(
          ours.get(key(name)),
          undefined,
          `"${name}" is already used`,
        );
      }
    }
  });

  it('gives every design its own page, titled with its name', () => {
    for (const design of DESIGN_TEMPLATE_INDEX) {
      const route = ROUTES.find((r) => r.path === `/templates/${design.id}`);
      assert.ok(route, design.id);
      assert.ok(route.title.startsWith(design.name), route.title);
    }
  });

  it('files every design under a use case this site has', () => {
    const slugs = new Set(USE_CASES.map((u) => u.slug));
    for (const design of DESIGN_TEMPLATE_INDEX) {
      assert.ok(slugs.has(design.useCase), `${design.id}: ${design.useCase}`);
    }
  });

  it('merges a design only into an example this site shows', () => {
    const shown = new Set(examples().map((e) => e.slug));
    for (const design of DESIGN_TEMPLATE_INDEX) {
      if (design.mergedInto?.collection === 'examples')
        assert.ok(shown.has(design.mergedInto.slug), design.id);
    }
  });

  it('merges a design into another only when that one is listed (D107)', () => {
    const byId = new Map(DESIGN_TEMPLATE_INDEX.map((t) => [t.id, t]));
    for (const design of DESIGN_TEMPLATE_INDEX) {
      if (design.mergedInto?.collection !== 'templates') continue;
      const into = byId.get(design.mergedInto.slug);
      assert.ok(into && !into.mergedInto, design.id);
    }
  });
});
