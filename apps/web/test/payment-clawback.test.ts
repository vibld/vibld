import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import Stripe from 'stripe';

import { applyStripeEvent } from '../worker/billing-events.ts';
import type { ClawbackDeps } from '../worker/billing-events.ts';
import {
  clawbackDepsFor,
  handleLiftSuspension,
  handleStripeWebhook,
  readInvoiceOfPayment,
} from '../worker/billing-handlers.ts';
import { retryUnattributedEvents } from '../worker/billing-replay.ts';
import { BillingStore } from '../worker/billing-store.ts';
import {
  clawBackReferral,
  payReferralIfEarned,
} from '../worker/referral-payout.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import {
  DEFAULT_FREE_INCLUDED_MICRO_USD,
  monthlyAllowanceMicroUsd,
} from '../worker/entitlement.ts';
import type { Principal } from '../worker/principal.ts';
import { spendableFor } from '../worker/spendable.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * Removing what a refunded or disputed payment bought (Chris, 2026-09-28).
 *
 * Against the real store and the real schema, with Stripe and the spend
 * ledger faked at the edges. The questions are the ones that decide money:
 * what comes off for each kind of reversal, that nothing comes off twice,
 * that nobody is left owing, and that a payment this deployment cannot name
 * is parked rather than guessed at.
 */

const SCHEMA = schemaSql();
const USER = 'user_a';
const CUSTOMER = 'cus_a';

/** A $20 top-up that granted $8 of credit, paid through payment intent `pi_topup`. */
async function withTopup() {
  const db = new SqliteD1Database(SCHEMA);
  const store = new BillingStore(db);
  await store.linkCustomer(USER, CUSTOMER);
  await store.recordTopup('cs_topup', USER, CUSTOMER, 800);
  await store.recordPayment('cs_topup', USER, 2000, new Date().toISOString(), [
    'cs_topup',
    'pi_topup',
  ]);
  return { db, store };
}

/** An active Build subscription whose invoice `in_1` was paid through `pi_sub`. */
async function withSubscription(
  invoice: Record<string, unknown> = {
    payment_intent: 'pi_sub',
    parent: { subscription_details: { subscription: 'sub_1' } },
  },
) {
  const db = new SqliteD1Database(SCHEMA);
  const store = new BillingStore(db);
  await store.linkCustomer(USER, CUSTOMER);
  await store.upsertSubscription({
    stripeSubscriptionId: 'sub_1',
    userId: USER,
    stripeCustomerId: CUSTOMER,
    tier: 'build',
    status: 'active',
    priceId: 'price_build_annual',
    currentPeriodEnd: '2099-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
  });
  const outcome = await applyStripeEvent(store, {
    id: 'evt_paid',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_1',
        customer: CUSTOMER,
        amount_paid: 29000,
        amount_paid_off_stripe: 0,
        ...invoice,
      },
    },
  } as never);
  assert.equal(outcome, 'applied', 'the fixture invoice was not recorded');
  return { db, store };
}

function charge(over: Record<string, unknown> = {}) {
  return {
    id: 'ch_topup',
    object: 'charge',
    customer: CUSTOMER,
    payment_intent: 'pi_topup',
    amount: 2000,
    amount_refunded: 2000,
    refunded: true,
    ...over,
  };
}

function refunded(object: Record<string, unknown>, id = 'evt_refund') {
  return { id, type: 'charge.refunded', data: { object } } as never;
}

function disputeClosed(
  status: string,
  over: Record<string, unknown> = {},
  id = 'evt_dispute',
) {
  return {
    id,
    type: 'charge.dispute.closed',
    data: {
      object: {
        id: 'dp_1',
        object: 'dispute',
        status,
        amount: 2000,
        charge: 'ch_topup',
        payment_intent: 'pi_topup',
        ...over,
      },
    },
  } as never;
}

