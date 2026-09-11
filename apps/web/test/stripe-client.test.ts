import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PRICE_LOOKUP_KEYS,
  lookupKeyFor,
  stripeConfigured,
  tierForLookupKey,
} from '../worker/stripe-client.ts';

describe('stripeConfigured', () => {
  it('requires the secret key', () => {
    assert.equal(stripeConfigured({}), false);
    assert.equal(stripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_x' }), true);
  });
});

describe('tierForLookupKey', () => {
  it('maps every subscription lookup_key to its tier', () => {
    assert.equal(tierForLookupKey(PRICE_LOOKUP_KEYS.buildMonthly), 'build');
    assert.equal(tierForLookupKey(PRICE_LOOKUP_KEYS.buildAnnual), 'build');
    assert.equal(tierForLookupKey(PRICE_LOOKUP_KEYS.shipMonthly), 'ship');
    assert.equal(tierForLookupKey(PRICE_LOOKUP_KEYS.shipAnnual), 'ship');
  });

  it('has no tier for the top-up price or an unrecognised key', () => {
    assert.equal(tierForLookupKey(PRICE_LOOKUP_KEYS.topup), undefined);
    assert.equal(tierForLookupKey('something_else'), undefined);
    assert.equal(tierForLookupKey(null), undefined);
  });
});

describe('lookupKeyFor', () => {
  it('picks the right lookup_key for every tier/interval combination', () => {
    assert.equal(
      lookupKeyFor({
        kind: 'subscription',
        tier: 'build',
        interval: 'monthly',
      }),
      PRICE_LOOKUP_KEYS.buildMonthly,
    );
    assert.equal(
      lookupKeyFor({ kind: 'subscription', tier: 'build', interval: 'annual' }),
      PRICE_LOOKUP_KEYS.buildAnnual,
    );
    assert.equal(
      lookupKeyFor({ kind: 'subscription', tier: 'ship', interval: 'monthly' }),
      PRICE_LOOKUP_KEYS.shipMonthly,
    );
    assert.equal(
      lookupKeyFor({ kind: 'subscription', tier: 'ship', interval: 'annual' }),
      PRICE_LOOKUP_KEYS.shipAnnual,
    );
    assert.equal(lookupKeyFor({ kind: 'topup' }), PRICE_LOOKUP_KEYS.topup);
  });
});
