import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { budgeted, OUT_OF_TIME, withinDeadline } from '../src/deadline.ts';
import { RETRY_ATTEMPTS, retryingWithin } from '../src/retry.ts';

/**
 * That one stuck call cannot outlast a build's whole budget
 * (#196 review).
 *
 * The deadline was checked between operations, which bounds a build made
 * of many quick calls and does nothing about a build stuck inside one slow
 * one. I answered that finding by saying the ownership check on resume
 * covered it. It does not, and the order is the whole of why: the stalled
 * write lands first and the check happens after, so a zombie build writes
 * a file into its successor's workspace and only then discovers it had
 * been superseded.
 */
describe('one operation against what is left of the clock', () => {
  it('gives back what the work returned, when the work is first', async () => {
    assert.equal(await withinDeadline(Promise.resolve('done'), 10_000), 'done');
  });

  it('gives up on work that outlasts the budget', async () => {
    const stuck = new Promise<string>(() => {});
    await assert.rejects(withinDeadline(stuck, 1), {
      message: OUT_OF_TIME,
    });
  });

  it('gives up at once on a budget already spent', async () => {
    // `deadline - Date.now()` is negative for a build that is already out
    // of time, and a negative delay must mean "now" rather than "never".
    await assert.rejects(
      withinDeadline(new Promise<string>(() => {}), -5_000),
      {
        message: OUT_OF_TIME,
      },
    );
  });

  it('lets a real failure through rather than masking it', async () => {
    await assert.rejects(
      withinDeadline(Promise.reject(new Error('the sandbox is gone')), 10_000),
      { message: 'the sandbox is gone' },
    );
  });

  it('leaves no timer running behind the work it watched', async () => {
    // A pending timer per file would outlive the work it was watching,
    // which in a Durable Object holds it awake for the rest of the
    // build's budget.
    //
    // Counted rather than waited for. The first version of this test
    // awaited the call and then asserted `true`, on the reasoning that a
    // leaked timer would hang the run instead of failing it. A mutation
    // that removed the `clearTimeout` walked straight through it: an
    // assertion that cannot fail is not a test, which is the eighth time
    // on this pull request I have written one and the first time I caught
    // it with a mutation rather than a reviewer.
    const timers = () =>
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === 'Timeout').length;
    const before = timers();
    await withinDeadline(Promise.resolve(1), 60_000);
    assert.equal(
      timers(),
      before,
      'the timer outlived the work it was watching',
    );
  });
});

/**
 * That a command's own cap cannot outlast the build's (#196 review).
 *
 * Bounding the calls that had no bound of their own left the ones that
 * did. Each command kept its full five minutes however much of the budget
 * had already gone, so a compile starting just before the deadline ran
 * five minutes past it: the wall clock bounded everything except the two
 * slowest things in the build, while its own comment said it bounded the
 * build. That is the shape of every finding on this pull request, and I
 * had written it one commit earlier.
 */
describe('a command cap against what is left of the build', () => {
  it('keeps its own cap while there is room for it', () => {
    assert.equal(budgeted(5 * 60_000, 9 * 60_000), 5 * 60_000);
  });

  it('is cut down to the budget that is left', () => {
    assert.equal(budgeted(5 * 60_000, 90_000), 90_000);
  });

  it('is zero rather than negative when the budget is gone', () => {
    // A negative timeout is the one answer that must never reach `exec`:
    // depending on what the SDK makes of it, it is either an immediate
    // failure or no timeout at all, and the second is the whole defect
    // coming back.
    assert.equal(budgeted(5 * 60_000, -30_000), 0);
  });
});

/**
 * That a retry can reach its second attempt (#196 review).
 *
 * `retrying` runs one attempt and then the next, so an attempt that never
 * settles ends the sequence: the retry becomes a single unbounded call
 * wearing a retry's name. What these retries exist for is a Durable Object
 * restarting, which is the case most likely to leave a call pending rather
 * than reject it, so without a bound the retry is absent exactly when it
 * is needed.
 *
 * Three call sites arrived at this one round apart, each reported as its
 * own finding and each fixed with the same three lines: a fleet ticket
 * nothing else will ever reclaim, a settlement that must not fail its
 * Workflow, and the release of a hold against a ceiling the whole
 * deployment shares.
 */
describe('retrying something that might never answer', () => {
  /** So a test does not spend the real backoff. */
  const instantly = async () => {};

  it('reaches the next attempt when one never answers', async () => {
    let asked = 0;
    const done = await retryingWithin(
      () => {
        asked += 1;
        return asked === 1
          ? new Promise<string>(() => {})
          : Promise.resolve('ok');
      },
      20,
      instantly,
    );
    assert.deepEqual(done, { ok: true, value: 'ok' });
    assert.equal(asked, 2, 'a pending attempt ended the sequence');
  });

  it('gives up rather than hanging when none of them answer', async () => {
    const started = Date.now();
    const done = await retryingWithin(
      () => new Promise<never>(() => {}),
      20,
      instantly,
    );
    assert.equal(done.ok, false, 'a call nobody answered was reported as done');
    assert.ok(
      Date.now() - started < 5_000,
      'the retry held its caller past every attempt',
    );
  });

  it('spends its whole allowance of attempts before giving up', async () => {
    // A bound that gave up after one would be a different defect wearing
    // the same fix: the retry exists because the first attempt is the one
    // most likely to meet a restarting object.
    let asked = 0;
    await retryingWithin(
      () => {
        asked += 1;
        return new Promise<never>(() => {});
      },
      10,
      instantly,
    );
    assert.equal(asked, RETRY_ATTEMPTS);
  });

  it('answers straight away when the first attempt does', async () => {
    let asked = 0;
    const done = await retryingWithin(
      async () => {
        asked += 1;
        return 'first';
      },
      5_000,
      instantly,
    );
    assert.deepEqual(done, { ok: true, value: 'first' });
    assert.equal(asked, 1, 'a call that worked was made again');
  });
});