/** The edges a clawback needs, recording what was asked of them. */
function edges(spentMicroUsd = 0, over: Partial<ClawbackDeps> = {}) {
  const cancelled: string[] = [];
  const asked: string[] = [];
  const deps: ClawbackDeps = {
    creditSpentMicroUsd: async () => spentMicroUsd,
    cancelSubscription: async (id) => {
      cancelled.push(id);
      return 'cancelled';
    },
    resolveInvoice: async (paymentIntentId) => {
      asked.push(paymentIntentId);
      return null;
    },
    ...over,
  };
  return { deps, cancelled, asked };
}

async function apply(
  store: BillingStore,
  event: never,
  deps: ClawbackDeps,
  resolveCharge?: (id: string) => Promise<Stripe.Charge>,
) {
  return applyStripeEvent(
    store,
    event,
    undefined,
    undefined,
    resolveCharge,
    undefined,
    deps,
  );
}

const creditCents = async (store: BillingStore) =>
  Math.round((await store.totalSpendableCreditMicroUsd(USER)) / 10_000);

const principal = { userId: USER } as Principal;
const spendable = (db: SqliteD1Database) =>
  spendableFor({ DB: db } as never, principal);

describe('a refunded top-up', () => {
  it('loses its credit on a full refund', async () => {
    const { store } = await withTopup();
    assert.equal(await creditCents(store), 800);

    const outcome = await apply(store, refunded(charge()), edges().deps);

    assert.equal(outcome, 'applied');
    assert.equal(await creditCents(store), 0);
    const [row, ...rest] = await store.listClawbacks(USER);
    assert.equal(rest.length, 0);
    assert.equal(row?.cause, 'refund');
    assert.equal(row?.kind, 'topup');
    assert.equal(row?.stripeObjectId, 'cs_topup');
    assert.equal(row?.creditRemovedUsdCents, 800);
    assert.equal(row?.creditShortfallUsdCents, 0);
    assert.equal(row?.suspends, false);
  });

  it('removes nothing twice when the same refund is applied again', async () => {
    // A redelivery, the replay and a parked retry all look like this. The
    // account is given other credit first, so the floor cannot be what
    // stops a second deduction: only the row id can.
    const { store } = await withTopup();
    await store.grantAdminCredit('goodwill', USER, 500, 'a@vibld.com', null);
    const { deps } = edges();

    await apply(store, refunded(charge()), deps);
    await apply(store, refunded(charge()), deps);

    assert.equal(await creditCents(store), 500);
    assert.equal((await store.listClawbacks(USER)).length, 1);
  });

  it('loses the refunded share on a partial refund, and the rest on a second', async () => {
    const { store } = await withTopup();
    await store.grantAdminCredit('goodwill', USER, 500, 'a@vibld.com', null);
    const { deps } = edges();

    // $5 of $20 back: a quarter of the $8 credit.
    await apply(
      store,
      refunded(charge({ amount_refunded: 500, refunded: false }), 'evt_r1'),
      deps,
    );
    assert.equal(await creditCents(store), 1300 - 200);

    // Stripe's `amount_refunded` is the running total, so the second
    // refund owes only what the first did not already take.
    await apply(store, refunded(charge(), 'evt_r2'), deps);
    assert.equal(await creditCents(store), 500);

    // The older event arriving last, as the replay's descent can deliver
    // it, owes nothing more.
    await apply(
      store,
      refunded(charge({ amount_refunded: 1000, refunded: false }), 'evt_r0'),
      deps,
    );
    assert.equal(await creditCents(store), 500);
    const removed = (await store.listClawbacks(USER)).reduce(
      (sum, row) => sum + row.creditRemovedUsdCents,
      0,
    );
    assert.equal(removed, 800, 'the refunds took more than the top-up gave');
  });

  it('never takes the balance below zero, and records the shortfall', async () => {
    // $6 of the $8 already spent: $2 is left to take, and the other $6 is
    // recorded as owed and not collected.
    const { db, store } = await withTopup();

    await apply(store, refunded(charge()), edges(6_000_000).deps);

    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.creditRemovedUsdCents, 200);
    assert.equal(row?.creditShortfallUsdCents, 600);
    // Granted less spent is exactly zero: nothing left, nothing owed.
    assert.equal(await creditCents(store), 600);
    assert.equal((await spendable(db)).topupCeiling, 6_000_000);
  });

  it('takes nothing from an account that spent it all, and says so', async () => {
    const { store } = await withTopup();

    await apply(store, refunded(charge()), edges(8_000_000).deps);

    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.creditRemovedUsdCents, 0);
    assert.equal(row?.creditShortfallUsdCents, 800);
    assert.equal(await creditCents(store), 800);
  });

  it('parks rather than guessing when the spend ledger cannot be read', async () => {
    const { store } = await withTopup();
    const outcome = await apply(
      store,
      refunded(charge()),
      edges(0, {
        creditSpentMicroUsd: async () => {
          throw new Error('ledger unavailable');
        },
      }).deps,
    );
    assert.equal(outcome, 'unresolved');
    assert.equal(await creditCents(store), 800);
    assert.deepEqual(await store.listClawbacks(USER), []);
  });
});

