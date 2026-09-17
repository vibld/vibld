import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  DEFAULT_QUERY_BUDGET,
  DEFAULT_REQUEST_BUDGET,
  pageSizeFor,
  parkedReserveFor,
  payoutBatchFor,
  payoutReserveFor,
  reconcileBatchFor,
  reconcileReserveFor,
  replayBudgetFor,
  retryBatchFor,
  REPLAYED_EVENT_TYPES,
  STRIPE_EVENTS_CURSOR,
  replayStripeEvents,
  retryUnattributedEvents,
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

    // A query budget wide enough that the request budget is what this
    // measures. The D1 ceiling has its own tests below.
    let runs = 0;
    let result = await replayStripeEvents(
      stripe,
      store,
      undefined,
      undefined,
      9000,
    );
    runs += 1;
    while (result.incomplete && runs < 10) {
      result = await replayStripeEvents(
        stripe,
        store,
        undefined,
        undefined,
        9000,
      );
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

    assert.match(source, /replayStripeEvents\(\s*stripe,\s*billing,/);
    assert.doesNotMatch(
      source,
      /replayStripeEvents\([^)]*\bcleared\b/,
      'a payout failure can stall the recovery again',
    );
  });

  it('pays out after it, so tonight rather than tomorrow', async () => {
    // `payoutsToRetry` finds anybody with a cleared payment and no payout, so
    // it does not need to be told. It does need to run after the thing that
    // records the payment.
    const source = await readFile(join(WORKER, 'index.ts'), 'utf8');
    const replay = source.indexOf('replayStripeEvents(');
    const payouts = source.indexOf('resumeStrandedPayouts(');

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

describe('an event whose owner this deployment cannot work out yet', () => {
  it('is not marked done, and is read again', async () => {
    // A descent reads newest first, so a missed `invoice.paid` can be read
    // before the older Checkout that creates its customer mapping. The
    // invoice has nobody to attribute to yet and writes nothing. Recording
    // it as handled on that normal return loses a real payment for ever:
    // the mapping arrives later, and nothing ever looks at the invoice
    // again.
    const store = newStore();
    const invoice = {
      id: 'evt_invoice',
      created: 3000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_user_1',
          amount_paid: 2000,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([
      [invoice],
      [topupEvent('evt_checkout', 1000)],
    ]);

    const first = await replayStripeEvents(stripe, store, 1);
    assert.equal(first.unresolved, 1, 'attributed an invoice it could not');
    assert.equal(first.applied, 0);
    assert.equal(
      await store.wasEventProcessed('evt_invoice'),
      false,
      'marked an event done that wrote nothing',
    );

    const parked = await store.listUnattributedEvents();
    assert.equal(parked.length, 1, 'dropped an event it could not attribute');
    assert.equal(parked[0]?.stripeEventId, 'evt_invoice');
  });

  it('does not pin the sweep while it waits', async () => {
    // Freezing the sweep on an unattributable event looks like the safe
    // direction and is the opposite. Stripe keeps events about 30 days, so a
    // freeze holds the cursor still while the retention boundary moves: one
    // event nobody can ever attribute, a subscription on a price this
    // deployment does not know, would cost every payment missed after it.
    // The freeze causes the loss it was meant to prevent.
    const store = newStore();
    const foreign = {
      id: 'evt_foreign',
      created: 3000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_x',
          customer: 'cus_nobody',
          amount_paid: 500,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([[foreign]]);

    const result = await replayStripeEvents(stripe, store, 5, () => 9000, 9000);

    assert.equal(result.unresolved, 1);
    assert.equal(result.incomplete, false, 'froze the sweep on it');
    const cursor = await store.getEventReplayCursor(STRIPE_EVENTS_CURSOR);
    assert.equal(cursor?.doneBelow, 9000, 'the floor never moved past it');
    assert.equal(cursor?.sweepTop, null, 'left the descent open for ever');
  });

  it('resolves once the older event that maps the customer is applied', async () => {
    // The whole reason the retry is worth having. The Checkout further down
    // the same descent links the customer, and the next run finds it.
    const store = newStore();
    const invoice = {
      id: 'evt_invoice',
      created: 3000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_user_1',
          amount_paid: 2000,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([
      [invoice],
      [topupEvent('evt_checkout', 1000)],
    ]);

    // One run over the whole descent: the invoice is parked, and the
    // Checkout below it links the customer. Given room for both pages.
    await replayStripeEvents(stripe, store, undefined, undefined, 9000);
    assert.equal((await store.listUnattributedEvents()).length, 1);

    // The local retry comes back for it, and now there is an owner. No
    // Stripe request: the payload was kept.
    const retry = await retryUnattributedEvents(store);

    assert.equal(retry.applied, 1, 'still could not attribute it');
    assert.equal(retry.waiting, 0);
    assert.equal(await store.wasEventProcessed('evt_invoice'), true);
    assert.equal(
      (await store.listUnattributedEvents()).length,
      0,
      'kept it parked after it was applied',
    );
    assert.equal(await store.hasClearedPayment('user_1'), true);
  });

  it('keeps waiting rather than giving up, and says how long', async () => {
    // A row nobody can attribute is a question for a person, not a thing to
    // delete. `attempts` and `first_seen_at` are what lets it be asked.
    const store = newStore();
    const foreign = {
      id: 'evt_foreign',
      created: 3000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_x',
          customer: 'cus_nobody',
          amount_paid: 500,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    const { stripe } = stripeServing([[foreign]]);
    await replayStripeEvents(stripe, store, undefined, undefined, 9000);

    await retryUnattributedEvents(store);
    const second = await retryUnattributedEvents(store);

    assert.equal(second.waiting, 1, 'threw away money it could not name');
    const [row] = await store.listUnattributedEvents();
    assert.ok(row && row.attempts >= 2, 'cannot say how long it has waited');
    assert.equal(await store.wasEventProcessed('evt_foreign'), false);
  });
});

describe('two events in the same second', () => {
  it('still applies the older one first', async () => {
    // `created` has one-second resolution, so a sort alone compares them
    // equal and a stable sort leaves Stripe's newest-first order untouched.
    // The mirror is then left holding the update that was already
    // superseded, until a reconcile happens to fix it.
    const store = newStore();
    const { stripe } = stripeServing([
      [
        subscriptionEvent('evt_new', 2000, 'active'),
        subscriptionEvent('evt_old', 2000, 'incomplete'),
      ],
    ]);

    await replayStripeEvents(stripe, store);

    const row = await store.getSubscription('sub_1');
    assert.equal(row?.status, 'active', 'kept the superseded status');
  });
});

describe('a queue with rows in it that can never be attributed', () => {
  function foreignEvent(id: string, created: number): Stripe.Event {
    return {
      id,
      created,
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_${id}`,
          customer: 'cus_nobody',
          amount_paid: 500,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
  }

  it('does not let them starve a payment parked behind them', async () => {
    // A batch of the oldest rows is the whole queue for ever once the oldest
    // rows are ones nobody can attribute. The invoice behind them becomes
    // attributable the moment its customer mapping arrives, and is never
    // tried again to find out. Its payment stays uncredited indefinitely.
    const store = newStore();
    const stuck = [foreignEvent('evt_a', 1000), foreignEvent('evt_b', 2000)];
    for (const event of stuck) {
      await store.parkUnattributedEvent(
        event.id,
        event.type,
        event.created,
        JSON.stringify(event),
        '2026-09-01T00:00:00.000Z',
      );
    }
    // Parked later, and attributable: the customer is mapped.
    await store.linkCustomer('user_1', 'cus_user_1');
    const payable = {
      id: 'evt_payable',
      created: 3000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_payable',
          customer: 'cus_user_1',
          amount_paid: 2500,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    await store.parkUnattributedEvent(
      payable.id,
      payable.type,
      payable.created,
      JSON.stringify(payable),
      '2026-09-02T00:00:00.000Z',
    );

    // A batch smaller than the queue, which is the whole point: the two
    // stuck rows are older and would fill it every time.
    const first = await retryUnattributedEvents(
      store,
      2,
      () => '2026-09-03T00:00:00.000Z',
    );
    assert.equal(first.tried, 2);

    const second = await retryUnattributedEvents(
      store,
      2,
      () => '2026-09-04T00:00:00.000Z',
    );

    assert.equal(second.applied, 1, 'never got to the one it could pay');
    assert.equal(
      await store.hasClearedPayment('user_1'),
      true,
      'the payment behind the stuck rows stayed uncredited',
    );
  });

  it('still applies a batch oldest first', async () => {
    // Fairness decides which rows are in the batch. It must not decide the
    // order they are applied in: a Checkout that maps a customer has to run
    // before the invoice that needs the mapping, whatever their attempt
    // history looks like.
    const store = newStore();
    const checkout = topupEvent('evt_checkout', 1000);
    const invoice = {
      id: 'evt_invoice',
      created: 2000,
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_user_1',
          amount_paid: 2000,
          amount_paid_off_stripe: 0,
          metadata: {},
        },
      },
    } as unknown as Stripe.Event;
    // The invoice was tried longer ago, so fairness puts it first.
    await store.parkUnattributedEvent(
      invoice.id,
      invoice.type,
      invoice.created,
      JSON.stringify(invoice),
      '2026-09-01T00:00:00.000Z',
    );
    await store.parkUnattributedEvent(
      checkout.id,
      checkout.type,
      checkout.created,
      JSON.stringify(checkout),
      '2026-09-02T00:00:00.000Z',
    );

    const result = await retryUnattributedEvents(
      store,
      10,
      () => '2026-09-03T00:00:00.000Z',
    );

    assert.equal(result.applied, 2, 'applied the invoice before its mapping');
    assert.equal((await store.listUnattributedEvents()).length, 0);
  });
});

describe('the D1 query ceiling', () => {
  it('always leaves room for a whole page', async () => {
    // D1 stops a Worker invocation at its query limit by throwing: 1000 on
    // Workers Paid, 50 on Free. A page that cannot fit in the budget could
    // never be completed, so its cursor could never advance, so every night
    // would die in the same place for ever. That is the stuck-for-ever
    // failure again, reached through a resource limit rather than through
    // logic, which is why the page is derived from the budget and not the
    // other way round.
    for (const budget of [1, 4, 8, 40, 50, 900, 1000]) {
      const size = pageSizeFor(budget);
      assert.ok(size >= 1, `budget ${budget} asked for a page of none`);
      // One run's header, the page's dedupe read and cursor save, then the
      // events at their worst.
      const worst = 1 + 2 + size * 4;
      if (budget >= 8) {
        assert.ok(
          worst <= budget,
          `budget ${budget} allows a page costing ${worst}`,
        );
      }
    }
  });

  it('never asks Stripe for more than the page it can afford', async () => {
    // Asking for a hundred and then only being able to pay for nine would
    // read eighty-one events it cannot mark, every night, for ever.
    const store = newStore();
    const { stripe, asked } = stripeServing([[]]);

    await replayStripeEvents(stripe, store, 20, () => 5000, 40);

    assert.equal(asked[0]?.limit, pageSizeFor(40));
    assert.ok(
      (asked[0]?.limit ?? 0) <= 100,
      'asked for more than D1 can bind in one dedupe read',
    );
  });

  it('stops a run before the budget rather than after it', async () => {
    // Two pages are available and the budget affords one. Stopping after
    // the second would be a throw partway through, and a throw leaves the
    // cursor where it was.
    const store = newStore();
    const { stripe, asked } = stripeServing([
      [topupEvent('evt_1', 3000)],
      [topupEvent('evt_2', 1000, 'user_2')],
    ]);

    const result = await replayStripeEvents(stripe, store, 20, () => 5000, 40);

    assert.equal(asked.length, 1, 'spent more of the budget than it had');
    assert.equal(result.incomplete, true, 'called a budgeted stop complete');

    // And the next run carries on, which is what makes the stop a pause.
    await replayStripeEvents(stripe, store, 20, () => 5000, 40);
    assert.equal(await store.hasClearedPayment('user_2'), true);
  });

  it('asks whether a page is done in one query, not one per event', async () => {
    // Per event it is the single biggest cost in the run, and it is what
    // decides how much of a backlog a night can clear.
    const store = newStore();
    const source = await readFile(
      fileURLToPath(new URL('../worker/billing-replay.ts', import.meta.url)),
      'utf8',
    );

    assert.match(source, /store\.processedEventIds\(/);
    assert.doesNotMatch(
      source,
      /await store\.wasEventProcessed\(/,
      'back to one dedupe query per event',
    );
    // And the batched read really does say what has been done.
    await store.markEventProcessed('evt_done', 'invoice.paid');
    const done = await store.processedEventIds(['evt_done', 'evt_new']);
    assert.deepEqual([...done], ['evt_done']);
  });
});

describe('two phases in one invocation', () => {
  it('cannot spend the allowance twice between them', async () => {
    // D1 counts the invocation, not the phase. Sizing the parked-event retry
    // from the whole budget rather than from what the replay left is how an
    // invocation goes over the limit while each phase believes it stayed
    // inside one: the replay can reserve most of it, and a full-size batch
    // then spends it again.
    const store = newStore();
    const pages = Array.from({ length: 6 }, (_, n) => [
      topupEvent(`evt_${n}`, 100_000 - n, `user_${n}`),
    ]);
    const { stripe } = stripeServing(pages);

    for (const budget of [40, 120, 500, 900]) {
      const result = await replayStripeEvents(
        stripe,
        store,
        20,
        () => 5000,
        replayBudgetFor(budget),
      );
      assert.ok(
        result.queriesReserved <= replayBudgetFor(budget),
        `the replay alone reserved ${result.queriesReserved} of ${budget}`,
      );

      // What the caller must hand the retry, and the worst that batch costs.
      const left = budget - result.queriesReserved;
      const worstRetry = retryBatchFor(left) * 6;
      assert.ok(
        result.queriesReserved + worstRetry <= budget,
        `both phases together reserve more than ${budget}`,
      );
    }
  });

  it('always leaves the parked queue enough for a row', async () => {
    // Leftovers do not work. The replay reserves a page's worst case up
    // front whether the page held anything or not, so on the Workers Free
    // default it took 39 of 40 and the retry was handed 1, which buys no
    // rows. Every night, for ever, while the cursor moved on past the very
    // events that were parked: money already taken and never credited.
    const store = newStore();
    const { stripe } = stripeServing([[topupEvent('evt_1', 3000)]]);

    for (const budget of [DEFAULT_QUERY_BUDGET, 40, 120, 500, 900]) {
      const result = await replayStripeEvents(
        stripe,
        store,
        20,
        () => 5000,
        replayBudgetFor(budget),
      );
      const batch = retryBatchFor(budget - result.queriesReserved);
      assert.ok(batch >= 1, `budget ${budget} retries no parked events, ever`);
    }
  });

  it('serves the parked queue before the replay, not after it', async () => {
    // A parked event is a payment already seen and not attributed, which is
    // worse than one not read yet. So the share is taken off the top rather
    // than left over, and the replay is handed the remainder.
    assert.ok(parkedReserveFor(500) >= 6);
    assert.equal(
      replayBudgetFor(500),
      500 -
        parkedReserveFor(500) -
        payoutReserveFor(500) -
        reconcileReserveFor(500),
    );
    // Never fewer than one row's worth, however small the allowance.
    assert.ok(parkedReserveFor(4) >= 6);
  });

  it('takes no parked work at all when nothing is left', async () => {
    // Zero is the right answer rather than one row anyway. A run with no
    // allowance left does no parked work tonight, and the queue rotates by
    // last attempt, so nothing is skipped over.
    assert.equal(retryBatchFor(0), 0);
    assert.equal(retryBatchFor(5), 0);
  });

  it('is what the nightly pass actually hands it', async () => {
    // The property above is only worth having if the caller uses it. This is
    // the line that was wrong: `retryBatchFor(budget)` sized the retry from
    // the whole allowance while the replay had already reserved most of it.
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );

    assert.match(
      source,
      /retryBatchFor\(\s*budget\s*-\s*payoutReserveFor\(budget\)\s*-\s*reconcileReserveFor\(budget\)\s*-\s*reserved,?\s*\)/,
      'the retry is sized from something other than what is left for it',
    );

    // And the replay is *called* with the remainder. Matching the file
    // anywhere passed while the call itself took the whole allowance,
    // because `replayBudgetFor(budget)` also appears in the error handler
    // beneath it. The argument list is the thing under test, so that is what
    // is read.
    // Whitespace-collapsed rather than sliced between two landmarks. The
    // first version of this matched the file anywhere and passed against its
    // own mutation, and the second sliced to the next `.then(`, which the
    // call's own argument list can contain. The argument list is what is
    // under test, so it is read as one string.
    const flat = source.replace(/\s+/g, ' ');
    assert.match(
      flat,
      /replayStripeEvents\( stripe, billing, undefined, undefined, replayBudgetFor\(budget\), reversed, readCharge, \)/,
      'the replay is handed the whole allowance again, or lost its clawback hook',
    );
    assert.doesNotMatch(
      source,
      /retryBatchFor\(budget\)/,
      'the retry is sized from the whole allowance again',
    );
  });
});

describe('the phases that hand over money already owed', () => {
  it('reserve their shares before the replay takes any', async () => {
    // A payout that is owed and a parked payment are both money already
    // established. The replay goes looking for more. Leftovers were tried
    // and do not work: a phase that reserves a worst case up front takes
    // everything and the ones after it get nothing, every night.
    for (const budget of [40, 120, 500, 900]) {
      const parked = parkedReserveFor(budget);
      const payouts = payoutReserveFor(budget);
      const reconcile = reconcileReserveFor(budget);
      assert.equal(
        replayBudgetFor(budget),
        Math.max(0, budget - parked - payouts - reconcile),
      );
      assert.ok(parked >= 6, `budget ${budget} parks nothing`);
      assert.ok(payoutBatchFor(payouts) >= 1, `budget ${budget} pays nobody`);
      // #47: the reconcile is the fourth phase and had no share at all. It
      // ran last and took whatever was left, which is how it came to exceed
      // the allowance on its own past about a hundred subscriptions.
      assert.ok(
        reconcileBatchFor(reconcile) >= 1,
        `budget ${budget} reconciles nothing, ever`,
      );
    }
  });

  it('keeps each phase inside its own share, not just the total', async () => {
    // The total staying under the allowance is not the property the split
    // exists for, and a test that checks only the total passes while one
    // phase quietly overruns its share and another goes short. The
    // reconcile did: it reserved a quarter and then sized a batch from ten
    // queries a subscription plus one fixed, when the true worst case is
    // eleven plus three. On a 1000 allowance that is 24 subscriptions
    // costing 267 out of a 250 share.
    for (const budget of [40, 120, 500, 900, 1000]) {
      const reconcile = reconcileReserveFor(budget);
      assert.ok(
        3 + reconcileBatchFor(reconcile) * 11 <= reconcile,
        `budget ${budget}: the reconcile overruns its own share`,
      );

      const payouts = payoutReserveFor(budget);
      assert.ok(
        1 + payoutBatchFor(payouts) * 6 <= payouts,
        `budget ${budget}: the payout resume overruns its own share`,
      );

      const parked = parkedReserveFor(budget);
      assert.ok(
        retryBatchFor(parked) * 11 <= parked,
        `budget ${budget}: the parked retry overruns its own share`,
      );
    }
  });

  it('cannot together exceed the allowance', async () => {
    // The property the whole split exists for. Three phases, one invocation,
    // and D1 counts the invocation.
    const store = newStore();
    const pages = Array.from({ length: 6 }, (_, n) => [
      topupEvent(`evt_${n}`, 100_000 - n, `user_${n}`),
    ]);
    const { stripe } = stripeServing(pages);

    for (const budget of [40, 120, 500, 900]) {
      const result = await replayStripeEvents(
        stripe,
        store,
        20,
        () => 5000,
        replayBudgetFor(budget),
      );
      const payouts = payoutReserveFor(budget);
      const reconcile = reconcileReserveFor(budget);
      const worstRetry =
        retryBatchFor(budget - payouts - reconcile - result.queriesReserved) *
        6;
      const worstPayouts = 1 + payoutBatchFor(payouts) * 6;
      // Eleven queries a subscription at its worst, plus the three the run
      // pays before it reaches any of them: the id list, the cursor read and
      // the cursor write. Read off `reconcileSubscriptions` and
      // `payReferralIfEarned`, whose own worst case is six and not five --
      // `attributionFor`, `reserveSlot`, two grants, `firstClearedPaymentIds`
      // and `markPaid`. Counting ten and one let a full batch on a Workers
      // Paid allowance overrun its own share.
      const worstReconcile = 3 + reconcileBatchFor(reconcile) * 11;

      assert.ok(
        result.queriesReserved + worstRetry + worstPayouts + worstReconcile <=
          budget,
        `budget ${budget} is exceeded by the four phases that share it`,
      );
    }
  });

  it('is what the nightly pass actually hands the payout resume', async () => {
    // It defaults to 100 rows at six queries each, 601 in total, which is
    // most of a Workers Paid invocation and was bounded by nothing.
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );

    assert.match(source, /payoutBatchFor\(payoutReserveFor\(budget\)\)/);
    assert.doesNotMatch(
      source,
      /resumeStrandedPayouts\(payout\)/,
      'the payout resume takes its unbounded default again',
    );
  });

  it('is what the nightly pass actually hands the reconcile', async () => {
    // #47. The reconcile's default is every subscription the deployment
    // knows about, which is what it used to be called with: past about a
    // hundred it exceeds the invocation on its own, D1 throws, and the
    // handler's own catch turns that into a log line nobody reads.
    const source = await readFile(
      fileURLToPath(new URL('../worker/index.ts', import.meta.url)),
      'utf8',
    );

    assert.match(
      source,
      /reconcileBatchFor\(reconcileReserveFor\(budget\)\)/,
      'the reconcile is sized from something other than its own share',
    );
    assert.doesNotMatch(
      source,
      /reconcileSubscriptions\(stripe, billing, cleared\)/,
      'the reconcile takes its unbounded default again',
    );
  });
});
