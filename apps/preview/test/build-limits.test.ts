import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_LOCK_TTL_MS,
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
