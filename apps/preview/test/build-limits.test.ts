import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
  BUILD_WALL_CLOCK_MS,
  LOCK_RENEWAL_INTERVAL_MS,
  MAX_DESTROY_WAIT_MS,
} from '../worker/build-limits.ts';
import { HARD_LIFETIME_MS } from '../worker/fleet.ts';

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

  /**
   * That a build has a maximum duration at all, and that everything
   * protecting it outlasts that maximum (#196 review).
   *
   * Three review rounds each found another place a heartbeat did not
   * reach, which is what an unbounded thing does to the protections around
   * it: the write loop had none, and then the fleet ticket, which has a
   * hard lifetime rather than a heartbeat, turned out to be reclaimable
   * underneath a build that was still running. A bound is what turns those
   * from hopes into arithmetic, and this is the arithmetic.
   */
  it('gives a build a maximum duration', () => {
    assert.ok(BUILD_WALL_CLOCK_MS > 0, 'a build may still run forever');
  });

  it('ends a build before its own lock could expire', () => {
    assert.ok(
      BUILD_WALL_CLOCK_MS < BUILD_LOCK_TTL_MS,
      `a build may take ${BUILD_WALL_CLOCK_MS}ms and its lock expires after ${BUILD_LOCK_TTL_MS}ms`,
    );
  });

  it('gives back its fleet ticket before the fleet reclaims it', () => {
    // The ticket is held until the teardown finishes, so the sum is what
    // has to fit. `reclaimStale` releasing a live build's ticket lets the
    // fleet authorise a container the platform has no room for, which is
    // the over-admission that counter exists to prevent.
    assert.ok(
      BUILD_WALL_CLOCK_MS + MAX_DESTROY_WAIT_MS < HARD_LIFETIME_MS,
      `a build holds its ticket for up to ${BUILD_WALL_CLOCK_MS + MAX_DESTROY_WAIT_MS}ms ` +
        `and the fleet reclaims after ${HARD_LIFETIME_MS}ms`,
    );
  });

  it('leaves the per-file loops room above the two commands', () => {
    // A wall clock that only covered the timed commands would stop builds
    // that were working perfectly well, and report it as a fault of this
    // service, which is the expensive direction.
    assert.ok(
      BUILD_WALL_CLOCK_MS -
        BUILD_INSTALL_TIMEOUT_MS -
        BUILD_COMPILE_TIMEOUT_MS >=
        60_000,
      'a build that spends both command bounds has no time left to read its own output',
    );
  });
});