describe('a refunded subscription payment', () => {
  it('ends the subscription on a full refund, in D1 and in Stripe', async () => {
    const { db, store } = await withSubscription();
    const { deps, cancelled } = edges();

    const outcome = await apply(
      store,
      refunded(
        charge({
          id: 'ch_sub',
          payment_intent: 'pi_sub',
          amount: 29000,
          amount_refunded: 29000,
        }),
      ),
      deps,
    );

    assert.equal(outcome, 'applied');
    assert.deepEqual(cancelled, ['sub_1']);
    assert.equal(await store.findActiveSubscription(USER), undefined);
    assert.equal(
      (await spendable(db)).monthlyAllowance,
      monthlyAllowanceMicroUsd('free', DEFAULT_FREE_INCLUDED_MICRO_USD),
    );
    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.kind, 'subscription');
    assert.equal(row?.stripeSubscriptionId, 'sub_1');
    assert.equal(row?.stripeObjectId, 'in_1');

    // The mirror is overwritten by every subscription event, and the replay
    // applies them out of order. An older `active` must not bring the
    // allowance back.
    await store.upsertSubscription({
      stripeSubscriptionId: 'sub_1',
      userId: USER,
      stripeCustomerId: CUSTOMER,
      tier: 'build',
      status: 'active',
      priceId: 'price_build_annual',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    });
    assert.equal(await store.findActiveSubscription(USER), undefined);
  });

  it('treats a partial refund as the cancellation it is, and keeps the record', async () => {
    // How an operator processes an annual plan's prorated cancellation:
    // refund the unused whole months in Stripe. Ended now, prorated no
    // further.
    const { store } = await withSubscription();
    const { deps, cancelled } = edges();

    const outcome = await apply(
      store,
      refunded(
        charge({
          id: 'ch_sub',
          payment_intent: 'pi_sub',
          amount: 29000,
          amount_refunded: 12083,
          refunded: false,
        }),
      ),
      deps,
    );

    assert.equal(outcome, 'applied');
    assert.deepEqual(cancelled, ['sub_1']);
    assert.equal(await store.findActiveSubscription(USER), undefined);
    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.reversedUsdCents, 12083);
    assert.equal(row?.chargeUsdCents, 29000);
    assert.equal(row?.creditRemovedUsdCents, 0);
  });

  it('is safe to apply again, and asks Stripe to cancel only what is live', async () => {
    const { store } = await withSubscription();
    const { deps, cancelled } = edges();
    const event = refunded(
      charge({ id: 'ch_sub', payment_intent: 'pi_sub', amount: 29000 }),
    );

    assert.equal(await apply(store, event, deps), 'applied');
    assert.equal(await apply(store, event, deps), 'applied');

    assert.equal((await store.listClawbacks(USER)).length, 1);
    // Asked each time, because the cancel is not in D1 and is what a retry
    // after a failed one exists to finish. `cancelSubscriptionNow` answers
    // `already-ended` without cancelling twice; its own test is below.
    assert.deepEqual(cancelled, ['sub_1', 'sub_1']);
  });

  it('finds the invoice through Stripe when the refund and the invoice share no id', async () => {
    // The current API: an invoice names no payment intent and a charge
    // names no invoice, so only Stripe's invoice payments join them.
    const { store } = await withSubscription({
      parent: { subscription_details: { subscription: 'sub_1' } },
    });
    const { deps, cancelled, asked } = edges(0, {
      resolveInvoice: async (paymentIntentId) => {
        asked.push(paymentIntentId);
        return { invoiceId: 'in_1', subscriptionId: 'sub_1' };
      },
    });

    const outcome = await apply(
      store,
      refunded(
        charge({ id: 'ch_new', payment_intent: 'pi_new', amount: 29000 }),
      ),
      deps,
    );

    assert.equal(outcome, 'applied');
    assert.deepEqual(asked, ['pi_new']);
    assert.deepEqual(cancelled, ['sub_1']);
  });

  it('stops the allowance even when Stripe cannot cancel yet, and retries the cancel', async () => {
    const { store } = await withSubscription();
    const event = refunded(
      charge({ id: 'ch_sub', payment_intent: 'pi_sub', amount: 29000 }),
    );

    const failing = await apply(
      store,
      event,
      edges(0, {
        cancelSubscription: async () => {
          throw new Error('stripe is down');
        },
      }).deps,
    );
    assert.equal(failing, 'unresolved', 'a failed cancel was reported done');
    assert.equal(await store.findActiveSubscription(USER), undefined);

    const { deps, cancelled } = edges();
    assert.equal(await apply(store, event, deps), 'applied');
    assert.deepEqual(cancelled, ['sub_1']);
  });
});

