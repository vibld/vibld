import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

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
const SCHEMA = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '0006_referrals.sql'),
  'utf8',
);

const AT = '2026-09-16T00:00:00.000Z';

function newStore(): ReferralStore {
  return new ReferralStore(new SqliteD1Database(SCHEMA));
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
