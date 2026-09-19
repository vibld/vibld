import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  askWhileBusy,
  buildWithin,
  BUILD_CALL_TIMEOUT_MS,
  REBUILD_WAIT_ATTEMPTS,
  REBUILD_WAIT_BUDGET_MS,
  REBUILD_WAIT_INTERVAL_MS,
} from '../worker/publish-client.ts';

/**
 * That asking a busy workspace again is bounded as a sequence, not only
 * per call (#196 review).
 *
 * The repair's second build waits out the first build's container
 * teardown, and each of those calls was bounded at thirteen minutes while
 * nothing bounded six of them. Ninety-one minutes of build against a step
 * funded for sixty, and the arithmetic in `repair-timeout.test.ts` said
 * one build plus thirty seconds of waiting, which is the shape this whole
 * pull request keeps finding: a comment stating an intent and an
 * implementation of part of it.
 *
 * Called rather than read. The real `ask` holds a service binding and
 * cannot run here, so the loop around it went four rounds with nothing
 * exercising its arithmetic; with `ask` as a parameter its argument is the
 * thing under test.
 */

/**
 * A workspace that is busy for as long as the caller keeps asking, on a
 * clock that only these calls move.
 *
 * `takes` is what one call would like to spend. It spends what it is given
 * instead when that is less, which is the whole point: the cap handed to
 * each call is what the real `withinDeadline` enforces, and a fake that
 * ignored it would let the sequence overrun and still pass.
 */
function busyFor(takes: number) {
  const asked: number[] = [];
  let elapsed = 0;
  const clock = {
    now: () => elapsed,
    wait: async (ms: number) => {
      elapsed += ms;
    },
  };
  const run = (answerWhenFree?: 'free') =>
    askWhileBusy(
      async (within) => {
        asked.push(within);
        elapsed += Math.min(takes, Math.max(0, within));
        return within <= 0 ? 'out-of-time' : (answerWhenFree ?? 'busy');
      },
      (answer) => answer === 'busy',
      clock,
    );
  return { asked, run, spent: () => elapsed };
}

describe('asking a busy workspace again', () => {
  /**
   * A call slow enough that two of them and one wait leave exactly one
   * more wait's worth of budget.
   *
   * Derived rather than picked, because the guard under test is about
   * that boundary and a round six minutes never reaches it: the budget
   * ran out exactly, so "stop when less than a wait is left" and "stop
   * when nothing is left" behaved identically and a mutation between them
   * survived. This is the pace where they differ.
   */
  const almostTwice =
    (BUILD_CALL_TIMEOUT_MS +
      REBUILD_WAIT_BUDGET_MS -
      2 * REBUILD_WAIT_INTERVAL_MS) /
    2;

  it('spends no more than one build and the waiting', async () => {
    const workspace = busyFor(almostTwice);
    await workspace.run();
    assert.ok(
      workspace.spent() <= BUILD_CALL_TIMEOUT_MS + REBUILD_WAIT_BUDGET_MS,
      `the sequence spent ${workspace.spent()}ms of a budget of ${BUILD_CALL_TIMEOUT_MS + REBUILD_WAIT_BUDGET_MS}ms`,
    );
  });

  it('gives each call what is left rather than its whole cap', async () => {
    // The half a per-call bound cannot do. Every call after the first has
    // to be told about the budget its predecessors spent, or the sequence
    // is bounded by the attempt count multiplied by the cap.
    const workspace = busyFor(almostTwice);
    await workspace.run();
    assert.ok(workspace.asked.length > 1, 'nothing was ever asked twice');
    for (let at = 1; at < workspace.asked.length; at += 1) {
      assert.ok(
        workspace.asked[at]! < workspace.asked[at - 1]!,
        `call ${at + 1} was given ${workspace.asked[at]}ms after call ${at} was given ${workspace.asked[at - 1]}ms`,
      );
    }
  });

  it('never asks with less time than it has already decided to wait', async () => {
    // A call given the last few milliseconds cannot answer, so making it
    // costs the wait before it and buys `unavailable` in place of the
    // refusal already in hand.
    const workspace = busyFor(almostTwice);
    await workspace.run();
    for (const within of workspace.asked) {
      assert.ok(
        within > REBUILD_WAIT_INTERVAL_MS,
        `a call was given ${within}ms, which is less than the wait before it`,
      );
    }
  });

  it('starts the first call on its full cap', async () => {
    // The budget is one build plus the waiting, so the build that is
    // actually expected to answer keeps everything it had before any of
    // this was added.
    const workspace = busyFor(0);
    await workspace.run();
    assert.equal(
      workspace.asked[0],
      BUILD_CALL_TIMEOUT_MS + REBUILD_WAIT_BUDGET_MS,
    );
  });

  it('still runs its full count when the calls are cheap', async () => {
    // The other direction, so a bound that simply never retried would not
    // satisfy the ones above. A quick refusal leaves the budget intact and
    // the attempt count is what ends it.
    const workspace = busyFor(1_000);
    await workspace.run();
    assert.equal(workspace.asked.length, 1 + REBUILD_WAIT_ATTEMPTS);
  });

  it('stops the moment the workspace is free', async () => {
    // Nothing above should read as "ask until the budget is gone". The
    // waiting exists to get an answer, not to spend the allowance.
    const workspace = busyFor(1_000);
    assert.equal(await workspace.run('free'), 'free');
    assert.equal(workspace.asked.length, 1);
  });
});

/**
 * That one call to the build service is bounded, and that both ways of
 * getting no answer end the same way (#196 review).
 *
 * The step's own wrapper closed over a service binding, so the fakes that
 * exercise it could only ever throw what a deadline throws: the test that
 * a call which simply never answers is given up on was producing the
 * symptom rather than the mechanism, and removing the bound walked
 * straight through it. Called here with a promise that really does not
 * settle.
 */
describe('one bounded call to the build service', () => {
  /** So a bound that never fires fails the test instead of hanging it. */
  const orSoon = <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise((settle) => setTimeout(() => settle('still waiting'), 500)),
    ]);

  it('gives up on a call that never answers', async () => {
    assert.equal(
      await orSoon(buildWithin(() => new Promise(() => {}), 5)),
      undefined,
      'a build service that never answers is waited on for its full cap',
    );
  });

  it('gives up at the budget it was handed, not its own', async () => {
    // The mutation this exists for: passing `BUILD_CALL_TIMEOUT_MS` in
    // place of what is left would leave every call in a sequence with its
    // full thirteen minutes, which is the whole finding.
    const late = new Promise((answer) => setTimeout(() => answer('ok'), 250));
    assert.equal(await orSoon(buildWithin(() => late, 5)), undefined);
  });

  it('answers when the answer arrives in time', async () => {
    // So the bound above cannot be satisfied by giving up on everything.
    assert.deepEqual(await buildWithin(async () => ({ ok: true }), 5_000), {
      ok: true,
    });
  });

  it('treats a rejection as the same absence of an answer', async () => {
    // Both are "nothing is known about this project", and the caller turns
    // that into `unavailable` rather than into a failed run.
    assert.equal(
      await buildWithin(async () => {
        throw new Error('the preview service is gone');
      }, 5_000),
      undefined,
    );
  });
});
