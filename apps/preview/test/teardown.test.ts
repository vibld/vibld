import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destroyWithin, releaseWithin } from '../worker/teardown.ts';

/**
 * That the wait for a container to die is really capped (#196 review).
 *
 * `MAX_DESTROY_WAIT_MS` is what stops a container that will not die from
 * holding a workspace lock and a fleet ticket forever, and the loop that
 * enforced it bounded everything except the one call in it that could
 * stall. A renewal awaited directly never returned to the clock check, so
 * the cap was a cap on a loop that could not reach its own condition.
 *
 * Called with real timers on millisecond budgets rather than read as
 * source, which is the whole reason it is a module: the source-reading
 * version of this test would have passed on the stalling code, because the
 * `await` it was missing looked exactly like the one that was there.
 */

/** Something that is still not finished when the test asks. */
const never = new Promise<never>(() => {});

/** How long a call really took, so a cap can be checked rather than described. */
async function timed<T>(work: Promise<T>): Promise<{ answer: T; ms: number }> {
  const started = Date.now();
  const answer = await work;
  return { answer, ms: Date.now() - started };
}

describe('waiting for a container to die', () => {
  it('answers as soon as the destroy does', async () => {
    const { answer, ms } = await timed(
      destroyWithin(
        Promise.resolve(true),
        async () => {},
        50,
        Date.now() + 5_000,
      ),
    );
    assert.equal(answer, true);
    assert.ok(ms < 1_000, `waited ${ms}ms for an answer it already had`);
  });

  it('reports a destroy that failed as a container still there', async () => {
    // The safe answer, and the one that keeps the lock and the ticket.
    assert.equal(
      await destroyWithin(
        Promise.resolve(false),
        async () => {},
        50,
        Date.now() + 5_000,
      ),
      false,
    );
  });

  it('gives up on a container that never dies', async () => {
    const renewals: number[] = [];
    const { answer, ms } = await timed(
      destroyWithin(
        never,
        async () => {
          renewals.push(Date.now());
        },
        20,
        Date.now() + 120,
      ),
    );
    assert.equal(answer, false);
    assert.ok(ms < 1_000, `a cap of 120ms took ${ms}ms`);
    assert.ok(renewals.length > 1, 'the lock was not kept alive while waiting');
  });

  it('gives up on a renewal that never answers', async () => {
    // The finding itself. Awaited with no bound of its own, this call
    // never came back to the clock check and the cap bounded nothing.
    const { answer, ms } = await timed(
      destroyWithin(never, () => never, 20, Date.now() + 120),
    );
    assert.equal(answer, false);
    assert.ok(ms < 1_000, `a stalled renewal held the teardown for ${ms}ms`);
  });

  it('gives up on a renewal that rejects', async () => {
    // Storage saying no is the same fact as storage saying nothing: this
    // build can no longer vouch for the lock, so it stops destroying under
    // it.
    //
    // Counted and timed rather than only answered. Swallowing the
    // rejection and going round again reaches the same `false` at the cap,
    // so the answer alone does not distinguish giving up from spinning:
    // what does is that it stops asking.
    let renewals = 0;
    const { answer, ms } = await timed(
      destroyWithin(
        never,
        async () => {
          renewals += 1;
          throw new Error('storage is unreachable');
        },
        20,
        Date.now() + 500,
      ),
    );
    assert.equal(answer, false);
    assert.equal(renewals, 1, 'a lock nobody can vouch for was renewed again');
    assert.ok(
      ms < 400,
      `the teardown kept waiting for ${ms}ms after giving up`,
    );
  });

  it('leaves no timer running behind it', async () => {
    // Each wait used to be a bare `setTimeout` inside a race, so a wait
    // the destroy won left a timer running for the rest of its interval.
    // In a Durable Object that is the object held awake after the work it
    // was watching finished; here it is a test run that does not exit.
    //
    // A destroy that answers quickly against a long interval, because that
    // is the case where the timer outlives the wait. With an interval
    // short enough to elapse, the leaked timer has already fired by the
    // time anything could count it, and the leak goes unseen.
    // Counted before the destroy's own timer exists, not after: that one
    // has fired by the time the count is taken again, so including it in
    // the baseline is a free timer for the leak to hide in. It did, and
    // the mutation that puts the bare race back walked through this test.
    const before = process
      .getActiveResourcesInfo()
      .filter((kind) => kind === 'Timeout').length;
    const dies = new Promise<boolean>((answer) => {
      setTimeout(() => answer(true), 5);
    });
    assert.equal(
      await destroyWithin(dies, async () => {}, 10_000, Date.now() + 60_000),
      true,
    );
    const after = process
      .getActiveResourcesInfo()
      .filter((kind) => kind === 'Timeout').length;
    assert.ok(
      after <= before,
      `the teardown left ${after - before} timers running`,
    );
  });

  it('never waits past the cap, however long the interval is', async () => {
    // An interval longer than the whole cap is the case the arithmetic is
    // for: the wait takes what is left rather than its own full pace.
    const { answer, ms } = await timed(
      destroyWithin(never, async () => {}, 10_000, Date.now() + 100),
    );
    assert.equal(answer, false);
    assert.ok(ms < 1_000, `an interval longer than the cap waited ${ms}ms`);
  });

  it('does nothing at all when the cap is already spent', async () => {
    const renewals: number[] = [];
    assert.equal(
      await destroyWithin(
        Promise.resolve(true),
        async () => {
          renewals.push(Date.now());
        },
        20,
        Date.now() - 1,
      ),
      false,
    );
    assert.equal(renewals.length, 0, 'a teardown out of time renewed a lock');
  });
});

/**
 * That a retried release can actually reach its second attempt
 * (#196 review).
 *
 * `retrying` runs one attempt and then the next, so an attempt that never
 * settles is the end of the sequence: the retry exists precisely for a
 * fleet object that is restarting, which is the case most likely to leave
 * a call pending rather than reject it. The bound is what makes the retry
 * a retry.
 *
 * It matters more than the other releases in this file because of which
 * ticket it is cleaning up. `PreviewFleet.reclaimStale` only reclaims rows
 * it has activated, so a ticket for a build refused before anything ran
 * has no expiry at all and this call is the only thing that will ever
 * return it.
 */
describe('giving a fleet ticket back', () => {
  it('reaches the next attempt when one never answers', async () => {
    const asked: number[] = [];
    await releaseWithin(() => {
      asked.push(Date.now());
      // Never for the first attempt, which is the whole point; the second
      // answers, so a bounded first one lets the release succeed.
      return asked.length === 1
        ? new Promise<never>(() => {})
        : Promise.resolve();
    }, 20);
    assert.equal(asked.length, 2, 'a pending attempt ended the sequence');
  });

  it('answers once a release lands', async () => {
    let asked = 0;
    await releaseWithin(async () => {
      asked += 1;
    }, 5_000);
    assert.equal(asked, 1, 'a release that worked was asked for again');
  });

  it('says so rather than hanging when none of them answer', async () => {
    // Two halves, and the second is the one that was missing: `retrying`
    // returns its outcome as a value instead of throwing, and this caller
    // discarded it, so a ticket that failed every attempt looked exactly
    // like one that went back.
    const started = Date.now();
    assert.equal(
      await releaseWithin(() => new Promise<never>(() => {}), 20),
      false,
      'a release nobody answered was reported as done',
    );
    assert.ok(
      Date.now() - started < 5_000,
      'the release held the teardown open past every attempt',
    );
  });

  it('says a release that landed did land', async () => {
    // So the answer above is an answer rather than a constant.
    assert.equal(await releaseWithin(async () => {}, 5_000), true);
  });
});
