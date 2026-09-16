import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import { applyStripeEvent } from '../worker/billing-events.ts';
import {
  clawBackReferral,
  payReferralIfEarned,
} from '../worker/referral-payout.ts';
import { clawbackCents } from '../worker/referral.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const SCHEMA = schemaSql();

/** A referrer and a referred account, attributed and paid. */
async function paidReferral() {
  const db = new SqliteD1Database(SCHEMA);
  const referrals = new ReferralStore(db);
  const billing = new BillingStore(db);
  const deps = { referrals, billing };

  const code = await referrals.codeFor('user_referrer');
  await referrals.attribute('user_referred', 'user_referrer', code);
  await billing.linkCustomer('user_referred', 'cus_referred');
  const paid = await payReferralIfEarned(deps, 'user_referred');
  assert.equal(paid.paid, true, 'the fixture did not actually pay');

  return { db, referrals, billing, deps };
}

const cents = async (billing: BillingStore, userId: string) =>
  Math.floor((await billing.totalAdminCreditMicroUsd(userId)) / 10_000);

describe('the clawback rule itself', () => {
  it('never takes more than is there, and never goes below zero', () => {
    assert.equal(clawbackCents(500, 500), 500);
    assert.equal(clawbackCents(500, 200), 200, 'took more than was granted');
    assert.equal(clawbackCents(500, 0), 0);
    assert.equal(
      clawbackCents(500, -100),
      0,
      'a negative balance is not a debt to collect',
    );
  });
});

describe('taking a referral back when its payment goes away', () => {
  it('reverses both sides', async () => {
    const { billing, deps } = await paidReferral();
    assert.equal(await cents(billing, 'user_referrer'), 500);
    assert.equal(await cents(billing, 'user_referred'), 500);

    const result = await clawBackReferral(deps, 'user_referred', 'refunded');

    assert.deepEqual(result, {
      found: true,
      referrerCents: 500,
      referredCents: 500,
    });
    assert.equal(await cents(billing, 'user_referrer'), 0);
    assert.equal(await cents(billing, 'user_referred'), 0);
  });

  it('does not touch credit somebody paid for', async () => {
    // The decision, and the case that makes it matter. The referrer here has
    // no granted credit left and a purchased top-up. Deducting from the
    // pooled balance would charge a customer for another account's refund.
    const { billing, deps } = await paidReferral();
    await billing.grantAdminCredit(
      'spent-it',
      'user_referrer',
      -500,
      'system@vibld.com',
      'already drawn down',
    );
    await billing.recordTopup(
      'cs_topup',
      'user_referrer',
      'cus_referrer',
      2000,
    );
    const before = await billing.totalSpendableCreditMicroUsd('user_referrer');

    const result = await clawBackReferral(deps, 'user_referred', 'refunded');

    assert.equal(result.referrerCents, 0, 'took money the referrer had paid');
    assert.equal(
      await billing.totalSpendableCreditMicroUsd('user_referrer'),
      before,
    );
  });

  it('is idempotent, so a redelivery does not deduct twice', async () => {
    // The referrer is given other granted credit first, and that is the
    // whole point of the fixture. Without it the first clawback leaves the
    // balance at zero, the floor refuses any further deduction on its own,
    // and this test passes whether or not the row id is deterministic: it
    // would be asserting the floor twice and the idempotency never.
    const { billing, deps } = await paidReferral();
    await billing.grantAdminCredit(
      'welcome',
      'user_referrer',
      1000,
      'admin@vibld.com',
      'a grant that has nothing to do with the referral',
    );

    await clawBackReferral(deps, 'user_referred', 'refunded');
    const after = await cents(billing, 'user_referrer');
    assert.equal(after, 1000, 'the first clawback took the wrong amount');

    const again = await clawBackReferral(deps, 'user_referred', 'refunded');

    assert.equal(again.referrerCents, 0, 'deducted a second time');
    assert.equal(
      await cents(billing, 'user_referrer'),
      after,
      'a redelivered refund took the reward twice',
    );
  });

  it('does not credit them again when a later payment clears', async () => {
    // A clawback must not re-arm the payout, or one refund becomes a way to
    // be paid twice: take the reward back, buy again, collect again.
    //
    // This asserts the balance rather than `paidAt`. An earlier version
    // checked the field and proved nothing, because `markPaid` carries
    // `AND paid_at IS NULL` and no method on the store can clear it, so the
    // assertion could not fail whatever the code did.
    const { billing, deps } = await paidReferral();
    await clawBackReferral(deps, 'user_referred', 'refunded');
    assert.equal(await cents(billing, 'user_referrer'), 0);

    await payReferralIfEarned(deps, 'user_referred');

    assert.equal(
      await cents(billing, 'user_referrer'),
      0,
      'the reward came back after being taken away',
    );
  });

  it('does nothing for a refund of a purchase no referral earned', async () => {
    const db = new SqliteD1Database(SCHEMA);
    const deps = {
      referrals: new ReferralStore(db),
      billing: new BillingStore(db),
    };
    const result = await clawBackReferral(deps, 'user_alone', 'refunded');
    assert.deepEqual(result, {
      found: false,
      referrerCents: 0,
      referredCents: 0,
    });
  });
});

