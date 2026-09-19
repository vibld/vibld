import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RUN_ABANDONED_AFTER_MS, RUN_STEP_TIMEOUT_MS } from '@vibld/ai';
import {
  BUILD_CALL_TIMEOUT_MS,
  REBUILD_WAIT_BUDGET_MS,
  REPAIR_BUILD_ALLOWANCE_MS,
  REPAIR_STEP_TIMEOUT_MS,
} from '../worker/generation-run.ts';
import {
  BUILD_COMPILE_TIMEOUT_MS,
  BUILD_INSTALL_TIMEOUT_MS,
  BUILD_WALL_CLOCK_MS,
} from '../../preview/worker/build-limits.ts';

/**
 * That the repair step is given time for everything it does (#196 review).
 *
 * The step runs a build, a model call and a second build, and the first
 * version of its allowance funded one build while its own comment said two.
 * A slow first build followed by a model call near its limit would then
 * have timed out with the project already accepted, promoted and billed,
 * and the repair's hold left for the reclaim to charge in full.
 *
 * The two halves of that arithmetic live in separate deployments that share
 * no build, so nothing but this test makes them agree: `apps/preview` can
 * raise a build bound with no idea that `apps/web` is budgeting for it.
 * Imported directly rather than read as source, because these are plain
 * numbers with no runtime behind them.
 */
describe('how long a repair is allowed to take', () => {
  // What one call to the build service can cost this step, which is not
  // the same as what the two commands inside it can cost (#196 review).
  // The earlier version of this file added up the command bounds, and a
  // build is more than its commands: it writes the project in, reads the
  // output back, and waits for a fleet slot, all inside its own wall
  // clock. Measuring the commands understated a build by two minutes and
  // the allowance was sized against the understatement.
  const oneBuild = BUILD_CALL_TIMEOUT_MS;

  it('funds both builds, not one', () => {
    assert.ok(
      REPAIR_BUILD_ALLOWANCE_MS >= oneBuild * 2,
      `two builds may take ${oneBuild * 2}ms and the allowance is ${REPAIR_BUILD_ALLOWANCE_MS}ms`,
    );
  });

  it('waits for a build longer than a build may take', () => {
    // Both directions matter. Too short cuts off a build that was about to
    // answer and turns a real verdict into `unavailable`, losing the
    // repair this feature exists to buy. Too long is the enclosing step
    // timing out, which fails a run that was already billed.
    assert.ok(
      BUILD_CALL_TIMEOUT_MS > BUILD_WALL_CLOCK_MS,
      `a build may take ${BUILD_WALL_CLOCK_MS}ms and its caller gives up after ${BUILD_CALL_TIMEOUT_MS}ms`,
    );
  });

  it('still covers the commands inside a build', () => {
    // The wall clock is the service's promise and these are what it has to
    // hold; asserted here as well so a change to either side of the
    // deployment boundary has to keep both true.
    assert.ok(
      BUILD_CALL_TIMEOUT_MS >
        BUILD_INSTALL_TIMEOUT_MS + BUILD_COMPILE_TIMEOUT_MS,
    );
  });

  it('leaves room for the work the build bounds do not cover', () => {
    // Writing the project into the container and reading its output back
    // are untimed. An allowance of exactly two builds would satisfy the
    // assertion above and still expire on a slow read.
    //
    // The rebuild's wait is named rather than left inside that margin
    // (#196 review). It is the second build waiting out the first build's
    // container teardown, which runs beside the model call now, and a wait
    // that fits only because nobody added it up is the defect this
    // allowance has already had twice.
    assert.ok(
      REPAIR_BUILD_ALLOWANCE_MS - oneBuild * 2 - REBUILD_WAIT_BUDGET_MS >=
        60_000,
      'no margin between the bounded work and the step timing out',
    );
  });

  it('gives up waiting for a workspace long before the step does', () => {
    // A wait as long as the teardown's own cap would put back on the
    // caller's clock exactly what moving that teardown to `ctx.waitUntil`
    // took off it. It has to be a fraction of one build, not a second one.
    assert.ok(
      REBUILD_WAIT_BUDGET_MS < oneBuild / 2,
      `waiting ${REBUILD_WAIT_BUDGET_MS}ms for a lock is a build's worth of the allowance`,
    );
  });

  it('adds that to the model call rather than replacing it', () => {
    // The repair's model call gets the same budget the run's did: it is
    // the same model, asked for the same kind of thing.
    assert.equal(
      REPAIR_STEP_TIMEOUT_MS,
      RUN_STEP_TIMEOUT_MS + REPAIR_BUILD_ALLOWANCE_MS,
    );
  });

  it('bounds the model call below the reclaim that would charge its hold', () => {
    // The invariant the whole step's position rests on, asserted rather
    // than described (#196 review). The repair's hold is settled
    // immediately after the model call, so the hold's life is that call,
    // and `UserBudget.reserve` charges any hold older than
    // `RUN_ABANDONED_AFTER_MS` at its full worst case. The step around it
    // is deliberately longer than the reclaim, because it also covers two
    // builds, so the call has to carry a bound of its own.
    assert.ok(
      RUN_STEP_TIMEOUT_MS < RUN_ABANDONED_AFTER_MS,
      `a repair's model call may take ${RUN_STEP_TIMEOUT_MS}ms and its hold is reclaimed after ${RUN_ABANDONED_AFTER_MS}ms`,
    );
  });

  it('is the step, not the model call, that is allowed to outlast the reclaim', () => {
    // Stated so the pair reads as a decision rather than an accident: the
    // step may run longer than the reclaim because by then the hold is
    // already settled and only the builds are left.
    assert.ok(REPAIR_STEP_TIMEOUT_MS > RUN_ABANDONED_AFTER_MS);
  });
});
