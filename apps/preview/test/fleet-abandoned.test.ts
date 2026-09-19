import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ABANDONED_AFTER_MS,
  HARD_LIFETIME_MS,
  isAbandoned,
} from '../worker/fleet.ts';
import {
  BUILD_WALL_CLOCK_MS,
  TEARDOWN_WALL_CLOCK_MS,
} from '../worker/build-limits.ts';

/**
 * That a queue row nobody is waiting on stops holding a place (#199).
 *
 * `reclaimStale` only ever looked at rows it had activated, so a waiting
 * row had no expiry at all. It is the one kind of ticket nothing in this
 * system can clean up on its own, and three separate findings on #196 were
 * that single fact arriving from three directions: a build that gave up
 * waiting, a build refused before anything ran, and a release whose retry
 * could never reach a second attempt. Each was fixed by making one more
 * release path infallible, which is an argument that holds only until
 * somebody adds a fourth path.
 */
describe('a queue row nobody is waiting on', () => {
  const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

  it('is not abandoned while somebody is still asking', () => {
    assert.equal(isAbandoned(NOW - ABANDONED_AFTER_MS + 1_000, NOW), false);
  });

  it('is abandoned once nobody has asked for long enough', () => {
    assert.equal(isAbandoned(NOW - ABANDONED_AFTER_MS - 1_000, NOW), true);
  });

  it('outlasts everything a build could still be doing with the answer', () => {
    // The caller that never asks twice. A build awaits `enqueue` once,
    // gives up on its own wall clock and tears down afterwards, so the
    // longest it could still want a slot is those two together. Reclaiming
    // sooner would take a ticket from a build that is still using it.
    const stillWanted = BUILD_WALL_CLOCK_MS + TEARDOWN_WALL_CLOCK_MS;
    assert.ok(
      ABANDONED_AFTER_MS > stillWanted,
      `a build may want its slot for ${stillWanted}ms and the row is reclaimed after ${ABANDONED_AFTER_MS}ms`,
    );
  });

  it('is never reclaimed sooner than an activated one', () => {
    // A waiting row costs nothing while it waits, so there is no reason to
    // be quicker with it than with a row actually holding a container. The
    // other direction is what matters and is asserted above.
    assert.ok(ABANDONED_AFTER_MS >= HARD_LIFETIME_MS);
  });
});

/**
 * The half the arithmetic cannot reach.
 *
 * `preview-fleet.ts` imports `cloudflare:workers` and cannot be loaded
 * under `node --test`, so the predicate above can be perfectly correct
 * while the object never calls it, or calls it against a column nothing
 * ever writes.
 */
describe('what the fleet object does with that', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'worker', 'preview-fleet.ts'),
    'utf8',
  );

  /** A region with its prose removed, so a match is never a comment's. */
  function code(region: string): string {
    return region
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  }

  function methodOf(name: string): string {
    const at = source.indexOf(name);
    assert.ok(at > 0, `${name} is not where this expected it`);
    const end = source.indexOf('\n  private ', at + 10);
    const next = source.indexOf('\n  ', at + name.length);
    assert.ok(end > at || next > at, `${name} runs to the end of the file`);
    return source.slice(at, end > at ? end : source.length);
  }

  it('reclaims waiting rows, not only activated ones', () => {
    // The literal cause: a `WHERE activated IS NOT NULL` that made the
    // reclaim structurally unable to see the rows that needed it.
    const reclaim = methodOf('private reclaimStale(');
    assert.match(reclaim, /isAbandoned\(/, 'a waiting row still never expires');
    assert.doesNotMatch(
      reclaim,
      /WHERE activated IS NOT NULL/,
      'the reclaim still only selects rows it activated',
    );
  });

  it('keeps the abandonment deadline after a row is promoted', () => {
    // #200 review. Written as a ternary, promotion erased it: a row nobody
    // was waiting on, promoted at minute twenty-nine, stopped being judged
    // by `seen` and started a fresh lifetime from its activation. That is
    // the exact case this change exists to remove, so the release path in
    // front of it would have stayed load bearing.
    const reclaim = code(methodOf('private reclaimStale('));
    assert.match(
      reclaim,
      /isAbandoned\([\s\S]{0,80}?\|\|/,
      'promotion still switches the row from one deadline to the other',
    );
    assert.doesNotMatch(
      reclaim,
      /activated != null\s*\?/,
      'the two deadlines are alternatives rather than both applying',
    );
  });

  it('deletes rows that have been released long enough to be unreadable', () => {
    // The other half of the index finding: rows were never removed, so the
    // table grew with all historical usage and every query paid for it.
    const reclaim = code(methodOf('private reclaimStale('));
    assert.match(
      reclaim,
      /DELETE FROM queue WHERE released IS NOT NULL AND released < \?/,
      'a released row is kept for the life of the instance',
    );
    assert.match(
      reclaim,
      /now - HARD_LIFETIME_MS/,
      'released rows are purged on some bound other than the one that makes them unreadable',
    );
  });

  it('indexes the predicate every one of its queries starts with', () => {
    // An index led by `activated` cannot serve `WHERE released IS NULL` on
    // its own, and the reclaim has no second predicate to narrow with, so
    // it scanned the whole table on every enqueue, poll and release. A
    // queued preview polls every 1.5 seconds.
    assert.match(
      source,
      /CREATE INDEX IF NOT EXISTS \w+ ON queue\(released/,
      'no index leads on the column every query filters by',
    );
    assert.match(
      source,
      /DROP INDEX IF EXISTS queue_waiting/,
      'the superseded index is left to cost a write on every insert',
    );
  });

  it('records when a row was last asked about', () => {
    // A predicate reading a column nothing writes is worse than no
    // predicate: it reads NULL, coalesces to the request time, and turns
    // "nobody asked" into "asked once, long ago" for every row.
    assert.match(
      methodOf('status('),
      /UPDATE queue SET seen = \?/,
      'polling a queued row does not count as asking about it',
    );
    assert.match(
      source,
      /INSERT INTO queue \(label, requested, seen\)/,
      'a new row starts with no last-seen time at all',
    );
  });

  it('reclaims before it promotes, on every path that promotes', () => {
    // Otherwise the order decides: promoting first hands a slot to a row
    // the reclaim was about to take, and the slot is then held for a full
    // hard lifetime by nobody.
    for (const name of ['enqueue(', 'status(', 'release(']) {
      const method = methodOf(name);
      const reclaimed = method.indexOf('this.reclaimStale(');
      const promoted = method.indexOf('this.promote(');
      assert.ok(reclaimed > 0, `${name} does not reclaim at all`);
      assert.ok(
        promoted > reclaimed,
        `${name} promotes before it reclaims, so an abandoned row can take a slot`,
      );
    }
  });

  it('treats a row from before the column existed as seen when requested', () => {
    // Instances already exist with the old shape. Reading NULL as "never
    // seen" would reclaim every one of them on the next call, including
    // the ones with somebody waiting.
    assert.match(
      source,
      /COALESCE\(seen, requested\)/,
      'a row written before this migration has no last-seen time to read',
    );
    assert.match(
      source,
      /ALTER TABLE queue ADD COLUMN seen INTEGER/,
      'the column is only ever created on a fresh instance',
    );
  });
});
