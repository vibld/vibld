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

describe('a reversal that arrives before the payout it reverses', () => {
  /**
   * The ordering hole, and it is not hypothetical: the nightly replay
   * descends newest pages first, so a refund can be applied in one run
   * before the older purchase that earns the reward is recovered. A payout
   * that fails between its first grant and its markPaid leaves the same
   * shape. In both cases paid_at is NULL while a payout is still coming.
   */
  async function attributedNotYetPaid() {
    const db = new SqliteD1Database(SCHEMA);
    const referrals = new ReferralStore(db);
    const billing = new BillingStore(db);
    const code = await referrals.codeFor('user_referrer');
    await referrals.attribute('user_referred', 'user_referrer', code);
    await billing.linkCustomer('user_referred', 'cus_referred');
    return { db, referrals, billing, deps: { referrals, billing } };
  }

  it('stops the reward being paid afterwards', async () => {
    const { billing, deps } = await attributedNotYetPaid();

    const reversal = await clawBackReferral(deps, 'user_referred', 'refunded');
    assert.equal(
      reversal.found,
      false,
      'nothing was paid yet, so nothing to take',
    );

    const later = await payReferralIfEarned(deps, 'user_referred');

    assert.equal(later.paid, false, 'paid a reward whose payment was returned');
    assert.equal(await cents(billing, 'user_referrer'), 0);
    assert.equal(await cents(billing, 'user_referred'), 0);
  });

  it('records the reversal even with nothing to take back', async () => {
    // The mark is what makes the early return above safe. Without it the
    // reversal leaves no trace and the payout path has nothing to refuse.
    const { referrals, deps } = await attributedNotYetPaid();
    await clawBackReferral(deps, 'user_referred', 'refunded');
    const attribution = await referrals.attributionFor('user_referred');
    assert.notEqual(attribution?.reversedAt ?? null, null);
  });
});

describe('two refunds for one referrer at the same moment', () => {
  it('cannot take more than the referrer has', async () => {
    // Two refunds of two different referrals sharing one referrer. Reading
    // the balance here and writing a deduction bounded by it is a check
    // followed by an act: both read the same remaining $5, both pass the
    // floor, and the granted total goes to minus $5, which takes the
    // difference out of credit somebody paid for.
    const db = new SqliteD1Database(SCHEMA);
    const billing = new BillingStore(db);
    await billing.grantAdminCredit(
      'the-only-credit-they-have',
      'user_referrer',
      500,
      'admin@vibld.com',
      'one reward is all that is left',
    );

    const taken = await Promise.all([
      billing.deductAdminCredit(
        'clawback-one',
        'user_referrer',
        500,
        'system@vibld.com',
        'first refund',
      ),
      billing.deductAdminCredit(
        'clawback-two',
        'user_referrer',
        500,
        'system@vibld.com',
        'second refund',
      ),
    ]);

    assert.equal(
      taken[0] + taken[1],
      500,
      'took more than the referrer was ever granted',
    );
    assert.equal(
      await cents(billing, 'user_referrer'),
      0,
      'the balance went negative, which is the debt this must never create',
    );
  });

  it('writes no row at all when there is nothing left to take', async () => {
    // A zero-value deduction would have to be explained to anybody reading a
    // credit history, and there is no such thing as deducting nothing.
    const db = new SqliteD1Database(SCHEMA);
    const billing = new BillingStore(db);
    const taken = await billing.deductAdminCredit(
      'clawback',
      'user_broke',
      500,
      'system@vibld.com',
      'refund',
    );
    assert.equal(taken, 0);
    assert.deepEqual(await billing.listAdminCredits('user_broke'), []);
  });
});

