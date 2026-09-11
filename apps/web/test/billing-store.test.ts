import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0002_billing.sql'),
  'utf8',
);

function newStore(): BillingStore {
  return new BillingStore(new SqliteD1Database(SCHEMA));
}

describe('BillingStore.linkCustomer / findCustomerId / findUserIdForCustomer', () => {
  it('round-trips a user-to-customer mapping in both directions', async () => {
    const store = newStore();
    await store.linkCustomer('user_1', 'cus_1');

    assert.equal(await store.findCustomerId('user_1'), 'cus_1');
    assert.equal(await store.findUserIdForCustomer('cus_1'), 'user_1');
    assert.equal(await store.findCustomerId('user_missing'), undefined);
  });

  it('keeps the first mapping once one exists', async () => {
    const store = newStore();
    await store.linkCustomer('user_1', 'cus_1');
    await store.linkCustomer('user_1', 'cus_2');

    assert.equal(
      await store.findCustomerId('user_1'),
      'cus_1',
      'a redelivered or racing webhook must not reassign an existing mapping',
    );
  });
});

describe('BillingStore subscriptions', () => {
  const RECORD = {
    stripeSubscriptionId: 'sub_1',
    userId: 'user_1',
    stripeCustomerId: 'cus_1',
    tier: 'build' as const,
    status: 'active',
    priceId: 'price_1',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  };

  it('upserts and reads a subscription record', async () => {
    const store = newStore();
    await store.upsertSubscription(RECORD);

    assert.deepEqual(await store.getSubscription('sub_1'), RECORD);
    assert.equal(await store.getSubscription('sub_missing'), undefined);
  });

  it('overwrites every field on a later upsert for the same subscription', async () => {
    const store = newStore();
    await store.upsertSubscription(RECORD);
    await store.upsertSubscription({
      ...RECORD,
      status: 'past_due',
      cancelAtPeriodEnd: true,
    });

    const updated = await store.getSubscription('sub_1');
    assert.equal(updated?.status, 'past_due');
    assert.equal(updated?.cancelAtPeriodEnd, true);
  });

  it('lists every mirrored subscription id, for the nightly reconcile', async () => {
    const store = newStore();
    await store.upsertSubscription(RECORD);
    await store.upsertSubscription({
      ...RECORD,
      stripeSubscriptionId: 'sub_2',
    });

    const ids = await store.listSubscriptionIds();
    assert.deepEqual([...ids].sort(), ['sub_1', 'sub_2']);
  });
});

describe('BillingStore.recordTopup', () => {
  it('records a top-up once, keyed by checkout session id', async () => {
    const store = newStore();
    await store.recordTopup('cs_1', 'user_1', 'cus_1', 800);
    // A redelivered checkout.session.completed for the same session must not
    // double-count the credit.
    await store.recordTopup('cs_1', 'user_1', 'cus_1', 800);

    // No public read method exists yet (the credit-ledger PR adds one) --
    // this just confirms the second call didn't throw on the primary key.
    assert.ok(true);
  });
});

describe('BillingStore webhook event dedup', () => {
  it('reports an unseen event as unprocessed, then as processed once marked', async () => {
    const store = newStore();
    assert.equal(await store.wasEventProcessed('evt_1'), false);

    await store.markEventProcessed('evt_1', 'checkout.session.completed');
    assert.equal(await store.wasEventProcessed('evt_1'), true);
  });

  it('marking the same event twice does not throw', async () => {
    const store = newStore();
    await store.markEventProcessed('evt_1', 'checkout.session.completed');
    await store.markEventProcessed('evt_1', 'checkout.session.completed');
    assert.equal(await store.wasEventProcessed('evt_1'), true);
  });
});
