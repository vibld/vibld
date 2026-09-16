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
  it('admits only the account that redeemed the invite', async () => {
    // An invite is for a person, and an address can be reassigned: a company
    // mailbox handed to a new employee, a domain that changes hands. Matching
    // on the address alone let a second Clerk account that later verified it
    // walk through a door somebody else had already opened.
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    await store.redeem('chris@example.com', 'user_first');

    assert.equal(
      await store.isInvited('chris@example.com', 'user_first'),
      true,
      'locked out the account that redeemed it',
    );
    assert.equal(
      await store.isInvited('chris@example.com', 'user_second'),
      false,
      'let a second account through a redeemed invite',
    );
  });

  it('admits whoever arrives first at an unredeemed invite', async () => {
    // Otherwise an invite could never be used at all.
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');

    assert.equal(await store.isInvited('chris@example.com', 'anyone'), true);
  });

  it('lets an invited address in', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    assert.equal(await store.isInvited('chris@example.com', 'user_1'), true);
  });

  it('matches an invite whatever case either side was written in', async () => {
    // Not a nicety: a missed lookup turns a granted invite into a locked
    // door with no error anybody can act on.
    const store = newStore();
    await store.invite('Chris@Example.COM', 'admin@vibld.com');
    assert.equal(await store.isInvited('  chris@example.com ', 'user_1'), true);
  });

  it('refuses an address nobody invited', async () => {
    const store = newStore();
    assert.equal(
      await store.isInvited('stranger@example.com', 'user_1'),
      false,
    );
  });

  it('refuses the unverified-identity sentinel rather than looking it up', async () => {
    const store = newStore();
    assert.equal(await store.isInvited('unknown', 'user_1'), false);
  });

  it('keeps the first invite rather than resetting it', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'first@vibld.com');
    assert.equal(
      await store.invite('chris@example.com', 'second@vibld.com'),
      false,
    );

    const [row] = await store.list();
    assert.equal(row?.invitedByEmail, 'first@vibld.com');
  });

  it('blocks a revoked invite but keeps its row', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    assert.equal(
      await store.revoke('chris@example.com', '2026-09-16T00:00:00.000Z'),
      true,
    );

    assert.equal(await store.isInvited('chris@example.com', 'user_1'), false);
    assert.equal((await store.list()).length, 1);
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
    assert.equal(await store.isInvited('chris@example.com', 'user_1'), false);

    assert.equal(await store.reinstate('chris@example.com'), true);
    assert.equal(await store.isInvited('chris@example.com', 'user_1'), true);
  });

  it('records when an invite was first taken up, and does not move it', async () => {
    const store = newStore();
    await store.invite('chris@example.com', 'admin@vibld.com');
    await store.redeem('chris@example.com', 'user_1');
    const first = (await store.list())[0]?.redeemedAt;

    await store.redeem('chris@example.com', 'user_2');
    const [row] = await store.list();

    assert.equal(row?.redeemedAt, first);
    assert.equal(row?.redeemedByUserId, 'user_1');
  });

  it('ignores an address that could never be one', async () => {
    const store = newStore();
    assert.equal(await store.invite('nope', 'admin@vibld.com'), false);
    assert.equal((await store.list()).length, 0);
  });

  it('lists invites nobody has used first', async () => {
    const store = newStore();
    await store.invite('used@example.com', 'admin@vibld.com');
    await store.invite('unused@example.com', 'admin@vibld.com');
    await store.redeem('used@example.com', 'user_1');

    assert.deepEqual(
      (await store.list()).map((row) => row.email),
      ['unused@example.com', 'used@example.com'],
    );
  });
});
