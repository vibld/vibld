import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AccessStore } from '../worker/access-store.ts';
import { BillingStore } from '../worker/billing-store.ts';
import {
  restoreSubscription,
  windDownSubscription,
} from '../worker/access-billing.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const SCHEMA = schemaSql();
const ENV = { STRIPE_SECRET_KEY: 'sk_test' };

/** A Stripe that accepts the cancellation and records what it was asked. */
function stripeAccepting(periodEnd = 1_800_000_000) {
  const calls: { id: string; params: unknown }[] = [];
  return {
    calls,
    client: {
      subscriptions: {
        update: async (id: string, params: unknown) => {
          calls.push({ id, params });
          return {
            id,
            current_period_end: periodEnd,
            items: { data: [] },
          } as never;
        },
      },
    } as never,
  };
}

/** A deployment with one invited, signed-in, paying person. */
async function deployment(options: { cancelAtPeriodEnd?: boolean } = {}) {
  const db = new SqliteD1Database(SCHEMA);
  const access = new AccessStore(db);
  const billing = new BillingStore(db);

  await access.invite('sam@example.com', 'admin@vibld.com');
  await access.claimInvite('sam@example.com', 'user_sam');
  await billing.linkCustomer('user_sam', 'cus_sam');
  await billing.upsertSubscription({
    stripeSubscriptionId: 'sub_sam',
    userId: 'user_sam',
    stripeCustomerId: 'cus_sam',
    tier: 'build',
    status: 'active',
    priceId: 'price_build_monthly',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
  });

  return { db, access, billing };
}

