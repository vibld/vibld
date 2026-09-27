import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Stripe from 'stripe';

import { applyStripeEvent } from '../worker/billing-events.ts';
import { handleStripeWebhook } from '../worker/billing-handlers.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { REPLAYED_EVENT_TYPES } from '../worker/billing-replay.ts';
import {
  SIGNUP_GRANT_NOTE,
  grantSignupCreditForCard,
  signupGrantId,
} from '../worker/signup-credit.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * The welcome credit, card first (Chris, 2026-09-27).
 *
 * A dollar of model spend is paid once a card is on file, at most once per
 * card and once per account, and only on the Stripe webhook that says the
 * card was saved. These are the properties that stop it being farmed, so
 * they are asserted against the real schema (every migration, through
 * `node:sqlite`) rather than against a mock that could agree with anything.
 */

const SCHEMA = schemaSql();
const DOLLAR = 1_000_000;

function newStore(): BillingStore {
  return new BillingStore(new SqliteD1Database(SCHEMA));
}

/** An account the offer has been opened to, as the status route opens it. */
async function offered(store: BillingStore, ...userIds: string[]) {
  for (const userId of userIds) await store.openSignupOffer(userId, 100);
}

function claim(
  store: BillingStore,
  userId: string,
  setupIntentId: string,
  cardFingerprint: string,
) {
  return grantSignupCreditForCard(store, {
    userId,
    setupIntentId,
    cardFingerprint,
  });
}

describe('the card-first welcome credit: dedupe', () => {
  it('pays an offered account once its card is saved', async () => {
    const store = newStore();
    await offered(store, 'user_a');

    assert.deepEqual(await claim(store, 'user_a', 'seti_1', 'fp_1'), {
      outcome: 'granted',
      paid: true,
    });
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
    const [grant] = await store.listAdminCredits('user_a');
    assert.equal(grant!.id, signupGrantId('user_a'));
    assert.equal(grant!.note, SIGNUP_GRANT_NOTE);
  });

  it('pays one card once, however many accounts save it', async () => {
    // The farm: one card, a fresh email address each time. The account id
    // cannot see it; the card's fingerprint can.
    const store = newStore();
    await offered(store, 'user_a', 'user_b', 'user_c');

    await claim(store, 'user_a', 'seti_1', 'fp_shared');
    for (const [user, intent] of [
      ['user_b', 'seti_2'],
      ['user_c', 'seti_3'],
    ] as const) {
      assert.deepEqual(await claim(store, user, intent, 'fp_shared'), {
        outcome: 'card-used',
        paid: false,
      });
      assert.equal(await store.totalSpendableCreditMicroUsd(user), 0);
    }
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
  });

  it('pays one account once, however many cards it saves', async () => {
    const store = newStore();
    await offered(store, 'user_a');

    await claim(store, 'user_a', 'seti_1', 'fp_1');
    assert.deepEqual(await claim(store, 'user_a', 'seti_2', 'fp_2'), {
      outcome: 'account-granted',
      paid: false,
    });
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);

    // And the second card, unused as far as the credit goes, is still free
    // to pay a different account: the refusal did not claim it.
    await offered(store, 'user_b');
    assert.equal(
      (await claim(store, 'user_b', 'seti_3', 'fp_2')).outcome,
      'granted',
    );
  });

  it('holds both limits when the claims race', async () => {
    // A read-then-write check would pass every one of these before any of
    // them wrote. The partial unique indexes are what make it hold.
    const store = newStore();
    const users = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
    await offered(store, ...users);
    await Promise.all([
      ...users.map((user, n) =>
        claim(store, user, `seti_card_${n}`, 'fp_race'),
      ),
      ...[1, 2, 3].map((n) => claim(store, 'u1', `seti_acct_${n}`, `fp_${n}`)),
    ]);

    let paid = 0;
    for (const user of users) {
      paid += await store.totalSpendableCreditMicroUsd(user);
    }
    // One dollar for the shared card, and u1 at most one dollar in all. If
    // u1 won the shared card, its own cards pay nothing more; if it lost,
    // one of its own cards pays it. Either way no account holds more than a
    // dollar, and the shared card paid exactly once.
    for (const user of users) {
      assert.ok((await store.totalSpendableCreditMicroUsd(user)) <= DOLLAR);
    }
    assert.ok(paid === DOLLAR || paid === 2 * DOLLAR, `paid ${paid}`);
  });

  it('pays nothing to an account that was never offered it', async () => {
    // The offer is what carries the access decision and the cohort to a
    // webhook that can ask neither. No offer, no dollar, card or not.
    const store = newStore();
    assert.deepEqual(await claim(store, 'user_stranger', 'seti_1', 'fp_1'), {
      outcome: 'no-offer',
      paid: false,
    });
    assert.equal(await store.totalSpendableCreditMicroUsd('user_stranger'), 0);

    // And the refusal does not use the card up.
    await offered(store, 'user_new');
    assert.equal(
      (await claim(store, 'user_new', 'seti_2', 'fp_1')).outcome,
      'granted',
    );
  });

  it('leaves an account that got its dollar on creation with exactly that dollar', async () => {
    const store = newStore();
    await store.grantAdminCredit(
      signupGrantId('user_early'),
      'user_early',
      100,
      'system@vibld.com',
      'Welcome credit on account creation',
    );
    // Even with an offer somehow open to it.
    await offered(store, 'user_early');

    assert.deepEqual(await claim(store, 'user_early', 'seti_1', 'fp_1'), {
      outcome: 'account-granted',
      paid: false,
    });
    assert.equal(
      await store.totalSpendableCreditMicroUsd('user_early'),
      DOLLAR,
    );
    const grants = await store.listAdminCredits('user_early');
    assert.equal(grants.length, 1);
    assert.equal(grants[0]!.note, 'Welcome credit on account creation');
  });

  it('pays the amount the offer opened at, not one the webhook supplies', async () => {
    const store = newStore();
    await store.openSignupOffer('user_a', 250);
    await claim(store, 'user_a', 'seti_1', 'fp_1');
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 2_500_000);
  });
});

