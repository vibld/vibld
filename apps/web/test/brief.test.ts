import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveBrief,
  deriveTitle,
  sanitizeText,
  slugify,
} from '../src/generation/brief.ts';

describe('brief derivation', () => {
  it('derives a stable title and slug from a prompt', () => {
    assert.equal(
      deriveTitle('Build me a cybersecurity SaaS landing page'),
      'Cybersecurity SaaS Landing',
    );
    assert.equal(
      slugify('Cybersecurity SaaS Landing'),
      'cybersecurity-saas-landing',
    );
  });

  it('falls back to a default title when the prompt carries no signal', () => {
    assert.equal(deriveTitle('build a site'), 'Vibld Project');
    assert.equal(slugify(''), 'vibld-project');
  });

  it('strips characters that would need escaping downstream', () => {
    assert.equal(
      sanitizeText('<script>alert("x")</script> shop'),
      'script alert x script shop',
    );
  });

  it('is deterministic for the same prompt', () => {
    const prompt = 'landing page with pricing and an faq';
    assert.deepEqual(deriveBrief(prompt), deriveBrief(prompt));
  });

  it('selects sections from prompt keywords in a fixed order', () => {
    const brief = deriveBrief(
      'A page with a contact form, pricing tiers and an FAQ',
    );
    assert.deepEqual(
      brief.sections.map((section) => section.kind),
      ['hero', 'pricing', 'faq', 'contact'],
    );
  });

  it('always produces a section below the hero', () => {
    const brief = deriveBrief('coffee roaster');
    assert.equal(brief.sections.length, 2);
    assert.equal(brief.sections[1]?.kind, 'features');
  });
});
