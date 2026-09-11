import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  applyStripeEvent,
  subscriptionRecordFrom,
} from '../worker/billing-events.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0002_billing.sql'),
  'utf8',
);

function newStore(): BillingStore {
  return new BillingStore(new SqliteD1Database(SCHEMA));
}

function stripeEvent(type: string, object: unknown): Stripe.Event {
  return {
    id: `evt_${type}`,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

function checkoutSession(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'cs_1',
    mode: 'subscription',
    customer: 'cus_1',
    client_reference_id: 'user_1',
    metadata: {},
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}): unknown {
  return {
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
    ...overrides,
  };
}

describe('applyStripeEvent: checkout.session.completed', () => {
  it('links the customer for a subscription checkout, and mirrors nothing else', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent('checkout.session.completed', checkoutSession()),
    );

    assert.equal(await store.findCustomerId('user_1'), 'cus_1');
  });

  it('records a top-up for a payment-mode checkout, at the amount in its own metadata', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent(
        'checkout.session.completed',
        checkoutSession({
          id: 'cs_topup',
          mode: 'payment',
          metadata: { vibld_credit_usd_cents: '800' },
        }),
      ),
    );

    assert.equal(await store.findCustomerId('user_1'), 'cus_1');
    // recordTopup has no public reader beyond its own idempotency (see
    // billing-store.test.ts); re-applying the same event must still not throw.
    await applyStripeEvent(
      store,
      stripeEvent(
        'checkout.session.completed',
        checkoutSession({
          id: 'cs_topup',
          mode: 'payment',
          metadata: { vibld_credit_usd_cents: '800' },
        }),
      ),
    );
  });

  it('does nothing when neither metadata nor client_reference_id names a user', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent(
        'checkout.session.completed',
        checkoutSession({ client_reference_id: null, metadata: {} }),
      ),
    );

    assert.equal(await store.findCustomerId('user_1'), undefined);
  });
});

describe('applyStripeEvent: customer.subscription.*', () => {
  it('mirrors a new subscription, resolving the user from its own metadata', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent('customer.subscription.created', subscription()),
    );

    const record = await store.getSubscription('sub_1');
    assert.equal(record?.userId, 'user_1');
    assert.equal(record?.tier, 'build');
    assert.equal(record?.status, 'active');
    assert.equal(
      record?.currentPeriodEnd,
      new Date(1_800_000_000_000).toISOString(),
    );
  });

  it('falls back to the customer mapping when a subscription carries no user metadata', async () => {
    const store = newStore();
    await store.linkCustomer('user_2', 'cus_2');
    await applyStripeEvent(
      store,
      stripeEvent(
        'customer.subscription.updated',
        subscription({ id: 'sub_2', customer: 'cus_2', metadata: {} }),
      ),
    );

    assert.equal((await store.getSubscription('sub_2'))?.userId, 'user_2');
  });

  it('does nothing for a price this deployment does not recognise', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent(
        'customer.subscription.updated',
        subscription({
          items: {
            data: [
              {
                current_period_end: 1_800_000_000,
                price: { id: 'price_unknown', lookup_key: 'something_else' },
              },
            ],
          },
        }),
      ),
    );

    assert.equal(await store.getSubscription('sub_1'), undefined);
  });

  it('mirrors cancel_at_period_end and status through customer.subscription.updated', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent('customer.subscription.created', subscription()),
    );
    await applyStripeEvent(
      store,
      stripeEvent(
        'customer.subscription.updated',
        subscription({ status: 'active', cancel_at_period_end: true }),
      ),
    );

    const record = await store.getSubscription('sub_1');
    assert.equal(record?.cancelAtPeriodEnd, true);
  });

  it('mirrors cancellation through customer.subscription.deleted', async () => {
    const store = newStore();
    await applyStripeEvent(
      store,
      stripeEvent('customer.subscription.created', subscription()),
    );
    await applyStripeEvent(
      store,
      stripeEvent(
        'customer.subscription.deleted',
        subscription({ status: 'canceled' }),
      ),
    );

    assert.equal((await store.getSubscription('sub_1'))?.status, 'canceled');
  });
});

describe('applyStripeEvent: unmirrored event types', () => {
  it('acknowledges invoice.paid and invoice.payment_failed without writing anything', async () => {
    const store = newStore();
    await applyStripeEvent(store, stripeEvent('invoice.paid', {}));
    await applyStripeEvent(store, stripeEvent('invoice.payment_failed', {}));
    // Nothing to assert beyond "did not throw" -- there is no table these write to.
  });
});

describe('subscriptionRecordFrom', () => {
  it('is undefined without a resolvable user id, even with a valid price', () => {
    assert.equal(
      subscriptionRecordFrom(subscription() as Stripe.Subscription, undefined),
      undefined,
    );
  });

  it('is undefined for a subscription with no items', () => {
    assert.equal(
      subscriptionRecordFrom(
        subscription({ items: { data: [] } }) as Stripe.Subscription,
        'user_1',
      ),
      undefined,
    );
  });
});
