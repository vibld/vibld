import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UserBudget } from '../worker/budget.ts';
import { RUN_ABANDONED_AFTER_MS } from '@vibld/ai';
import { fakeDurableObjectCtx } from './fakes/sqlite-do-storage.ts';

/**
 * What a caller is actually charged (#180).
 *
 * The ledger reclaims a reservation that never came back, and charges it at
 * its full worst case, because a run that vanished may have spent anything.
 * That is the right guess. The bug is treating a guess as final: the real
 * figure can arrive afterwards, and when it does it is not an opinion, it is
 * a measurement.
 *
 * Codex found the ordering this PR first relied on could not hold. The
 * reclaim clock starts when the reservation is written; the Workflow's step
 * timeout starts when the step begins, and a durable Workflow may sit queued
 * in between. No cushion between two clocks that start at different moments
 * is safe. So correctness moved off the timing and onto the correction.
 */

const DAY = '2026-09-18';
const CEILING = 10_000_000;
const MAX_IN_FLIGHT = 4;

function ledger() {
  return new UserBudget(fakeDurableObjectCtx(), {});
}

describe('the spend ledger', () => {
  it('charges what a run actually used, not what it reserved', () => {
    const budget = ledger();
    const { id } = budget.reserve(300_000, CEILING, MAX_IN_FLIGHT, DAY);
    assert.ok(id !== undefined);
    budget.settle(id, 120_000);
    assert.equal(budget.usageFor(DAY).spentMicroUsd, 120_000);
  });

  it('charges the worst case for a run that never came back', () => {
    // The guess, and it has to stay: a run that vanished mid-call may have
    // spent its whole reservation, and assuming otherwise hands out free
    // generation to anyone who disconnects.
    const budget = ledger();
    const { id } = budget.reserve(300_000, CEILING, MAX_IN_FLIGHT, DAY);
    assert.ok(id !== undefined);

    // A later reservation is what runs the reclaim, so age the first one
    // past the window and make one.
    const clock = Date.now;
    Date.now = () => clock() + RUN_ABANDONED_AFTER_MS + 1000;
    try {
      budget.reserve(1, CEILING, MAX_IN_FLIGHT, DAY);
    } finally {
      Date.now = clock;
    }

    assert.equal(
      budget.usageFor(DAY).spentMicroUsd,
      300_001,
      'the abandoned run was not charged its reservation',
    );
  });

  it('corrects a reclaimed run once its real cost arrives', () => {
    // The finding. A run reclaimed while it was still alive -- queued long
    // enough that the reclaim clock ran out before its step timeout did --
    // used to keep the worst-case charge for ever, because `settle` wrote
    // only where `settled IS NULL`. The measurement has to win over the
    // guess whenever it turns up.
    const budget = ledger();
    const { id } = budget.reserve(300_000, CEILING, MAX_IN_FLIGHT, DAY);
    assert.ok(id !== undefined);

    const clock = Date.now;
    Date.now = () => clock() + RUN_ABANDONED_AFTER_MS + 1000;
    try {
      budget.reserve(1, CEILING, MAX_IN_FLIGHT, DAY);
    } finally {
      Date.now = clock;
    }
    assert.equal(budget.usageFor(DAY).spentMicroUsd, 300_001);

    budget.settle(id, 120_000);
    assert.equal(
      budget.usageFor(DAY).spentMicroUsd,
      120_001,
      'the run was billed its reservation although it reported a real cost',
    );
  });

  it('does not put a corrected run back in flight', () => {
    // The reclaim released the slot. A late correction is about money, not
    // about concurrency, and handing the slot back would let a caller hold
    // more runs at once than the limit allows.
    const budget = ledger();
    const { id } = budget.reserve(300_000, CEILING, MAX_IN_FLIGHT, DAY);
    assert.ok(id !== undefined);

    const clock = Date.now;
    Date.now = () => clock() + RUN_ABANDONED_AFTER_MS + 1000;
    try {
      budget.reserve(1, CEILING, MAX_IN_FLIGHT, DAY);
    } finally {
      Date.now = clock;
    }

    budget.settle(id, 120_000);
    assert.equal(
      budget.usageFor(DAY).inFlight,
      1,
      'a corrected run was counted as running again',
    );
  });

  it('is unchanged by settling the same run twice', () => {
    // The settle step retries. It used to be idempotent by accident, via
    // the `settled IS NULL` guard that this removes; it has to stay
    // idempotent on its own terms.
    const budget = ledger();
    const { id } = budget.reserve(300_000, CEILING, MAX_IN_FLIGHT, DAY);
    assert.ok(id !== undefined);
    budget.settle(id, 120_000);
    budget.settle(id, 120_000);
    assert.equal(budget.usageFor(DAY).spentMicroUsd, 120_000);
    assert.equal(budget.usageFor(DAY).inFlight, 0);
  });
});
