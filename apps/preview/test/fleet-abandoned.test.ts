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
