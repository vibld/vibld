import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  DEFAULT_REQUEST_BUDGET,
  REPLAYED_EVENT_TYPES,
  STRIPE_EVENTS_CURSOR,
  replayStripeEvents,
} from '../worker/billing-replay.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Recovering a payment whose webhook was never delivered.
 *
 * Three earlier attempts read each customer's Checkout and invoice history
 * and died the same death every time: an unbounded read inside a run with a
 * fixed budget, then a bound that turned "never finishes" into "stops early
 * and reports success". These tests are written against that, so most of
 * them are about where the cursor ends up rather than about what was
 * applied.
 */
const SCHEMA = schemaSql();

function newStore(): BillingStore {
  return new BillingStore(new SqliteD1Database(SCHEMA));
}

/** A settled top-up Checkout, which is a payment somebody is owed credit for. */
function topupEvent(
  id: string,
  created: number,
  userId = 'user_1',
): Stripe.Event {
  return {
    id,
    created,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_${id}`,
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 800,
        // One customer per user: the mapping is unique per Stripe customer,
        // and sharing one across users is a fixture that fails for a reason
        // the test is not about.
        customer: `cus_${userId}`,
        metadata: { vibld_user_id: userId, vibld_credit_usd_cents: '800' },
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionEvent(
  id: string,
  created: number,
  status: string,
): Stripe.Event {
  return {
    id,
    created,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status,
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
      },
    },
  } as unknown as Stripe.Event;
}

/**
 * A Stripe that serves the given pages in order, recording what it was asked.
 *
 * Pages rather than a flat list because every interesting property of this
 * sweep is about what happens between one page and the next.
 */
function stripeServing(pages: Stripe.Event[][]) {
  const asked: Stripe.EventListParams[] = [];
  let next = 0;
  return {
    asked,
    stripe: {
      events: {
        async list(params: Stripe.EventListParams) {
          asked.push(params);
          const data = pages[next] ?? [];
          next += 1;
          return { data, has_more: next < pages.length };
        },
      },
    },
  };
}

describe('replaying Stripe events nobody delivered', () => {
  it('applies a top-up whose webhook never arrived', async () => {
    const store = newStore();
    const { stripe } = stripeServing([[topupEvent('evt_1', 1000)]]);

    const result = await replayStripeEvents(stripe, store);

    assert.equal(result.applied, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.incomplete, false);
    assert.equal(await store.hasClearedPayment('user_1'), true);
  });

  it('does not grant a second time for one a delivery already applied', async () => {
    // The normal case on a healthy deployment: every event in the window was
    // delivered, and the sweep is a read that changes nothing.
    const store = newStore();
    const event = topupEvent('evt_1', 1000);
    await store.markEventProcessed(event.id, event.type);
    const { stripe } = stripeServing([[event]]);

    const result = await replayStripeEvents(stripe, store);

    assert.equal(result.read, 1);
    assert.equal(result.applied, 0, 'applied an event that was already done');
  });

  it('asks Stripe only for the types it can apply', async () => {
    // Otherwise a busy account's unrelated events spend the budget, and the
    // payment behind them is the thing that goes unrecovered.
    const store = newStore();
    const { stripe, asked } = stripeServing([[]]);

    await replayStripeEvents(stripe, store);

    assert.deepEqual(asked[0]?.types, REPLAYED_EVENT_TYPES);
  });
});

describe('where a run that ran out of budget leaves the cursor', () => {
  it('resumes below where it stopped, rather than at the top again', async () => {
    // The failure every previous attempt had. A history long enough to
    // exhaust the budget was re-read from the top every night, so it stopped
    // at the same place every night and a payment behind it was never
    // reached.
    const store = newStore();
    const first = topupEvent('evt_new', 3000);
    const second = topupEvent('evt_old', 1000, 'user_2');
    const { stripe, asked } = stripeServing([[first], [second]]);

    const stopped = await replayStripeEvents(stripe, store, undefined, 1);
    assert.equal(stopped.incomplete, true, 'called a partial run complete');
    assert.equal(stopped.applied, 1);

    const resumed = await replayStripeEvents(stripe, store, undefined, 1);

    assert.equal(
      asked[1]?.starting_after,
      'evt_new',
      'started again at the top instead of resuming',
    );
    assert.equal(resumed.applied, 1, 'never reached the second page');
    assert.equal(await store.hasClearedPayment('user_2'), true);
  });

  it('keeps the floor where it was until the descent reaches it', async () => {
    // Raising the floor to the top of a descent that has not finished would
    // declare the unread middle covered, which is the same silent loss with
    // a cursor in front of it.
    const store = newStore();
    const { stripe } = stripeServing([
      [topupEvent('evt_new', 3000)],
      [topupEvent('evt_old', 1000, 'user_2')],
    ]);

    await replayStripeEvents(stripe, store, undefined, 1);
    const midway = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(midway?.doneBelow, 0, 'moved the floor mid-descent');
    assert.equal(midway?.sweepAfterId, 'evt_new');
    assert.ok(midway?.sweepTop, 'forgot the top it has to come back to');

    await replayStripeEvents(stripe, store, undefined, 1);
    const done = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);

    assert.equal(done?.doneBelow, midway?.sweepTop, 'floor did not catch up');
    assert.equal(done?.sweepTop, null, 'left a finished descent open');
    assert.equal(done?.sweepAfterId, null);
  });

  it('holds the top of the descent still while it descends', async () => {
    // A sweep that re-read "now" per page would chase a busy account's new
    // events downward and never reach its own bottom.
    const store = newStore();
    const { stripe, asked } = stripeServing([
      [topupEvent('evt_new', 3000)],
      [topupEvent('evt_old', 1000, 'user_2')],
    ]);
    let clock = 5000;

    await replayStripeEvents(stripe, store, undefined, 1, () => clock);
    clock = 9000;
    await replayStripeEvents(stripe, store, undefined, 1, () => clock);

    assert.equal(
      (asked[1]?.created as { lt: number }).lt,
      5000,
      'raised the ceiling mid-descent',
    );
  });
});

describe('an event the replay could not apply', () => {
  it('does not raise the floor past it', async () => {
    // A failure is ground this run did not cover. Putting it below the floor
    // would lose it for ever, which is exactly the payment this module is
    // here to recover.
    const store = newStore();
    const broken = {
      id: 'evt_broken',
      created: 1000,
      type: 'invoice.paid',
      data: { object: null },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([[broken]]);

    const result = await replayStripeEvents(stripe, store);

    assert.equal(result.failed, 1);
    assert.equal(result.incomplete, true, 'reported a clean run');
    const cursor = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(cursor?.doneBelow, 0, 'stepped over the event that failed');
    assert.ok(cursor?.sweepTop, 'closed a descent that did not finish');
  });

  it('keeps going through the rest of the page', async () => {
    // One unreadable event must not strand the payments either side of it.
    const store = newStore();
    const broken = {
      id: 'evt_broken',
      created: 2000,
      type: 'invoice.paid',
      data: { object: null },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([[broken, topupEvent('evt_1', 1000)]]);

    const result = await replayStripeEvents(stripe, store);

    assert.equal(result.applied, 1);
    assert.equal(result.failed, 1);
    assert.equal(await store.hasClearedPayment('user_1'), true);
  });
});

describe('the order a page is applied in', () => {
  it('takes the oldest first, so the newest state is what survives', async () => {
    // Stripe lists newest first. Applied in that order, the older update
    // lands last and the mirror ends up holding the state that was already
    // superseded.
    const store = newStore();
    const { stripe } = stripeServing([
      [
        subscriptionEvent('evt_new', 3000, 'active'),
        subscriptionEvent('evt_old', 1000, 'incomplete'),
      ],
    ]);

    await replayStripeEvents(stripe, store);

    const row = await store.getSubscription('sub_1');
    assert.equal(row?.status, 'active', 'kept the superseded status');
  });
});

describe('the budget', () => {
  it('is spent on requests and never decides what is reachable', async () => {
    // Twice the budget in pages, which under every previous design was a
    // history that could not be finished. Here it takes three runs.
    const store = newStore();
    const pages = Array.from({ length: DEFAULT_REQUEST_BUDGET * 2 }, (_, n) => [
      topupEvent(`evt_${n}`, 100_000 - n, `user_${n}`),
    ]);
    const { stripe } = stripeServing(pages);

    let runs = 0;
    let result = await replayStripeEvents(stripe, store);
    runs += 1;
    while (result.incomplete && runs < 10) {
      result = await replayStripeEvents(stripe, store);
      runs += 1;
    }

    assert.equal(result.incomplete, false, 'never finished the history');
    for (const n of [0, DEFAULT_REQUEST_BUDGET, pages.length - 1]) {
      assert.equal(
        await store.hasClearedPayment(`user_${n}`),
        true,
        `never reached page ${n}`,
      );
    }
  });
});
