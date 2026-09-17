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

  it("keeps reconciling when one subscriber's invoice lookup fails", async () => {
    // The recovery is one request with no retry. If Stripe refuses it, that
    // subscription's iteration is counted as a failure and tried again
    // tomorrow, and the subscriptions behind it are still reconciled. A
    // single bad account must not cost the whole run.
    const statuses = ['active', 'canceled'];
    const store = await storeWith(statuses);
    const offered: string[] = [];

    const stripe = {
      subscriptions: {
        async list() {
          return { data: statuses.map(subscriptionObject), has_more: false };
        },
        async retrieve(id: string) {
          const status = statuses.find((s) => `sub_${s}` === id)!;
          return subscriptionObject(status);
        },
      },
      invoices: {
        async list({ subscription }: { subscription: string }) {
          if (subscription === 'sub_active') throw new Error('stripe down');
          return {
            data: [
              {
                id: 'in_ok',
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

    const result = await reconcileSubscriptions(stripe, store, async (u) => {
      offered.push(u);
    });

    assert.equal(result.failed, 1, 'the failure was not reported');
    assert.deepEqual(offered, ['user_canceled'], 'the healthy one was skipped');
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

  it('reports an empty page that claims more as truncated too', async () => {
    // The other shape of "there is more and I cannot reach it": a page with
    // nothing in it to take a cursor from. Exiting quietly here is the same
    // silent stall as a repeated cursor, and it was still classified as a
    // clean end after the repeated-cursor case was fixed.
    //
    // Nothing is discovered, so no subscription is processed and the only
    // thing that can raise `failed` is the truncation itself.
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    const stripe = {
      subscriptions: {
        async list() {
          return { data: [], has_more: true };
        },
        async retrieve() {
          return subscription;
        },
      },
    } as unknown as Stripe;

    const result = await reconcileSubscriptions(stripe, store);

    assert.equal(result.checked, 0, 'something else was reconciled');
    assert.equal(result.failed, 1, 'an empty has-more page reported success');
  });

  it('reports a stuck discovery cursor as a failure, not a clean short run', async () => {
    // Breaking out of the loop stops the spin. Reporting it is what stops
    // the stall being invisible: otherwise every night reads the same
    // first pages, stops at the same place, logs success, and every
    // subscription behind that page goes unreconciled with nothing saying
    // so.
    //
    // The invoice lookup has to succeed here. Without it the discovered
    // subscription throws on a missing `invoices.list` and `failed` is 1
    // for that reason instead, which made this pass with the truncation
    // reporting removed entirely.
    const store = new BillingStore(new SqliteD1Database(SCHEMA));
    const stripe = {
      subscriptions: {
        list: stuck(subscription),
        async retrieve() {
          return subscription;
        },
      },
      invoices: {
        async list() {
          return {
            data: [
              {
                id: 'in_ok',
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

    const result = await reconcileSubscriptions(stripe, store);

    assert.equal(result.failed, 1, 'the truncated discovery was not reported');
  });
});

/**
 * The walk, once it stopped being unbounded (#47).
 *
 * `reconcileSubscriptions` checked every subscription on every run, with
 * nothing bounding it, in an invocation whose D1 allowance three other
 * phases had already drawn on. Past about a hundred subscriptions D1 throws,
 * the scheduled handler catches the throw and logs it, and the reconcile
 * stops happening: drift goes uncorrected and a payout whose `invoice.paid`
 * never arrived is never recovered, silently, every night after.
 *
 * A bound alone would be the failure 0009_event_replay.sql was written from,
 * three times over: it turns "never finishes" into "stops early and reports
 * success". So the bound comes with a resume point, and what these tests are
 * really about is that nothing is skipped.
 */
describe('the reconcile walk', () => {
  /** Sorted, because that is the order the walk uses. */
  const FIVE = ['a', 'b', 'c', 'd', 'e'];

  async function walk(
    store: BillingStore,
    limit: number,
  ): Promise<{ seen: string[]; remaining: number }> {
    const seen: string[] = [];
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;
    const result = await reconcileSubscriptions(
      stripe,
      store,
      undefined,
      limit,
    );
    return { seen, remaining: result.remaining };
  }

  it('checks only as many as it was given', async () => {
    const store = await storeWith(FIVE);
    const first = await walk(store, 2);
    assert.equal(first.seen.length, 2);
    assert.equal(first.remaining, 3);
  });

  it('carries on where the last run stopped, and skips nobody', async () => {
    // The whole point. A bound that restarted at the top every night would
    // check the same two for ever and never reach the other three.
    const store = await storeWith(FIVE);
    const seen: string[] = [];
    for (let run = 0; run < 3; run += 1) {
      seen.push(...(await walk(store, 2)).seen);
    }
    assert.deepEqual(
      [...seen].sort(),
      FIVE.map((s) => `sub_${s}`).sort(),
      'a full lap did not cover every subscription',
    );
    assert.equal(new Set(seen).size, FIVE.length, 'it checked one twice');
  });

  it('walks in one stable order however the two sources are ordered', async () => {
    // The merged list is the mirror plus whatever Stripe's list adds that
    // the mirror did not have, and the second half lands after the first
    // whatever its ids are. Here the mirror holds the two that sort last, so
    // the merged order is d, e, a, b, c. Walking that directly with a cursor
    // that means "after this id" reaches e, finds nothing above it, and
    // starts again at d: a, b and c are never checked on any night, which is
    // the exact failure 0009_event_replay.sql was written from.
    const store = await storeWith(['d', 'e']);
    const seen: string[] = [];
    for (let run = 0; run < 3; run += 1) {
      seen.push(...(await walk(store, 2)).seen);
    }
    assert.deepEqual(
      [...new Set(seen)].sort(),
      FIVE.map((name) => `sub_${name}`),
      'the walk never reached the ids Stripe discovered',
    );
  });

  it('laps, so a subscription is never checked once and forgotten', async () => {
    // Reaching the end clears the cursor rather than leaving it at the last
    // id. Otherwise the walk stops at the end of the list and the first
    // subscription is never re-checked.
    const store = await storeWith(FIVE);
    for (let run = 0; run < 3; run += 1) await walk(store, 2);
    const next = await walk(store, 2);
    assert.deepEqual(next.seen, ['sub_a', 'sub_b'], 'the walk did not lap');
  });

  it('says how many it did not reach', async () => {
    // The lie 0009_event_replay.sql was written about is a run that stops
    // early and reports success. The count is what makes a deployment whose
    // share never covers its list visible rather than silent.
    const store = await storeWith(FIVE);
    assert.equal((await walk(store, 2)).remaining, 3);
    assert.equal((await walk(store, 2)).remaining, 1);
    assert.equal((await walk(store, 2)).remaining, 0);
  });

  it('checks everything in one run when the share allows it', async () => {
    const store = await storeWith(FIVE);
    const { seen, remaining } = await walk(store, 50);
    assert.equal(seen.length, FIVE.length);
    assert.equal(remaining, 0);
  });

  it('does not lose its place when a subscription disappears', async () => {
    // The cursor holds an id, and the search is for the next one above it,
    // so an id that has since gone costs nothing. Holding an index instead
    // would silently shift the whole walk.
    const store = await storeWith(FIVE);
    await walk(store, 2);
    const stripe = stripeServing(['c', 'd', 'e']);
    const seen: string[] = [];
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_c', 'sub_d']);
  });

  it('comes back to a subscription that threw, on the very next run', async () => {
    // It used to walk straight past: the cursor advanced over the whole
    // slice whatever happened inside it, so a transient Stripe or D1 failure
    // left an entitlement uncorrected until the walk lapped.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    let throwOn: string | null = 'sub_b';
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (id === throwOn) throw new Error('Stripe is having a day');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    const first = await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_a', 'sub_b']);
    assert.equal(first.failed, 1);
    assert.equal(first.remaining, 4, 'it reported the failure as covered');

    seen.length = 0;
    throwOn = null;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_b', 'sub_c'], 'it walked past the failure');
  });

  it('walks past a subscription that keeps failing, rather than starving the rest', async () => {
    // The opposite failure, and the worse one. A row that fails every night
    // holding the front of the queue is exactly what `resumeStrandedPayouts`
    // stamps each attempt to avoid. So the hold lasts one night.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (id === 'sub_b') throw new Error('this one is broken for good');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    await reconcileSubscriptions(stripe, store, undefined, 2);
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_b', 'sub_c'], 'the retry did not happen');
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(
      seen,
      ['sub_d', 'sub_e'],
      'a permanently broken subscription held the front of the queue',
    );
  });

  it('gives a first-time failure its own retry, even during a retry run', async () => {
    // The distinction a boolean could not make. While retrying `sub_b`, a
    // different subscription failing for the first time found the flag
    // already set and was walked past with no retry of its own -- the exact
    // delay the retry exists to remove, moved one subscription along.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    let broken = new Set(['sub_b']);
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (broken.has(id)) throw new Error('not today');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    // Run one: a, b. b fails, so the walk parks before it.
    await reconcileSubscriptions(stripe, store, undefined, 2);

    // Run two: b succeeds this time, and c fails for the first time.
    broken = new Set(['sub_c']);
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_b', 'sub_c']);

    // Run three has to come back to c rather than walking past it.
    broken = new Set();
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(
      seen,
      ['sub_c', 'sub_d'],
      'a first-time failure during a retry run got no retry of its own',
    );
  });

  it('retries a whole slice of failures in one night, not one a night', async () => {
    // What naming a single id could not do. Two failures in a slice, and
    // only the earliest was recorded: the second was on its own second
    // attempt but its id differed from the one named, so it read as
    // first-time, parked the cursor again and took a third. A slice of
    // failing subscriptions therefore advanced one id a night, with every
    // healthy subscription behind them waiting.
    //
    // The watermark says what an id cannot: the whole slice was attempted.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    const broken = new Set(['sub_b', 'sub_c']);
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (broken.has(id)) throw new Error('both of these are broken for good');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    // Run one: a, b, c. Two failures, so the walk parks before the earlier.
    await reconcileSubscriptions(stripe, store, undefined, 3);

    // Run two retries both of them and moves on, rather than parking again
    // on the second and giving it a third attempt.
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 3);
    assert.deepEqual(seen, ['sub_b', 'sub_c', 'sub_d']);

    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 3);
    assert.deepEqual(
      seen,
      ['sub_e'],
      'the second failure in the slice parked the walk all over again',
    );
  });

  it('gives a subscription created overnight its own first attempt', async () => {
    // What a range could not do, however it was drawn. Recording "attempted
    // up to sub_c" is true of the ids that were there, and the set changes
    // between runs: Stripe ids are random, so a subscription created
    // overnight can sort anywhere, here between sub_b and sub_c. Failing on
    // its first appearance it would be inside the attempted range, read as
    // a retry, and walked past with no attempt of its own.
    //
    // Membership is the question, so membership is what is stored.
    const statuses = [...FIVE];
    const store = await storeWith(statuses);
    const stripe = stripeServing(statuses);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    let broken = new Set(['sub_b']);
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (broken.has(id)) throw new Error('not today');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    // Run one: a, b, c. b fails, so the walk parks before it.
    await reconcileSubscriptions(stripe, store, undefined, 3);

    // Overnight, somebody subscribes, and their id sorts inside the ground
    // the parked run covered.
    statuses.push('bb');
    await store.upsertSubscription(record('bb'));

    // Run two: b is fine now, and the newcomer fails on first sight.
    broken = new Set(['sub_bb']);
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 3);
    assert.deepEqual(seen, ['sub_b', 'sub_bb', 'sub_c']);

    // Run three has to come back to it.
    broken = new Set();
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 3);
    assert.deepEqual(
      seen,
      ['sub_bb', 'sub_c', 'sub_d'],
      'a subscription that had never been attempted was counted as retried',
    );
  });

  it('gives a subscription that succeeded last night its own retry', async () => {
    // Recording the whole attempted slice counted a subscription that
    // succeeded as having spent a retry it never needed. When it then threw
    // on the following run, on its first failure, it was read as a retry
    // already had and walked past, waiting a full lap.
    //
    // What "has had its retry" means is "failed and was tried again", so
    // the failures are what the cursor keeps.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    let broken = new Set(['sub_a']);
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (broken.has(id)) throw new Error('not today');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    // Run one: a fails, b succeeds. The walk parks before a.
    await reconcileSubscriptions(stripe, store, undefined, 2);

    // Run two: a is fine now, and b throws for the first time.
    broken = new Set(['sub_b']);
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_a', 'sub_b']);

    // Run three has to come back to b. It has failed once and been retried
    // never, whatever it did on the run before that.
    broken = new Set();
    seen.length = 0;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(
      seen,
      ['sub_b', 'sub_c'],
      'a subscription that succeeded once was counted as having had its retry',
    );
  });

  it('stays put when the first subscription in the slice throws', async () => {
    // The edge the arithmetic gets wrong if it reaches for `ids[-1]`: the
    // failure is the first thing in the slice, so there is no earlier id to
    // park before and the walk has to stay exactly where it started.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const real = stripe.subscriptions.retrieve.bind(stripe.subscriptions);
    let broken = true;
    const seen: string[] = [];
    stripe.subscriptions.retrieve = (async (id: string) => {
      seen.push(id);
      if (id === 'sub_a' && broken) throw new Error('nope');
      return real(id);
    }) as typeof stripe.subscriptions.retrieve;

    const first = await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.equal(first.remaining, 5, 'it reported ground it had not covered');

    seen.length = 0;
    broken = false;
    await reconcileSubscriptions(stripe, store, undefined, 2);
    assert.deepEqual(seen, ['sub_a', 'sub_b']);
  });

  it('checks everything when given no limit at all', async () => {
    // The default is what every existing caller and test relies on.
    const store = await storeWith(FIVE);
    const stripe = stripeServing(FIVE);
    const result = await reconcileSubscriptions(stripe, store);
    assert.equal(result.checked, FIVE.length);
    assert.equal(result.remaining, 0);
  });
});
