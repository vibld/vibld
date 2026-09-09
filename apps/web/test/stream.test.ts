import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_KEEPALIVE_MS,
  KEEPALIVE_COMMENT,
  createProgressThrottle,
  encodeEvent,
  parseKeepaliveMs,
} from '../worker/stream.ts';

describe('stream framing', () => {
  it('encodes an event as a complete SSE frame', () => {
    assert.equal(
      encodeEvent('plan', { a: 1 }),
      'event: plan\ndata: {"a":1}\n\n',
    );
  });

  it('uses a comment for keepalives so clients ignore them', () => {
    assert.ok(KEEPALIVE_COMMENT.startsWith(':'));
    assert.ok(KEEPALIVE_COMMENT.endsWith('\n\n'));
  });
});

describe('keepalive interval configuration', () => {
  it('is configurable rather than hardcoded', () => {
    assert.equal(parseKeepaliveMs('5000'), 5000);
    assert.equal(parseKeepaliveMs('30000'), 30000);
  });

  it('falls back to the documented default when unset or unusable', () => {
    for (const bad of [
      undefined,
      '',
      'soon',
      '0',
      '-1',
      '999',
      '120000',
      'NaN',
    ]) {
      assert.equal(parseKeepaliveMs(bad), DEFAULT_KEEPALIVE_MS);
    }
  });

  it('keeps the default inside common browser and proxy idle windows', () => {
    assert.ok(DEFAULT_KEEPALIVE_MS >= 1000 && DEFAULT_KEEPALIVE_MS <= 30_000);
  });
});

describe('createProgressThrottle', () => {
  function harness(intervalMs?: number) {
    const emitted: { characters: number; elapsedMs: number }[] = [];
    let clock = 1_000_000;
    const report = createProgressThrottle({
      emit: (update) => emitted.push(update),
      now: () => clock,
      ...(intervalMs === undefined ? {} : { intervalMs }),
    });
    return { emitted, report, advance: (ms: number) => (clock += ms) };
  }

  it('lets the first update through immediately', () => {
    // The earliest "something is happening" is the most valuable one: it is
    // the difference between a long run and an apparently dead page.
    const { emitted, report } = harness();
    report(12);
    assert.deepEqual(emitted, [{ characters: 12, elapsedMs: 0 }]);
  });

  it('drops the updates in between', () => {
    const { emitted, report, advance } = harness(1000);
    report(1);
    advance(200);
    report(2);
    advance(300);
    report(3);
    assert.equal(emitted.length, 1, 'a burst inside the interval sends once');

    advance(600);
    report(4);
    assert.deepEqual(emitted[1], { characters: 4, elapsedMs: 1100 });
  });

  it('measures elapsed time from when the run started, not the last frame', () => {
    const { emitted, report, advance } = harness(1000);
    report(1);
    advance(5_000);
    report(2);
    advance(5_000);
    report(3);
    assert.deepEqual(
      emitted.map((update) => update.elapsedMs),
      [0, 5_000, 10_000],
    );
  });

  it('defaults to one update a second', () => {
    const { emitted, report, advance } = harness();
    report(1);
    advance(999);
    report(2);
    assert.equal(emitted.length, 1);
    advance(1);
    report(3);
    assert.equal(emitted.length, 2);
  });
});
