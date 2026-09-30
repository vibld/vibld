import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DESIGN_TEMPLATES } from '@vibld/ai/design-templates';

import {
  blockFor,
  ctaFor,
  headlineFor,
  previewSpec,
} from '../app/template-preview.ts';

describe('a template card’s mocked homepage (D106)', () => {
  it('draws each layout line as the block it describes', () => {
    assert.equal(blockFor('Minimal top bar: logo left')?.kind, 'nav');
    assert.deepEqual(blockFor('Split hero: headline left, image right'), {
      kind: 'hero',
      layout: 'split',
    });
    assert.deepEqual(blockFor('Full-bleed video hero with a headline'), {
      kind: 'hero',
      layout: 'media',
    });
    assert.equal(
      blockFor('Three-column pricing with a highlighted plan')?.kind,
      'pricing',
    );
    assert.equal(blockFor('Testimonial card with avatar')?.kind, 'quote');
    assert.equal(
      blockFor('Horizontally overflowing bento strip of tiles')?.kind,
      'bento',
    );
    assert.equal(
      blockFor('Thin divider and footer with wordmark')?.kind,
      'footer',
    );
  });

  it('takes its headline from the design’s own goal', () => {
    assert.equal(
      headlineFor({
        name: 'Loanlight',
        summary: 'Mortgage calculator',
        buildPrompt:
          '### Goal\nBuild **Loanlight**, a friendly guided mortgage calculator for first-time buyers.',
      }),
      'Friendly guided mortgage calculator',
    );
  });

  it('words the call to action for the kind of site', () => {
    assert.equal(ctaFor('restaurant', 'site'), 'Reserve a table');
    assert.equal(ctaFor('internal-tools', 'app'), 'Start free');
  });

  it('draws every design with a nav and a hero, in its own colours and faces', () => {
    for (const t of DESIGN_TEMPLATES) {
      const spec = previewSpec(t, () => 'sans-serif');
      const kinds = spec.blocks.map((b) => b.kind);
      assert.ok(kinds.includes('nav') && kinds.includes('hero'), t.id);
      assert.ok(spec.blocks.length <= 6, t.id);
      assert.equal(
        spec.colors.background,
        t.style.tokens.colors.background,
        t.id,
      );
      const display = t.style.typeSet.find((f) => f.role === 'display')!.family;
      assert.ok(spec.display.startsWith(`"tf-${display}"`), t.id);
      assert.ok(
        spec.headline.length > 0 && spec.headline.split(' ').length <= 7,
        t.id,
      );
    }
  });

  it('draws more than one page shape across the catalog', () => {
    const shapes = new Set(
      DESIGN_TEMPLATES.map((t) =>
        previewSpec(t, () => 'sans-serif')
          .blocks.map((b) => (b.kind === 'hero' ? `hero-${b.layout}` : b.kind))
          .join(','),
      ),
    );
    assert.ok(shapes.size > 60, `only ${shapes.size} shapes`);
  });
});

describe('each template’s share image (D106)', () => {
  it('exists for every page that names one', async () => {
    const { existsSync } = await import('node:fs');
    const { ROUTES } = await import('../app/site.ts');
    const publicDir = new URL('../public', import.meta.url).pathname;
    const missing = ROUTES.filter(
      (route) => route.image && !existsSync(publicDir + route.image.path),
    ).map((route) => route.path);
    assert.deepEqual(missing, [], 'run scripts/template-og.mjs');
  });
});
