import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  handleUnattributedQueue,
  parkedPaymentOf,
} from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The parked queue, made visible (#46).
 *
 * `0010_unattributed_events.sql` says what the table is for: "a visible
 * queue with a count and an age, which is a thing somebody can act on,
 * rather than a number in a log or a silence". The table and the nightly
 * retry were built; the visible half was not, so the only way to know the
 * retry had stopped resolving anything was to query D1 by hand.
 *
 * Read-only on purpose. Attributing a payment by hand is a route that
 * credits money on an operator's say-so, and that wants its own
 * confirmation and its own audit record.
 */

const SCHEMA = schemaSql();

function invoiceEvent(id: string, customer: string, amountPaid: number) {
  return {
    id,
    type: 'invoice.paid',
    created: 1_700_000_000,
    data: {
      object: {
        id: `in_${id}`,
        customer,
        amount_paid: amountPaid,
        currency: 'usd',
        // The kind of thing a stored Stripe event carries and a panel has no
        // business receiving.
        lines: { data: [{ description: 'Build plan' }] },
        hosted_invoice_url: 'https://invoice.stripe.com/secret-token',
      },
    },
  };
}

describe('the unattributed payment queue', () => {
  /** The store keeps its database private, so hand the handler its own. */
  function envFor(db: D1Database) {
    return { DB: db };
  }

  it('says how many are parked and how long the oldest has waited', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.parkUnattributedEvent(
      'evt_old',
      'invoice.paid',
      1_700_000_000,
      JSON.stringify(invoiceEvent('evt_old', 'cus_1', 1200)),
      '2026-09-01T00:00:00.000Z',
    );
    await store.parkUnattributedEvent(
      'evt_new',
      'invoice.paid',
      1_700_000_100,
      JSON.stringify(invoiceEvent('evt_new', 'cus_2', 3400)),
      '2026-09-10T00:00:00.000Z',
    );

    const body = (await (
      await handleUnattributedQueue(
        new Request('https://app.example/api/admin/unattributed'),
        envFor(db),
      )
    ).json()) as { parked: number; oldestFirstSeenAt: string };

    assert.equal(body.parked, 2);
    assert.equal(
      body.oldestFirstSeenAt,
      '2026-09-01T00:00:00.000Z',
      'the age shown was not the oldest thing waiting',
    );
  });

  it('counts everything parked, not just the page it shows', async () => {
    // The count and the rows answer different questions, and the count is
    // the one somebody acts on. Measuring the capped list instead would
    // report a queue of any size as exactly the page size, which reads as
    // survivable no matter how bad it gets.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    for (let n = 0; n < 60; n += 1) {
      await store.parkUnattributedEvent(
        `evt_${n}`,
        'invoice.paid',
        1_700_000_000 + n,
        JSON.stringify(invoiceEvent(`evt_${n}`, 'cus_1', 100)),
        '2026-09-01T00:00:00.000Z',
      );
    }

    const body = (await (
      await handleUnattributedQueue(
        new Request('https://app.example/api/admin/unattributed'),
        envFor(db),
      )
    ).json()) as { parked: number; events: unknown[] };

    assert.equal(body.parked, 60, 'the count was the page length');
    assert.ok(
      body.events.length < body.parked,
      'this test proves nothing unless the page is smaller than the queue',
    );
  });

  it('never puts the stored Stripe payload on the page', async () => {
    // The payload is the whole event, kept so the retry does not depend on
    // Stripe still having it. A panel needs none of it, and shipping it
    // would put a growing third-party object in a browser: every field
    // Stripe adds would arrive without anybody deciding it should.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.parkUnattributedEvent(
      'evt_1',
      'invoice.paid',
      1_700_000_000,
      JSON.stringify(invoiceEvent('evt_1', 'cus_1', 1200)),
      '2026-09-01T00:00:00.000Z',
    );

    const text = await (
      await handleUnattributedQueue(
        new Request('https://app.example/api/admin/unattributed'),
        envFor(db),
      )
    ).text();

    assert.ok(!('payload' in JSON.parse(text).events[0]));
    assert.ok(
      !text.includes('hosted_invoice_url'),
      'a field nobody chose to expose reached the browser',
    );
    assert.ok(
      !text.includes('secret-token'),
      'the payload was serialised into the response',
    );
    assert.ok(!text.includes('Build plan'));
  });

  it('carries enough to find the payment in Stripe', async () => {
    // The point of showing a row at all: somebody has to be able to take it
    // to the Stripe dashboard and work out whose it is.
    const row = parkedPaymentOf({
      stripeEventId: 'evt_1',
      type: 'invoice.paid',
      created: 1_700_000_000,
      payload: JSON.stringify(invoiceEvent('evt_1', 'cus_42', 1999)),
      attempts: 3,
      firstSeenAt: '2026-09-01T00:00:00.000Z',
    });

    assert.deepEqual(row, {
      stripeEventId: 'evt_1',
      type: 'invoice.paid',
      created: 1_700_000_000,
      firstSeenAt: '2026-09-01T00:00:00.000Z',
      attempts: 3,
      customerId: 'cus_42',
      amountCents: 1999,
      currency: 'usd',
    });
  });

  it('reads the amount whichever object the event carries it on', async () => {
    // Invoices use `amount_paid`, Checkout sessions `amount_total`, charges
    // and refunds a bare `amount`. What parks is whatever could not be
    // attributed, not a fixed list of types.
    const shapes = [
      { amount_paid: 500 },
      { amount_total: 500 },
      { amount: 500 },
    ];
    for (const object of shapes) {
      const row = parkedPaymentOf({
        stripeEventId: 'evt_1',
        type: 'whatever',
        created: 1,
        payload: JSON.stringify({ data: { object } }),
        attempts: 0,
        firstSeenAt: '2026-09-01T00:00:00.000Z',
      });
      assert.equal(
        row.amountCents,
        500,
        `missed the amount on ${JSON.stringify(object)}`,
      );
    }
  });

  it('still lists a row whose payload will not parse', async () => {
    // The retry cannot apply it either, so it is exactly the row somebody
    // needs to see. Hiding it would also make the count disagree with the
    // rows, which is how a queue quietly stops being believed.
    const row = parkedPaymentOf({
      stripeEventId: 'evt_broken',
      type: 'invoice.paid',
      created: 1_700_000_000,
      payload: 'not json at all',
      attempts: 9,
      firstSeenAt: '2026-09-01T00:00:00.000Z',
    });

    assert.equal(row.stripeEventId, 'evt_broken');
    assert.equal(row.attempts, 9);
    assert.equal(row.amountCents, undefined);
  });

  it('is empty rather than absent when nothing is parked', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const body = (await (
      await handleUnattributedQueue(
        new Request('https://app.example/api/admin/unattributed'),
        envFor(db),
      )
    ).json()) as {
      parked: number;
      oldestFirstSeenAt: string | null;
      events: unknown[];
    };

    assert.deepEqual(body, {
      parked: 0,
      oldestFirstSeenAt: null,
      oldestCreated: null,
      events: [],
    });
  });

  it('refuses anything but GET', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const response = await handleUnattributedQueue(
      new Request('https://app.example/api/admin/unattributed', {
        method: 'POST',
      }),
      envFor(db),
    );
    assert.equal(response.status, 405);
  });

  it('says so rather than throwing when billing is not configured', async () => {
    const response = await handleUnattributedQueue(
      new Request('https://app.example/api/admin/unattributed'),
      {},
    );
    assert.equal(response.status, 503);
  });
});
