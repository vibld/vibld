import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidSlug } from '../worker/slug.ts';

describe('isValidSlug', () => {
  it('accepts ordinary DNS-safe labels', () => {
    assert.equal(isValidSlug('coffee-roaster'), true);
    assert.equal(isValidSlug('acme'), true);
    assert.equal(isValidSlug('a1-b2'), true);
  });

  it('rejects uppercase, since DNS labels are matched lowercase', () => {
    assert.equal(isValidSlug('Acme'), false);
  });

  it('rejects a leading or trailing hyphen', () => {
    assert.equal(isValidSlug('-acme'), false);
    assert.equal(isValidSlug('acme-'), false);
  });

  it('rejects characters outside a DNS label', () => {
    assert.equal(isValidSlug('acme.com'), false);
    assert.equal(isValidSlug('acme_co'), false);
    assert.equal(isValidSlug('acme co'), false);
  });

  it('rejects the empty string and an over-long label', () => {
    assert.equal(isValidSlug(''), false);
    assert.equal(isValidSlug('a'.repeat(64)), false);
  });

  it('rejects reserved labels', () => {
    for (const reserved of [
      'www',
      'api',
      'admin',
      'internal',
      'status',
      'share',
      'published',
      'domains',
    ]) {
      assert.equal(isValidSlug(reserved), false, reserved);
    }
  });

  it('rejects the shapes apps/preview answers itself on the same domain', () => {
    // A published site is `<slug>.vibld-preview.dev`, beside sandbox
    // previews (`{port}-{sandboxId}-{token}`) and share origins
    // (`sh-<uuid>`); apps/preview keeps those hosts, so such a slug could
    // never be reached.
    for (const shaped of [
      '8080-app-v2',
      '2026-conference',
      '12345-a-b',
      'sh-3f2a9c1e-0b7d-4e6a-9c52-1d8e7f604ab3',
      'sh-anything',
    ]) {
      assert.equal(isValidSlug(shaped), false, shaped);
    }
    for (const fine of ['conference-2026', '123-go', '202-accepted', 'shop']) {
      assert.equal(isValidSlug(fine), true, fine);
    }
  });
});
