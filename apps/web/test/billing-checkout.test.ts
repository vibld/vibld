import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Stripe from 'stripe';

import {
  AutoSubscribeInFlightError,
  createCardSetupSession,
  createCheckoutSession,
} from '../worker/billing-checkout.ts';
import { BillingStore } from '../worker/billing-store.ts';
import { handleReferralClaim } from '../worker/referral-handlers.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import type { PurchaseOption } from '../worker/stripe-client.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * What this Worker asks Stripe for when somebody starts a checkout, and what
 * starting one means for the referral barrier.
 *
 * Against a Stripe stand-in that records the parameters it was given and
 * answers with a URL, so nothing here reaches Stripe, and against the real
 * schema, so the barrier is the one production runs.
 */

const SCHEMA = schemaSql();
const URLS = {
  successUrl: 'https://app.vibld.com/billing/success',
  cancelUrl: 'https://app.vibld.com/billing/cancelled',
};

interface FakeStripe {
  stripe: Stripe;
  sessions: Record<string, unknown>[];
}

/** Records every Checkout Session it is asked to create. */
function fakeStripe(): FakeStripe {
  const sessions: Record<string, unknown>[] = [];
  let customers = 0;
  const stripe = {
    customers: {
      create: async () => {
        customers += 1;
        return { id: `cus_${customers}` };
      },
    },
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: [{ id: `price_for_${lookup_keys[0]}` }],
      }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          sessions.push(params);
          return {
            id: `cs_${sessions.length}`,
            url: `https://checkout.stripe.com/c/${sessions.length}`,
          };
        },
      },
    },
  };
  return { stripe: stripe as unknown as Stripe, sessions };
}

function newDb(): SqliteD1Database {
  return new SqliteD1Database(SCHEMA);
}

const PLANS: PurchaseOption[] = [
  { kind: 'subscription', tier: 'build', interval: 'monthly' },
  { kind: 'subscription', tier: 'build', interval: 'annual' },
  { kind: 'subscription', tier: 'ship', interval: 'monthly' },
  { kind: 'subscription', tier: 'ship', interval: 'annual' },
  { kind: 'topup' },
];

/**
 * Every Checkout parameter that exists only to calculate or evidence tax.
 * `customer_update` is here because its only use on these sessions would be
 * saving the address Stripe Tax asked for back onto the customer.
 */
const TAX_PARAMS = [
  'automatic_tax',
  'tax_id_collection',
  'billing_address_collection',
  'customer_update',
];

describe('Checkout asks Stripe for no tax (L15)', () => {
  for (const option of PLANS) {
    const label =
      option.kind === 'topup'
        ? 'a top-up'
        : `${option.tier} ${option.interval}`;
    it(`sends no tax parameter for ${label}`, async () => {
      const { stripe, sessions } = fakeStripe();
      await createCheckoutSession(
        stripe,
        new BillingStore(newDb()),
        'user_1',
        option,
        URLS,
      );
      assert.equal(sessions.length, 1);
      for (const key of TAX_PARAMS) {
        assert.equal(key in sessions[0]!, false, `${label} sent ${key}`);
      }
    });
  }

  it('sends no tax parameter when saving a card', async () => {
    const { stripe, sessions } = fakeStripe();
    await createCardSetupSession(
      stripe,
      new BillingStore(newDb()),
      'user_1',
      URLS,
    );
    assert.equal(sessions[0]!.mode, 'setup');
    for (const key of TAX_PARAMS) {
      assert.equal(key in sessions[0]!, false, `card setup sent ${key}`);
    }
  });

  it('still sends what a purchase does need', async () => {
    // Removing tax must not take anything else with it: the customer, the
    // user id Checkout reports back, and the price are what the webhook
    // attributes the purchase by.
    const { stripe, sessions } = fakeStripe();
    await createCheckoutSession(
      stripe,
      new BillingStore(newDb()),
      'user_1',
      { kind: 'subscription', tier: 'build', interval: 'monthly' },
      URLS,
    );
    const session = sessions[0]!;
    assert.equal(session.customer, 'cus_1');
    assert.equal(session.client_reference_id, 'user_1');
    assert.equal(session.mode, 'subscription');
    assert.deepEqual(session.line_items, [
      { price: 'price_for_vibld_build_monthly', quantity: 1 },
    ]);
  });
});