describe('the Stripe events that trigger it', () => {
  const store = (db: SqliteD1Database) => new BillingStore(db);

  async function mapped() {
    const db = new SqliteD1Database(SCHEMA);
    await store(db).linkCustomer('user_referred', 'cus_referred');
    return db;
  }

  it('claws back on a refund', async () => {
    const db = await mapped();
    const seen: { userId: string; reason: string }[] = [];
    const outcome = await applyStripeEvent(
      store(db),
      {
        type: 'charge.refunded',
        data: { object: { id: 'ch_1', customer: 'cus_referred' } },
      } as never,
      undefined,
      async (userId, reason) => {
        seen.push({ userId, reason });
      },
    );

    assert.equal(outcome, 'applied');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.userId, 'user_referred');
    assert.match(seen[0]?.reason ?? '', /refunded/i);
  });

  it('claws back on a dispute that was lost, and not one that was won', async () => {
    // A won dispute means the money stayed. Reversing on `dispute.created`
    // instead would mean re-crediting everybody whose dispute is won.
    const db = await mapped();
    const seen: string[] = [];
    const hook = async (userId: string) => {
      seen.push(userId);
    };
    const dispute = (status: string) =>
      ({
        type: 'charge.dispute.closed',
        data: {
          object: {
            status,
            charge: { id: 'ch_1', customer: 'cus_referred' },
          },
        },
      }) as never;

    await applyStripeEvent(store(db), dispute('won'), undefined, hook);
    assert.deepEqual(seen, [], 'took the reward back on a dispute we won');

    await applyStripeEvent(store(db), dispute('lost'), undefined, hook);
    assert.deepEqual(seen, ['user_referred']);
  });

  it('reports an unmapped customer as unresolved, not applied', async () => {
    // Marking it applied is how a reversal is lost for good: a refund read
    // before the Checkout that creates the customer mapping has nobody to
    // attribute to yet, and does once that older event lands.
    const db = new SqliteD1Database(SCHEMA);
    const outcome = await applyStripeEvent(
      store(db),
      {
        type: 'charge.refunded',
        data: { object: { id: 'ch_1', customer: 'cus_nobody' } },
      } as never,
      undefined,
      async () => {},
    );
    assert.equal(outcome, 'unresolved');
  });

  it('does not silently apply a reversal when nothing can act on it', async () => {
    // The replay used to call applyStripeEvent with no hooks at all. A
    // reversal arriving that way would return applied, be marked processed,
    // and the credit would stay for ever with nothing left to retry.
    const db = await mapped();
    const outcome = await applyStripeEvent(store(db), {
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_referred' } },
    } as never);
    assert.equal(outcome, 'applied');
  });
});
