import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TEMPLATE_GROUPS,
  TEMPLATE_SUBCATEGORIES,
  findSubcategory,
  styleSubcategory,
  subcategoryPhrase,
  subcategoryTitle,
  templateGroup,
  templateSubcategories,
} from '../src/design-categories.ts';
import { DESIGN_TEMPLATE_INDEX } from '../src/design-template-index.ts';
import { STYLE_GALLERY_INDEX } from '../src/style-gallery-index.ts';
import {
  STYLE_GALLERY_GROUPS,
  styleGalleryBrief,
} from '../src/style-gallery.ts';
import {
  findDesignTemplate,
  listedDesignTemplates,
} from '../src/design-templates.ts';

describe('template categories (D161)', () => {
  const listed = listedDesignTemplates();

  it('puts every listed design in at least one subcategory', () => {
    const missing = listed
      .filter((t) => t.format !== 'screen')
      .filter((t) => templateSubcategories(t).length === 0)
      .map((t) => `${t.id} (${t.kind}/${t.category})`);
    assert.deepEqual(missing, []);
  });

  it('leaves no subcategory empty, and names each catalog category once per group', () => {
    for (const s of TEMPLATE_SUBCATEGORIES) {
      assert.ok(
        listed.some((t) => templateSubcategories(t).includes(s)) ||
          STYLE_GALLERY_INDEX.some((e) => styleSubcategory(e.group) === s),
        `${s.group}/${s.slug} is empty`,
      );
    }
    for (const group of ['websites', 'apps'] as const) {
      const named = TEMPLATE_SUBCATEGORIES.filter(
        (s) => s.group === group,
      ).flatMap((s) => s.categories);
      assert.equal(new Set(named).size, named.length, group);
    }
  });

  it('gives each subcategory a path no design or group already uses', () => {
    const paths = TEMPLATE_SUBCATEGORIES.map((s) => `${s.group}/${s.slug}`);
    assert.equal(new Set(paths).size, paths.length);
    const ids = new Set(DESIGN_TEMPLATE_INDEX.map((t) => t.id));
    for (const g of TEMPLATE_GROUPS) assert.equal(ids.has(g.slug), false);
    assert.equal(findSubcategory('websites', 'ecommerce')?.label, 'Ecommerce');
    assert.equal(findSubcategory('apps', 'ecommerce'), undefined);
  });

  it('lists as Shopify storefronts only listed designs whose purpose names Shopify', () => {
    const shopify = findSubcategory('websites', 'shopify')!;
    for (const id of shopify.ids ?? []) {
      const t = findDesignTemplate(id);
      assert.ok(t && !t.mergedInto, id);
      assert.match(t.purpose, /Shopify/, id);
      assert.ok(
        templateSubcategories(t).some((s) => s.slug === 'ecommerce'),
        `${id} is also ecommerce`,
      );
    }
  });

  it('groups by format first, then kind', () => {
    assert.equal(templateGroup({ kind: 'app', format: 'screen' }), 'screens');
    assert.equal(templateGroup({ kind: 'site', format: 'page' }), 'websites');
    assert.equal(templateGroup({ kind: 'app', format: 'design' }), 'apps');
  });
});

describe('subcategory titles (D161)', () => {
  it('names the kind only where websites and apps share a label', () => {
    assert.equal(
      subcategoryTitle(findSubcategory('websites', 'ecommerce')!),
      'Ecommerce templates',
    );
    assert.equal(
      subcategoryTitle(findSubcategory('apps', 'saas')!),
      'SaaS app templates',
    );
  });
});

describe('subcategories in a sentence (D161)', () => {
  it('keeps acronyms and proper nouns capitalized', () => {
    const phrase = (group: string, slug: string) =>
      subcategoryPhrase(findSubcategory(group, slug)!);
    assert.equal(phrase('websites', 'services'), 'local services');
    assert.equal(phrase('websites', 'saas'), 'SaaS');
    assert.equal(phrase('websites', 'ai-products'), 'AI products');
    assert.equal(phrase('websites', 'shopify'), 'Shopify');
    assert.equal(phrase('websites', 'web3'), 'Web3');
  });
});

describe('the style gallery under the template categories (D162)', () => {
  it('lists every gallery industry under exactly one website subcategory', () => {
    for (const group of STYLE_GALLERY_GROUPS) {
      const subs = TEMPLATE_SUBCATEGORIES.filter((s) =>
        s.styleGroups?.includes(group),
      );
      assert.equal(subs.length, 1, `${group} is under ${subs.length}`);
      assert.equal(subs[0]!.group, 'websites');
      assert.equal(styleSubcategory(group), subs[0]);
    }
    assert.equal(styleSubcategory('nothing'), undefined);
  });

  it('names only industries the gallery has', () => {
    const known = new Set<string>(STYLE_GALLERY_GROUPS);
    for (const s of TEMPLATE_SUBCATEGORIES)
      for (const g of s.styleGroups ?? [])
        assert.ok(known.has(g), `${s.slug} names ${g}`);
  });

  it('shares no id between a style and a design template', () => {
    const designs = new Set(DESIGN_TEMPLATE_INDEX.map((t) => t.id));
    const shared = STYLE_GALLERY_INDEX.filter((s) => designs.has(s.id));
    assert.deepEqual(
      shared.map((s) => s.id),
      [],
    );
  });

  it('lays a style out as a brief the way a design is', () => {
    assert.equal(
      styleGalleryBrief('  Rules.\n', {
        name: 'Amberbrae',
        build_prompt: '\n### Goal\nA store.\n',
      }),
      'Rules.\n\n## Amberbrae\n\n### Goal\nA store.\n',
    );
  });
});

describe('the SaaS industries split out (D164)', () => {
  it('gives each SaaS industry its own website subcategory', () => {
    const slug = (group: string) => styleSubcategory(group)?.slug;
    assert.equal(slug('saas'), 'saas');
    assert.equal(slug('design-tools'), 'design-tools');
    assert.equal(slug('devtools'), 'developer-tools');
    assert.equal(slug('fintech'), 'fintech');
    assert.equal(slug('productivity'), 'productivity');
    assert.equal(slug('web3'), 'web3');
  });

  it('moves the matching catalog designs with them', () => {
    for (const category of ['fintech', 'productivity', 'developer-tools']) {
      const t = listedDesignTemplates().find(
        (d) => templateGroup(d) === 'websites' && d.category === category,
      )!;
      assert.deepEqual(
        templateSubcategories(t).map((s) => s.slug),
        [category],
      );
    }
  });

  it('names the kind where apps share the label', () => {
    assert.equal(
      subcategoryTitle(findSubcategory('websites', 'developer-tools')!),
      'Developer tools website templates',
    );
    assert.equal(
      subcategoryTitle(findSubcategory('websites', 'fintech')!),
      'Fintech templates',
    );
  });
});