function claim(code: string): Request {
  return new Request('https://app.vibld.com/api/referral/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

const REFERRED = { userId: 'user_new', policyIdentity: 'new@example.com' };

describe('what starting a checkout means for a referral claim', () => {
  it('lets an account that saved a card for the welcome credit claim a referral', async () => {
    // The bug: the card-setup session creates a Stripe customer, the barrier
    // read a customer as a started purchase, and so every account that took
    // its dollar could never be referred.
    const db = newDb();
    const billing = new BillingStore(db);
    const referrals = new ReferralStore(db);
    const code = await referrals.codeFor('user_owner');
    const { stripe } = fakeStripe();

    await createCardSetupSession(stripe, billing, 'user_new', URLS);
    assert.equal(await billing.findCustomerId('user_new'), 'cus_1');
    assert.equal(await billing.hasBegunAPurchase('user_new'), false);

    const response = await handleReferralClaim(
      claim(code),
      { DB: db },
      REFERRED,
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await referrals.attributionFor('user_new'))?.referrerUserId,
      'user_owner',
    );
  });

  it('refuses a claim once a plan checkout has been started', async () => {
    const db = newDb();
    const billing = new BillingStore(db);
    const referrals = new ReferralStore(db);
    const code = await referrals.codeFor('user_owner');
    const { stripe } = fakeStripe();

    await createCheckoutSession(
      stripe,
      billing,
      'user_new',
      { kind: 'subscription', tier: 'build', interval: 'monthly' },
      URLS,
    );
    // Before any webhook: the checkout exists and nothing has been paid.
    assert.equal(await billing.hasBegunAPurchase('user_new'), true);

    const response = await handleReferralClaim(
      claim(code),
      { DB: db },
      REFERRED,
    );
    // Refused, and silently, as every refusal is.
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(await referrals.attributionFor('user_new'), undefined);
  });

  it('refuses a claim once a top-up checkout has been started', async () => {
    const db = newDb();
    const billing = new BillingStore(db);
    const referrals = new ReferralStore(db);
    const code = await referrals.codeFor('user_owner');
    const { stripe } = fakeStripe();

    await createCheckoutSession(
      stripe,
      billing,
      'user_new',
      { kind: 'topup' },
      URLS,
    );

    await handleReferralClaim(claim(code), { DB: db }, REFERRED);
    assert.equal(await referrals.attributionFor('user_new'), undefined);
  });

  it('refuses a claim when the card came first and a plan checkout followed', async () => {
    // The card's customer is reused by the plan checkout, so the customer row
    // says nothing new; the start row is what has to change the answer.
    const db = newDb();
    const billing = new BillingStore(db);
    const referrals = new ReferralStore(db);
    const code = await referrals.codeFor('user_owner');
    const { stripe, sessions } = fakeStripe();

    await createCardSetupSession(stripe, billing, 'user_new', URLS);
    await createCheckoutSession(
      stripe,
      billing,
      'user_new',
      { kind: 'subscription', tier: 'ship', interval: 'annual' },
      URLS,
    );
    assert.equal(sessions[1]!.customer, sessions[0]!.customer);

    await handleReferralClaim(claim(code), { DB: db }, REFERRED);
    assert.equal(await referrals.attributionFor('user_new'), undefined);
  });

  it('records no start when Stripe fails to create the session', async () => {
    // No URL was handed back, so nothing can be paid, and the account has
    // not begun anything a referral needs to be kept away from.
    const db = newDb();
    const billing = new BillingStore(db);
    const { stripe } = fakeStripe();
    (
      stripe.checkout.sessions as unknown as { create: () => Promise<never> }
    ).create = async () => {
      throw new Error('stripe is down');
    };

    await assert.rejects(
      createCheckoutSession(
        stripe,
        billing,
        'user_new',
        { kind: 'topup' },
        URLS,
      ),
    );
    assert.equal(await billing.hasBegunAPurchase('user_new'), false);
  });
});

describe('a plan Checkout and auto-subscribe (D167)', () => {
  const PLAN: PurchaseOption = {
    kind: 'subscription',
    tier: 'build',
    interval: 'monthly',
  };

  async function inFlight(db: SqliteD1Database, userId: string) {
    await (db as unknown as D1Database)
      .prepare(
        `INSERT INTO billing_auto_subscribe
           (user_id, enabled, payment_method_id, attempt_id,
            attempt_claimed_at, updated_at)
         VALUES (?1, 1, 'pm_card', 'att_1', 'now', 'now')`,
      )
      .bind(userId)
      .run();
  }

  it('refuses a plan Checkout while auto-subscribe is starting one', async () => {
    const db = newDb();
    await inFlight(db, 'user_1');
    const { stripe, sessions } = fakeStripe();
    await assert.rejects(
      createCheckoutSession(stripe, new BillingStore(db), 'user_1', PLAN, URLS),
      AutoSubscribeInFlightError,
    );
    assert.equal(sessions.length, 0);
  });

  it('expires its own session when auto-subscribe claimed meanwhile', async () => {
    const db = newDb();
    const { stripe, sessions } = fakeStripe();
    const expired: string[] = [];
    const checkout = stripe.checkout.sessions as unknown as {
      create: (params: Record<string, unknown>) => Promise<{ id: string }>;
      expire: (id: string) => Promise<unknown>;
    };
    const create = checkout.create;
    checkout.create = async (params) => {
      const session = await create(params);
      await inFlight(db, 'user_1');
      return session;
    };
    checkout.expire = async (id) => {
      expired.push(id);
      return {};
    };
    const billing = new BillingStore(db);
    await assert.rejects(
      createCheckoutSession(stripe, billing, 'user_1', PLAN, URLS),
      AutoSubscribeInFlightError,
    );
    assert.equal(sessions.length, 1);
    assert.deepEqual(expired, ['cs_1']);
    assert.equal(await billing.hasBegunAPurchase('user_1'), false);
  });

  it('expires its own session when auto-subscribe started a plan meanwhile', async () => {
    const db = newDb();
    const { stripe } = fakeStripe();
    const expired: string[] = [];
    const checkout = stripe.checkout.sessions as unknown as {
      create: (params: Record<string, unknown>) => Promise<{ id: string }>;
      expire: (id: string) => Promise<unknown>;
    };
    const create = checkout.create;
    checkout.create = async (params) => {
      const session = await create(params);
      // Claimed, started and settled while the session was being made.
      await (db as unknown as D1Database)
        .prepare(
          `INSERT INTO billing_auto_subscribe
             (user_id, enabled, disabled_reason, stripe_subscription_id,
              updated_at)
           VALUES ('user_1', 0, 'subscribed', 'sub_auto', 'now')`,
        )
        .run();
      return session;
    };
    checkout.expire = async (id) => {
      expired.push(id);
      return {};
    };
    await assert.rejects(
      createCheckoutSession(stripe, new BillingStore(db), 'user_1', PLAN, URLS),
      AutoSubscribeInFlightError,
    );
    assert.deepEqual(expired, ['cs_1']);
  });

  it('sells no top-up either while auto-subscribe is starting a plan', async () => {
    const db = newDb();
    await inFlight(db, 'user_1');
    const { stripe, sessions } = fakeStripe();
    await assert.rejects(
      createCheckoutSession(
        stripe,
        new BillingStore(db),
        'user_1',
        { kind: 'topup' },
        URLS,
      ),
      AutoSubscribeInFlightError,
    );
    assert.equal(sessions.length, 0);
  });
});
