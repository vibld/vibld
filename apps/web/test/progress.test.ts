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

/**
 * What the line says when the count is unavailable (#183).
 *
 * Generation moved into a durable Workflow, which has no live channel back
 * to the Worker polling it, so the character count these helpers were built
 * around usually is not there. The line has to stay useful without it, and
 * must not substitute a zero: a counter sitting at 0 while a run works
 * perfectly well is the frozen line this component exists to replace,
 * wearing a number.
 */
describe('a run whose character count is unknown', () => {
  it('carries the line on the clock alone', () => {
    const line = describeProgress({ elapsedMs: 187_000 });
    assert.equal(line, '3:07');
    assert.doesNotMatch(line, /character/);
    assert.doesNotMatch(line, /\b0\b/);
  });

  it('names the stage when there is one', () => {
    assert.equal(
      describeProgress({ elapsedMs: 9_000, stage: 'running' }),
      'Building your project · 0:09',
    );
    assert.equal(
      describeProgress({ elapsedMs: 4_000, stage: 'queued' }),
      'Waiting for a slot · 0:04',
    );
  });

  it('still shows a count when one is genuinely known', () => {
    // The old path has to keep working: a provider that does report
    // characters, or a later change that restores the live channel, should
    // light this back up without touching the wording.
    assert.equal(
      describeProgress({ characters: 12_480, elapsedMs: 187_000 }),
      '12,480 characters written · 3:07',
    );
    assert.equal(
      describeProgress({
        characters: 12_480,
        elapsedMs: 187_000,
        stage: 'running',
      }),
      'Building your project · 12,480 characters written · 3:07',
    );
  });

  it('says nothing rather than zero for a count that has not moved', () => {
    assert.equal(describeProgress({ characters: 0, elapsedMs: 2_000 }), '0:02');
  });

  it('explains a queue differently from a slow run', () => {
    // Two different worries. "Building takes several minutes" is the wrong
    // answer while nothing has started yet.
    const queued = reassurance({ elapsedMs: 60_000, stage: 'queued' });
    assert.match(queued ?? '', /queued behind other builds/);

    const running = reassurance({ elapsedMs: 60_000, stage: 'running' });
    assert.match(running ?? '', /takes several minutes/);
    assert.doesNotMatch(running ?? '', /queued/);
  });

  it('claims no work it cannot see when there is no stage', () => {
    // Removing the stage word for a paused or waiting run and then
    // explaining the wait in terms of the work being done would put the
    // same claim back one line lower (#188 review). All that is known is
    // that the run has not finished.
    const unknown = reassurance({ elapsedMs: 60_000 }) ?? '';
    assert.notEqual(unknown, '');
    assert.doesNotMatch(
      unknown,
      /Building|Writing|queued/,
      'a run in a state the Worker cannot name was described as doing something specific',
    );
    assert.match(unknown, /cancel at any time/);
  });

  it('stays quiet early, whatever the stage', () => {
    assert.equal(reassurance({ elapsedMs: 1_000, stage: 'queued' }), null);
    assert.equal(reassurance({ elapsedMs: 1_000, stage: 'running' }), null);
    assert.equal(reassurance({ elapsedMs: 1_000 }), null);
  });
});
