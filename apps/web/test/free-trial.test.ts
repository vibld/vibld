import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import { UserBudget } from '../worker/budget.ts';
import {
  DEFAULT_FREE_TRIAL_MICRO_USD,
  TRIAL_PERIOD_KEY,
  allowancePeriodKey,
} from '../worker/entitlement.ts';
import {
  refusalFor,
  reserveBudget,
  type ReserveEnv,
} from '../worker/reserve.ts';
import { allowanceOf, freeTrialOf, spendableFor } from '../worker/spendable.ts';
import type { Principal } from '../worker/principal.ts';
import {
  signupCreditPrompt,
  CARD_ADDED_PATH,
} from '../src/billing/billing-client.ts';
import type { BillingStatus } from '../src/billing/billing-client.ts';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

/**
 * D159 (Chris, 2026-10-05: "Trial, then $1/mo"): a Free account with no
 * card on file gets about two builds once, $0.20, and saving a card moves
 * it to the monthly dollar. One card buys one account its month.
 *
 * The figures are the decision's, written out rather than imported, so a
 * test of D159 cannot be satisfied by changing the constant it tests.
 */
const TRIAL = 200_000;
const MONTHLY = 1_000_000;
const BILLING = {
  STRIPE_SECRET_KEY: 'sk',
  STRIPE_WEBHOOK_SECRET: 'wh',
  DB: {} as D1Database,
};
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

function db(): D1Database {
  return new SqliteD1Database(schemaSql()) as unknown as D1Database;
}