describe('a dispute', () => {
  const chargeOf = async (id: string) =>
    ({ ...charge({ amount_refunded: 0, refunded: false }), id }) as never;

  it('removes the credit and suspends the account when it is lost', async () => {
    const { db, store } = await withTopup();

    const outcome = await apply(
      store,
      disputeClosed('lost'),
      edges().deps,
      chargeOf,
    );

    assert.equal(outcome, 'applied');
    assert.equal(await creditCents(store), 0);
    assert.equal(await store.isSuspended(USER), true);
    assert.deepEqual(await spendable(db), {
      monthlyAllowance: 0,
      topupCeiling: 0,
      suspended: true,
    });
    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.cause, 'dispute');
    assert.equal(row?.suspends, true);
    assert.equal(row?.liftedAt, null);
  });

  it('ends a subscription and suspends when a subscription payment is lost', async () => {
    const { store } = await withSubscription();
    const { deps, cancelled } = edges();

    await apply(
      store,
      disputeClosed('lost', {
        amount: 29000,
        charge: 'ch_sub',
        payment_intent: 'pi_sub',
      }),
      deps,
      async (id) =>
        charge({
          id,
          payment_intent: 'pi_sub',
          amount: 29000,
          amount_refunded: 0,
        }) as never,
    );

    assert.deepEqual(cancelled, ['sub_1']);
    assert.equal(await store.findActiveSubscription(USER), undefined);
    assert.equal(await store.isSuspended(USER), true);
  });

  it('removes nothing and suspends nobody when it is won or withdrawn', async () => {
    const { db, store } = await withTopup();
    const { deps, cancelled } = edges();

    for (const status of ['won', 'warning_closed', 'prevented']) {
      assert.equal(
        await apply(store, disputeClosed(status), deps, chargeOf),
        'applied',
      );
    }
    // Opening one is not losing one.
    await apply(
      store,
      {
        id: 'evt_opened',
        type: 'charge.dispute.created',
        data: { object: { id: 'dp_1', status: 'needs_response' } },
      } as never,
      deps,
      chargeOf,
    );

    assert.equal(await creditCents(store), 800);
    assert.equal(await store.isSuspended(USER), false);
    assert.equal((await spendable(db)).suspended, undefined);
    assert.deepEqual(await store.listClawbacks(USER), []);
    assert.deepEqual(cancelled, []);
  });

  it('stays lifted once an operator lifts it, until a new dispute is lost', async () => {
    const { db, store } = await withTopup();
    const { deps } = edges();
    await apply(store, disputeClosed('lost'), deps, chargeOf);

    const lookups: string[] = [];
    const response = await handleLiftSuspension(
      new Request('https://app.vibld.test/api/admin/suspension/lift', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
      { DB: db as unknown as D1Database },
      'ops@vibld.com',
      async (email) => {
        lookups.push(email);
        return { ok: true, userId: USER };
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      userId: USER,
      lifted: 1,
    });
    assert.deepEqual(lookups, ['a@example.com']);
    assert.equal(await store.isSuspended(USER), false);
    assert.equal((await spendable(db)).suspended, undefined);
    const [row] = await store.listClawbacks(USER);
    assert.equal(row?.liftedByEmail, 'ops@vibld.com');

    // The same dispute replayed is the same row, already lifted.
    await apply(store, disputeClosed('lost'), deps, chargeOf);
    assert.equal(await store.isSuspended(USER), false);

    // A different one is a new suspension.
    await apply(
      store,
      disputeClosed('lost', { id: 'dp_2' }, 'evt_dispute_2'),
      deps,
      chargeOf,
    );
    assert.equal(await store.isSuspended(USER), true);
  });
});

