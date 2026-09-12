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

/** For tests that need to reach past `BillingStore`'s own writers -- an old top-up's `created_at`, say. */
function newStoreWithDb(): { store: BillingStore; db: SqliteD1Database } {
  const db = new SqliteD1Database(SCHEMA);
  return { store: new BillingStore(db), db };
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

    assert.equal(await store.totalTopupCreditMicroUsd('user_1'), 8_000_000);
  });
});

describe('BillingStore.findActiveSubscription', () => {
  const RECORD = {
    stripeSubscriptionId: 'sub_1',
    userId: 'user_1',
    stripeCustomerId: 'cus_1',
    tier: 'ship' as const,
    status: 'active',
    priceId: 'price_1',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  };

  it('finds an active subscription for a user', async () => {
    const store = newStore();
    await store.upsertSubscription(RECORD);

    assert.deepEqual(await store.findActiveSubscription('user_1'), RECORD);
  });

  it('finds a trialing subscription too', async () => {
    const store = newStore();
    await store.upsertSubscription({ ...RECORD, status: 'trialing' });

    assert.equal(
      (await store.findActiveSubscription('user_1'))?.status,
      'trialing',
    );
  });

  it('is undefined for a canceled subscription -- it must not still grant a tier', async () => {
    const store = newStore();
    await store.upsertSubscription({ ...RECORD, status: 'canceled' });

    assert.equal(await store.findActiveSubscription('user_1'), undefined);
  });

  it('is undefined for a user with no subscription at all', async () => {
    const store = newStore();
    assert.equal(await store.findActiveSubscription('user_nobody'), undefined);
  });
});

describe('BillingStore.totalTopupCreditMicroUsd', () => {
  it('is zero with no top-ups', async () => {
    const store = newStore();
    assert.equal(await store.totalTopupCreditMicroUsd('user_1'), 0);
  });

  it('sums every top-up for the user, converting cents to micro-USD', async () => {
    const store = newStore();
    await store.recordTopup('cs_1', 'user_1', 'cus_1', 800);
    await store.recordTopup('cs_2', 'user_1', 'cus_1', 800);
    await store.recordTopup('cs_3', 'user_2', 'cus_2', 800);

    assert.equal(await store.totalTopupCreditMicroUsd('user_1'), 16_000_000);
    assert.equal(await store.totalTopupCreditMicroUsd('user_2'), 8_000_000);
  });

  it('excludes a top-up older than 12 months (L36)', async () => {
    const { store, db } = newStoreWithDb();
    await store.recordTopup('cs_recent', 'user_1', 'cus_1', 800);
    // Older than 12 months: not reachable through recordTopup, which always
    // stamps "now" -- inserted directly to exercise the boundary.
    await db
      .prepare(
        `INSERT INTO billing_topups
           (stripe_checkout_session_id, user_id, stripe_customer_id, credit_usd_cents, created_at)
         VALUES ('cs_old', 'user_1', 'cus_1', 800, datetime('now', '-13 months'))`,
      )
      .run();

    assert.equal(await store.totalTopupCreditMicroUsd('user_1'), 8_000_000);
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
