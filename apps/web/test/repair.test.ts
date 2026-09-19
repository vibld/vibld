import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { repairPromptFor, worthRepairing } from '../worker/generation-run.ts';

/**
 * When a project that will not build is worth a second model call (#194).
 *
 * Two of six real generations against the production provider produced a
 * project that fails `npm run build`, for two unrelated reasons, with the
 * same prompt passing on one run and failing on another. A repair turn is
 * the answer Chris chose, and it costs a second generation's tokens, so
 * every path that reaches one has to be a path where the project really is
 * broken and the caller really can pay.
 */

/** A run admitted with an allowance, which is every run since #194. */
const FUNDED = { monthlyAllowance: 1_000_000, topupCeiling: 0 };

describe('whether a failed build buys a repair', () => {
  it('repairs what the compiler and the installer refused', () => {
    for (const reason of ['install', 'build']) {
      assert.equal(worthRepairing({ ok: false, reason }, FUNDED), true, reason);
    }
  });

  it('never repairs a sandbox that was merely busy', () => {
    // The refusal is issued before the build starts, because a preview is
    // already running for the project. Nothing about the code is
    // implicated, and repairing would spend real tokens on a project that
    // compiles perfectly well.
    assert.equal(worthRepairing({ ok: false, reason: 'busy' }, FUNDED), false);
  });

  it('never repairs this deployment having a bad day', () => {
    for (const reason of ['output', 'sandbox']) {
      assert.equal(
        worthRepairing({ ok: false, reason }, FUNDED),
        false,
        reason,
      );
    }
  });

  it('treats an unreadable reason as no evidence', () => {
    // `publish-client.ts` drops a reason it does not recognise rather than
    // guessing. "I could not read why this failed" must not become "the
    // project is broken, spend a generation on it".
    assert.equal(worthRepairing({ ok: false }, FUNDED), false);
    assert.equal(
      worthRepairing({ ok: false, reason: 'something-new' }, FUNDED),
      false,
    );
  });

  it('does not repair a build that succeeded', () => {
    assert.equal(worthRepairing({ ok: true }, FUNDED), false);
  });

  it('does not repair a run that cannot say what its caller may spend', () => {
    // A payload persisted before these fields existed. Guessing an
    // allowance here would reserve against a ceiling nobody set.
    assert.equal(worthRepairing({ ok: false, reason: 'build' }, {}), false);
    assert.equal(
      worthRepairing(
        { ok: false, reason: 'build' },
        { monthlyAllowance: 1_000_000 },
      ),
      false,
      'a half-carried payload still has no top-up figure',
    );
  });

  it('counts a zero allowance as a figure, not as absence', () => {
    // Somebody on a spent allowance with no credit still has both numbers.
    // Reading zero as "not carried" would skip the reservation that is
    // supposed to refuse them, and the ledger is what says no, not this.
    assert.equal(
      worthRepairing(
        { ok: false, reason: 'build' },
        { monthlyAllowance: 0, topupCeiling: 0 },
      ),
      true,
    );
  });
});

describe('what the model is asked to fix', () => {
  it('quotes the build output verbatim', () => {
    // The whole reason this is worth a paid call is that the error names
    // the file and the line. A summary throws away the fixable part.
    const said =
      "src/App.tsx(3,10): error TS1484: 'ReactNode' is a type and must be imported using a type-only import";
    assert.ok(repairPromptFor(said).includes(said));
  });

  it('asks for a fix rather than a rewrite', () => {
    // Left to itself a model asked to "fix the build" rewrites the
    // project. The reader asked for the project, not a second draft.
    // Whitespace normalised: where the prompt happens to wrap is a
    // formatting detail, and a test that breaks on re-wrapping is testing
    // the line width rather than the instruction.
    const prompt = repairPromptFor('boom').replace(/\s+/g, ' ');
    assert.match(prompt, /change nothing else/i);
    assert.match(prompt, /do not rename or reorganise/i);
  });
});
