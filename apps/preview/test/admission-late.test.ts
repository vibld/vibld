import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OUT_OF_TIME, admit } from '../worker/build-files.ts';

/**
 * That a build gives back a ticket it abandoned, and keeps one it did not
 * (#196 review).
 *
 * This is here because the inline version was wrong in a way no source
 * read could see and no regex was ever going to catch. It kept a `waiting`
 * flag set false after the `await`, and a handler registered on the
 * admission before it; reactions run in registration order, so on the
 * ordinary fast path the handler ran first, saw `waiting` still true, and
 * released the ticket of the build about to use it. Every build would then
 * have run holding no slot, which is the container partition defeated
 * always rather than rarely.
 *
 * The two cases below are one line each and either of them fails against
 * that code.
 */
const ticket = { id: 7, active: true };

describe('a fleet ticket that arrives after the build gave up', () => {
  it('keeps the ticket the build actually waited for', async () => {
    const released: number[] = [];
    const kept: Promise<unknown>[] = [];
    const got = await admit(
      Promise.resolve(ticket),
      (work) => work,
      async (id) => {
        released.push(id);
      },
      (work) => kept.push(work),
    );
    await Promise.all(kept);
    assert.deepEqual(got, ticket);
    assert.deepEqual(
      released,
      [],
      'the ticket this build is about to use was given back',
    );
  });

  it('gives back one that lands after the wait gave up', async () => {
    const released: number[] = [];
    const kept: Promise<unknown>[] = [];
    let admit_: (value: typeof ticket) => void = () => {};
    const admission = new Promise<typeof ticket>((resolve) => {
      admit_ = resolve;
    });
    await assert.rejects(
      admit(
        admission,
        async () => {
          throw new Error(OUT_OF_TIME);
        },
        async (id) => {
          released.push(id);
        },
        (work) => kept.push(work),
      ),
      { message: OUT_OF_TIME },
    );
    admit_(ticket);
    await Promise.all(kept);
    assert.deepEqual(
      released,
      [ticket.id],
      'a ticket nobody holds is left for a reclaim that never reclaims it',
    );
  });

  it('releases nothing when the admission itself failed', async () => {
    // There is no ticket to give back, and asking the fleet to release one
    // that was never issued is a call that can only fail.
    const released: number[] = [];
    const kept: Promise<unknown>[] = [];
    await assert.rejects(
      admit(
        Promise.reject(new Error('the fleet is unreachable')),
        async (work) => work,
        async (id) => {
          released.push(id);
        },
        (work) => kept.push(work),
      ),
    );
    await Promise.all(kept);
    assert.deepEqual(released, []);
  });
});
