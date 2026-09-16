import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AccessStore } from '../worker/access-store.ts';
import { SqliteD1Database } from './fakes/sqlite-d1.ts';
import { schemaSql } from './fakes/schema.ts';

const SCHEMA = schemaSql();

function newStore(): AccessStore {
  return new AccessStore(new SqliteD1Database(SCHEMA));
}

describe('AccessStore', () => {
  it('gives one invite to exactly one of two accounts racing for it', async () => {
    // Two Clerk accounts verified for the same address, arriving together.
    // A read followed by a write let both pass the read before either wrote,
    // so both were admitted and only one binding landed. The claim is one
    // statement now, which is what SQLite's single writer can settle.
    const store = newStore();
    await store.invite('shared@example.com', 'admin@vibld.com');

    const [first, second] = await Promise.all([
      store.claimInvite('shared@example.com', 'user_a'),
      store.claimInvite('shared@example.com', 'user_b'),
    ]);

    assert.equal(
      [first, second].filter(Boolean).length,
      1,
      'one invite admitted both accounts',
    );
  });

  it('admits only the account that redeemed the invite', async () => {
    // An invite is for a person, and an address can be reassigned: a company
    // mailbox handed to a new employee, a domain that changes hands. Matching
    // on the address alone let a second Clerk account that later verified it
    // walk through a door somebody else had already opened.
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    await store.claimInvite('chris@example.com', 'user_first');

    assert.equal(
      await store.claimInvite('chris@example.com', 'user_first'),
      true,
      'locked out the account that redeemed it',
    );
    assert.equal(
      await store.claimInvite('chris@example.com', 'user_second'),
      false,
      'let a second account through a redeemed invite',
    );
  });

  it('admits whoever arrives first at an unredeemed invite', async () => {
    // Otherwise an invite could never be used at all.
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');

    assert.equal(await store.claimInvite('chris@example.com', 'anyone'), true);
  });

  it('lets an invited address in', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    assert.equal(await store.claimInvite('chris@example.com', 'user_1'), true);
  });

  it('matches an invite whatever case either side was written in', async () => {
    // Not a nicety: a missed lookup turns a granted invite into a locked
    // door with no error anybody can act on.
    const store = newStore();
    await store.invite('Chris@Example.COM', 'admin@vibld.com');
    assert.equal(
      await store.claimInvite('  chris@example.com ', 'user_1'),
      true,
    );
  });

  it('refuses an address nobody invited', async () => {
    const store = newStore();
    assert.equal(
      await store.claimInvite('stranger@example.com', 'user_1'),
      false,
    );
  });

  it('refuses the unverified-identity sentinel rather than looking it up', async () => {
    const store = newStore();
    assert.equal(await store.claimInvite('unknown', 'user_1'), false);
  });

  it('keeps the first invite rather than resetting it', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'first@vibld.com');
    assert.equal(
      await store.invite('chris@example.com', 'second@vibld.com'),
      false,
    );

    const [row] = (await store.list()).invites;
    assert.equal(row?.invitedByEmail, 'first@vibld.com');
  });

  it('blocks a revoked invite but keeps its row', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    assert.equal(
      await store.revoke('chris@example.com', '2026-09-16T00:00:00.000Z'),
      true,
    );

    assert.equal(await store.claimInvite('chris@example.com', 'user_1'), false);
    assert.equal((await store.list()).invites.length, 1);
  });

  it('does not un-revoke an invite by re-issuing it', async () => {
    // Reinstating somebody is a deliberate act, and it says so.
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    await store.revoke('chris@example.com', '2026-09-16T00:00:00.000Z');

    assert.equal(
      await store.invite('chris@example.com', 'admin@vibld.com'),
      false,
    );
    assert.equal(await store.claimInvite('chris@example.com', 'user_1'), false);

    assert.equal(await store.reinstate('chris@example.com'), true);
    assert.equal(await store.claimInvite('chris@example.com', 'user_1'), true);
  });

  it('records when an invite was first taken up, and does not move it', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    await store.claimInvite('chris@example.com', 'user_1');
    const first = (await store.list()).invites[0]?.redeemedAt;

    // A second account cannot take a claimed invite, and a repeat claim by
    // the same account must not move the timestamp.
    assert.equal(await store.claimInvite('chris@example.com', 'user_2'), false);
    assert.equal(await store.claimInvite('chris@example.com', 'user_1'), true);
    const [row] = (await store.list()).invites;

    assert.equal(row?.redeemedAt, first);
    assert.equal(row?.redeemedByUserId, 'user_1');
  });

  it('ignores an address that could never be one', async () => {
    const store = newStore();
    assert.equal(await store.invite('nope', 'admin@vibld.com'), false);
    assert.equal((await store.list()).invites.length, 0);
  });

  it('says when there are more invites than it returned', async () => {
    // The panel's only per-invite control is the row, so an invite past the
    // cap has none. A capped list that presents itself as the whole one is
    // what makes that invisible.
    const store = newStore();
    for (const n of [1, 2, 3, 4, 5]) {
      await store.invite(`u${n}@example.com`, 'admin@vibld.com');
    }

    const capped = await store.list(3);
    assert.equal(capped.invites.length, 3, 'returned more than asked for');
    assert.equal(capped.truncated, true);

    // The boundary, which is the reason this is not a count comparison: a
    // last page of exactly the limit is complete, and telling an operator
    // otherwise sends them looking for rows that do not exist.
    const exact = await store.list(5);
    assert.equal(exact.invites.length, 5);
    assert.equal(exact.truncated, false, 'called a whole list incomplete');

    const roomy = await store.list(200);
    assert.equal(roomy.truncated, false);
  });

  it('lists invites nobody has used first', async () => {
    const store = newStore();
    await store.invite('used@example.com', 'admin@vibld.com');
    await store.invite('unused@example.com', 'admin@vibld.com');
    await store.claimInvite('used@example.com', 'user_1');

    assert.deepEqual(
      (await store.list()).invites.map((row) => row.email),
      ['unused@example.com', 'used@example.com'],
    );
  });
});
