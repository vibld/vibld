import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  LEGACY_WEBHOOK_URLS,
  PORTAL_SETTINGS,
  REQUIRED_WEBHOOK_EVENTS,
  RETENTION_COUPON,
  WEBHOOK_URL,
  formPairs,
  missingWebhookEvents,
} from './configure-accounts.mjs';

const worker = (file) =>
  readFileSync(new URL(`../apps/web/worker/${file}`, import.meta.url), 'utf8');

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

test('the retention coupon is created for any product', () => {
  // Monthly and annual prices share a product, so a product scope cannot
  // express "monthly only". The Worker's cancel flow does, by offering the
  // coupon only for a monthly price; a scope here would add nothing and
  // would have to be kept in step with every product the plans move to.
  assert.equal('applies_to' in RETENTION_COUPON, false);
  assert.equal(RETENTION_COUPON.percent_off, 50);
  assert.equal(RETENTION_COUPON.duration, 'once');
});

test('the coupon this script creates is the one the Worker offers', () => {
  const declared = worker('stripe-client.ts').match(
    /export const RETENTION_COUPON_ID = '([^']+)'/,
  );
  assert.ok(declared, 'stripe-client.ts no longer declares the coupon id');
  assert.equal(declared[1], RETENTION_COUPON.id);
});

test('the webhook asks for every event the Worker handles', () => {
  // Every `case` in `applyStripeEvent`'s switch. An event the Worker acts on
  // that the endpoint never sends reaches it only through the nightly
  // replay, a day late.
  const source = worker('billing-events.ts');
  const body = source.slice(
    source.indexOf('export async function applyStripeEvent'),
  );
  const handled = [
    ...body.slice(0, body.indexOf('default:')).matchAll(/case '([^']+)':/g),
  ].map((match) => match[1]);
  assert.ok(handled.length >= 10, `only found ${handled.length} event types`);
  assert.deepEqual(
    handled.filter((type) => !REQUIRED_WEBHOOK_EVENTS.includes(type)),
    [],
  );
  for (const type of [
    'setup_intent.succeeded',
    'charge.refunded',
    'charge.dispute.closed',
  ]) {
    assert.ok(
      REQUIRED_WEBHOOK_EVENTS.includes(type),
      `${type} is not asked for`,
    );
  }
  // And nothing the Worker would only log as unhandled.
  assert.deepEqual(
    REQUIRED_WEBHOOK_EVENTS.filter((type) => !handled.includes(type)),
    [],
  );
});

test('the webhook asks for the same events the nightly replay reads', () => {
  const source = worker('billing-replay.ts');
  const list = source.slice(
    source.indexOf('export const REPLAYED_EVENT_TYPES = ['),
  );
  const replayed = [
    ...list.slice(0, list.indexOf('];')).matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  assert.deepEqual([...replayed].sort(), [...REQUIRED_WEBHOOK_EVENTS].sort());
});

test('only the missing events are added, and nothing is taken away', () => {
  const some = ['checkout.session.completed', 'invoice.paid', 'ping'];
  const missing = missingWebhookEvents(some);
  assert.equal(missing.includes('checkout.session.completed'), false);
  assert.equal(missing.includes('invoice.paid'), false);
  assert.ok(missing.includes('charge.refunded'));
  assert.deepEqual(
    [...some, ...missing].sort(),
    [...new Set([...some, ...REQUIRED_WEBHOOK_EVENTS])].sort(),
  );
  assert.deepEqual(missingWebhookEvents(REQUIRED_WEBHOOK_EVENTS), []);
});

test('an endpoint on every event is left as it is', () => {
  // Writing a list to it would narrow it to that list.
  assert.deepEqual(missingWebhookEvents(['*']), []);
});

test("only the Worker's own old workers.dev address is moved", () => {
  assert.deepEqual(LEGACY_WEBHOOK_URLS, [
    'https://vibld-web-preview.chris-brock-llc.workers.dev/api/stripe/webhook',
  ]);
  assert.ok(!LEGACY_WEBHOOK_URLS.includes(WEBHOOK_URL));
});
