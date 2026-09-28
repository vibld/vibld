import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTAL_SETTINGS,
  formPairs,
  retentionScope,
} from './configure-accounts.mjs';

test('formPairs encodes nested objects and arrays the way Stripe reads them', () => {
  assert.deepEqual(formPairs({ a: { b: 'x', c: ['y', 'z'] }, d: true }), [
    ['a[b]', 'x'],
    ['a[c][]', 'y'],
    ['a[c][]', 'z'],
    ['d', 'true'],
  ]);
});

test('the portal settings cancel at the end of the period, without proration', () => {
  const pairs = new Map(formPairs(PORTAL_SETTINGS));
  assert.equal(
    pairs.get('features[subscription_cancel][mode]'),
    'at_period_end',
  );
  assert.equal(
    pairs.get('features[subscription_cancel][proration_behavior]'),
    'none',
  );
  assert.ok(PORTAL_SETTINGS.business_profile.headline.length <= 60);
});

const price = (product, interval) => ({
  product: { id: product },
  recurring: interval ? { interval } : null,
});

test('the retention coupon is scoped to the monthly plans products', () => {
  assert.deepEqual(
    retentionScope([
      price('prod_build_m', 'month'),
      price('prod_build_y', 'year'),
      price('prod_ship_m', 'month'),
      price('prod_ship_y', 'year'),
      price('prod_topup', null),
    ]),
    { products: ['prod_build_m', 'prod_ship_m'] },
  );
});

test('a product carrying both a monthly and an annual price refuses the coupon', () => {
  const scope = retentionScope([
    price('prod_build', 'month'),
    price('prod_build', 'year'),
  ]);
  assert.match(scope.error, /share product prod_build/);
});

test('no monthly price refuses the coupon', () => {
  assert.match(
    retentionScope([price('prod_build', 'year')]).error,
    /No monthly/,
  );
});