describe('lifting a suspension, as a route', () => {
  const env = () => ({
    DB: new SqliteD1Database(SCHEMA) as unknown as D1Database,
  });
  const found = async () => ({ ok: true as const, userId: USER });

  it('answers only POST', async () => {
    const response = await handleLiftSuspension(
      new Request('https://app.vibld.test/api/admin/suspension/lift'),
      env(),
      'ops@vibld.com',
      found,
    );
    assert.equal(response.status, 405);
  });

  it('refuses a body with no email, and an email nobody has', async () => {
    const empty = await handleLiftSuspension(
      new Request('https://app.vibld.test/api/admin/suspension/lift', {
        method: 'POST',
        body: JSON.stringify({ email: ' ' }),
      }),
      env(),
      'ops@vibld.com',
      found,
    );
    assert.equal(empty.status, 400);

    const nobody = await handleLiftSuspension(
      new Request('https://app.vibld.test/api/admin/suspension/lift', {
        method: 'POST',
        body: JSON.stringify({ email: 'ghost@example.com' }),
      }),
      env(),
      'ops@vibld.com',
      async () => ({
        ok: false,
        error: 'No user found for ghost@example.com.',
      }),
    );
    assert.equal(nobody.status, 404);
  });

  it('says so when there was nothing to lift', async () => {
    const response = await handleLiftSuspension(
      new Request('https://app.vibld.test/api/admin/suspension/lift', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com' }),
      }),
      env(),
      'ops@vibld.com',
      found,
    );
    assert.deepEqual(await response.json(), {
      ok: true,
      userId: USER,
      lifted: 0,
    });
  });
});

