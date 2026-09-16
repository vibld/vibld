import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AccessStore } from '../worker/access-store.ts';
import { BillingStore } from '../worker/billing-store.ts';
import type { SubscriptionRecord } from '../worker/billing-store.ts';
import {
  restoreSubscription,
  windDownSubscription,
} from '../worker/access-billing.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const SCHEMA = schemaSql();
const ENV = { STRIPE_SECRET_KEY: 'sk_test' };

/**
 * When the fake Stripe says a cancellation was scheduled.
 *
 * Provenance is compared against Stripe's own `canceled_at`, so a fake that
 * never sets one would let every restore match on two nulls and assert
 * nothing at all.
 */
const CANCELED_AT = 1_790_000_000;
const CANCELED_AT_ISO = new Date(CANCELED_AT * 1000).toISOString();

/** A Stripe that accepts the cancellation and records what it was asked. */
function stripeAccepting(periodEnd = 1_800_000_000) {
  const calls: { id: string; params: unknown }[] = [];
  // Stripe stamps `canceled_at` when a cancellation is scheduled and clears
  // it when one is cleared, and the restore path reads it back. Kept as
  // state on the fake rather than as a constant response, because the point
  // of the check is that the value can differ between two cancellations.
  let canceledAt: number | null = null;
  const shape = (id: string) => ({
    id,
    current_period_end: periodEnd,
    canceled_at: canceledAt,
    items: { data: [] },
  });
  return {
    calls,
    /** Put Stripe in the state it would be in after a scheduled cancellation. */
    alreadyCancelled(at: number = CANCELED_AT) {
      canceledAt = at;
    },
    client: {
      subscriptions: {
        retrieve: async (id: string) => shape(id) as never,
        update: async (id: string, params: unknown) => {
          calls.push({ id, params });
          const asked = params as { cancel_at_period_end?: boolean };
          if (asked.cancel_at_period_end === true) canceledAt = CANCELED_AT;
          if (asked.cancel_at_period_end === false) canceledAt = null;
          return shape(id) as never;
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
      recordScheduledCancellation: async () => {},
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

    assert.deepEqual(result, {
      scheduled: true,
      endsAt: '2027-01-15T08:00:00.000Z',
      restorable: true,
    });
  });

  it('says so when the cancellation cannot be undone later', async () => {
    // The provenance row is the only thing that will ever establish this
    // cancellation as ours to clear: the webhooks and the nightly reconcile
    // own `billing_subscriptions` and have never heard of this table, so a
    // failed write is not repaired by anything. An earlier version swallowed
    // it under a comment claiming the reconcile would, which was true of the
    // mirror row and false of this one. Stripe has still accepted the
    // cancellation, so this is not a failed wind-down; it is one the
    // Reinstate button will refuse, and the operator is told now rather than
    // finding out weeks later.
    const { access } = await deployment();
    const brokenProvenance = {
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
      recordScheduledCancellation: async () => {
        throw new Error('no such table: billing_scheduled_cancellations');
      },
      upsertSubscription: async () => {},
    } as unknown as BillingStore;

    const result = await windDownSubscription(
      ENV,
      access,
      brokenProvenance,
      'sam@example.com',
      () => stripeAccepting().client,
    );

    assert.equal(result.scheduled, true, 'Stripe accepted it, so it is done');
    assert.equal(
      result.scheduled === true && result.restorable,
      false,
      'claimed a cancellation this deployment can no longer undo',
    );
  });
});

describe('putting a subscription back when access is restored', () => {
  it('clears the cancellation this deployment scheduled', async () => {
    // Without this the reason for cancelling at period end rather than
    // immediately was false. Revoking schedules the end, re-inviting cleared
    // revoked_at and asked Clerk, and Stripe ended a subscription belonging
    // to somebody whose access had been restored.
    //
    // The provenance row is what makes this ours to undo. Setting the flag
    // alone is a subscriber's own cancellation, which the suite below covers.
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    await billing.recordScheduledCancellation(
      'sub_sam',
      'user_sam',
      CANCELED_AT_ISO,
    );
    const stripe = stripeAccepting();
    stripe.alreadyCancelled();

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
    await billing.recordScheduledCancellation(
      'sub_sam',
      'user_sam',
      CANCELED_AT_ISO,
    );
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
    await billing.recordScheduledCancellation(
      'sub_sam',
      'user_sam',
      CANCELED_AT_ISO,
    );
    const result = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () =>
        ({
          subscriptions: {
            // Answers the provenance read, so the refusal under test is the
            // update's and not a fake missing a method.
            retrieve: async (id: string) =>
              ({ id, canceled_at: CANCELED_AT, items: { data: [] } }) as never,
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

describe('whose cancellation it is', () => {
  it('does not clear a cancellation the subscriber made themselves', async () => {
    // The harm this exists to stop, and the previous version caused it. A
    // subscriber cancels in the Billing Portal; an admin later re-invites
    // them for an unrelated reason; the restore clears the cancellation and
    // Stripe charges them again for a subscription they had ended.
    //
    // The mirror cannot tell the two apart: `cancel_at_period_end` is the
    // same boolean whoever set it. Only a record of having scheduled it can.
    const { access, billing } = await deployment({ cancelAtPeriodEnd: true });
    const stripe = stripeAccepting();

    const result = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(
      stripe.calls,
      [],
      'told Stripe to un-cancel their own cancellation',
    );
    assert.deepEqual(result, { restored: false, reason: 'not-ours' });
  });

  it('clears one this deployment scheduled', async () => {
    const { access, billing } = await deployment();
    // One Stripe across both calls, because the point is that the restore
    // matches the cancellation the revoke actually created. Two fakes would
    // let the test pass on two nulls agreeing with each other.
    const stripe = stripeAccepting();
    // Revoke first, which is what records the provenance.
    await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );
    stripe.calls.length = 0;

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
  });

  it('refuses a record left behind by a clean-up that failed', async () => {
    // The harm the `canceled_at` on the row exists to stop, and the reason
    // deleting the row is not on its own enough. Stripe clears the
    // cancellation, the delete fails, and the row survives. The subscriber
    // then cancels for themselves. A record that only said "this deployment
    // scheduled something once" would authorise clearing theirs, and Stripe
    // would charge them again: the original bug, reached through a failure
    // path instead of through a missing table.
    const { access, billing } = await deployment();
    const stripe = stripeAccepting();
    await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    // The restore lands at Stripe and the clean-up does not. Delegated
    // method by method rather than through the prototype, because
    // `BillingStore` holds its database in a private field and a stand-in
    // that only inherits its methods cannot reach it.
    const leavesTheRow = {
      findActiveSubscription: (userId: string) =>
        billing.findActiveSubscription(userId),
      scheduledCancellation: (id: string) => billing.scheduledCancellation(id),
      upsertSubscription: (record: SubscriptionRecord) =>
        billing.upsertSubscription(record),
      clearScheduledCancellation: async () => {
        throw new Error('no such table: billing_scheduled_cancellations');
      },
    } as unknown as BillingStore;
    const restored = await restoreSubscription(
      ENV,
      access,
      leavesTheRow,
      'sam@example.com',
      () => stripe.client,
    );
    assert.equal(restored.restored, true, 'the fixture did not restore');
    assert.notEqual(
      await billing.scheduledCancellation('sub_sam'),
      null,
      'the row was cleared, so this proves nothing',
    );

    // Now the subscriber cancels for themselves. Stripe stamps a different
    // `canceled_at`, which is the only thing that tells the two apart.
    const row = await billing.getSubscription('sub_sam');
    await billing.upsertSubscription({ ...row!, cancelAtPeriodEnd: true });
    stripe.alreadyCancelled(CANCELED_AT + 86_400);
    stripe.calls.length = 0;

    const again = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(
      stripe.calls.filter((call) => call.id !== 'list'),
      [],
      'cleared a cancellation the subscriber made for themselves',
    );
    assert.deepEqual(again, { restored: false, reason: 'not-ours' });
  });

  it('forgets the record once it is undone', async () => {
    // A stale row would let a later restore undo a cancellation the
    // subscriber makes after this one, which is the same harm one step
    // removed.
    const { access, billing } = await deployment();
    const stripe = stripeAccepting();
    await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );
    await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.equal(await billing.scheduledCancellation('sub_sam'), null);

    // Now the subscriber cancels for themselves, which Stripe stamps with a
    // different `canceled_at` than the one this deployment scheduled.
    const row = await billing.getSubscription('sub_sam');
    await billing.upsertSubscription({ ...row!, cancelAtPeriodEnd: true });
    stripe.alreadyCancelled(CANCELED_AT + 86_400);
    stripe.calls.length = 0;
    const again = await restoreSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(stripe.calls, []);
    assert.deepEqual(again, { restored: false, reason: 'not-ours' });
  });
});

describe('a subscription Stripe has and the mirror does not', () => {
  /** A Stripe that has a live subscription this deployment never mirrored. */
  function stripeWithUnmirrored(
    status = 'active',
    /**
     * The price's `lookup_key`, or nothing for a subscription this
     * deployment does not sell. Which tier a subscription is comes from
     * this and only this, so a fake that always carried one could not show
     * what happens when the price is unrecognised.
     */
    lookupKey?: string,
  ) {
    const calls: { id: string; params: unknown }[] = [];
    const items = lookupKey
      ? {
          data: [
            {
              current_period_end: 1_800_000_000,
              price: { id: 'price_live', lookup_key: lookupKey },
            },
          ],
        }
      : { data: [] };
    return {
      calls,
      client: {
        subscriptions: {
          // Filters the way Stripe does. A fake that ignored `status` and
          // handed the subscription back regardless would pass whatever the
          // caller asked for, which is exactly the bug under test: asking
          // for `active` alone and never seeing a trial.
          list: async (params: { status?: string }) => {
            calls.push({ id: 'list', params });
            const wanted = params.status ?? 'active';
            const matches = wanted === 'all' || wanted === status;
            return {
              data: matches
                ? [
                    {
                      id: 'sub_unmirrored',
                      status,
                      customer: 'cus_sam',
                      current_period_end: 1_800_000_000,
                      cancel_at_period_end: false,
                      items,
                    },
                  ]
                : [],
            };
          },
          update: async (id: string, params: unknown) => {
            calls.push({ id, params });
            return {
              id,
              current_period_end: 1_800_000_000,
              canceled_at: CANCELED_AT,
              items: { data: [] },
            } as never;
          },
        },
      } as never,
    };
  }

  it('still stops the charges', async () => {
    // A customer.subscription.created that was missed, delayed, or racing
    // this revoke leaves no local row while Stripe bills on schedule. The
    // nightly reconcile creates the row later and never asks whether that
    // person's access was withdrawn, so nothing revisits it and they are
    // charged indefinitely.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('sam@example.com', 'admin@vibld.com');
    await access.claimInvite('sam@example.com', 'user_sam');
    await billing.linkCustomer('user_sam', 'cus_sam');
    // Deliberately no upsertSubscription: that is the whole case.

    const stripe = stripeWithUnmirrored();
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(
      stripe.calls.filter((call) => call.id !== 'list'),
      [{ id: 'sub_unmirrored', params: { cancel_at_period_end: true } }],
    );
    assert.equal(result.scheduled, true);
    assert.deepEqual(await billing.scheduledCancellation('sub_unmirrored'), {
      canceledAt: new Date(CANCELED_AT * 1000).toISOString(),
    });
  });

  it('finds a trial whose creation webhook never arrived', async () => {
    // A trial charges when it ends. Asking Stripe for `active` alone left a
    // trialing subscription unfound, the revoke reported nothing to stop,
    // and Stripe charged somebody whose access had been withdrawn as soon as
    // the trial ran out.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('sam@example.com', 'admin@vibld.com');
    await access.claimInvite('sam@example.com', 'user_sam');
    await billing.linkCustomer('user_sam', 'cus_sam');

    const stripe = stripeWithUnmirrored('trialing');
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.equal(result.scheduled, true, 'left a trial running');
    assert.deepEqual(
      stripe.calls.filter((call) => call.id !== 'list'),
      [{ id: 'sub_unmirrored', params: { cancel_at_period_end: true } }],
    );
  });

  it('does not stop one Stripe has already finished with', async () => {
    // The other direction. A cancelled subscription cannot charge anybody,
    // and reporting it as newly wound down would tell an operator something
    // happened that did not.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('sam@example.com', 'admin@vibld.com');
    await access.claimInvite('sam@example.com', 'user_sam');
    await billing.linkCustomer('user_sam', 'cus_sam');

    const stripe = stripeWithUnmirrored('canceled');
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripe.client,
    );

    assert.deepEqual(result, { scheduled: false, reason: 'nothing-to-stop' });
    assert.deepEqual(
      stripe.calls.filter((call) => call.id !== 'list'),
      [],
    );
  });

  it('writes no mirror row for a price this deployment does not sell', async () => {
    // The previous cut built a synthetic record hard-coding `build` and an
    // empty price id, said in a comment that it was never written to the
    // mirror, and then wrote it. A revoked Ship subscriber reinstated before
    // the nightly reconcile came back on Build entitlement.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('sam@example.com', 'admin@vibld.com');
    await access.claimInvite('sam@example.com', 'user_sam');
    await billing.linkCustomer('user_sam', 'cus_sam');

    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripeWithUnmirrored().client,
    );

    assert.equal(result.scheduled, true, 'left the subscription running');
    assert.equal(
      await billing.getSubscription('sub_unmirrored'),
      undefined,
      'invented a mirror row for a subscription it could not read',
    );
  });

  it('writes the real tier when the price is one it does sell', async () => {
    // And the other half: when the price is recognised, the row written is
    // the one the reconcile would write, from the same function, so the two
    // cannot disagree. Ship, deliberately, because Build is what the broken
    // version hard-coded and a Build fixture would pass either way.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('sam@example.com', 'admin@vibld.com');
    await access.claimInvite('sam@example.com', 'user_sam');
    await billing.linkCustomer('user_sam', 'cus_sam');

    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'sam@example.com',
      () => stripeWithUnmirrored('active', 'vibld_ship_monthly').client,
    );

    assert.equal(result.scheduled, true);
    const row = await billing.getSubscription('sub_unmirrored');
    assert.equal(row?.tier, 'ship', 'restored them on the wrong plan');
    assert.equal(row?.priceId, 'price_live');
    assert.equal(row?.cancelAtPeriodEnd, true);
  });

  it('asks Stripe nothing for an account that never reached Checkout', async () => {
    // No customer mapping means they never bought anything, so there is
    // nothing to look up and the ordinary revoke costs no Stripe request.
    const db = new SqliteD1Database(SCHEMA);
    const access = new AccessStore(db);
    const billing = new BillingStore(db);
    await access.invite('free@example.com', 'admin@vibld.com');
    await access.claimInvite('free@example.com', 'user_free');

    let asked = false;
    const result = await windDownSubscription(
      ENV,
      access,
      billing,
      'free@example.com',
      () => {
        asked = true;
        return stripeWithUnmirrored().client;
      },
    );

    assert.equal(asked, false);
    assert.deepEqual(result, { scheduled: false, reason: 'nothing-to-stop' });
  });
});
