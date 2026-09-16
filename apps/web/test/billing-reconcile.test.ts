import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  backfillTopupPayments,
  reconcileSubscriptions,
} from '../worker/billing-handlers.ts';
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
 * `paidCents` says what each subscription's paid invoices took, defaulting
 * to one real charge. It is what the payout now follows: an empty list is a
 * subscription that has never been charged, and `[0]` is one whose invoice
 * is paid in Stripe's sense and took nothing (a trial, or a full coupon).
 */
function stripeServing(
  statuses: string[],
  listed = statuses,
  paidCents: (subscriptionId: string) => number[] = () => [2000],
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
  it('offers whoever Stripe has taken money from, whatever their status now', async () => {
    // Status was the wrong question in both directions. A subscriber who
    // paid once and cancelled reads `canceled` for ever, and skipping them
    // is the bug this sweep exists for; a trialing subscriber has been
    // charged nothing, and paying on one makes the trial the thing farmed.
    const statuses = ['active', 'trialing', 'canceled'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    const result = await reconcileSubscriptions(
      stripeServing(statuses, statuses, (id) =>
        id === 'sub_trialing' ? [] : [2000],
      ),
      store,
      async (userId) => {
        offered.push(userId);
      },
    );

    assert.deepEqual(offered.sort(), ['user_active', 'user_canceled']);
    assert.equal(result.checked, 3);
    assert.equal(result.failed, 0);
  });

  it('does not offer a subscriber whose paid invoices took nothing', async () => {
    // `paid` is Stripe's word for settled, not for charged. A zero-amount
    // invoice is paid and took no money, and treating it as a purchase is a
    // way to earn referral credit for free.
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

  it('does not offer a subscriber whose invoices were settled outside Stripe', async () => {
    // Marked paid by hand rather than collected. `amount_paid` is populated
    // and no money moved through Stripe, so the same rule the webhook uses
    // has to apply here too.
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

  it('records the invoices it read, so the payout sweep can see them', async () => {
    // The delivery-independent half. If `invoice.paid` never arrived,
    // nothing local says the money cleared, and this is what repairs that.
    const statuses = ['canceled'];
    const store = await storeWith(statuses);

    await reconcileSubscriptions(stripeServing(statuses), store);

    assert.equal(await store.hasClearedPayment('user_canceled'), true);
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

describe('backfillTopupPayments', () => {
  /**
   * A Stripe that reports the given Checkout Sessions for one customer.
   *
   * `sessions` are `[mode, payment_status, amount_total]` triples, which is
   * exactly the three things the backfill decides on.
   */
  let listCalls = 0;

  function stripeWithSessions(
    sessions: Array<[string, string, number]>,
  ): Stripe {
    return {
      checkout: {
        sessions: {
          async list() {
            listCalls += 1;
            return {
              data: sessions.map(([mode, payment_status, amount], index) => ({
                id: `cs_${index}`,
                mode,
                payment_status,
                amount_total: amount,
                created: 1_800_000_000,
              })),
              has_more: false,
            };
          },
        },
      },
    } as unknown as Stripe;
  }

  async function storeWithCustomer(): Promise<BillingStore> {
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    await store.linkCustomer('user_1', 'cus_1');
    return store;
  }

  it('records a settled top-up nothing else could reconstruct', async () => {
    // The hole this closes. A top-up taken before `billing_payments` existed
    // leaves only a `billing_topups` row, which records credit granted and
    // not money taken, so the account reads as never having paid and the
    // attribution behind it is stranded for ever.
    const store = await storeWithCustomer();
    const paid: string[] = [];

    const result = await backfillTopupPayments(
      stripeWithSessions([['payment', 'paid', 500]]),
      store,
      async (userId) => {
        paid.push(userId);
      },
    );

    assert.equal(await store.hasClearedPayment('user_1'), true);
    assert.deepEqual(paid, ['user_1']);
    assert.equal(result.cleared, 1);
    assert.equal(result.failed, 0);
  });

  it('does not count a Checkout that owed nothing', async () => {
    const store = await storeWithCustomer();
    const paid: string[] = [];

    await backfillTopupPayments(
      stripeWithSessions([['payment', 'no_payment_required', 0]]),
      store,
      async (userId) => {
        paid.push(userId);
      },
    );

    assert.equal(await store.hasClearedPayment('user_1'), false);
    assert.deepEqual(paid, []);
  });

  it('ignores a session that never settled', async () => {
    const store = await storeWithCustomer();

    await backfillTopupPayments(
      stripeWithSessions([['payment', 'unpaid', 500]]),
      store,
    );

    assert.equal(await store.hasClearedPayment('user_1'), false);
  });

  it('leaves subscription checkouts to the invoice path, to avoid counting twice', async () => {
    // A subscription Checkout's money arrives as an invoice and is recorded
    // there. Recording the session as well would put the same charge in the
    // table under two keys.
    const store = await storeWithCustomer();

    await backfillTopupPayments(
      stripeWithSessions([['subscription', 'paid', 2000]]),
      store,
    );

    assert.equal(await store.hasClearedPayment('user_1'), false);
  });

  it('does not read or pay a covered customer again the next night', async () => {
    // An unbounded nightly scan re-read every customer's whole Checkout
    // history for ever and offered every paid account to the payout again.
    // The stamp is what stops both, so both are asserted.
    const store = await storeWithCustomer();
    const stripe = stripeWithSessions([['payment', 'paid', 500]]);
    const paid: string[] = [];
    const pay = async (userId: string) => {
      paid.push(userId);
    };

    listCalls = 0;
    await backfillTopupPayments(stripe, store, pay);
    const afterFirst = listCalls;

    const again = await backfillTopupPayments(stripe, store, pay);

    assert.equal(again.checked, 0);
    assert.equal(listCalls, afterFirst, 'Stripe read again');
    assert.deepEqual(paid, ['user_1'], 'payout offered twice');
    assert.equal(await store.hasClearedPayment('user_1'), true);
  });

  it('takes at most the limit it is given, and the rest next time', async () => {
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    for (const n of [1, 2, 3])
      await store.linkCustomer(`user_${n}`, `cus_${n}`);
    const stripe = stripeWithSessions([['payment', 'paid', 500]]);

    const first = await backfillTopupPayments(stripe, store, undefined, 2);
    const second = await backfillTopupPayments(stripe, store, undefined, 2);
    const third = await backfillTopupPayments(stripe, store, undefined, 2);

    assert.equal(first.checked, 2);
    assert.equal(second.checked, 1);
    assert.equal(third.checked, 0, 'did not terminate');
  });

  it('reaches later customers even though an earlier one always fails', async () => {
    // A Stripe customer deleted out from under the mapping fails every
    // night for ever. Ordered by age alone it leads every run, and with a
    // limit enough such rows hold every slot: the set stops converging and
    // nothing reports that it has.
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    await store.linkCustomer('user_bad', 'cus_bad');
    await store.linkCustomer('user_good', 'cus_good');

    const stripe = {
      checkout: {
        sessions: {
          async list({ customer }: { customer: string }) {
            if (customer === 'cus_bad') throw new Error('no such customer');
            return {
              data: [
                {
                  id: 'cs_1',
                  mode: 'payment',
                  payment_status: 'paid',
                  amount_total: 500,
                  created: 1_800_000_000,
                },
              ],
              has_more: false,
            };
          },
        },
      },
    } as unknown as Stripe;

    // One slot a night, and the failing customer is the older row.
    for (let night = 0; night < 3; night += 1) {
      await backfillTopupPayments(stripe, store, undefined, 1);
    }

    assert.equal(
      await store.hasClearedPayment('user_good'),
      true,
      'starved by the failing customer',
    );
  });

  it('comes back to a customer whose history could not be read', async () => {
    // Stamped only after a complete read. A customer marked done on a
    // failed read would never be reconciled, which is the failure the
    // backfill exists to prevent.
    const store = await storeWithCustomer();
    const failing = {
      checkout: {
        sessions: {
          async list() {
            throw new Error('stripe unavailable');
          },
        },
      },
    } as unknown as Stripe;

    const first = await backfillTopupPayments(failing, store);
    assert.equal(first.failed, 1);

    const retry = await backfillTopupPayments(
      stripeWithSessions([['payment', 'paid', 500]]),
      store,
    );

    assert.equal(retry.checked, 1, 'gave up on a customer it never read');
    assert.equal(await store.hasClearedPayment('user_1'), true);
  });
});
