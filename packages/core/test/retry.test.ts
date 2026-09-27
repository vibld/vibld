import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RETRY_ATTEMPTS, retrying } from '../src/retry.ts';

/**
 * Asking again, a bounded number of times, without the asking becoming the
 * failure (#196 review).
 *
 * Both callers are cleanup on an error path against a Durable Object that
 * is probably restarting: closing the repair's reservation, and releasing
 * an account hold a later ceiling could not be asked about. Neither may
 * throw, because in both cases the thing left behind is money the reclaim
 * charges in full.
 */
describe('asking a ledger again', () => {
  it('does not wait after an attempt that worked', async () => {
    const waits: number[] = [];
    const outcome = await retrying(
      async () => 'done',
      async (ms) => {
        waits.push(ms);
      },
    );
    assert.deepEqual(outcome, { ok: true, value: 'done' });
    assert.deepEqual(waits, [], 'a successful first attempt still slept');
  });

  it('keeps asking while there are attempts left', async () => {
    let asked = 0;
    const outcome = await retrying(
      async () => {
        asked += 1;
        if (asked < 3) throw new Error('restarting');
        return asked;
      },
      async () => {},
    );
    assert.deepEqual(outcome, { ok: true, value: 3 });
  });

  it('stops after the last attempt and reports rather than throws', async () => {
    // The whole reason this returns a value: a caller that has to remember
    // to catch is a caller that will eventually not.
    let asked = 0;
    const outcome = await retrying(
      async () => {
        asked += 1;
        throw new Error('still gone');
      },
      async () => {},
    );
    assert.equal(asked, RETRY_ATTEMPTS);
    assert.equal(outcome.ok, false);
    assert.match(
      String(!outcome.ok && outcome.error),
      /still gone/,
      'the failure that ended it was not the one reported',
    );
  });

  it('does not sleep after the attempt it will never follow', async () => {
    // A delay with nothing after it is latency on an error path and
    // nothing else. It is the last attempt that proves this, because that
    // is the one where the loop is about to end anyway.
    const waits: number[] = [];
    await retrying(
      async () => {
        throw new Error('gone');
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    assert.equal(
      waits.length,
      RETRY_ATTEMPTS - 1,
      'slept once for every attempt, including the last',
    );
  });

  it('backs off further each time rather than hammering', async () => {
    const waits: number[] = [];
    await retrying(
      async () => {
        throw new Error('gone');
      },
      async (ms) => {
        waits.push(ms);
      },
    );
    for (let i = 1; i < waits.length; i += 1) {
      assert.ok(
        waits[i]! > waits[i - 1]!,
        `attempt ${i + 1} waited no longer than the one before it`,
      );
    }
  });
});