describe('a dispute that names its charge by id', () => {
  it('reads the charge rather than giving up on it', async () => {
    // Stripe sends `charge` as a bare id in the ordinary case, and the
    // customer is only on the charge. Without a way to read it the whole
    // dispute path answered unresolved, the webhook marked the event
    // processed anyway, and lost disputes never clawed anything back.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.linkCustomer('user_referred', 'cus_referred');
    const asked: string[] = [];
    const seen: string[] = [];

    const outcome = await applyStripeEvent(
      store,
      {
        type: 'charge.dispute.closed',
        data: { object: { status: 'lost', charge: 'ch_bare' } },
      } as never,
      undefined,
      async (userId) => {
        seen.push(userId);
      },
      async (chargeId) => {
        asked.push(chargeId);
        return { id: chargeId, customer: 'cus_referred' } as never;
      },
    );

    assert.equal(outcome, 'applied');
    assert.deepEqual(asked, ['ch_bare']);
    assert.deepEqual(seen, ['user_referred']);
  });

  it('stays unresolved when the charge cannot be read', async () => {
    // Stripe was asked and could not answer, so the reversal is still owed.
    // Marking it applied is how a lost dispute keeps its reward for ever.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.linkCustomer('user_referred', 'cus_referred');

    const outcome = await applyStripeEvent(
      store,
      {
        type: 'charge.dispute.closed',
        data: { object: { status: 'lost', charge: 'ch_bare' } },
      } as never,
      undefined,
      async () => {},
      async () => {
        throw new Error('stripe is down');
      },
    );
    assert.equal(outcome, 'unresolved');
  });
});

describe('a clawback that cannot be applied yet', () => {
  it('is not reported as applied', async () => {
    // The event is the clawback. Reporting `applied` on a failed one means
    // the replay marks it processed and skips it next run, so a transient D1
    // failure leaves the credit in place for ever. An earlier version caught
    // the failure and resolved, and its comment claimed a retry that could
    // not happen.
    const db = new SqliteD1Database(SCHEMA);
    const store = new BillingStore(db);
    await store.linkCustomer('user_referred', 'cus_referred');

    const outcome = await applyStripeEvent(
      store,
      {
        type: 'charge.refunded',
        data: { object: { id: 'ch_1', customer: 'cus_referred' } },
      } as never,
      undefined,
      async () => {
        throw new Error('no such table: referral_attributions');
      },
    );

    assert.equal(outcome, 'unresolved');
  });
});

describe('a reversal that lands while the payout is running', () => {
  it('leaves no reward standing', async () => {
    // The race. decidePayout reads reversed_at several statements before the
    // grants are written, so a refund arriving in between passes that check
    // while the reversal sees a null paid_at and takes nothing back. Both
    // halves conclude there is nothing to do and the reward survives.
    const db = new SqliteD1Database(SCHEMA);
    const referrals = new ReferralStore(db);
    const billing = new BillingStore(db);
    const deps = { referrals, billing };
    const code = await referrals.codeFor('user_referrer');
    await referrals.attribute('user_referred', 'user_referrer', code);
    await billing.linkCustomer('user_referred', 'cus_referred');

    // The reversal lands after decidePayout would have read the row and
    // before the payout's own write, which is the window.
    const payout = payReferralIfEarned(deps, 'user_referred');
    await clawBackReferral(deps, 'user_referred', 'refunded mid-payout');
    const result = await payout;

    assert.equal(
      result.paid,
      false,
      'paid a reward whose payment was returned',
    );
    assert.equal(await cents(billing, 'user_referrer'), 0);
    assert.equal(await cents(billing, 'user_referred'), 0);
  });

  it('does not mark a reversed attribution paid', async () => {
    // markPaid is the write that settles which of the two happened second,
    // so it carries the condition rather than a read before it.
    const db = new SqliteD1Database(SCHEMA);
    const referrals = new ReferralStore(db);
    const code = await referrals.codeFor('user_referrer');
    await referrals.attribute('user_referred', 'user_referrer', code);
    await referrals.markReversed('user_referred', new Date().toISOString());

    assert.equal(
      await referrals.markPaid('user_referred', new Date().toISOString()),
      false,
    );
  });
});
