import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  UNKNOWN_IDENTITY,
  decideAccess,
  isUsableIdentity,
  normaliseEmail,
  parseAccessMode,
} from '../worker/access.ts';

/**
 * Who may use the deployment at all.
 *
 * The product grants model spend on sign-up, so this is the rule standing
 * between the provider bill and anybody who can reach the URL. Every case
 * below fails closed, including the ones about configuration.
 */

const BASE = {
  mode: 'invite' as const,
  isAdmin: false,
  identity: 'chris@example.com',
  claimInvite: async () => true,
};

describe('parseAccessMode', () => {
  it('opens only on the exact word', async () => {
    assert.equal(parseAccessMode('open'), 'open');
  });

  it('treats anything else as invite-only, including unset', async () => {
    // A typo in a deployment variable must not open the door. This is the
    // opposite of the usual default and it is the point.
    //
    // The near misses are the reason this is a list and not one case. This
    // test used to assert that ` OPEN ` opened the deployment, under this
    // very heading: the name said exact and the assertion said lenient, so
    // the leniency was pinned as though it were the requirement. Every
    // spelling accepted here is another way a mistyped deployment variable
    // opens the door.
    for (const raw of [
      undefined,
      '',
      ' ',
      'OPEN',
      'Open',
      ' open',
      'open ',
      ' OPEN ',
      'open\n',
      'opne',
      'true',
      'yes',
      'invite',
      'off',
    ]) {
      assert.equal(parseAccessMode(raw), 'invite', `${String(raw)} opened it`);
    }
  });
});

describe('decideAccess', () => {
  it('lets an invited identity in', async () => {
    assert.deepEqual(await decideAccess(BASE), {
      allowed: true,
      because: 'invited',
    });
  });

  it('refuses one that is not on the list', async () => {
    assert.deepEqual(
      await decideAccess({ ...BASE, claimInvite: async () => false }),
      {
        allowed: false,
        because: 'not-invited',
      },
    );
  });

  it('always lets a platform admin in, before the mode is even read', async () => {
    // The tool that issues invites is behind this same gate, so an operator
    // who locks themselves out has no way back in.
    assert.deepEqual(
      await decideAccess({
        ...BASE,
        isAdmin: true,
        claimInvite: async () => false,
      }),
      {
        allowed: true,
        because: 'admin',
      },
    );
    assert.equal(
      (
        await decideAccess({
          ...BASE,
          isAdmin: true,
          claimInvite: async () => false,
          identity: UNKNOWN_IDENTITY,
        })
      ).allowed,
      true,
    );
  });

  it('lets everybody in when the deployment is open', async () => {
    assert.deepEqual(
      await decideAccess({
        ...BASE,
        mode: 'open',
        claimInvite: async () => false,
      }),
      {
        allowed: true,
        because: 'open',
      },
    );
  });

  it('refuses an unverified identity in invite mode, even if the list says yes', async () => {
    // An invite list keyed on email means nothing if the email was never
    // verified: anybody could claim an invited address.
    assert.deepEqual(
      await decideAccess({
        ...BASE,
        identity: UNKNOWN_IDENTITY,
        claimInvite: async () => true,
      }),
      { allowed: false, because: 'unverified-identity' },
    );
  });

  it('still lets an unverified identity in when the deployment is open', async () => {
    // Open means open. The verification check exists to protect the list,
    // and there is no list in this mode.
    assert.equal(
      (
        await decideAccess({
          ...BASE,
          mode: 'open',
          identity: UNKNOWN_IDENTITY,
          claimInvite: async () => false,
        })
      ).allowed,
      true,
    );
  });
});

describe('isUsableIdentity', () => {
  it('rejects the sentinel and the empty string', async () => {
    assert.equal(isUsableIdentity(UNKNOWN_IDENTITY), false);
    assert.equal(isUsableIdentity('   '), false);
    assert.equal(isUsableIdentity('chris@example.com'), true);
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims, so one invite matches one person', async () => {
    assert.equal(normaliseEmail('  Chris@Example.COM '), 'chris@example.com');
  });

  it('refuses anything that cannot be an address', async () => {
    for (const raw of [null, undefined, 42, '', 'nope', 'a@b', 'a b@c.com']) {
      assert.equal(normaliseEmail(raw), null, `${String(raw)} was accepted`);
    }
  });

  it('refuses an address longer than the standard allows', async () => {
    assert.equal(normaliseEmail(`${'a'.repeat(250)}@b.com`), null);
  });
});
