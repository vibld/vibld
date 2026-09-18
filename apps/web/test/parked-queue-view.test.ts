import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parkedQueueView,
  waitedFor,
} from '../src/components/parked-queue-view.ts';
import type { ParkedQueue } from '../src/components/parked-queue-view.ts';

/**
 * The wording of the parked queue (#46).
 *
 * This is money Stripe says moved that this deployment cannot yet put a name
 * to, and both wrong readings of that are expensive. Read as "payments lost"
 * an operator goes looking for refunds to issue; read as "payments handled"
 * they stop looking at a retry that has quietly stopped working. So the copy
 * is the feature, and it is tested directly rather than through a rendered
 * tree.
 */

const NOW = Date.parse('2026-09-17T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

function queue(overrides: Partial<ParkedQueue> = {}): ParkedQueue {
  return {
    parked: 1,
    oldestFirstSeenAt: daysAgo(0.1),
    oldestCreated: 1_700_000_000,
    events: [
      {
        stripeEventId: 'evt_1',
        type: 'invoice.paid',
        created: 1_700_000_000,
        firstSeenAt: daysAgo(0.1),
        attempts: 1,
        customerId: 'cus_42',
        amountCents: 1999,
        currency: 'usd',
      },
    ],
    ...overrides,
  };
}

describe('the parked queue on screen', () => {
  it('says plainly when there is nothing waiting', () => {
    const view = parkedQueueView(
      { parked: 0, oldestFirstSeenAt: null, oldestCreated: null, events: [] },
      NOW,
    );
    assert.equal(view.headline, 'No payments waiting to be attributed.');
    assert.equal(view.tone, 'quiet');
    assert.deepEqual(view.rows, []);
  });

  it('does not treat a fresh queue as a problem', () => {
    // An event can park at 3am and resolve at 3:01. A panel that shouts at
    // every non-zero count is one an operator learns to ignore, and then it
    // is not a signal any more.
    const view = parkedQueueView(queue(), NOW);
    assert.equal(view.tone, 'watch');
    assert.match(view.note ?? '', /usually clear on the next nightly retry/);
  });

  it('escalates once the retry has had more than one go at it', () => {
    // The retry runs nightly, so one night is the system working. Two nights
    // means it has tried twice and got nowhere, which is when a person has
    // something to do.
    const view = parkedQueueView(
      queue({ parked: 3, oldestFirstSeenAt: daysAgo(4) }),
      NOW,
    );
    assert.equal(view.tone, 'stale');
    assert.match(view.headline, /3 payments waiting to be attributed/);
    assert.match(view.headline, /the oldest for 4 days/);
    assert.match(view.note ?? '', /has not resolved it/);
  });

  it('never lets either wrong reading stand', () => {
    // Both tones have to say it: not lost, and not credited.
    for (const days of [0.1, 9]) {
      const view = parkedQueueView(
        queue({ oldestFirstSeenAt: daysAgo(days) }),
        NOW,
      );
      assert.match(
        view.note ?? '',
        /Nothing here has been credited to anybody\./,
        `the ${days}-day view let "already handled" stand`,
      );
    }
  });

  it('counts in the singular when there is one', () => {
    const view = parkedQueueView(queue({ parked: 1 }), NOW);
    assert.match(view.headline, /1 payment waiting/);
    assert.doesNotMatch(view.headline, /1 payments/);
  });

  it('admits when it is showing fewer rows than it counted', () => {
    // The count comes from the database and the rows are a capped page. A
    // table that showed fifty and a headline that said four hundred, with
    // nothing joining them, reads as a bug in the panel.
    const view = parkedQueueView(queue({ parked: 400 }), NOW);
    assert.equal(view.truncated, true);
    assert.equal(parkedQueueView(queue({ parked: 1 }), NOW).truncated, false);
  });

  it('shows an amount an operator can recognise', () => {
    const [row] = parkedQueueView(queue(), NOW).rows;
    assert.equal(row?.amount, '$19.99');
    assert.equal(row?.customer, 'cus_42');
    assert.equal(row?.type, 'invoice.paid');
  });

  it('says so rather than inventing one when the event carried no amount', () => {
    const view = parkedQueueView(
      queue({
        events: [
          {
            stripeEventId: 'evt_2',
            type: 'customer.subscription.updated',
            created: 1_700_000_000,
            firstSeenAt: daysAgo(1),
            attempts: 2,
          },
        ],
      }),
      NOW,
    );
    assert.equal(view.rows[0]?.amount, 'amount unknown');
    assert.equal(view.rows[0]?.customer, 'no customer on the event');
    assert.equal(view.rows[0]?.attempts, '2 attempts');
  });

  it("uses each currency's own minor unit, not always a hundredth", () => {
    // Stripe sends the smallest unit of the currency, and that is not
    // always a hundredth. JPY has no minor unit, so 2500 is 2500 yen;
    // dividing by 100 shows 25.00 and sends an operator looking for a
    // payment a hundred times smaller than the one in front of them.
    // Bahraini dinar goes the other way, with three places.
    const shown = (amountCents: number, currency: string) =>
      parkedQueueView(
        queue({
          events: [
            {
              stripeEventId: 'evt_3',
              type: 'invoice.paid',
              created: 1,
              firstSeenAt: daysAgo(1),
              attempts: 1,
              amountCents,
              currency,
            },
          ],
        }),
        NOW,
      )
        // Intl separates a currency code from the number with a
        // non-breaking space, and which separator it picks moves with the
        // ICU version. Normalising it keeps this test about the number of
        // decimal places, which is what the bug was.
        .rows[0]?.amount.replace(/\u00a0/g, ' ');

    assert.equal(shown(1999, 'usd'), '$19.99');
    assert.equal(shown(2500, 'eur'), '€25.00');
    assert.equal(shown(2500, 'jpy'), '¥2,500', 'yen was divided by a hundred');
    assert.equal(
      shown(2500, 'bhd'),
      'BHD 2.500',
      'a three-place currency lost a digit',
    );
  });

  it('shows the raw amount rather than nothing for a code it cannot parse', () => {
    // A malformed code makes Intl throw, and a panel that throws shows an
    // operator nothing at all. The minor units and the code are still more
    // use than a blank.
    const view = parkedQueueView(
      queue({
        events: [
          {
            stripeEventId: 'evt_4',
            type: 'invoice.paid',
            created: 1,
            firstSeenAt: daysAgo(1),
            attempts: 1,
            amountCents: 1234,
            currency: 'not-a-currency',
          },
        ],
      }),
      NOW,
    );
    assert.equal(view.rows[0]?.amount, '1234 NOT-A-CURRENCY');
  });

  describe('how long it has waited', () => {
    it('rounds to something a person acts on', () => {
      assert.equal(waitedFor(daysAgo(0.01), NOW), 'under an hour');
      assert.equal(waitedFor(daysAgo(1 / 24), NOW), '1 hour');
      assert.equal(waitedFor(daysAgo(5 / 24), NOW), '5 hours');
      assert.equal(waitedFor(daysAgo(1), NOW), '1 day');
      assert.equal(waitedFor(daysAgo(12), NOW), '12 days');
    });

    it('does not report a negative age when a clock disagrees', () => {
      // `first_seen_at` is written by the Worker and read here, and the two
      // need not agree. "-1 days" would read as a bug in the panel rather
      // than a clock, and send somebody looking in the wrong place.
      assert.equal(waitedFor(daysAgo(-3), NOW), 'under an hour');
    });

    it('says unknown rather than NaN for an unparseable stamp', () => {
      assert.equal(waitedFor('not a date', NOW), 'unknown');
    });
  });
});
