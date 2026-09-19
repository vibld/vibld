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
  it('says running only while the instance is running', () => {
    assert.equal(stageFor('running'), 'running');
    for (const status of STILL_GOING) {
      if (status === 'running') continue;
      assert.notEqual(
        stageFor(status),
        'running',
        `a ${status} run would be described as under way when it is not`,
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

  it('says thinking while a reasoning model has written nothing', () => {
    // The state the Workflow cannot report, because `status` is `running`
    // for all of it (#183). On the production provider this is between 57%
    // and 68% of a run's output tokens, so a meter without it spends most
    // of its time claiming a project is being built while the character
    // count beside it sits at zero.
    assert.equal(
      stageFor('running', { characters: 0, reasoningCharacters: 4_120 }),
      'thinking',
    );
  });

  it('stops saying thinking the moment the answer starts', () => {
    // Nothing decides that thinking is over: the condition is that no
    // answer exists yet, so one character ends it.
    assert.equal(
      stageFor('running', { characters: 1, reasoningCharacters: 4_120 }),
      'running',
    );
  });

  it('does not call a run thinking on a provider that never says', () => {
    // A provider that streams no reasoning reports zero, not absence
    // (`throttleProgress` normalises it). Zero and zero is a run that has
    // produced nothing yet, which is ordinary at the start of every run and
    // is not evidence of thinking.
    assert.equal(
      stageFor('running', { characters: 0, reasoningCharacters: 0 }),
      'running',
    );
    assert.equal(stageFor('running'), 'running');
  });

  it('never calls a queued or unnameable run thinking', () => {
    // A report outlives the state it was made in: the object holds the last
    // one, and a run can be re-read while the instance is paused between
    // retries. The thinking word must come from a running instance only.
    const thinking = { characters: 0, reasoningCharacters: 4_120 };
    assert.equal(stageFor('queued', thinking), 'queued');
    for (const status of ['paused', 'waiting', 'waitingForPause', 'unknown']) {
      assert.equal(stageFor(status, thinking), undefined, status);
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