async function saveCard(
  database: D1Database,
  userId: string,
  fingerprint: string,
  at: string,
  intent = `seti_${userId}_${fingerprint}`,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO billing_signup_cards
         (stripe_setup_intent_id, user_id, card_fingerprint, outcome, created_at)
       VALUES (?1, ?2, ?3, 'no-offer', ?4)`,
    )
    .bind(intent, userId, fingerprint, at)
    .run();
}

describe('a card on file for the Free month (D159)', () => {
  it('is none for an account that saved no card', async () => {
    const store = new BillingStore(db());
    assert.deepEqual(await store.freeCardOf('user_a'), {
      onFile: false,
      cardAlreadyUsed: false,
    });
  });

  it('is the card the account saved first', async () => {
    const database = db();
    await saveCard(database, 'user_a', 'fp_1', '2026-10-06T10:00:00.000Z');
    assert.equal(
      (await new BillingStore(database).freeCardOf('user_a')).onFile,
      true,
    );
  });

  it('is not a card another account saved first, and says so', async () => {
    const database = db();
    await saveCard(database, 'user_a', 'fp_1', '2026-10-06T10:00:00.000Z');
    await saveCard(database, 'user_b', 'fp_1', '2026-10-06T11:00:00.000Z');
    const store = new BillingStore(database);
    assert.equal((await store.freeCardOf('user_a')).onFile, true);
    assert.deepEqual(await store.freeCardOf('user_b'), {
      onFile: false,
      cardAlreadyUsed: true,
    });
    // A card of its own still counts.
    await saveCard(database, 'user_b', 'fp_2', '2026-10-06T12:00:00.000Z');
    assert.equal((await store.freeCardOf('user_b')).onFile, true);
  });

  it('gives a card saved twice in the same millisecond to one account', async () => {
    const database = db();
    const at = '2026-10-06T10:00:00.000Z';
    await saveCard(database, 'user_a', 'fp_1', at, 'seti_2');
    await saveCard(database, 'user_b', 'fp_1', at, 'seti_1');
    const store = new BillingStore(database);
    assert.equal((await store.freeCardOf('user_b')).onFile, true);
    assert.deepEqual(await store.freeCardOf('user_a'), {
      onFile: false,
      cardAlreadyUsed: true,
    });
  });

  it('counts an account that has paid, for a plan or a top-up', async () => {
    const database = db();
    await database
      .prepare(
        `INSERT INTO billing_subscriptions
           (stripe_subscription_id, user_id, stripe_customer_id, tier, status,
            price_id, current_period_end, cancel_at_period_end, created_at,
            updated_at)
         VALUES ('sub_1', 'user_a', 'cus_1', 'build', 'canceled', 'price', NULL, 0, ?1, ?1)`,
      )
      .bind('2026-10-01T00:00:00.000Z')
      .run();
    await database
      .prepare(
        `INSERT INTO billing_topups
           (stripe_checkout_session_id, user_id, stripe_customer_id, credit_usd_cents, created_at)
         VALUES ('cs_1', 'user_b', 'cus_2', 800, ?1)`,
      )
      .bind('2026-10-01T00:00:00.000Z')
      .run();
    const store = new BillingStore(database);
    assert.equal((await store.freeCardOf('user_a')).onFile, true);
    assert.equal((await store.freeCardOf('user_b')).onFile, true);
  });
});

describe("a Free account's allowance (D159)", () => {
  const card = (onFile: boolean, cardAlreadyUsed = false) => ({
    freeCardOf: async () => ({ onFile, cardAlreadyUsed }),
  });

  it('is $0.20 for the life of the account without a card', async () => {
    assert.equal(DEFAULT_FREE_TRIAL_MICRO_USD, TRIAL);
    assert.deepEqual(
      await allowanceOf(
        BILLING,
        card(false),
        'user_a',
        'free',
        null,
        undefined,
      ),
      {
        monthlyAllowance: TRIAL,
        allowancePeriod: TRIAL_PERIOD_KEY,
        trial: { cardAlreadyUsed: false },
      },
    );
  });

  it('is $1 a month with one', async () => {
    assert.deepEqual(
      await allowanceOf(BILLING, card(true), 'user_a', 'free', null, undefined),
      { monthlyAllowance: MONTHLY },
    );
  });

  it('is unchanged for a paid plan, an admin cap, and a deployment with no plans', async () => {
    assert.deepEqual(
      await allowanceOf(
        BILLING,
        card(false),
        'user_a',
        'build',
        null,
        undefined,
      ),
      { monthlyAllowance: 14_000_000 },
    );
    assert.deepEqual(
      await allowanceOf(
        BILLING,
        card(false),
        'user_a',
        'free',
        { activeProjectLimit: null, monthlySpendCapMicroUsd: 500_000 },
        undefined,
      ),
      { monthlyAllowance: 500_000 },
    );
    assert.deepEqual(
      await allowanceOf({}, card(false), 'user_a', 'free', null, undefined),
      { monthlyAllowance: MONTHLY },
    );
  });

  it('reads the trial from the deployment, where zero means none', () => {
    assert.equal(freeTrialOf({}), TRIAL);
    assert.equal(freeTrialOf({ VIBLD_FREE_TRIAL_MICRO_USD: '0' }), 0);
    assert.equal(freeTrialOf({ VIBLD_FREE_TRIAL_MICRO_USD: '50000' }), 50_000);
    assert.equal(freeTrialOf({ VIBLD_FREE_TRIAL_MICRO_USD: 'lots' }), TRIAL);
  });
});

describe('what a Free account may spend, end to end (D159)', () => {
  it('is the trial until a card is saved, then the month', async () => {
    const database = db();
    const env = { ...BILLING, DB: database };
    const principal = { userId: 'user_a' } as Principal;
    const before = await spendableFor(env, principal);
    assert.equal(before.monthlyAllowance, TRIAL);
    assert.equal(before.allowancePeriod, TRIAL_PERIOD_KEY);
    assert.equal(before.freePool, true);

    await saveCard(database, 'user_a', 'fp_1', '2026-10-06T10:00:00.000Z');
    const after = await spendableFor(env, principal);
    assert.equal(after.monthlyAllowance, MONTHLY);
    assert.equal(after.allowancePeriod, undefined);
  });
});

describe('spending the trial (D159)', () => {
  function ledgers() {
    const objects = new Map<string, UserBudget>();
    const of = (key: string) => {
      let object = objects.get(key);
      if (!object) {
        object = new UserBudget(fakeDurableObjectCtx(), {});
        objects.set(key, object);
      }
      return object;
    };
    return {
      of,
      env: {
        USER_BUDGET: { getByName: of } as unknown as ReserveEnv['USER_BUDGET'],
      } as ReserveEnv,
    };
  }
  const reserve = (env: ReserveEnv, amount: number, at = NOW) =>
    reserveBudget(
      env,
      'user_a',
      amount,
      TRIAL,
      0,
      at,
      async () => {},
      undefined,
      {
        allowancePeriod: TRIAL_PERIOD_KEY,
      },
    );

  it('draws on one period that never resets', async () => {
    const { env, of } = ledgers();
    const first = await reserve(env, 150_000);
    assert.ok(first.ok && first.layers.user.id !== undefined);
    of('user_a').settle(first.layers.user.id, 150_000);
    assert.equal(
      of('user_a').usageFor(TRIAL_PERIOD_KEY).spentMicroUsd,
      150_000,
    );
    assert.equal(
      of('user_a').usageFor(allowancePeriodKey(NOW)).spentMicroUsd,
      0,
    );

    // A month later, the trial is still spent.
    const later = await reserve(env, 100_000, Date.UTC(2026, 10, 6));
    assert.equal(later.ok, false);
  });

  it('asks for a card when it runs out, not for the 1st', async () => {
    const { env } = ledgers();
    const refused = await reserve(env, TRIAL + 1);
    assert.ok(!refused.ok);
    assert.equal(
      refused.ceiling?.layer === 'user' && refused.ceiling.trial,
      true,
    );
    const { error } = refusalFor(refused, 'This build', TRIAL + 1);
    assert.match(error, /the free trial has \$0\.20 left/);
    assert.match(error, /Add a card to get free builds every month/);
    assert.doesNotMatch(error, /resets on the 1st/);
  });
});

describe('what the builder says to a Free account on the trial (D159)', () => {
  const status = (over: Partial<BillingStatus> = {}): BillingStatus => ({
    tier: 'free',
    allowanceMicroUsd: TRIAL,
    spentMicroUsd: 0,
    topupRemainingMicroUsd: 0,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasStripeCustomer: false,
    billingConfigured: true,
    freeTrial: { cardAlreadyUsed: false, monthlyMicroUsd: MONTHLY },
    ...over,
  });

  it('offers the monthly dollar for a card', () => {
    assert.deepEqual(signupCreditPrompt(status(), '/'), {
      kind: 'offer',
      message:
        "Add a card to get $1 of free builds every month. You won't be charged.",
    });
  });

  it('names the welcome credit too, where it is offered', () => {
    assert.match(
      signupCreditPrompt(
        status({
          signupCredit: {
            state: 'needs-card',
            cents: 100,
            cardAlreadyUsed: false,
          },
        }),
        '/',
      )!.message,
      /\$1 of free build credit now and \$1 every month/,
    );
  });

  it("asks for a different card when its card is another account's", () => {
    const prompt = signupCreditPrompt(
      status({
        freeTrial: { cardAlreadyUsed: true, monthlyMicroUsd: MONTHLY },
      }),
      '/',
    );
    assert.equal(prompt?.kind, 'card-used');
    assert.match(prompt!.message, /already on file for another account/);
  });

  it('says the month is on its way once Stripe sends the browser back', () => {
    assert.equal(
      signupCreditPrompt(status(), CARD_ADDED_PATH)?.kind,
      'pending',
    );
  });

  it("asks for a different card on the way back from Stripe when the card was another account's", () => {
    assert.equal(
      signupCreditPrompt(
        status({
          freeTrial: { cardAlreadyUsed: true, monthlyMicroUsd: MONTHLY },
        }),
        CARD_ADDED_PATH,
      )?.kind,
      'card-used',
    );
  });

  it('says nothing about the trial once a card is on file', () => {
    assert.equal(
      signupCreditPrompt(status({ freeTrial: undefined }), '/'),
      null,
    );
  });
});
