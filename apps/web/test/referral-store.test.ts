import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { BillingStore } from '../worker/billing-store.ts';
import { ReferralStore } from '../worker/referral-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';

/**
 * The referral rules that are statements rather than comparisons.
 *
 * Against real SQLite, which is the point: the cap is enforced inside one
 * `UPDATE`, and what makes it a cap rather than a suggestion is the
 * `changes` count that statement reports when two writers go for the same
 * slot. A hand-written fake would only prove the method was called.
 */
/**
 * The billing tables come along because `attribute` carries the purchase
 * barrier in its own INSERT (purchase-barrier.ts), which reads them. That
 * coupling is the fix rather than an accident, so the test schema reflects
 * it rather than working around it.
 */
const SCHEMA = [
  '0002_billing.sql',
  '0004_admin_credits.sql',
  '0006_referrals.sql',
  '0007_subscription_payments.sql',
]
  .map((name) =>
    readFileSync(join(import.meta.dirname, '..', 'migrations', name), 'utf8'),
  )
  .join('\n');

const AT = '2026-09-16T00:00:00.000Z';

function newStore(): ReferralStore {
  return new ReferralStore(new SqliteD1Database(SCHEMA));
}

function newStoreWithDb(): { store: ReferralStore; db: SqliteD1Database } {
  const db = new SqliteD1Database(SCHEMA);
  return { store: new ReferralStore(db), db };
}

/**
 * A settled top-up for this account, which is what makes a payout owed.
 *
 * The sweep asks who has money cleared, not who holds a cap reservation, so
 * every test about what it returns has to say which accounts have paid.
 */
async function hasPaid(db: SqliteD1Database, userId: string): Promise<void> {
  await new BillingStore(db).recordTopup(`cs_${userId}`, userId, 'cus_1', 500);
}

/** `n` accounts referred by one referrer, none of them claimed yet. */
async function referAll(
  store: ReferralStore,
  referrer: string,
  n: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `user_referred_${i}`;
    await store.attribute(id, referrer, 'ABCD2345');
    ids.push(id);
  }
  return ids;
}

describe('ReferralStore.reserveSlot', () => {
  it('lets a referral under the cap take a slot', async () => {
    const store = newStore();
    const [referred] = await referAll(store, 'user_owner', 1);

    assert.equal(await store.reserveSlot(referred!, AT, 3), true);
    assert.equal((await store.attributionFor(referred!))?.claimedAt, AT);
  });

  it('refuses the one that would pass the cap, and only that one', async () => {
    const store = newStore();
    const referred = await referAll(store, 'user_owner', 4);

    const taken: boolean[] = [];
    for (const id of referred) taken.push(await store.reserveSlot(id, AT, 3));

    assert.deepEqual(taken, [true, true, true, false]);
  });

  it('counts claims, not payments, so a claimed slot is not lent out twice', async () => {
    // The reason claimed_at exists at all. A payout that has taken its slot
    // and not yet written the credit is still owed it, so the cap has to
    // count it. Counting paid_at instead would hand the same slot to the
    // next purchase that cleared while the first was still in flight.
    const store = newStore();
    const referred = await referAll(store, 'user_owner', 2);

    assert.equal(await store.reserveSlot(referred[0]!, AT, 1), true);
    assert.equal((await store.attributionFor(referred[0]!))?.paidAt, null);
    assert.equal(await store.reserveSlot(referred[1]!, AT, 1), false);
  });

  it('is a no-op for a row that already holds a slot', async () => {
    // A redelivered webhook must not consume a second one.
    const store = newStore();
    const referred = await referAll(store, 'user_owner', 2);

    assert.equal(await store.reserveSlot(referred[0]!, AT, 2), true);
    assert.equal(await store.reserveSlot(referred[0]!, AT, 2), false);
    // The second slot is still there for somebody else, which is what proves
    // the repeat did not spend it.
    assert.equal(await store.reserveSlot(referred[1]!, AT, 2), true);
  });

  it('counts each referrer separately', async () => {
    const store = newStore();
    await store.attribute('user_a', 'user_owner_1', 'ABCD2345');
    await store.attribute('user_b', 'user_owner_2', 'EFGH6789');

    assert.equal(await store.reserveSlot('user_a', AT, 1), true);
    assert.equal(await store.reserveSlot('user_b', AT, 1), true);
  });

  it('refuses everything at a cap of zero', async () => {
    const store = newStore();
    const [referred] = await referAll(store, 'user_owner', 1);
    assert.equal(await store.reserveSlot(referred!, AT, 0), false);
  });

  it('claims nothing for an account with no attribution', async () => {
    const store = newStore();
    assert.equal(await store.reserveSlot('user_stranger', AT, 5), false);
  });
});