describe('the card-first welcome credit: idempotency', () => {
  it('pays once when the same SetupIntent is reported again', async () => {
    const store = newStore();
    await offered(store, 'user_a');

    const first = await claim(store, 'user_a', 'seti_1', 'fp_1');
    const again = await claim(store, 'user_a', 'seti_1', 'fp_1');
    assert.deepEqual(first, { outcome: 'granted', paid: true });
    // The same answer, and nothing moved the second time.
    assert.deepEqual(again, { outcome: 'granted', paid: false });
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
    assert.equal((await store.listAdminCredits('user_a')).length, 1);
  });

  it('finishes a grant a failed delivery left half done', async () => {
    // A delivery that died after the claim and before the payment. Stripe
    // retries, the claim is a no-op on the SetupIntent, and the payment
    // reads the claim rather than trusting what the first insert reported.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await offered(store, 'user_a');
    await db
      .prepare(
        `INSERT INTO billing_signup_cards
           (stripe_setup_intent_id, user_id, card_fingerprint, outcome, created_at)
         VALUES ('seti_1', 'user_a', 'fp_1', 'granted', '2026-09-27T00:00:00Z')`,
      )
      .run();
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);

    assert.deepEqual(await claim(store, 'user_a', 'seti_1', 'fp_1'), {
      outcome: 'granted',
      paid: true,
    });
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
  });
});

// --- The Stripe events ---------------------------------------------------

const PURPOSE = { vibld_purpose: 'signup_credit', vibld_user_id: 'user_a' };

function event(
  type: string,
  object: unknown,
  id = `evt_${type}`,
): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

function setupIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seti_1',
    object: 'setup_intent',
    status: 'succeeded',
    customer: 'cus_1',
    metadata: PURPOSE,
    payment_method: {
      id: 'pm_1',
      type: 'card',
      card: { fingerprint: 'fp_1' },
    },
    ...overrides,
  };
}

function setupSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_setup_1',
    mode: 'setup',
    customer: 'cus_1',
    client_reference_id: 'user_a',
    setup_intent: 'seti_1',
    metadata: PURPOSE,
    ...overrides,
  };
}

/** A resolver that answers from a fixed SetupIntent and counts the calls. */
function resolving(intent: unknown = setupIntent()) {
  const calls: string[] = [];
  const resolve = async (id: string) => {
    calls.push(id);
    return intent as Stripe.SetupIntent;
  };
  return { calls, resolve };
}

function apply(
  store: BillingStore,
  e: Stripe.Event,
  resolve?: (id: string) => Promise<Stripe.SetupIntent>,
) {
  return applyStripeEvent(store, e, undefined, undefined, undefined, resolve);
}

describe('applyStripeEvent: a card saved for the welcome credit', () => {
  it('pays on setup_intent.succeeded', async () => {
    const store = newStore();
    await offered(store, 'user_a');
    const { resolve } = resolving();

    assert.equal(
      await apply(
        store,
        event('setup_intent.succeeded', setupIntent()),
        resolve,
      ),
      'applied',
    );
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
    assert.equal(await store.findCustomerId('user_a'), 'cus_1');
  });

  it('pays on a setup-mode checkout.session.completed', async () => {
    const store = newStore();
    await offered(store, 'user_a');
    const { resolve, calls } = resolving();

    await apply(
      store,
      event('checkout.session.completed', setupSession()),
      resolve,
    );
    assert.deepEqual(calls, ['seti_1']);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
  });

  it('pays once when both events for one saved card arrive, in either order, twice', async () => {
    for (const order of [
      ['setup_intent.succeeded', 'checkout.session.completed'],
      ['checkout.session.completed', 'setup_intent.succeeded'],
    ]) {
      const store = newStore();
      await offered(store, 'user_a');
      const { resolve } = resolving();
      for (let round = 0; round < 2; round += 1) {
        for (const type of order) {
          const object =
            type === 'setup_intent.succeeded' ? setupIntent() : setupSession();
          assert.equal(
            await apply(store, event(type, object), resolve),
            'applied',
          );
        }
      }
      assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
      assert.equal((await store.listAdminCredits('user_a')).length, 1);
    }
  });

  it('asks Stripe nothing about a card the welcome flow did not save', async () => {
    // Every card saved anywhere fires setup_intent.succeeded, the Billing
    // Portal's included. Those pay nothing and cost no request.
    const store = newStore();
    await offered(store, 'user_a');
    const { resolve, calls } = resolving();

    await apply(
      store,
      event('setup_intent.succeeded', setupIntent({ metadata: {} })),
      resolve,
    );
    await apply(
      store,
      event('checkout.session.completed', setupSession({ metadata: {} })),
      resolve,
    );
    assert.deepEqual(calls, []);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);
  });

  it('leaves the event owed when Stripe cannot be asked, and writes nothing', async () => {
    const store = newStore();
    await offered(store, 'user_a');
    const failing = async () => {
      throw new Error('Stripe unavailable');
    };

    assert.equal(
      await apply(
        store,
        event('setup_intent.succeeded', setupIntent()),
        failing,
      ),
      'unresolved',
    );
    assert.equal(
      await apply(store, event('setup_intent.succeeded', setupIntent())),
      'unresolved',
      'no resolver at all must not read as done either',
    );
    assert.equal(await store.latestSignupCardOutcome('user_a'), undefined);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);
  });

  it('pays nothing for a payment method with no card fingerprint', async () => {
    // Without one the once-per-card limit cannot hold.
    const store = newStore();
    await offered(store, 'user_a');
    const { resolve } = resolving(
      setupIntent({
        payment_method: { id: 'pm_1', type: 'us_bank_account' },
      }),
    );
    assert.equal(
      await apply(
        store,
        event('setup_intent.succeeded', setupIntent()),
        resolve,
      ),
      'applied',
    );
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);
  });

  it('pays nothing for a SetupIntent that has not succeeded', async () => {
    const store = newStore();
    await offered(store, 'user_a');
    const { resolve } = resolving(setupIntent({ status: 'requires_action' }));
    await apply(
      store,
      event('checkout.session.completed', setupSession()),
      resolve,
    );
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);
  });

  it('is replayed by the nightly sweep as well as delivered', () => {
    // A missed delivery is otherwise a credit never paid.
    assert.ok(REPLAYED_EVENT_TYPES.includes('setup_intent.succeeded'));
    assert.ok(REPLAYED_EVENT_TYPES.includes('checkout.session.completed'));
  });
});

