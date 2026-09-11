import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HARD_LIFETIME_MS,
  isStale,
  queuePosition,
  toActivate,
} from '../worker/fleet.ts';

describe('isStale', () => {
  it('is not stale before the hard lifetime elapses', () => {
    assert.equal(isStale(0, HARD_LIFETIME_MS - 1), false);
  });

  it('is stale once the hard lifetime elapses', () => {
    assert.equal(isStale(0, HARD_LIFETIME_MS + 1), true);
  });
});

describe('queuePosition', () => {
  it('is zero for the earliest waiting row', () => {
    const rows = [
      { id: 1, requested: 100 },
      { id: 2, requested: 200 },
    ];
    assert.equal(queuePosition(rows[0]!, rows), 0);
  });

  it('counts every row requested earlier', () => {
    const rows = [
      { id: 1, requested: 100 },
      { id: 2, requested: 200 },
      { id: 3, requested: 300 },
    ];
    assert.equal(queuePosition(rows[2]!, rows), 2);
  });

  it('breaks a tie on id, not on request order in the array', () => {
    const rows = [
      { id: 5, requested: 100 },
      { id: 2, requested: 100 },
    ];
    assert.equal(queuePosition(rows[0]!, rows), 1);
    assert.equal(queuePosition(rows[1]!, rows), 0);
  });

  it('does not count itself', () => {
    const rows = [{ id: 1, requested: 100 }];
    assert.equal(queuePosition(rows[0]!, rows), 0);
  });
});

describe('toActivate', () => {
  const rows = [
    { id: 1, requested: 300 },
    { id: 2, requested: 100 },
    { id: 3, requested: 200 },
  ];

  it('activates nothing when already at capacity', () => {
    assert.deepEqual(toActivate(rows, 25, 25), []);
  });

  it('activates the oldest rows first, not array order', () => {
    const activated = toActivate(rows, 24, 25);
    assert.deepEqual(activated, [{ id: 2, requested: 100 }]);
  });

  it('activates up to the available room and no more', () => {
    const activated = toActivate(rows, 0, 2);
    assert.deepEqual(activated, [
      { id: 2, requested: 100 },
      { id: 3, requested: 200 },
    ]);
  });

  it('never activates more than exist', () => {
    assert.equal(toActivate(rows, 0, 100).length, rows.length);
  });

  it('clamps a negative apparent room to zero rather than activating none-of-negative', () => {
    // activeCount can momentarily exceed maxInFlight right after the ceiling
    // is lowered; this must not activate anyone until it drains below it.
    assert.deepEqual(toActivate(rows, 30, 25), []);
  });
});
