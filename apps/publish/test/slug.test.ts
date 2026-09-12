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
    ]) {
      assert.equal(isValidSlug(reserved), false, reserved);
    }
  });
});