describe('the Stripe webhook, signed, for a saved card', () => {
  const SECRET = 'whsec_test_signup_card';

  function webhookEnv(db: SqliteD1Database) {
    return {
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: SECRET,
      DB: db,
    };
  }

  /** A Stripe client with no network: the one lookup is answered here. */
  function offlineStripe(intent: unknown = setupIntent()) {
    const stripe = new Stripe('sk_test_fake');
    const calls: string[] = [];
    (stripe.setupIntents as unknown as { retrieve: unknown }).retrieve = async (
      id: string,
      params: { expand?: string[] },
    ) => {
      // The fingerprint is on the PaymentMethod, so the lookup must ask for
      // it expanded. A resolver that forgot would read a bare id.
      assert.deepEqual(params?.expand, ['payment_method']);
      calls.push(id);
      return intent;
    };
    return { stripe, calls };
  }

  async function deliver(
    stripe: Stripe,
    env: ReturnType<typeof webhookEnv>,
    body: string,
    secret = SECRET,
  ) {
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
    });
    return handleStripeWebhook(
      new Request('https://app.example.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body,
      }),
      env,
      stripe,
    );
  }

  it('pays once when Stripe delivers the same event twice', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await offered(store, 'user_a');
    const { stripe, calls } = offlineStripe();
    const body = JSON.stringify(
      event('setup_intent.succeeded', setupIntent(), 'evt_card_1'),
    );

    for (let n = 0; n < 2; n += 1) {
      const response = await deliver(stripe, webhookEnv(db), body);
      assert.equal(response.status, 200);
    }
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
    // The redelivery stopped at the processed-event check, before Stripe
    // was asked anything.
    assert.deepEqual(calls, ['seti_1']);
    assert.equal(await store.wasEventProcessed('evt_card_1'), true);
  });

  it('fails the delivery, retryably, when the card cannot be read yet', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await offered(store, 'user_a');
    const { stripe } = offlineStripe();
    (stripe.setupIntents as unknown as { retrieve: unknown }).retrieve =
      async () => {
        throw new Error('Stripe unavailable');
      };
    const body = JSON.stringify(
      event('setup_intent.succeeded', setupIntent(), 'evt_card_2'),
    );

    const response = await deliver(stripe, webhookEnv(db), body);
    assert.equal(response.status, 500);
    assert.equal(await store.wasEventProcessed('evt_card_2'), false);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);

    // Stripe's retry, with Stripe answering this time, pays.
    const { stripe: recovered } = offlineStripe();
    assert.equal((await deliver(recovered, webhookEnv(db), body)).status, 200);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), DOLLAR);
  });

  it('pays nothing for an event it cannot verify', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await offered(store, 'user_a');
    const { stripe, calls } = offlineStripe();
    const body = JSON.stringify(
      event('setup_intent.succeeded', setupIntent(), 'evt_forged'),
    );

    const response = await deliver(stripe, webhookEnv(db), body, 'whsec_wrong');
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
    assert.equal(await store.totalSpendableCreditMicroUsd('user_a'), 0);
  });
});
