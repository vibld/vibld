import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STYLE_PRESETS, styleDirection } from '../src/style-presets.ts';
import { contrastRatio } from '../src/contrast.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

const TOKENED = STYLE_PRESETS.filter((preset) => preset.tokens);

/**
 * Every pair a reader actually has to read. Hairlines are deliberately not
 * here -- see the `tokens` comment in style-presets.ts on why WCAG's 3:1
 * does not apply to a decorative rule between two surfaces.
 */
const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['cardForeground', 'card'],
  ['mutedForeground', 'muted'],
  ['mutedForeground', 'background'],
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onAccent', 'accent'],
  ['onDestructive', 'destructive'],
] as const;

describe('the tokened style archetypes', () => {
  it('ships seven of them', () => {
    assert.equal(TOKENED.length, 7);
  });

  it('meets the 4.5:1 rule UX BASELINE states, on every text pair', () => {
    // The source corpus these were distilled from records real brands
    // faithfully, and several of its own declared pairs fail this. That is
    // exactly why none of its values were copied and why this test exists.
    for (const preset of TOKENED) {
      const colors = preset.tokens!.colors;
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrastRatio(colors[fg], colors[bg]);
        assert.ok(ratio !== null, `${preset.id}: ${fg}/${bg} unparseable`);
        assert.ok(
          ratio >= 4.5,
          `${preset.id}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`,
        );
      }
    }
  });

  it('keeps a primary fill distinguishable from the page', () => {
    for (const preset of TOKENED) {
      const { primary, background } = preset.tokens!.colors;
      const ratio = contrastRatio(primary, background);
      assert.ok(ratio !== null && ratio >= 3, `${preset.id}: ${ratio}`);
    }
  });

  it('writes every colour as a 6-digit hex, so every one is checkable', () => {
    for (const preset of TOKENED) {
      for (const [key, value] of Object.entries(preset.tokens!.colors)) {
        assert.match(value, /^#[0-9A-Fa-f]{6}$/, `${preset.id}.${key}`);
      }
    }
  });

  it('gives each a real font pairing and a working Google Fonts URL', () => {
    for (const preset of TOKENED) {
      const { headingFont, bodyFont, googleFontsUrl } =
        preset.tokens!.typography;
      assert.ok(headingFont.length > 0 && bodyFont.length > 0, preset.id);
      assert.match(
        googleFontsUrl,
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=/,
        preset.id,
      );
      for (const family of [headingFont, bodyFont]) {
        assert.ok(
          googleFontsUrl.includes(family.replace(/ /g, '+')),
          `${preset.id}: ${family} is not in its own font URL`,
        );
      }
    }
  });

  it('gives each a radius scale', () => {
    for (const preset of TOKENED) {
      for (const value of Object.values(preset.tokens!.radius)) {
        assert.match(value, /^\d+px$/, preset.id);
      }
    }
  });

  it('carries no company name on the label surface', () => {
    // The archetypes were distilled from a corpus of real brands. The id,
    // the chip name and its caption are the surface a trademark claim would
    // actually attach to -- a menu of third-party word marks -- so those are
    // checked against the whole list, including words that are innocent
    // elsewhere.
    const BRANDS = [
      'linear',
      'warp',
      'raycast',
      'vercel',
      'stripe',
      'notion',
      'figma',
      'shopify',
      'ferrari',
      'tesla',
      'apple',
      'nike',
      'claude',
      'anthropic',
      'airbnb',
      'uber',
      'spotify',
    ];
    for (const preset of STYLE_PRESETS) {
      const label =
        `${preset.id} ${preset.name} ${preset.description}`.toLowerCase();
      for (const brand of BRANDS) {
        assert.ok(!label.includes(brand), `${preset.id} is labelled ${brand}`);
      }
    }
  });

  it('names no company in a direction either', () => {
    // Same list minus the two that are ordinary CSS vocabulary: "linear" is
    // an easing keyword and a gradient type, and excluding it here is about
    // that collision, not about it being safe as a label -- the test above
    // still forbids it there.
    const BRANDS = [
      'warp',
      'raycast',
      'vercel',
      'stripe',
      'notion',
      'figma',
      'shopify',
      'ferrari',
      'tesla',
      'nike',
      'anthropic',
      'airbnb',
    ];
    for (const preset of STYLE_PRESETS) {
      const direction = preset.direction.toLowerCase();
      for (const brand of BRANDS) {
        assert.ok(
          !direction.includes(brand),
          `${preset.id}'s direction mentions ${brand}`,
        );
      }
    }
  });
});

describe('styleDirection with a tokened preset', () => {
  it('emits the :root block, since the palette is suppressed by a preset', () => {
    const direction = styleDirection('warmTerminal');
    assert.ok(direction);
    assert.match(direction, /--background: #2B2622/);
    assert.match(direction, /--radius-md: 4px/);
    assert.match(direction, /@import url\('https:\/\/fonts\.googleapis\.com/);
  });

  it('emits no token block for a preset that is only a treatment', () => {
    const direction = styleDirection('glassmorphism');
    assert.ok(direction);
    assert.ok(!direction.includes(':root'));
  });

  it('reaches the composed prompt', () => {
    const composed = buildUserPrompt(
      { prompt: 'A landing page for a SaaS product' },
      'monoPress',
    );
    assert.match(composed, /--accent: #0057B8/);
    // And the product-type palette stays suppressed, so there is exactly
    // one :root block in the prompt rather than two competing ones.
    assert.equal(composed.match(/:root \{/g)?.length, 1);
  });
});
