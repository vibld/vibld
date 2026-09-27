import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  answerQuestion,
  continuationRequest,
  isOpen,
  pendingFor,
} from '../src/continuation.ts';
import type { PendingQuestion } from '../src/continuation.ts';
import { discardFor } from '../src/run-disposition.ts';
import type { RunOutcome } from '../src/run-disposition.ts';
import type { ProjectSnapshot } from '../src/types.ts';

const WORK: ProjectSnapshot = {
  revision: 'r1',
  files: [{ path: 'index.html', content: '<html></html>' }],
};

const ASK: RunOutcome = {
  kind: 'ask',
  question: { id: 'q1', question: 'Which of the two logos?' },
  held: WORK,
};

function opened(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  const pending = pendingFor('run-1', 'Build a landing page', ASK);
  assert.ok(pending, 'an ask must open a question');
  return { ...pending, ...overrides };
}

describe('opening a question', () => {
  it('opens one only for a run that asked', () => {
    // Taken from the outcome rather than from a loose question, so a run
    // that retained, applied or discarded cannot have a question opened
    // against it. Those three have nothing to answer.
    assert.notEqual(pendingFor('run-1', 'p', ASK), null);
    assert.equal(
      pendingFor('run-1', 'p', { kind: 'retain', work: WORK }),
      null,
    );
    assert.equal(
      pendingFor('run-1', 'p', { kind: 'apply', work: WORK, changed: true }),
      null,
    );
    assert.equal(pendingFor('run-1', 'p', discardFor('model-refused')), null);
  });

  it('carries the held work and the original prompt', () => {
    const pending = opened();

    assert.equal(pending.held?.revision, 'r1');
    assert.equal(pending.prompt, 'Build a landing page');
    assert.equal(pending.answer, null);
    assert.equal(isOpen(pending), true);
  });
});

describe('answering', () => {
  it('starts a continuation carrying the held work and the answer', () => {
    const result = answerQuestion(opened(), 'The wordmark', 'run-2');

    assert.equal(result.started, true);
    assert.equal(result.continuation?.runId, 'run-2');
    assert.equal(result.continuation?.answeredRunId, 'run-1');
    assert.equal(result.continuation?.answer, 'The wordmark');
    assert.equal(result.continuation?.base?.revision, 'r1');
  });

  it('is not by itself an acceptance', () => {
    // The held work travels as the base the next run edits, never as
    // something the project has adopted. Answering starts work; the
    // continuation's own outcome is what may apply it.
    const result = answerQuestion(opened(), 'The wordmark', 'run-2');

    assert.equal(result.continuation?.base?.revision, WORK.revision);
    assert.equal(
      Object.hasOwn(result.continuation ?? {}, 'accepted'),
      false,
      'a continuation must not carry an acceptance',
    );
  });

  it('starts only one continuation when the answer arrives twice', () => {
    // A double click or a retried request. Two runs against the same held
    // work would be billed twice for one decision.
    const first = answerQuestion(opened(), 'The wordmark', 'run-2');
    const second = answerQuestion(first.pending, 'The wordmark', 'run-3');

    assert.equal(second.started, false);
    assert.equal(second.continuation, null);
    assert.equal(
      second.pending.continuationRunId,
      'run-2',
      'the second answer moved the record to its own run',
    );
  });

  it('does not let a different second answer start a second run', () => {
    // Changing their mind is not a way around it either: the first answer
    // already started a run, and this one arrives too late to be free.
    const first = answerQuestion(opened(), 'The wordmark', 'run-2');
    const second = answerQuestion(first.pending, 'The other one', 'run-3');

    assert.equal(second.started, false);
    assert.equal(second.pending.answer, 'The wordmark');
  });

  it('closes the question once it has been answered', () => {
    const first = answerQuestion(opened(), 'The wordmark', 'run-2');

    assert.equal(isOpen(first.pending), false);
  });

  it('is still answerable if the answer was stored and no run started', () => {
    // A crash between the two writes, or any store that persists these
    // fields separately. The question is closed by a continuation having
    // been started, not by an answer having been written down: reading the
    // answer instead strands the question for ever, answered and with
    // nothing to show for it.
    const stranded = opened({ answer: 'The wordmark' });
    assert.equal(isOpen(stranded), true);

    const result = answerQuestion(stranded, 'The wordmark', 'run-2');

    assert.equal(result.started, true);
    assert.equal(result.continuation?.runId, 'run-2');
  });

  it('refuses an empty answer rather than storing one', () => {
    // A continuation carrying no answer is a paid run that knows nothing
    // the asking run did not, and it would close the question behind it.
    for (const empty of ['', '   ', '\n']) {
      const result = answerQuestion(opened(), empty, 'run-2');
      assert.equal(result.started, false, JSON.stringify(empty));
      assert.equal(result.pending.answer, null);
      assert.equal(isOpen(result.pending), true, 'the question was closed');
    }
  });

  it('trims the answer it stores', () => {
    const result = answerQuestion(opened(), '  The wordmark \n', 'run-2');

    assert.equal(result.continuation?.answer, 'The wordmark');
  });

  it('refuses a continuation that reuses the asking run id', () => {
    // It would overwrite the asking run's own record with this one's, and
    // the run that asked is finished and recorded.
    assert.throws(
      () => answerQuestion(opened(), 'The wordmark', 'run-1'),
      /reuse/,
    );
  });

  it('refuses a continuation with no id of its own', () => {
    assert.throws(() => answerQuestion(opened(), 'The wordmark', ''), /run id/);
  });
});

describe('the continuation request', () => {
  it('repeats what was originally asked for, the question and the answer', () => {
    const result = answerQuestion(opened(), 'The wordmark', 'run-2');
    assert.ok(result.continuation);
    const request = continuationRequest(result.continuation);

    // All three, because each is useless without the others: the answer
    // alone says nothing, and dropping the original prompt loses everything
    // the answer did not settle.
    assert.match(request.prompt, /Build a landing page/);
    assert.match(request.prompt, /Which of the two logos\?/);
    assert.match(request.prompt, /The wordmark/);
  });

  it('starts from the held work', () => {
    const result = answerQuestion(opened(), 'The wordmark', 'run-2');
    assert.ok(result.continuation);

    assert.equal(continuationRequest(result.continuation).base?.revision, 'r1');
  });

  it('carries no base when the asking run had built nothing', () => {
    // An ask that arrived before anything was built. `base: undefined` is
    // what `GenerationRequest` means by "start from what the project has",
    // and a null in its place would be a snapshot with no files.
    const result = answerQuestion(
      opened({ held: null }),
      'The wordmark',
      'run-2',
    );
    assert.ok(result.continuation);

    assert.equal(continuationRequest(result.continuation).base, undefined);
  });
});