describe('a reversal of a payment this deployment cannot name', () => {
  it('parks like an unattributed payment, and removes nothing', async () => {
    const { store } = await withTopup();
    const { deps, asked } = edges();

    const outcome = await apply(
      store,
      refunded(charge({ id: 'ch_elsewhere', payment_intent: 'pi_elsewhere' })),
      deps,
    );

    assert.equal(outcome, 'unresolved');
    // Stripe was asked once, and knew of no invoice either.
    assert.deepEqual(asked, ['pi_elsewhere']);
    assert.equal(await creditCents(store), 800);
    assert.deepEqual(await store.listClawbacks(USER), []);
  });

  it('is applied by the parked retry once the payment it refunds is recorded', async () => {
    // The replay descends newest first, so a refund can be read before the
    // purchase it refunds. Parked, it waits; once the purchase lands, the
    // retry applies it exactly once.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.linkCustomer(USER, CUSTOMER);
    const event = {
      id: 'evt_early_refund',
      type: 'charge.refunded',
      created: 100,
      data: { object: charge() },
    };
    await store.parkUnattributedEvent(
      event.id,
      event.type,
      event.created,
      JSON.stringify(event),
    );
    const { deps } = edges();

    const first = await retryUnattributedEvents(
      store,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      deps,
    );
    assert.equal(first.waiting, 1);

    await store.recordTopup('cs_topup', USER, CUSTOMER, 800);
    await store.recordPayment(
      'cs_topup',
      USER,
      2000,
      new Date().toISOString(),
      ['cs_topup', 'pi_topup'],
    );
    const second = await retryUnattributedEvents(
      store,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      deps,
    );
    assert.equal(second.applied, 1);
    assert.equal(await creditCents(store), 0);
    assert.equal(await store.wasEventProcessed(event.id), true);

    const third = await retryUnattributedEvents(
      store,
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      deps,
    );
    assert.equal(third.tried, 0);
    assert.equal((await store.listClawbacks(USER)).length, 1);
  });

  it('parks a refund for a customer nobody is mapped to, as before', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    const outcome = await apply(
      store,
      refunded(charge({ customer: 'cus_nobody' })),
      edges().deps,
    );
    assert.equal(outcome, 'unresolved');
  });

  it('never matches another account’s payment', async () => {
    // The charge's customer says whose money it was. A payment recorded
    // under somebody else with the same id is not this one.
    const { store } = await withTopup();
    await store.linkCustomer('user_b', 'cus_b');
    const outcome = await apply(
      store,
      refunded(charge({ customer: 'cus_b' })),
      edges().deps,
    );
    assert.equal(outcome, 'unresolved');
    assert.equal(await creditCents(store), 800);
  });
});

describe('the Stripe webhook, signed, for a refund', () => {
  const SECRET = 'whsec_test_clawback';

  function offlineStripe() {
    const stripe = new Stripe('sk_test_fake');
    const calls: { method: string; args: unknown[] }[] = [];
    const subscriptions = stripe.subscriptions as unknown as {
      retrieve: unknown;
      cancel: unknown;
    };
    subscriptions.retrieve = async (...args: unknown[]) => {
      calls.push({ method: 'retrieve', args });
      return { id: args[0], status: 'active' };
    };
    subscriptions.cancel = async (...args: unknown[]) => {
      calls.push({ method: 'cancel', args });
      return { id: args[0], status: 'canceled' };
    };
    return { stripe, calls };
  }

  function webhookEnv(db: SqliteD1Database, spentMicroUsd = 0) {
    const keys: string[] = [];
    return {
      keys,
      env: {
        STRIPE_SECRET_KEY: 'sk_test_fake',
        STRIPE_WEBHOOK_SECRET: SECRET,
        DB: db as unknown as D1Database,
        USER_BUDGET: {
          getByName: (key: string) => {
            keys.push(key);
            return {
              usageFor: async () => ({ spentMicroUsd, inFlight: 0 }),
            };
          },
        } as never,
      },
    };
  }

  async function deliver(
    stripe: Stripe,
    env: Parameters<typeof handleStripeWebhook>[1],
    body: string,
  ) {
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret: SECRET,
    });
    return handleStripeWebhook(
      new Request('https://app.vibld.test/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body,
      }),
      env,
      stripe,
    );
  }

  it('removes a refunded top-up once, reading the top-up ledger for the floor', async () => {
    const { db, store } = await withTopup();
    const { stripe } = offlineStripe();
    const { env, keys } = webhookEnv(db, 2_000_000);
    const body = JSON.stringify({
      id: 'evt_hook_refund',
      object: 'event',
      type: 'charge.refunded',
      data: { object: charge() },
    });

    for (let n = 0; n < 2; n += 1) {
      assert.equal((await deliver(stripe, env, body)).status, 200);
    }

    // $2 spent: $6 taken, $2 recorded as a shortfall, and only once.
    assert.equal(await creditCents(store), 200);
    assert.deepEqual(keys, [`${USER}:topup`]);
    assert.equal((await store.listClawbacks(USER)).length, 1);
  });

  it('cancels a refunded subscription now, without a final invoice or proration', async () => {
    const { db, store } = await withSubscription();
    const { stripe, calls } = offlineStripe();
    const body = JSON.stringify({
      id: 'evt_hook_sub',
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: charge({
          id: 'ch_sub',
          payment_intent: 'pi_sub',
          amount: 29000,
          amount_refunded: 12083,
          refunded: false,
        }),
      },
    });

    const response = await deliver(stripe, webhookEnv(db).env, body);

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { method: 'retrieve', args: ['sub_1'] },
      {
        method: 'cancel',
        args: ['sub_1', { invoice_now: false, prorate: false }],
      },
    ]);
    assert.equal(await store.findActiveSubscription(USER), undefined);
  });

  it('fails the delivery, retryably, for a refund it cannot tie to a payment', async () => {
    const { db, store } = await withTopup();
    const { stripe } = offlineStripe();
    (stripe.invoicePayments as unknown as { list: unknown }).list =
      async () => ({ data: [], has_more: false });
    const body = JSON.stringify({
      id: 'evt_hook_unknown',
      object: 'event',
      type: 'charge.refunded',
      data: {
        object: charge({ id: 'ch_other', payment_intent: 'pi_other' }),
      },
    });

    const response = await deliver(stripe, webhookEnv(db).env, body);

    assert.equal(response.status, 500);
    assert.equal(await store.wasEventProcessed('evt_hook_unknown'), false);
    assert.equal(await creditCents(store), 800);
  });
});