describe('winding down a revoked subscriber', () => {
  it('schedules the cancellation rather than taking the month away', async () => {
    // The whole decision, in one assertion: `cancel_at_period_end`, never a
    // delete. They keep what they paid for, nothing is charged for time they
    // cannot use, and there is no refund to process.
    const { access, billing } = await deployment();
    const stripe = stripeAccepting();

    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(stripe.calls, [
      { id: 'sub_sam', params: { cancel_at_period_end: true } },
    ]);
    assert.equal(result.scheduled, true);
  });

  it('mirrors it locally, so the panel is not still promising a renewal', async () => {
    // Stripe will also send a webhook, and waiting for it means the list an
    // operator is looking at right now still says this subscription renews,
    // which is the same false claim the revoke was meant to end.
    const { access, billing } = await deployment();
    await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripeAccepting().client,
    );

    const row = await billing.getSubscription('sub_sam');
    assert.equal(row?.cancelAtPeriodEnd, true);
    assert.equal(row?.status, 'active', 'it must still be a live subscription');
  });

  it('reports the end date Stripe confirmed, not the one we had', async () => {
    const { access, billing } = await deployment();
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripeAccepting(1_800_000_000).client,
    );

    assert.equal(result.scheduled, true);
    assert.equal(
      result.scheduled && result.endsAt,
      new Date(1_800_000_000 * 1000).toISOString(),
    );
  });

  it('falls back to the mirrored date when Stripe returns no period end', async () => {
    // Stripe has moved `current_period_end` between the subscription and its
    // items across API versions. Read blindly, a missing one becomes
    // `new Date(undefined)`, an Invalid Date whose toISOString throws, which
    // would turn a successful cancellation into a 500.
    const { access, billing } = await deployment();
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () =>
        ({
          subscriptions: {
            update: async () => ({ id: 'sub_sam', items: { data: [] } }),
          },
        }) as never,
    );

    assert.equal(result.scheduled, true);
    assert.equal(result.scheduled && result.endsAt, '2026-10-01T00:00:00.000Z');
  });

  it('asks nothing at all when Stripe is not configured', async () => {
    const { access, billing } = await deployment();
    let asked = false;
    const result = await windDownSubscription(
      {},
      access,
      billing,
      'sam@example.com',
      () => {
        asked = true;
        return stripeAccepting().client;
      },
    );

    assert.equal(asked, false);
    assert.deepEqual(result, { scheduled: false, reason: 'unconfigured' });
  });

  it('tells an invite nobody took apart from one with nothing to stop', async () => {
    // Two different facts an operator would act on differently. Collapsing
    // them into one "no subscription" answer hides that the second person
    // has an account and simply never paid.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('nobody@example.com', 'admin@vibld.com');

    const untaken = await windDownSubscription(
      ENV,
      access,
      billing,
      'nobody@example.com',
      () => stripeAccepting().client,
    );
    assert.deepEqual(untaken, {
      scheduled: false,
      reason: 'never-signed-in',
    });

    await access.invite('free@example.com', 'admin@vibld.com');
    await access.claimInvite('free@example.com', 'user_free');
    const unpaid = await windDownSubscription(
      ENV,
      access,
      billing,
      'free@example.com',
      () => stripeAccepting().client,
    );
    assert.deepEqual(unpaid, {
      scheduled: false,
      reason: 'nothing-to-stop',
    });
  });

  it('does not ask Stripe again for one that is already ending', async () => {
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    const stripe = stripeAccepting();

    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(stripe.calls, []);
    assert.deepEqual(result, {
      scheduled: false,
      reason: 'already-ending',
      endsAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('reports a Stripe refusal instead of throwing into the route', async () => {
    // The revoke has already been written by the time this runs. A throw
    // escaping here would answer 500 for a request that half happened: the
    // access gone, the billing untouched, and nothing saying so.
    const { access, billing } = await deployment();
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () =>
        ({
          subscriptions: {
            update: async () => {
              throw new Error('stripe is down');
            },
          },
        }) as never,
    );

    assert.equal(result.scheduled, false);
    assert.equal(result.scheduled === false && result.reason, 'error');
  });

  it('keeps the wind-down when only the local mirror fails', async () => {
    // Stripe has already accepted the change, which is the part that stops
    // the money. Reporting that as a failure would send an operator to
    // cancel something that is already cancelling.
    const { access } = await deployment();
    const brokenMirror = {
      findActiveSubscription: async () => ({
        stripeSubscriptionId: 'sub_sam',
        userId: 'user_sam',
        stripeCustomerId: 'cus_sam',
        tier: 'build' as const,
        status: 'active',
        priceId: 'price_build_monthly',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      }),
      upsertSubscription: async () => {
        throw new Error('no such table: billing_subscriptions');
      },
    } as unknown as BillingStore;

    const result = await windDownSubscription(
      ENV,
      access,
      brokenMirror,
      'sam@example.com',
      () => stripeAccepting().client,
    );

    assert.equal(result.scheduled, true);
  });
});

describe('putting a subscription back when access is restored', () => {
  it('clears the cancellation this deployment scheduled', async () => {
    // Without this the reason for cancelling at period end rather than
    // immediately was false. Revoking schedules the end, re-inviting cleared
    // revoked_at and asked Clerk, and Stripe ended a subscription belonging
    // to somebody whose access had been restored.
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    const stripe = stripeAccepting();

    const result = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(stripe.calls, [
      { id: 'sub_sam', params: { cancel_at_period_end: false } },
    ]);
    assert.equal(result.restored, true);
    const row = await billing.getSubscription('sub_sam');
    assert.equal(row?.cancelAtPeriodEnd, false);
  });

  it('leaves a cancellation the subscriber made themselves alone', async () => {
    // Read from the mirror first, and only a subscription already marked as
    // ending is touched. Sending cancel_at_period_end: false unconditionally
    // would charge somebody who asked not to be charged.
    const { access, billing } = await deployment({ cancelAtPeriodEnd: false });
    const stripe = stripeAccepting();

    const result = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(stripe.calls, []);
    assert.deepEqual(result, {
      restored: false,
      reason: 'nothing-to-restore',
    });
  });

  it('asks nothing when Stripe is not configured', async () => {
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    let asked = false;
    const result = await restoreSubscription(
      {},
      access,
      billing,
      'sam@example.com',
      () => {
        asked = true;
        return stripeAccepting().client;
      },
    );
    assert.equal(asked, false);
    assert.deepEqual(result, { restored: false, reason: 'unconfigured' });
  });

  it('reports a Stripe refusal rather than throwing into the route', async () => {
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    const result = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () =>
        ({
          subscriptions: {
            update: async () => {
              throw new Error('stripe is down');
            },
          },
        }) as never,
    );
    assert.equal(result.restored, false);
    assert.equal(result.restored === false && result.reason, 'error');
  });
});

describe('an address the invite list has never heard of', () => {
  it('is not reported as an invite nobody took', async () => {
    // Two different facts. A mistyped address in the free-form Withdraw
    // control has no row at all, and telling an operator that nobody signed
    // in with that invite is a claim about a person who does not exist.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);

    const missing = await windDownSubscription(
      ENV,
      access,
      billing,
      'typo@example.com',
      () => stripeAccepting().client,
    );
    assert.deepEqual(missing, { scheduled: false, reason: 'no-invite' });

    await access.invite('real@example.com', 'admin@vibld.com');
    const untaken = await windDownSubscription(
      ENV,
      access,
      billing,
      'real@example.com',
      () => stripeAccepting().client,
    );
    assert.deepEqual(untaken, {
      scheduled: false,
      reason: 'never-signed-in',
    });
  });
});
