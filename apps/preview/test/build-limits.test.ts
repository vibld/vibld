import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
  BUILD_WALL_CLOCK_MS,
  FLEET_CALL_TIMEOUT_MS,
  LOCK_RENEWAL_INTERVAL_MS,
  MAX_DESTROY_WAIT_MS,
  TEARDOWN_WALL_CLOCK_MS,
} from '../worker/build-limits.ts';
import { HARD_LIFETIME_MS } from '../worker/fleet.ts';
import { RETRY_ATTEMPTS, RETRY_DELAY_MS } from '@vibld/core';

/**
 * What giving one fleet ticket back really costs: every attempt plus the
 * waits between them, which is what a release takes when the fleet object
 * is restarting. Shared, because both sums below contain it and a release
 * counted in one place and forgotten in the other is how these numbers
 * drift.
 */
const releaseCost =
  RETRY_ATTEMPTS * FLEET_CALL_TIMEOUT_MS +
  (RETRY_ATTEMPTS - 1) * RETRY_DELAY_MS;

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
    //
    // The teardown's own clock, not the destroy wait inside it
    // (#196 review). This sum was written when the destroy was the whole
    // teardown, and the teardown then grew a clock two minutes longer plus
    // a release after it, so the figure understated the hold by nearly
    // three minutes. Every round of this pull request that got an
    // allowance wrong got it wrong this way: added up against a number
    // smaller than the truth.
    const held = BUILD_WALL_CLOCK_MS + TEARDOWN_WALL_CLOCK_MS + releaseCost;
    assert.ok(
      held < HARD_LIFETIME_MS,
      `a build holds its ticket for up to ${held}ms ` +
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

/**
 * That the teardown is bounded as a whole, and that what it may hold is
 * held for less time than the fleet takes to reclaim it (#196 review).
 *
 * The teardown moved off the build's clock and onto `ctx.waitUntil`, which
 * left it with no clock at all: its storage reads and its ticket release
 * could each stay pending, and a teardown that never finishes is one that
 * never reaches its release. The numbers below are what make "it gives up"
 * true rather than intended.
 */
describe('how long a teardown may take', () => {
  it('can finish the destroy it waits for', () => {
    // A teardown clock shorter than the destroy wait inside it would stop
    // the teardown before the thing it exists to do, which is worse than
    // no clock: the container survives and the lock is never cleared.
    assert.ok(
      TEARDOWN_WALL_CLOCK_MS > MAX_DESTROY_WAIT_MS + releaseCost,
      `a teardown may need ${MAX_DESTROY_WAIT_MS + releaseCost}ms and is given ${TEARDOWN_WALL_CLOCK_MS}ms`,
    );
  });

  it('gives up long before the fleet reclaims what it is holding', () => {
    // A teardown that runs out of time holds its ticket, which is safe
    // only because the fleet reclaims an activated row. If the teardown
    // could still be running when that reclaim lands, the release and the
    // reclaim race over the same row.
    assert.ok(
      TEARDOWN_WALL_CLOCK_MS + releaseCost < HARD_LIFETIME_MS,
      `a teardown may hold a ticket for ${TEARDOWN_WALL_CLOCK_MS + releaseCost}ms ` +
        `and the fleet reclaims after ${HARD_LIFETIME_MS}ms`,
    );
  });

  it('keeps a fleet call far shorter than the wait it happens inside', () => {
    // These are same-colocation object calls and `retrying` waits a second
    // between attempts, a pace that assumes sub-second answers. A fleet
    // bound anywhere near the destroy wait would make the release the
    // biggest thing in the teardown.
    assert.ok(FLEET_CALL_TIMEOUT_MS * 10 < MAX_DESTROY_WAIT_MS);
  });

  it('retries a release rather than asking once', () => {
    // The release is the only cleanup a queued ticket will ever get, so a
    // single attempt against a restarting object loses it for good.
    assert.ok(RETRY_ATTEMPTS > 1);
  });
});