describe('ReferralStore.markPaid', () => {
  it('pays once and says which call did it', async () => {
    const store = newStore();
    const [referred] = await referAll(store, 'user_owner', 1);
    await store.reserveSlot(referred!, AT, 5);

    assert.equal(await store.markPaid(referred!, AT), true);
    assert.equal(
      await store.markPaid(referred!, '2026-10-01T00:00:00Z'),
      false,
    );
    assert.equal((await store.attributionFor(referred!))?.paidAt, AT);
  });
});

describe('ReferralStore.summaryFor', () => {
  it('counts the referred and the paid separately', async () => {
    const store = newStore();
    const referred = await referAll(store, 'user_owner', 3);
    await store.reserveSlot(referred[0]!, AT, 5);
    await store.markPaid(referred[0]!, AT);
    // Claimed but unpaid: owed, and not yet counted as paid.
    await store.reserveSlot(referred[1]!, AT, 5);

    assert.deepEqual(await store.summaryFor('user_owner'), {
      referred: 3,
      paid: 1,
    });
  });
});

describe('ReferralStore.attribute', () => {
  it('records an attribution for an account with no purchase', async () => {
    const store = newStore();
    assert.equal(
      await store.attribute('user_new', 'user_owner', 'ABCD2345'),
      true,
    );
    assert.equal(
      (await store.attributionFor('user_new'))?.referrerUserId,
      'user_owner',
    );
  });

  it('never replaces one that already exists', async () => {
    const store = newStore();
    await store.attribute('user_new', 'user_first', 'ABCD2345');
    assert.equal(
      await store.attribute('user_new', 'user_second', 'EFGH6789'),
      false,
    );
    assert.equal(
      (await store.attributionFor('user_new'))?.referrerUserId,
      'user_first',
    );
  });

  it('refuses once a Checkout exists for the account', async () => {
    // The race the readable rule cannot close on its own: a claim arriving
    // after Checkout completes but before its webhook is mirrored sees no
    // purchase. The barrier is in this statement, so it loses here instead.
    const { store, db } = newStoreWithDb();
    await new BillingStore(db).linkCustomer('user_new', 'cus_1');

    assert.equal(
      await store.attribute('user_new', 'user_owner', 'ABCD2345'),
      false,
    );
    assert.equal(await store.attributionFor('user_new'), undefined);
  });

  it('refuses once a top-up has been recorded', async () => {
    const { store, db } = newStoreWithDb();
    await new BillingStore(db).recordTopup('cs_1', 'user_new', 'cus_1', 500);

    assert.equal(
      await store.attribute('user_new', 'user_owner', 'ABCD2345'),
      false,
    );
  });

  it('is not blocked by somebody else having purchased', async () => {
    const { store, db } = newStoreWithDb();
    await new BillingStore(db).linkCustomer('user_other', 'cus_1');

    assert.equal(
      await store.attribute('user_new', 'user_owner', 'ABCD2345'),
      true,
    );
  });
});

