import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { stageFor } from '../worker/run-stage.ts';

/**
 * The meter may not name a state it cannot name (#188 review, P2).
 *
 * `WorkflowInstanceStatus` carries more states than the meter has words
 * for. The first cut treated every non-terminal, non-queued state as
 * writing, which put "Writing your project" on screen for a run that was
 * paused or sitting in the settlement step's delayed retries.
 */

/**
 * Every non-terminal state a Workflow instance reports. The terminal ones
 * (`complete`, `errored`, `terminated`) never reach this mapping: the poll
 * loop returns on them before asking what to call the run.
 */
const STILL_GOING = [
  'queued',
  'running',
  'paused',
  'waiting',
  'waitingForPause',
  'unknown',
];

describe('what the meter calls a run in flight', () => {
  it('says writing only while the run is actually running', () => {
    assert.equal(stageFor('running'), 'writing');
    for (const status of STILL_GOING) {
      if (status === 'running') continue;
      assert.notEqual(
        stageFor(status),
        'writing',
        `a ${status} run would be described as writing a project it is not writing`,
      );
    }
  });

  it('says queued only while the run is queued', () => {
    assert.equal(stageFor('queued'), 'queued');
    for (const status of STILL_GOING) {
      if (status === 'queued') continue;
      assert.notEqual(stageFor(status), 'queued');
    }
  });

  it('returns nothing for a state it has no honest word for', () => {
    // Not a fallback word, and not an invented one: `undefined` is a shape
    // the client already renders, as a line carrying only the clock.
    for (const status of ['paused', 'waiting', 'waitingForPause', 'unknown']) {
      assert.equal(
        stageFor(status),
        undefined,
        `${status} was given a word rather than left unnamed`,
      );
    }
  });
});
