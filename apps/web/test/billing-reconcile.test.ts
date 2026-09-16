import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import { reconcileSubscriptions } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The nightly pass, and the reason it now carries the referral payout too.
 *
 * The webhook is the fast path for "their first purchase cleared". It is not
 * a guaranteed one: a delivery can be missed outright, and Stripe stops
 * retrying a failing one after a few days. This is the path that does not
 * depend on a delivery having happened at all.
 */
const SCHEMA = schemaSql();

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
 *
 * `paidCents` says what each subscription's paid invoices took. It defaults
 * to none, so a test that wants the single-invoice recovery to find
 * something has to say so: the recovery reads only the first entry, which
 * is Stripe's most recent paid invoice. `[0]` is an invoice that is paid in
 * Stripe's sense and took nothing (a trial, or a full coupon), and a
 * negative value is one settled outside Stripe.
 */
function stripeServing(
  statuses: string[],
  listed = statuses,
  paidCents: (subscriptionId: string) => number[] = () => [],
): Stripe {
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
    invoices: {
      async list({ subscription }: { subscription: string }) {
        return {
          data: paidCents(subscription).map((amount, index) => ({
            id: `in_${subscription}_${index}`,
            // Negative means "settled outside Stripe": the invoice reports
            // the full amount paid and Stripe collected none of it.
            amount_paid: Math.abs(amount),
            amount_paid_off_stripe: amount < 0 ? Math.abs(amount) : 0,
            status_transitions: { paid_at: 1_800_000_000 },
          })),
          has_more: false,
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
  it('offers whoever has a recorded payment, whatever their status now', async () => {
    // Status was the wrong question in both directions. A subscriber who
    // paid once and cancelled reads `canceled` for ever, and skipping them
    // is the bug this sweep exists for; a trialing subscriber has been
    // charged nothing, and paying on one makes the trial the thing farmed.
    // What separates them is a recorded payment, not a status.
    const statuses = ['active', 'trialing', 'canceled'];
    const store = await storeWith(statuses);
    await store.recordPayment(
      'in_a',
      'user_active',
      2000,
      '2026-09-01T00:00:00.000Z',
    );
    await store.recordPayment(
      'in_c',
      'user_canceled',
      2000,
      '2026-09-01T00:00:00.000Z',
    );
    const offered: string[] = [];

    const result = await reconcileSubscriptions(
      stripeServing(statuses),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered.sort(), ['user_active', 'user_canceled']);
    assert.equal(result.checked, 3);
    assert.equal(result.failed, 0);
  });

  it('recovers a paying subscriber whose invoice.paid was never delivered', async () => {
    // The case reading `status === 'active'` used to get right, and the one
    // requiring a recorded payment would otherwise lose: a subscriber who
    // really is paying, with nothing local to show for it because the
    // webhook never arrived. A payout silently never made is not something
    // to leave for later.
    const statuses = ['active'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    await reconcileSubscriptions(
      stripeServing(statuses, statuses, () => [2000]),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered, ['user_active']);
    assert.equal(await store.hasClearedPayment('user_active'), true);
  });

  it('does not recover a subscriber whose latest invoice took nothing', async () => {
    // A trial or a fully discounted month is `paid` and collected no money.
    // Recorded truthfully, and it earns nothing.
    const statuses = ['active'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    await reconcileSubscriptions(
      stripeServing(statuses, statuses, () => [0]),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered, []);
    assert.equal(await store.hasClearedPayment('user_active'), false);
  });

  it('does not recover a subscriber whose invoice settled outside Stripe', async () => {
    const statuses = ['active'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    await reconcileSubscriptions(
      stripeServing(statuses, statuses, () => [-2000]),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered, []);
    assert.equal(await store.hasClearedPayment('user_active'), false);
  });

  it('asks Stripe once per subscription, and not at all once payment is recorded', async () => {
    // The whole reason this shape is safe. One request, no pagination, so
    // it cannot stop early while reporting success the way walking the
    // history did. And a subscriber already known to have paid costs no
    // request at all.
    const statuses = ['active'];
    const store = await storeWith(statuses);
    let invoiceCalls = 0;
    const counting = {
      subscriptions: {
        async list() {
          return { data: [subscriptionObject('active')], has_more: false };
        },
        async retrieve() {
          return subscriptionObject('active');
        },
      },
      invoices: {
        async list() {
          invoiceCalls += 1;
          return {
            data: [
              {
                id: 'in_latest',
                amount_paid: 2000,
                amount_paid_off_stripe: 0,
                status_transitions: { paid_at: 1_800_000_000 },
              },
            ],
            has_more: false,
          };
        },
      },
    } as unknown as Stripe;

    await reconcileSubscriptions(counting, store);
    assert.equal(invoiceCalls, 1, 'asked Stripe more than once');

    await reconcileSubscriptions(counting, store);
    assert.equal(invoiceCalls, 1, 'asked again after the payment was known');
  });

  it('does not offer a subscriber whose only payment took nothing', async () => {
    // A zero-amount invoice is `paid` in Stripe's sense and took no money.
    // Recorded truthfully, and it earns nothing.
    const statuses = ['active'];
    const store = await storeWith(statuses);
    await store.recordPayment(
      'in_free',
      'user_active',
      0,
      '2026-09-01T00:00:00.000Z',
    );
    const offered: string[] = [];

    await reconcileSubscriptions(
      stripeServing(statuses),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered, []);
  });

  it('keeps reconciling when one payout throws', async () => {
    // The sweep corrects entitlement state. A reward that cannot be paid
    // tonight must not stop the remaining subscriptions being corrected.
    const statuses = ['active'];
    const store = await storeWith(statuses);
    await store.recordPayment(
      'in_a',
      'user_active',
      2000,
      '2026-09-01T00:00:00.000Z',
    );

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
    await store.recordPayment(
      'in_a',
      'user_active',
      2000,
      '2026-09-01T00:00:00.000Z',
    );
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

describe('Stripe pagination that does not advance', () => {
  /**
   * A cursor that never moves is the difference between a long loop and an
   * endless one. Stripe should never return the same page while claiming
   * more, and the cost of trusting that is a scheduled run that spins
   * inside one record until the Worker is killed, every night, reaching
   * nobody else. Each paginated read is pinned here.
   *
   * `stuck` answers every list call with the same single-item page and
   * `has_more: true`. A loop without the guard never returns, so these
   * tests hang rather than fail, which is its own kind of signal.
   */
  function stuck(item: unknown) {
    return async () => ({ data: [item], has_more: true });
  }

  const subscription = {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { vibld_user_id: 'user_1' },
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

  it('reports a stuck discovery cursor as a failure, not a clean short run', async () => {
    // Breaking out of the loop stops the spin. Reporting it is what stops
    // the stall being invisible: otherwise every night reads the same
    // first pages, stops at the same place, logs success, and every
    // subscription behind that page goes unreconciled with nothing saying
    // so.
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    const stripe = {
      subscriptions: {
        list: stuck(subscription),
        async retrieve() {
          return subscription;
        },
      },
    } as unknown as Stripe;

    const result = await reconcileSubscriptions(stripe, store);

    assert.ok(result.failed > 0, 'a truncated discovery reported success');
  });
});
