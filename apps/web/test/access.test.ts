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
  invited: true,
};

describe('parseAccessMode', () => {
  it('opens only on the exact word', () => {
    assert.equal(parseAccessMode('open'), 'open');
  });

  it('treats anything else as invite-only, including unset', () => {
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
  it('lets an invited identity in', () => {
    assert.deepEqual(decideAccess(BASE), { allowed: true, because: 'invited' });
  });

  it('refuses one that is not on the list', () => {
    assert.deepEqual(decideAccess({ ...BASE, invited: false }), {
      allowed: false,
      because: 'not-invited',
    });
  });

  it('always lets a platform admin in, before the mode is even read', () => {
    // The tool that issues invites is behind this same gate, so an operator
    // who locks themselves out has no way back in.
    assert.deepEqual(decideAccess({ ...BASE, isAdmin: true, invited: false }), {
      allowed: true,
      because: 'admin',
    });
    assert.equal(
      decideAccess({
        ...BASE,
        isAdmin: true,
        invited: false,
        identity: UNKNOWN_IDENTITY,
      }).allowed,
      true,
    );
  });

  it('lets everybody in when the deployment is open', () => {
    assert.deepEqual(decideAccess({ ...BASE, mode: 'open', invited: false }), {
      allowed: true,
      because: 'open',
    });
  });

  it('refuses an unverified identity in invite mode, even if the list says yes', () => {
    // An invite list keyed on email means nothing if the email was never
    // verified: anybody could claim an invited address.
    assert.deepEqual(
      decideAccess({ ...BASE, identity: UNKNOWN_IDENTITY, invited: true }),
      { allowed: false, because: 'unverified-identity' },
    );
  });

  it('still lets an unverified identity in when the deployment is open', () => {
    // Open means open. The verification check exists to protect the list,
    // and there is no list in this mode.
    assert.equal(
      decideAccess({
        ...BASE,
        mode: 'open',
        identity: UNKNOWN_IDENTITY,
        invited: false,
      }).allowed,
      true,
    );
  });
});

describe('isUsableIdentity', () => {
  it('rejects the sentinel and the empty string', () => {
    assert.equal(isUsableIdentity(UNKNOWN_IDENTITY), false);
    assert.equal(isUsableIdentity('   '), false);
    assert.equal(isUsableIdentity('chris@example.com'), true);
  });
});

describe('normaliseEmail', () => {
  it('lowercases and trims, so one invite matches one person', () => {
    assert.equal(normaliseEmail('  Chris@Example.COM '), 'chris@example.com');
  });

  it('refuses anything that cannot be an address', () => {
    for (const raw of [null, undefined, 42, '', 'nope', 'a@b', 'a b@c.com']) {
      assert.equal(normaliseEmail(raw), null, `${String(raw)} was accepted`);
    }
  });

  it('refuses an address longer than the standard allows', () => {
    assert.equal(normaliseEmail(`${'a'.repeat(250)}@b.com`), null);
  });
});
