import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
  LOCK_RENEWAL_INTERVAL_MS,
  MAX_DESTROY_WAIT_MS,
} from '../worker/build-limits.ts';

/**
 * That a build cannot outlive its own lock (#196 review).
 *
 * The failure this rules out needs no bad actor. `npm run build` runs
 * whatever the generated package.json declares, so a manifest naming a
 * watch-mode script never returns; the lock then aged out while its build
 * was still running, a second build took it and emptied the workspace
 * beneath the first, and the first's release deleted the second's lock on
 * its way out. Three builds in and nobody is compiling what they wrote.
 */
describe('how long a build may take against how long its lock lasts', () => {
  it('bounds both halves of a build', () => {
    // Zero or a missing bound is the same thing as no bound at all, and it
    // is the shape a "temporarily disable the timeout" change would take.
    assert.ok(BUILD_INSTALL_TIMEOUT_MS > 0);
    assert.ok(BUILD_COMPILE_TIMEOUT_MS > 0);
  });

  it('keeps the lock alive longer than the work it protects', () => {
    // The whole invariant, on the real values. A lock that can expire
    // under its own running build is not a lock.
    assert.ok(
      BUILD_INSTALL_TIMEOUT_MS + BUILD_COMPILE_TIMEOUT_MS < BUILD_LOCK_TTL_MS,
      `a build may take ${BUILD_INSTALL_TIMEOUT_MS + BUILD_COMPILE_TIMEOUT_MS}ms ` +
        `while its lock expires after ${BUILD_LOCK_TTL_MS}ms`,
    );
  });

  it('leaves room for the work between the timed commands', () => {
    // Writing the project out and reading the output back are untimed and
    // not free. A margin of exactly zero would satisfy the assertion above
    // and still expire mid-build.
    const slack =
      BUILD_LOCK_TTL_MS - (BUILD_INSTALL_TIMEOUT_MS + BUILD_COMPILE_TIMEOUT_MS);
    assert.ok(
      slack >= 60_000,
      `only ${slack}ms between the bounded work and the lock expiring`,
    );
  });
});

/**
 * That holding the lock through teardown cannot itself lose the lock
 * (#196 review).
 *
 * The renewals around the build stopped at the edge of teardown, and
 * `destroy()` has no deadline. A destroy that blocked past the TTL let
 * another build take the lock and start in the same sandbox, which the
 * first destroy then killed. Holding the lock across the destroy fixes
 * that, and these are the numbers that make the holding work.
 */
describe('holding the lock while a container is torn down', () => {
  it('renews well inside the window it is renewing against', () => {
    // A renewal that landed at the TTL would be a renewal that landed too
    // late at least sometimes.
    assert.ok(
      LOCK_RENEWAL_INTERVAL_MS * 2 < BUILD_LOCK_TTL_MS,
      `renewing every ${LOCK_RENEWAL_INTERVAL_MS}ms against a ${BUILD_LOCK_TTL_MS}ms lock`,
    );
  });

  it('gives up waiting before it has held the lock all day', () => {
    // A destroy that never settles must stop renewing rather than block
    // this user's builds for good. Bounded below the TTL so the lock then
    // ages out promptly rather than after another full window.
    assert.ok(
      MAX_DESTROY_WAIT_MS < BUILD_LOCK_TTL_MS,
      'a stuck destroy can renew the lock for longer than the lock lasts',
    );
  });

  it('waits long enough to be worth doing at all', () => {
    // Shorter than a renewal interval would mean never renewing, which is
    // the behaviour this replaced.
    assert.ok(MAX_DESTROY_WAIT_MS > LOCK_RENEWAL_INTERVAL_MS);
  });
});
