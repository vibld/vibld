import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UNKNOWN_ACCESS, readAccess } from '../src/access/access-client.ts';

describe('readAccess', () => {
  it('takes a well-formed answer at face value', () => {
    assert.deepEqual(
      readAccess({ allowed: true, mode: 'open', message: null }),
      { allowed: true, mode: 'open', message: null, decided: true },
    );
  });

  it('treats anything but an explicit yes as no', () => {
    // The shell renders a builder on this answer. A truthy-looking value
    // that is not `true` must not be the thing that opens it.
    for (const allowed of ['true', 1, {}, undefined, null]) {
      assert.equal(readAccess({ allowed, mode: 'open' }).allowed, false);
    }
  });

  it('falls back to invite for any mode it does not recognise', () => {
    assert.equal(readAccess({ allowed: true, mode: 'opne' }).mode, 'invite');
  });

  it('returns the closed answer for a body that is not an object', () => {
    for (const body of [null, undefined, 'yes', 42, []]) {
      assert.equal(readAccess(body).allowed, false);
    }
    assert.deepEqual(readAccess(null), UNKNOWN_ACCESS);
  });

  it('separates a refusal from an answer it could not read', () => {
    // Both keep the builder shut and only one of them is a fact about the
    // account. Told apart here so the screen can say which it is: an
    // invited customer must not be shown a waiting-list notice because
    // something failed for a moment.
    assert.equal(
      readAccess({ allowed: false, mode: 'invite', message: null }).decided,
      true,
      'a refusal the endpoint gave is an answer',
    );
    for (const body of [null, undefined, 'yes', 42, []]) {
      assert.equal(
        readAccess(body).decided,
        false,
        'something that is not a status was treated as a refusal',
      );
    }
  });
});
