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

const SCHEMA = ['0002_billing.sql', '0007_subscription_payments.sql']
  .map((name) =>
    readFileSync(join(import.meta.dirname, '..', 'migrations', name), 'utf8'),
  )
  .join('\n');

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

describe('applyStripeEvent: the purchase hook', () => {
  function topup(overrides: Record<string, unknown> = {}): Stripe.Event {
    return stripeEvent(
      'checkout.session.completed',
      checkoutSession({
        id: 'cs_topup',
        mode: 'payment',
        payment_status: 'paid',
        ...overrides,
      }),
    );
  }

  it('announces a cleared top-up to the hook', async () => {
    const seen: string[] = [];
    await applyStripeEvent(newStore(), topup(), async (userId) => {
      seen.push(userId);
    });
    assert.deepEqual(seen, ['user_1']);
  });

  it('lets a failing hook fail the delivery', async () => {
    // This used to be swallowed, and the comment said a later delivery would
    // recover it. It would not: handleStripeWebhook marks the event
    // processed once this returns, and Stripe's redelivery then exits at
    // that check, so a referral payout that threw here was owed and never
    // attempted again. Throwing means the event is not marked and Stripe
    // retries into an idempotent path.
    await assert.rejects(
      applyStripeEvent(newStore(), topup(), async () => {
        throw new Error('payout failed');
      }),
      /payout failed/,
    );
  });

  it('records the money before it announces anything', async () => {
    // Which is what makes the retry above safe to ask for: the top-up is
    // already durable and keyed on the checkout session, so the redelivery
    // re-runs it as a no-op and the customer's own credit never depends on
    // the reward working.
    const store = newStore();
    let hadCustomer = false;
    await assert.rejects(
      applyStripeEvent(store, topup(), async (userId) => {
        hadCustomer = (await store.findCustomerId(userId)) !== undefined;
        throw new Error('payout failed');
      }),
      /payout failed/,
    );
    assert.equal(hadCustomer, true);
  });

  it('announces nothing for a session that completed unpaid', async () => {
    // A delayed payment method completes the session and settles later, or
    // never. Announcing on completion alone pays a referral on money that may
    // not arrive, and records a top-up for it too.
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      topup({ payment_status: 'unpaid' }),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, []);
  });

  it('announces the delayed payment when it finally settles', async () => {
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      stripeEvent(
        'checkout.session.async_payment_succeeded',
        checkoutSession({
          id: 'cs_topup',
          mode: 'payment',
          payment_status: 'paid',
        }),
      ),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, ['user_1']);
  });

  it('announces a session that owed nothing to begin with', async () => {
    // Fully covered by a coupon or a credit balance. Settled, not an edge
    // case to skip.
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      topup({ payment_status: 'no_payment_required' }),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, ['user_1']);
  });

  it('does nothing at all for a delayed payment that failed', async () => {
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      stripeEvent(
        'checkout.session.async_payment_failed',
        checkoutSession({ id: 'cs_topup', mode: 'payment' }),
      ),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, []);
  });

  it('announces an active subscription, and not a trialing one', async () => {
    // A trial is not money. Paying on one makes the trial the thing farmed.
    const active: string[] = [];
    await applyStripeEvent(
      newStore(),
      stripeEvent('customer.subscription.updated', subscription()),
      async (userId) => {
        active.push(userId);
      },
    );
    assert.deepEqual(active, ['user_1']);

    const trialing: string[] = [];
    await applyStripeEvent(
      newStore(),
      stripeEvent(
        'customer.subscription.updated',
        subscription({ status: 'trialing' }),
      ),
      async (userId) => {
        trialing.push(userId);
      },
    );
    assert.deepEqual(trialing, []);
  });
});

describe('applyStripeEvent: invoice.paid', () => {
  function invoice(overrides: Record<string, unknown> = {}): Stripe.Event {
    return stripeEvent('invoice.paid', {
      id: 'in_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { vibld_user_id: 'user_1' },
      ...overrides,
    });
  }

  it('records that the subscription has actually taken money', async () => {
    // The durable signal. A subscription's current status cannot answer
    // "did they ever pay" afterwards, and this event is the only one that
    // says money moved.
    const store = newStore();
    await store.upsertSubscription({
      stripeSubscriptionId: 'sub_1',
      userId: 'user_1',
      stripeCustomerId: 'cus_1',
      tier: 'build',
      status: 'active',
      priceId: 'price_build_monthly',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    await applyStripeEvent(store, invoice());

    assert.notEqual(
      (await store.getSubscription('sub_1'))?.everPaidAt ?? null,
      null,
    );
  });

  it('announces the purchase, which is the recovery for a missed subscription event', async () => {
    const seen: string[] = [];
    await applyStripeEvent(newStore(), invoice(), async (userId) => {
      seen.push(userId);
    });
    assert.deepEqual(seen, ['user_1']);
  });

  it('resolves the owner from the customer when the invoice does not name one', async () => {
    const store = newStore();
    await store.linkCustomer('user_1', 'cus_1');
    const seen: string[] = [];
    await applyStripeEvent(store, invoice({ metadata: {} }), async (userId) => {
      seen.push(userId);
    });
    assert.deepEqual(seen, ['user_1']);
  });

  it('announces nothing it cannot attribute', async () => {
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      invoice({ metadata: {}, customer: null }),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, []);
  });

  it('handles an invoice with no subscription at all', async () => {
    const seen: string[] = [];
    await applyStripeEvent(
      newStore(),
      invoice({ subscription: null }),
      async (userId) => {
        seen.push(userId);
      },
    );
    assert.deepEqual(seen, ['user_1']);
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
