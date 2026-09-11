import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MARKETING_PAGE_PATTERNS,
  SAAS_SCREEN_PATTERNS,
  patternGuidance,
  selectPatterns,
} from '../src/patterns.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

describe('the pattern catalogue', () => {
  it("has L51's 10 marketing page types and 6 SaaS screens", () => {
    assert.equal(MARKETING_PAGE_PATTERNS.length, 10);
    assert.equal(SAAS_SCREEN_PATTERNS.length, 6);
  });

  it('gives every pattern guidance a model can act on, not a label', () => {
    for (const pattern of [
      ...MARKETING_PAGE_PATTERNS,
      ...SAAS_SCREEN_PATTERNS,
    ]) {
      assert.ok(
        pattern.guidance.length > 80,
        `${pattern.id} needs real guidance, not a label`,
      );
      assert.ok(pattern.triggers.length > 0, `${pattern.id} needs a trigger`);
    }
  });

  it('has distinct ids', () => {
    const ids = [...MARKETING_PAGE_PATTERNS, ...SAAS_SCREEN_PATTERNS].map(
      (pattern) => pattern.id,
    );
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('selectPatterns', () => {
  it('matches a request that names a page type directly', () => {
    const matched = selectPatterns('A pricing page for a SaaS product');
    assert.ok(matched.some((pattern) => pattern.id === 'pricing'));
  });

  it('returns nothing for a request that names no pattern', () => {
    assert.deepEqual(selectPatterns('Make the hero navy'), []);
  });

  it('is case-insensitive', () => {
    const matched = selectPatterns('A PRICING PAGE please');
    assert.ok(matched.some((pattern) => pattern.id === 'pricing'));
  });

  it('caps how many patterns it returns', () => {
    // Names three distinct page types in one request.
    const matched = selectPatterns(
      'A landing page, a pricing page and a contact page',
      2,
    );
    assert.equal(matched.length, 2);
  });
});

describe('patternGuidance', () => {
  it('is null when nothing matched', () => {
    assert.equal(patternGuidance('Make the hero navy'), null);
  });

  it('subordinates itself to the request', () => {
    const guidance = patternGuidance('A pricing page for a SaaS product');
    assert.ok(guidance);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with a matching pattern', () => {
  it('appends pattern guidance after the request', () => {
    const composed = buildUserPrompt({
      prompt: 'A pricing page for a SaaS product',
    });
    assert.ok(composed.startsWith('A pricing page for a SaaS product'));
    assert.match(composed, /Pricing page:/);
  });

  it('comes before style direction, both after a base project', () => {
    const composed = buildUserPrompt(
      {
        prompt: 'A pricing page for a SaaS product',
        base: {
          revision: 'r1',
          files: [{ path: 'src/App.tsx', content: 'x' }],
        },
      },
      'minimalist',
    );
    const baseIndex = composed.indexOf('already exists at revision r1');
    const patternIndex = composed.indexOf('Pricing page:');
    const styleIndex = composed.indexOf('minimalist visual direction');
    assert.ok(baseIndex < patternIndex);
    assert.ok(patternIndex < styleIndex);
  });
});
