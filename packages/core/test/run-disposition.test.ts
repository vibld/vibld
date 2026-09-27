import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RUN_OUTCOME_KINDS,
  canDiscardFor,
  discardFor,
  isRunOutcomeKind,
  outcomeApplies,
  outcomeAsks,
  settledOutcome,
  stopForOutcome,
  workOf,
} from '../src/run-disposition.ts';
import type { RunOutcome } from '../src/run-disposition.ts';
import { RUN_STOPS, stopIsRecordable } from '../src/run-outcome.ts';
import type { GenerationResult, ProjectSnapshot } from '../src/types.ts';

const WORK: ProjectSnapshot = {
  revision: 'r1',
  files: [{ path: 'index.html', content: '<html></html>' }],
};

const ASK: RunOutcome = {
  kind: 'ask',
  question: { id: 'q1', question: 'Which of the two logos?' },
  held: WORK,
};

describe('the four outcomes a run can have', () => {
  it('names exactly the four', () => {
    assert.deepEqual(
      [...RUN_OUTCOME_KINDS],
      ['ask', 'retain', 'apply', 'discard'],
    );
    assert.equal(isRunOutcomeKind('ask'), true);
    assert.equal(isRunOutcomeKind('pause'), false);
  });

  it('asks in exactly one of them', () => {
    // The rule most easily lost once a UI is wired to this: work held for
    // review is not a question. A reviewer has nothing to answer, and a
    // surface that prompts them invents a decision nobody asked for.
    assert.equal(outcomeAsks(ASK), true);
    assert.equal(outcomeAsks({ kind: 'retain', work: WORK }), false);
    assert.equal(
      outcomeAsks({ kind: 'apply', work: WORK, changed: true }),
      false,
    );
    assert.equal(outcomeAsks(discardFor('validation-failed')), false);
  });

  it('promotes in exactly one of them', () => {
    assert.equal(
      outcomeApplies({ kind: 'apply', work: WORK, changed: true }),
      true,
    );
    // Retained work is finished and deliberately not applied. Treating it as
    // an apply is how "awaiting review" silently becomes "shipped".
    assert.equal(outcomeApplies({ kind: 'retain', work: WORK }), false);
    assert.equal(outcomeApplies(ASK), false);
  });

  it('keeps the work an ask was holding', () => {
    // The point of holding it: the answer is about work that already
    // exists, and making somebody pay to regenerate it is what this avoids.
    assert.equal(workOf(ASK)?.revision, 'r1');
    assert.equal(workOf({ ...ASK, held: null }), null);
    assert.equal(workOf({ kind: 'retain', work: WORK })?.revision, 'r1');
    assert.equal(workOf(discardFor('model-refused')), null);
  });

  it('records a stop that matches the outcome', () => {
    assert.equal(stopForOutcome(ASK), 'awaiting-answer');
    assert.equal(stopForOutcome({ kind: 'retain', work: WORK }), 'retained');
    assert.equal(
      stopForOutcome({ kind: 'apply', work: WORK, changed: true }),
      'applied',
    );
    assert.equal(
      stopForOutcome({ kind: 'apply', work: WORK, changed: false }),
      'no-changes',
    );
    assert.equal(stopForOutcome(discardFor('conflict')), 'conflict');
  });

  it('records every outcome as a run that happened', () => {
    // All four end runs that really ran, so all four belong in the history.
    // A refusal is the thing that leaves no record, and none of these is one.
    for (const outcome of [
      ASK,
      { kind: 'retain', work: WORK } as const,
      { kind: 'apply', work: WORK, changed: true } as const,
      discardFor('provider-error'),
    ]) {
      assert.equal(stopIsRecordable(stopForOutcome(outcome)), true);
    }
  });

  it('refuses a discard that claims the project changed', () => {
    // "Nothing should be applied" and "this was applied" are opposite
    // claims about one run, and the type system cannot catch this one.
    assert.equal(canDiscardFor('applied'), false);
    assert.throws(() => discardFor('applied'), /applied/);
  });

  it('refuses a discard for a run that simply had nothing to do', () => {
    // The case this gets written as by mistake. A run that finished and
    // produced the project it started from is an apply with no change, not
    // a run whose work was thrown away.
    assert.equal(canDiscardFor('no-changes'), false);
    assert.throws(() => discardFor('no-changes'));
  });

  it('allows a discard for every stop that is not one of those two', () => {
    for (const stop of RUN_STOPS) {
      if (stop === 'applied' || stop === 'no-changes') continue;
      assert.equal(canDiscardFor(stop), true, stop);
    }
  });
});

describe('reading the outcome off a finished run', () => {
  function result(overrides: Partial<GenerationResult>): GenerationResult {
    return {
      state: 'accepted',
      stop: 'applied',
      errors: [],
      accepted: WORK,
      ...overrides,
    };
  }

  it('reads a promotion as an apply that changed something', () => {
    const outcome = settledOutcome(result({ stop: 'applied' }));

    assert.equal(outcome.kind, 'apply');
    assert.equal(stopForOutcome(outcome), 'applied');
    assert.equal(workOf(outcome)?.revision, 'r1');
  });

  it('reads a run with nothing to do as an apply that changed nothing', () => {
    const outcome = settledOutcome(result({ stop: 'no-changes' }));

    // Still an apply: the run worked and the project is what it produced.
    // Calling it a discard would report a working run as a thrown-away one.
    assert.equal(outcome.kind, 'apply');
    assert.equal(stopForOutcome(outcome), 'no-changes');
  });

  it('reads held work as a retain, from what was staged', () => {
    const outcome = settledOutcome(
      result({ stop: 'retained', accepted: undefined, staged: WORK }),
    );

    assert.equal(outcome.kind, 'retain');
    assert.equal(outcomeApplies(outcome), false);
  });

  it('reads every failure as a discard that keeps its stop', () => {
    // Flattened to one outcome, and not to one reason: a validation failure
    // and a model refusal are both discards and are not the same news.
    for (const stop of [
      'validation-failed',
      'model-refused',
      'conflict',
    ] as const) {
      const outcome = settledOutcome(result({ state: 'failed', stop }));
      assert.equal(outcome.kind, 'discard');
      assert.equal(stopForOutcome(outcome), stop);
      assert.equal(workOf(outcome), null);
    }
  });

  it('refuses a run that applied something it does not have', () => {
    assert.throws(
      () => settledOutcome(result({ accepted: undefined, staged: undefined })),
      /no snapshot/,
    );
  });

  it('refuses to invent the question a run claims to have asked', () => {
    // A result has no channel to carry one, so inferring an ask from the
    // stop would make up its text. The producer that can ask builds the
    // ask itself.
    assert.throws(
      () => settledOutcome(result({ stop: 'awaiting-answer' })),
      /question/,
    );
  });
});