describe('ReferralStore.payoutsToRetry', () => {
  it('finds an unpaid attribution for somebody who has paid', async () => {
    const { store, db } = newStoreWithDb();
    const referred = await referAll(store, 'user_owner', 2);
    await hasPaid(db, referred[0]!);

    assert.deepEqual(await store.payoutsToRetry(10), [referred[0]]);
  });

  it('finds one whose payout failed before it ever claimed a slot', async () => {
    // The row the old predicate excluded, and the reason it was wrong: a
    // payout that died in the attribution read or the reservation leaves
    // claimed_at NULL, so asking for reservations skipped exactly the rows
    // this sweep exists to recover.
    const { store, db } = newStoreWithDb();
    const [referred] = await referAll(store, 'user_owner', 1);
    await hasPaid(db, referred!);

    assert.equal((await store.attributionFor(referred!))?.claimedAt, null);
    assert.deepEqual(await store.payoutsToRetry(10), [referred]);
  });

  it('finds one for a subscriber who paid once and then cancelled', async () => {
    // Current status cannot answer "did they ever pay". A subscriber whose
    // first subscription event was missed and who then cancelled reads
    // `canceled` for ever, which is how they were skipped.
    const { store, db } = newStoreWithDb();
    const [referred] = await referAll(store, 'user_owner', 1);
    const billing = new BillingStore(db);
    await billing.upsertSubscription({
      stripeSubscriptionId: 'sub_1',
      userId: referred!,
      stripeCustomerId: 'cus_1',
      tier: 'build',
      status: 'canceled',
      priceId: 'price_build_monthly',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    await billing.markSubscriptionPaid('sub_1', '2026-09-01T00:00:00.000Z');

    assert.deepEqual(await store.payoutsToRetry(10), [referred]);
  });

  it('leaves alone an attribution for somebody who has not paid', async () => {
    // An attribution on its own earns nothing, and a sweep that paid on one
    // would be a faucet rather than a recovery.
    const store = newStore();
    await referAll(store, 'user_owner', 2);

    assert.deepEqual(await store.payoutsToRetry(10), []);
  });

  it('never pays on a checkout somebody merely started', async () => {
    // The barrier that refuses a *claim* counts a customer row, which exists
    // from Checkout creation and before any charge. Reusing it here would pay
    // out on an abandoned checkout.
    const { store, db } = newStoreWithDb();
    const [referred] = await referAll(store, 'user_owner', 1);
    await new BillingStore(db).linkCustomer(referred!, 'cus_1');

    assert.deepEqual(await store.payoutsToRetry(10), []);
  });

  it('leaves alone one that has already been paid', async () => {
    const { store, db } = newStoreWithDb();
    const [referred] = await referAll(store, 'user_owner', 1);
    await hasPaid(db, referred!);
    await store.reserveSlot(referred!, AT, 5);
    await store.markPaid(referred!, AT);

    assert.deepEqual(await store.payoutsToRetry(10), []);
  });

  it('honours its limit', async () => {
    const { store, db } = newStoreWithDb();
    const referred = await referAll(store, 'user_owner', 3);
    for (const id of referred) await hasPaid(db, id);

    assert.equal((await store.payoutsToRetry(2)).length, 2);
  });
});

describe('ReferralStore.payoutsToRetry: ordering', () => {
  it('puts a row that has been tried behind one that has not', async () => {
    // The starvation this fixes: ordering by claimed_at alone keeps a row
    // that fails every night at the front for ever, and once `limit` of them
    // accumulate no newer stranded payout is ever attempted again.
    const { store, db } = newStoreWithDb();
    const referred = await referAll(store, 'user_owner', 2);
    for (const id of referred) await hasPaid(db, id);
    await store.reserveSlot(referred[0]!, '2026-09-01T00:00:00.000Z', 5);
    await store.reserveSlot(referred[1]!, '2026-09-02T00:00:00.000Z', 5);

    // The older one is tried and fails, so it goes to the back.
    await store.markAttempted(referred[0]!, '2026-09-16T00:00:00.000Z');

    assert.deepEqual(await store.payoutsToRetry(10), [
      referred[1],
      referred[0],
    ]);
  });

  it('orders two attempted rows by which was tried longest ago', async () => {
    const { store, db } = newStoreWithDb();
    const referred = await referAll(store, 'user_owner', 2);
    for (const id of referred) await hasPaid(db, id);
    for (const id of referred) await store.reserveSlot(id, AT, 5);
    await store.markAttempted(referred[0]!, '2026-09-16T02:00:00.000Z');
    await store.markAttempted(referred[1]!, '2026-09-16T01:00:00.000Z');

    assert.deepEqual(await store.payoutsToRetry(10), [
      referred[1],
      referred[0],
    ]);
  });

  it('lets a newer row through once the failing one has been tried', async () => {
    // With a limit of one, the whole question is which single row the sweep
    // picks tonight. Before the stamp it was the same one every night.
    const { store, db } = newStoreWithDb();
    const referred = await referAll(store, 'user_owner', 2);
    for (const id of referred) await hasPaid(db, id);
    await store.reserveSlot(referred[0]!, '2026-09-01T00:00:00.000Z', 5);
    await store.reserveSlot(referred[1]!, '2026-09-02T00:00:00.000Z', 5);

    assert.deepEqual(await store.payoutsToRetry(1), [referred[0]]);
    await store.markAttempted(referred[0]!, '2026-09-16T00:00:00.000Z');
    assert.deepEqual(await store.payoutsToRetry(1), [referred[1]]);
  });

  it('records the attempt on the row itself', async () => {
    const store = newStore();
    const [referred] = await referAll(store, 'user_owner', 1);
    await store.reserveSlot(referred!, AT, 5);
    await store.markAttempted(referred!, '2026-09-16T00:00:00.000Z');

    assert.equal(
      (await store.attributionFor(referred!))?.lastAttemptAt,
      '2026-09-16T00:00:00.000Z',
    );
  });
});