describe('what a paid invoice records for a later refund', () => {
  it('records the payments Stripe lists on it, so no question is needed', async () => {
    const { store } = await withSubscription({
      parent: { subscription_details: { subscription: 'sub_1' } },
      payments: {
        data: [
          { payment: { type: 'payment_intent', payment_intent: 'pi_listed' } },
        ],
      },
    });
    const { deps, cancelled, asked } = edges();

    const outcome = await apply(
      store,
      refunded(
        charge({ id: 'ch_listed', payment_intent: 'pi_listed', amount: 29000 }),
      ),
      deps,
    );

    assert.equal(outcome, 'applied');
    assert.deepEqual(asked, []);
    assert.deepEqual(cancelled, ['sub_1']);
  });

  it('learns its subscription when the same invoice is recorded again', async () => {
    // A row written before the column existed has no subscription; the
    // nightly reconcile re-records the latest invoice with one, and that is
    // the only thing a repeat may change.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.recordPayment('in_old', USER, 2900, '2026-01-01T00:00:00Z', [
      'in_old',
      'pi_old',
    ]);
    await store.recordPayment(
      'in_old',
      USER,
      0,
      '2026-02-01T00:00:00Z',
      [],
      'sub_old',
    );
    await store.recordPayment(
      'in_old',
      USER,
      0,
      '2026-03-01T00:00:00Z',
      [],
      'sub_other',
    );

    const found = await store.findReversedPayment(USER, ['pi_old']);
    assert.deepEqual(found, {
      stripeObjectId: 'in_old',
      amountUsdCents: 2900,
      stripeSubscriptionId: 'sub_old',
      topup: null,
    });
  });
});

