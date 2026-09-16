import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
          // A descent that goes back to the top starts this walk again, which
          // is what re-reading the sweep means. Without it a re-walk would
          // read nothing and a test of one could not tell the difference.
          if (params.starting_after === undefined) next = 0;
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

    const stopped = await replayStripeEvents(stripe, store, 1);
    assert.equal(stopped.incomplete, true, 'called a partial run complete');
    assert.equal(stopped.applied, 1);

    const resumed = await replayStripeEvents(stripe, store, 1);

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

    await replayStripeEvents(stripe, store, 1);
    const midway = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(midway?.doneBelow, 0, 'moved the floor mid-descent');
    assert.equal(midway?.sweepAfterId, 'evt_new');
    assert.ok(midway?.sweepTop, 'forgot the top it has to come back to');

    await replayStripeEvents(stripe, store, 1);
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

    await replayStripeEvents(stripe, store, 1, () => clock);
    clock = 9000;
    await replayStripeEvents(stripe, store, 1, () => clock);

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

    // The run after it, which is where the first version of this test
    // stopped and where the bug was. Leaving the resume point below the
    // failed page sent the next run past the event, let it finish clean, and
    // moved the floor over the failure anyway: the same silent loss, one run
    // later. So the next run has to read the failed event again.
    const again = await replayStripeEvents(stripe, store);
    assert.equal(again.read, 1, 'never went back for the event that failed');
    assert.equal(again.failed, 1);
    const after = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(after?.doneBelow, 0, 'moved the floor on the second run');
  });

  it('lets the floor move once the failure clears', async () => {
    // The other half, and what makes the stall a stall rather than a
    // deadlock: a sweep that fails is re-walked, and a re-walk that works
    // finishes. Without this the test above is satisfied by a cursor that
    // can never advance at all.
    const store = newStore();
    let broken = true;
    const stripe = {
      events: {
        async list() {
          return {
            data: [
              broken
                ? ({
                    id: 'evt_1',
                    created: 1000,
                    type: 'invoice.paid',
                    data: { object: null },
                  } as unknown as Stripe.Event)
                : topupEvent('evt_1', 1000),
            ],
            has_more: false,
          };
        },
      },
    };

    const failing = await replayStripeEvents(stripe, store);
    assert.equal(failing.incomplete, true);

    broken = false;
    const clean = await replayStripeEvents(stripe, store);

    assert.equal(clean.incomplete, false, 'stayed stalled after it was fixed');
    assert.equal(await store.hasClearedPayment('user_1'), true);
    const cursor = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.ok(cursor && cursor.doneBelow > 0, 'floor never caught up');
    assert.equal(cursor?.sweepTop, null);
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

describe('what the nightly pass hands the replay', () => {
  // The worker entry imports `cloudflare:workers` and cannot be loaded here,
  // so this reads its source. The same reason `access-gate.test.ts` reads it.
  const WORKER = fileURLToPath(new URL('../worker/', import.meta.url));

  it('does not give it the referral payout hook', async () => {
    // `announceIfPaid` lets a failed payout fail the delivery, which is right
    // for a webhook because Stripe retries it. Nothing retries the replay, so
    // the same throw would hold the floor and stop every future payment being
    // recovered over a bug in an unrelated subsystem.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');

    assert.match(source, /replayStripeEvents\(stripe, billing\)/);
    assert.doesNotMatch(
      source,
      /replayStripeEvents\(stripe, billing, cleared\)/,
      'a payout failure can stall the recovery again',
    );
  });

  it('pays out after it, so tonight rather than tomorrow', async () => {
    // `payoutsToRetry` finds anybody with a cleared payment and no payout, so
    // it does not need to be told. It does need to run after the thing that
    // records the payment.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const replay = source.indexOf('replayStripeEvents(stripe, billing)');
    const payouts = source.indexOf('resumeStrandedPayouts(payout)');

    assert.ok(replay > 0 && payouts > 0, 'the nightly pass lost a step');
    assert.ok(
      payouts > replay,
      'the payout resume runs before the payments it would pay on',
    );
  });
});

describe('a failure on a page with more below it', () => {
  it('is still read again when the budget runs out under it', async () => {
    // The door the first fix did not cover. Rewinding only where the descent
    // reaches the bottom leaves the resume point below a failed page
    // whenever the run leaves any other way, and the budget running out is
    // the ordinary way. The next run's `failed` starts at zero, so it
    // resumes under the failed event, finishes clean, and moves the floor
    // over the payment.
    const store = newStore();
    const broken = {
      id: 'evt_broken',
      created: 3000,
      type: 'invoice.paid',
      data: { object: null },
    } as unknown as Stripe.Event;
    const { stripe, asked } = stripeServing([
      [broken],
      [topupEvent('evt_old', 1000, 'user_2')],
    ]);

    const stopped = await replayStripeEvents(stripe, store, 1);
    assert.equal(stopped.failed, 1);
    assert.equal(stopped.incomplete, true);

    const cursor = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(
      cursor?.sweepAfterId,
      null,
      'left the resume point below the page that failed',
    );

    await replayStripeEvents(stripe, store, 1);
    assert.equal(
      asked[1]?.starting_after,
      undefined,
      'the next run skipped past the event that failed',
    );
    const after = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(after?.doneBelow, 0, 'moved the floor over the failure');
  });

  it('keeps the top of the descent even when the first page fails', async () => {
    // Nothing else is persisted on that run, so without a write before the
    // first request the sweep would forget its own top and the next run
    // would pin a later one, quietly narrowing what this descent covers.
    const store = newStore();
    const broken = {
      id: 'evt_broken',
      created: 3000,
      type: 'invoice.paid',
      data: { object: null },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([[broken], [topupEvent('evt_old', 1000)]]);

    await replayStripeEvents(stripe, store, 1, () => 5000);
    const cursor = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);

    assert.equal(cursor?.sweepTop, 5000, 'forgot the top of the descent');
  });
});
