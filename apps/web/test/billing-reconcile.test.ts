import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import { reconcileSubscriptions } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The nightly pass, and the reason it now carries the referral payout too.
 *
 * The webhook is the fast path for "their first purchase cleared". It is not
 * a guaranteed one: a delivery can be missed outright, and Stripe stops
 * retrying a failing one after a few days. This is the path that does not
 * depend on a delivery having happened at all.
 */
const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0002_billing.sql'),
  'utf8',
);

function record(status: string) {
  return {
    stripeSubscriptionId: `sub_${status}`,
    userId: `user_${status}`,
    stripeCustomerId: 'cus_1',
    tier: 'build' as const,
    status,
    priceId: 'price_build_monthly',
    currentPeriodEnd: '2026-10-16T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  };
}

/** A Stripe that reports every subscription exactly as it was mirrored. */
function stripeServing(statuses: string[]): Stripe {
  return {
    subscriptions: {
      async retrieve(id: string) {
        const status = statuses.find((candidate) => `sub_${candidate}` === id)!;
        return {
          id,
          customer: 'cus_1',
          status,
          cancel_at_period_end: false,
          metadata: { vibld_user_id: `user_${status}` },
          items: {
            data: [
              {
                current_period_end: 1_800_000_000,
                price: {
                  id: 'price_build_monthly',
                  lookup_key: 'vibld_build_monthly',
                },
              },
            ],
          },
        };
      },
    },
  } as unknown as Stripe;
}

async function storeWith(statuses: string[]): Promise<BillingStore> {
  const store = new BillingStore(new SqliteD1Database(SCHEMA));
  for (const status of statuses) await store.upsertSubscription(record(status));
  return store;
}

describe('reconcileSubscriptions', () => {
  it('offers every active subscriber to the payout, and nobody else', async () => {
    const statuses = ['active', 'trialing', 'canceled'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    const result = await reconcileSubscriptions(
      stripeServing(statuses),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered, ['user_active']);
    assert.equal(result.checked, 3);
    assert.equal(result.failed, 0);
  });

  it('keeps reconciling when one payout throws', async () => {
    // The sweep corrects entitlement state. A reward that cannot be paid
    // tonight must not stop the remaining subscriptions being corrected.
    const statuses = ['active'];
    const store = await storeWith(statuses);

    const result = await reconcileSubscriptions(
      stripeServing(statuses),
      store,
      async () => {
        throw new Error('D1 unavailable');
      },
    );

    assert.equal(result.checked, 1);
    assert.equal(result.failed, 1);
  });

  it('still reconciles with no payout hook at all', async () => {
    const statuses = ['active'];
    const store = await storeWith(statuses);

    const result = await reconcileSubscriptions(stripeServing(statuses), store);

    assert.equal(result.checked, 1);
    assert.equal(result.failed, 0);
  });
});