describe('the Stripe questions a clawback asks', () => {
  it('reads an invoice and its subscription from a payment intent', async () => {
    const stripe = new Stripe('sk_test_fake');
    const asked: unknown[] = [];
    (stripe.invoicePayments as unknown as { list: unknown }).list = async (
      params: unknown,
    ) => {
      asked.push(params);
      return {
        data: [
          {
            invoice: {
              id: 'in_9',
              parent: { subscription_details: { subscription: 'sub_9' } },
            },
          },
        ],
        has_more: false,
      };
    };

    const found = await readInvoiceOfPayment(stripe)('pi_9');

    assert.deepEqual(found, { invoiceId: 'in_9', subscriptionId: 'sub_9' });
    assert.deepEqual(asked, [
      {
        payment: { type: 'payment_intent', payment_intent: 'pi_9' },
        limit: 1,
        expand: ['data.invoice'],
      },
    ]);
  });

  it('does not cancel a subscription Stripe has already ended', async () => {
    const stripe = new Stripe('sk_test_fake');
    const cancelled: unknown[] = [];
    const subscriptions = stripe.subscriptions as unknown as {
      retrieve: unknown;
      cancel: unknown;
    };
    subscriptions.retrieve = async (id: string) => ({ id, status: 'canceled' });
    subscriptions.cancel = async (...args: unknown[]) => {
      cancelled.push(args);
    };

    const outcome = await clawbackDepsFor(stripe, undefined)
      .cancelSubscription!('sub_1');

    assert.equal(outcome, 'already-ended');
    assert.deepEqual(cancelled, []);
  });

  it('has no spend reader without the ledger, so a top-up refund parks', () => {
    const stripe = new Stripe('sk_test_fake');
    assert.equal(
      clawbackDepsFor(stripe, undefined).creditSpentMicroUsd,
      undefined,
    );
  });
});

describe('what the worst reversal costs in D1', () => {
  it('fits the thirteen queries the nightly replay budgets for it', async () => {
    // `MAX_QUERIES_PER_EVENT` in billing-replay.ts sizes every replay page
    // and parked batch from this. The worst case is a refund that takes a
    // referral back and whose invoice had to be named by Stripe before the
    // subscription could be ended. Measured, because under-counting is how
    // a nightly run goes over D1's limit and throws.
    const inner = new SqliteD1Database(SCHEMA);
    let statements = 0;
    const counted = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver) as unknown;
          if (typeof value !== 'function') return value;
          if (key === 'bind') {
            return (...values: unknown[]) => counted(target.bind(...values));
          }
          if (key === 'run' || key === 'first' || key === 'all') {
            return (...args: unknown[]) => {
              statements += 1;
              return (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              );
            };
          }
          return (value as (...a: unknown[]) => unknown).bind(target);
        },
      });
    const db = {
      prepare: (query: string) => counted(inner.prepare(query)),
    } as unknown as D1Database;
    const store = new BillingStore(db);
    const referrals = new ReferralStore(db);
    const payout = { referrals, billing: store };

    await store.linkCustomer(USER, CUSTOMER);
    // Attributed before anything is bought, as the referral barrier needs.
    const code = await referrals.codeFor('user_referrer');
    await referrals.attribute(USER, 'user_referrer', code);
    await store.upsertSubscription({
      stripeSubscriptionId: 'sub_1',
      userId: USER,
      stripeCustomerId: CUSTOMER,
      tier: 'build',
      status: 'active',
      priceId: 'price_build_monthly',
      currentPeriodEnd: '2099-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    });
    await store.recordPayment('in_1', USER, 2900, '2026-09-01T00:00:00Z', [
      'in_1',
    ]);
    const paid = await payReferralIfEarned(payout, USER, ['pi_new']);
    assert.equal(paid.paid, true, 'the fixture did not pay the referral');

    const before = statements;
    const outcome = await applyStripeEvent(
      store,
      refunded(
        charge({ id: 'ch_new', payment_intent: 'pi_new', amount: 2900 }),
      ),
      undefined,
      (userId, reason, ids) =>
        clawBackReferral(payout, userId, reason, ids).then(() => undefined),
      undefined,
      undefined,
      edges(0, {
        resolveInvoice: async () => ({
          invoiceId: 'in_1',
          subscriptionId: 'sub_1',
        }),
      }).deps,
    );
    await store.markEventProcessed('evt_refund', 'charge.refunded');
    const spent = statements - before;

    assert.equal(outcome, 'applied');
    assert.equal(await store.findActiveSubscription(USER), undefined);
    assert.ok(spent <= 13, `the worst reversal cost ${spent} queries`);
  });
});
