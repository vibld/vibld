import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DESIGN_TEMPLATES } from '@vibld/ai/design-templates';

import {
  blockFor,
  ctaFor,
  headlineFor,
  previewSpec,
  styleTemplate,
} from '../app/template-preview.ts';
import { styleGalleryCatalog } from '../app/style-gallery.server.ts';

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

  it('draws every design with a nav and a hero, and a screen with its title bar, in its own colours and faces', () => {
    for (const t of DESIGN_TEMPLATES) {
      const spec = previewSpec(t, () => 'sans-serif');
      const kinds = spec.blocks.map((b) => b.kind);
      assert.equal(kinds[0], 'nav', t.id);
      // A screen (D110) is one app screen, not a homepage.
      assert.equal(kinds[1], t.format === 'screen' ? 'heading' : 'hero', t.id);
      assert.ok(spec.blocks.length >= 3, t.id);
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

describe('a style gallery entry drawn as a template card (D162)', () => {
  const entries = styleGalleryCatalog().entries;
  const generic = () => 'system-ui, sans-serif';

  it('draws every style in its own colors and faces, with its subject as the headline', () => {
    for (const entry of entries) {
      const spec = previewSpec(styleTemplate(entry), generic);
      const canvas = entry.design_tokens.colors.find((c) =>
        c.role.split(' / ').includes('canvas'),
      );
      if (canvas) assert.equal(spec.colors.background, canvas.hex, entry.id);
      for (const value of Object.values(spec.colors))
        assert.match(value, /^#[0-9a-f]{3,8}$/i, entry.id);
      assert.match(spec.display, new RegExp(entry.design_tokens.fonts.display));
      assert.doesNotMatch(spec.headline, / on$/, entry.id);
      assert.equal(spec.blocks[0]?.kind, 'nav', entry.id);
    }
  });

  it('reads the subject out of the goal', () => {
    const spec = previewSpec(
      styleTemplate({
        name: 'Amberbrae',
        kind: 'Warm minimal online store site',
        group: 'ecommerce',
        layout: ['top navigation: wordmark left'],
        build_prompt:
          '### Goal\nBuild a responsive light-theme marketing site for a fictional consumer brand store in the "Amberbrae" style.',
        design_tokens: {
          colors: [
            { role: 'canvas / primary action label', hex: '#ffffff' },
            { role: 'text / primary action fill', hex: '#111111' },
          ],
          fonts: { display: 'Raleway', body: 'Poppins' },
          radius: { cards: '0px' },
        },
      }),
      generic,
    );
    assert.equal(spec.headline, 'Consumer brand store');
    assert.equal(spec.cta, 'Shop now');
    assert.equal(spec.colors.primary, '#111111');
    assert.equal(spec.colors.onPrimary, '#ffffff');
    assert.equal(spec.radius, '0px');
  });
});
