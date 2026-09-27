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

/**
 * The second constraint inside the one counter (#197).
 *
 * Previews and builds share one budget of twenty-five containers, with
 * builds bounded at five of it. So a waiting row is admitted only if there
 * is room in the whole budget and, for a build, room under the build bound
 * as well. The rows here carry their kind; the ones above carry none and
 * are previews, which is also what a row written before builds shared the
 * counter is.
 */
describe('toActivate with builds in the same budget', () => {
  const build = (id: number, requested: number) =>
    ({ id, requested, kind: 'build' }) as const;
  const preview = (id: number, requested: number) =>
    ({ id, requested, kind: 'preview' }) as const;

  it('admits no build past the build bound, however much room is left', () => {
    const rows = [build(1, 100), build(2, 200), preview(3, 300)];
    assert.deepEqual(toActivate(rows, 5, 25, { active: 5, max: 5 }), [
      preview(3, 300),
    ]);
  });

  it('admits builds up to the build bound and no further', () => {
    const rows = [build(1, 100), build(2, 200), build(3, 300)];
    assert.deepEqual(toActivate(rows, 3, 25, { active: 3, max: 5 }), [
      build(1, 100),
      build(2, 200),
    ]);
  });

  it('lets a preview past a build that its own bound is holding back', () => {
    // A build held by the build bound is not holding a container, so the
    // preview behind it is not waiting for the platform. Stopping at the
    // build would queue a preview while containers sit free, which is the
    // L9 breach this change exists to remove.
    const rows = [build(1, 100), preview(2, 200)];
    assert.deepEqual(toActivate(rows, 24, 25, { active: 5, max: 5 }), [
      preview(2, 200),
    ]);
  });

  it('counts an admitted build against the room as well as the bound', () => {
    const rows = [build(1, 100), preview(2, 200)];
    assert.deepEqual(toActivate(rows, 24, 25, { active: 0, max: 5 }), [
      build(1, 100),
    ]);
    assert.deepEqual(toActivate(rows, 25, 25, { active: 0, max: 5 }), []);
  });

  it('admits no build at all when it is not told the build bound', () => {
    // Fails closed: a caller that forgot the bound refuses builds rather
    // than running them unbounded against the previews' containers.
    const rows = [build(1, 100), preview(2, 200)];
    assert.deepEqual(toActivate(rows, 0, 25), [preview(2, 200)]);
  });
});
