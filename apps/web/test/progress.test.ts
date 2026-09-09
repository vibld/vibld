import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANNOUNCE_INTERVAL_MS,
  describeProgress,
  formatCharacters,
  formatElapsed,
  progressAnnouncement,
  reassurance,
} from '../src/generation/progress.ts';

describe('formatElapsed', () => {
  it('reads as a clock', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(7_400), '0:07');
    assert.equal(formatElapsed(59_999), '0:59');
    assert.equal(formatElapsed(60_000), '1:00');
    // The run that proved generation works took 496 seconds.
    assert.equal(formatElapsed(496_000), '8:16');
  });

  it('grows an hours field rather than counting past 60 minutes', () => {
    assert.equal(formatElapsed(3_600_000), '1:00:00');
    assert.equal(formatElapsed(3_723_000), '1:02:03');
  });

  it('never renders a negative or non-finite clock', () => {
    // A clock skew between the Worker and the browser must not produce
    // "-1:-3" in front of someone waiting on a paid run.
    assert.equal(formatElapsed(-5_000), '0:00');
    assert.equal(formatElapsed(Number.NaN), '0:00');
    assert.equal(formatElapsed(Number.POSITIVE_INFINITY), '0:00');
  });
});

describe('formatCharacters', () => {
  it('groups digits so a long plan is legible at a glance', () => {
    assert.equal(formatCharacters(0), '0');
    assert.equal(formatCharacters(942), '942');
    assert.equal(formatCharacters(103_524), '103,524');
  });

  it('clamps nonsense to zero', () => {
    assert.equal(formatCharacters(-1), '0');
    assert.equal(formatCharacters(Number.NaN), '0');
  });
});

describe('describeProgress', () => {
  it('states the two things that are true and moving', () => {
    assert.equal(
      describeProgress({ characters: 12_400, elapsedMs: 92_000 }),
      '12,400 characters written · 1:32',
    );
  });

  it('claims no percentage, because there is no total', () => {
    // The model does not say how long a plan will be. Any percentage here
    // would be invented, and would be wrong exactly when the wait is worst.
    const text = describeProgress({ characters: 400, elapsedMs: 4_000 });
    assert.equal(/%/.test(text), false);
  });
});

describe('reassurance', () => {
  it('stays quiet while the wait is still ordinary', () => {
    assert.equal(reassurance({ characters: 200, elapsedMs: 0 }), null);
    assert.equal(reassurance({ characters: 900, elapsedMs: 44_999 }), null);
  });

  it('explains the wait once it is long, and offers the way out', () => {
    const note = reassurance({ characters: 9_000, elapsedMs: 60_000 });
    assert.ok(note);
    assert.match(note, /minutes/);
    assert.match(note, /cancel/i);
  });
});

describe('progressAnnouncement', () => {
  it('says nothing when nothing is running', () => {
    assert.equal(progressAnnouncement(null), null);
  });

  it('waits for the first boundary before speaking', () => {
    assert.equal(
      progressAnnouncement({ characters: 10, elapsedMs: 1_000 }),
      null,
    );
  });

  it('is stable between boundaries, so the live region stays silent', () => {
    // The counters change several times a second. If the announcement
    // changed with them, a screen reader would read the whole run aloud.
    const first = progressAnnouncement({
      characters: 1_000,
      elapsedMs: ANNOUNCE_INTERVAL_MS,
    });
    const later = progressAnnouncement({
      characters: 8_000,
      elapsedMs: ANNOUNCE_INTERVAL_MS + ANNOUNCE_INTERVAL_MS - 1,
    });
    assert.equal(first, later);
    assert.match(String(first), /Still generating/);
  });

  it('advances at the next boundary', () => {
    const second = progressAnnouncement({
      characters: 20_000,
      elapsedMs: ANNOUNCE_INTERVAL_MS * 2 + 500,
    });
    assert.equal(second, 'Still generating, 1:00 elapsed.');
  });
});
