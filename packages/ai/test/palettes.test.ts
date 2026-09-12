import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRODUCT_PALETTES,
  findPalette,
  paletteGuidance,
  selectPalette,
} from '../src/palettes.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('the palette catalogue', () => {
  it('has distinct ids and triggers', () => {
    const ids = PRODUCT_PALETTES.map((palette) => palette.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const palette of PRODUCT_PALETTES) {
      assert.ok(palette.triggers.length > 0, `${palette.id} needs a trigger`);
    }
  });

  it('gives every palette real hex tokens, not placeholders', () => {
    for (const palette of PRODUCT_PALETTES) {
      for (const [key, value] of Object.entries(palette.colors)) {
        assert.match(value, HEX, `${palette.id}.${key} must be a hex colour`);
      }
    }
  });

  it('gives every palette a real font pairing and a working Google Fonts URL', () => {
    for (const palette of PRODUCT_PALETTES) {
      assert.ok(palette.typography.headingFont.length > 0);
      assert.ok(palette.typography.bodyFont.length > 0);
      assert.match(
        palette.typography.googleFontsUrl,
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=/,
      );
    }
  });
});

describe('selectPalette', () => {
  it('matches a request that names a product type directly', () => {
    assert.equal(
      selectPalette('A landing page for a SaaS product')?.id,
      'saas',
    );
    assert.equal(selectPalette('An e-commerce storefront')?.id, 'ecommerce');
  });

  it('returns null for a request that names no recognised product type', () => {
    assert.equal(selectPalette('Make the hero navy'), null);
  });

  it('is case-insensitive', () => {
    assert.equal(selectPalette('A SAAS DASHBOARD')?.id, 'saas');
  });
});

describe('findPalette', () => {
  it('returns the palette, or null for anything unknown', () => {
    assert.equal(findPalette('fintech')?.name, 'Fintech / crypto');
    assert.equal(findPalette('nope'), null);
  });
});

describe('paletteGuidance', () => {
  it('is null when nothing matched', () => {
    assert.equal(paletteGuidance('Make the hero navy'), null);
  });

  it('includes the CSS custom properties and the font import', () => {
    const guidance = paletteGuidance('A landing page for a SaaS product');
    assert.ok(guidance);
    assert.match(guidance, /--primary: #2563EB/);
    assert.match(guidance, /@import url\('https:\/\/fonts\.googleapis\.com/);
  });

  it('subordinates itself to the request', () => {
    const guidance = paletteGuidance('A landing page for a SaaS product');
    assert.ok(guidance);
    assert.match(guidance, /still wins/i);
  });
});

describe('buildUserPrompt with a matching product type', () => {
  it('appends palette guidance when no style preset was chosen', () => {
    const composed = buildUserPrompt({
      prompt: 'A landing page for a SaaS product',
    });
    assert.match(composed, /--primary: #2563EB/);
  });

  it('does not append palette guidance when a style preset was chosen', () => {
    // "dark" already carries its own colour direction -- see palettes.ts's
    // own comment on why this must not also inject the SaaS default.
    const composed = buildUserPrompt(
      { prompt: 'A landing page for a SaaS product' },
      'dark',
    );
    assert.ok(!composed.includes('--primary: #2563EB'));
  });

  it('does not append anything for a request naming no recognised product', () => {
    const composed = buildUserPrompt({ prompt: 'Make the hero navy' });
    assert.equal(composed, 'Make the hero navy');
  });
});
