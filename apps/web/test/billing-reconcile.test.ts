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
const SCHEMA = ['0002_billing.sql', '0008_subscription_payments.sql']
  .map((name) =>
    readFileSync(join(import.meta.dirname, '..', 'migrations', name), 'utf8'),
  )
  .join('\n');

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

function subscriptionObject(status: string) {
  return {
    id: `sub_${status}`,
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
}

/**
 * A Stripe that reports the given subscriptions, both by id and in its list.
 *
 * `listed` defaults to everything, which is the normal case. Passing a
 * smaller set is how the discovery tests describe "Stripe knows about this
 * one and the mirror does not".
 */
function stripeServing(statuses: string[], listed = statuses): Stripe {
  return {
    subscriptions: {
      async list() {
        return { data: listed.map(subscriptionObject), has_more: false };
      },
      async retrieve(id: string) {
        const status = statuses.find((candidate) => `sub_${candidate}` === id)!;
        return subscriptionObject(status);
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

describe('reconcileSubscriptions: discovery', () => {
  it('reconciles a subscription Stripe knows about and the mirror does not', async () => {
    // The hole this closes. A subscriber whose first
    // customer.subscription.created delivery was missed has no row here, and
    // a subscription-mode checkout only links the customer, so iterating the
    // mirror alone never reaches them and their referral is never paid.
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    const offered: string[] = [];

    const result = await reconcileSubscriptions(
      stripeServing(['active']),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.equal(result.discovered, 1);
    assert.equal(result.checked, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(offered, ['user_active']);
  });

  it('mirrors the subscription it discovered, so it is known next time', async () => {
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    await reconcileSubscriptions(stripeServing(['active']), store);

    assert.equal(
      (await store.getSubscription('sub_active'))?.userId,
      'user_active',
    );
    // Second pass: already mirrored, so nothing new to find.
    const again = await reconcileSubscriptions(
      stripeServing(['active']),
      store,
    );
    assert.equal(again.discovered, 0);
    assert.equal(again.checked, 1);
  });

  it('counts a mirrored subscription once, not twice', async () => {
    const statuses = ['active'];
    const store = await storeWith(statuses);

    const result = await reconcileSubscriptions(stripeServing(statuses), store);

    assert.equal(result.checked, 1);
    assert.equal(result.discovered, 0);
  });

  it('still reconciles a mirrored subscription Stripe does not list', async () => {
    // Stripe's list is the discovery source, not the authority on what to
    // check: a subscription already mirrored still gets re-read.
    const statuses = ['active'];
    const store = await storeWith(statuses);

    const result = await reconcileSubscriptions(
      stripeServing(statuses, []),
      store,
    );

    assert.equal(result.checked, 1);
    assert.equal(result.failed, 0);
  });
});
