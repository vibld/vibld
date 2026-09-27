import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARS_PER_OUTPUT_TOKEN,
  LARGEST_OBSERVED_ANSWER_SHARE,
  outputTokensToCarry,
  outputTokensToRewrite,
} from '../src/limits.ts';

/**
 * The estimate a truncated follow-up is explained with, pinned to the live
 * numbers it was written for.
 *
 * The figure that matters is the one a person reads after a run of theirs
 * was cut off: 63,903 characters needed roughly this much room, and the run
 * had 32,000. It decides nothing, so these tests are about it staying a
 * faithful description rather than about any threshold holding.
 */
describe('outputTokensToRewrite', () => {
  it('describes the live failure as having wanted more than it had', () => {
    // The project stored for the run of 2026-09-23 and the ceiling the
    // dollar reserve bought on a model priced at 50 micro-USD a token.
    const needed = outputTokensToRewrite(63903);

    assert.equal(needed, 37154);
    assert.ok(
      needed > 32000,
      'the explanation would tell that run it had room to spare',
    );
  });

  it('counts the project itself and then the thinking around it', () => {
    // Two steps, asserted separately, because they fail for different
    // reasons: one is how many tokens the files are, the other is how much
    // of a run's output never reaches the files.
    const files = 4000;
    const chars = files * CHARS_PER_OUTPUT_TOKEN;

    assert.equal(
      outputTokensToRewrite(chars),
      Math.ceil(files / LARGEST_OBSERVED_ANSWER_SHARE),
    );
    assert.ok(
      outputTokensToRewrite(chars) > files,
      'the estimate left no room for reasoning at all',
    );
  });

  it('asks for nothing when there is no project to rewrite', () => {
    assert.equal(outputTokensToRewrite(0), 0);
    // A first run has no base at all, and a negative size is nobody's
    // project. Neither may produce a demand a ceiling could fail.
    assert.equal(outputTokensToRewrite(-1), 0);
  });

  it('uses the favourable end of the measured range, not the far end', () => {
    // The finding this was corrected for (internal PR 208 review). Thinking was
    // measured between 57% and 68% of the output, so the answer was between
    // 32% and 43%. Taking the 32 would overstate what a run needed, which
    // read as caution while it drove a refusal and reads as exaggeration
    // now that it explains one.
    const needed = outputTokensToRewrite(48000);
    const files = Math.ceil(48000 / CHARS_PER_OUTPUT_TOKEN);

    assert.ok(
      needed <= Math.ceil(files / 0.43),
      'the refusal is sized past the most favourable share ever measured',
    );
    assert.ok(
      needed < Math.ceil(files / 0.32),
      'the refusal is sized by the least favourable share instead',
    );
    // The case from the review: a project this size is described as
    // fitting a 32,000-token ceiling, because it does.
    assert.ok(needed <= 32000, 'a project that fits is described as too big');
  });

  it('never asks for less of a larger project', () => {
    let previous = -1;
    for (const chars of [0, 1, 4, 100, 10_000, 63_903, 160_000]) {
      const needed = outputTokensToRewrite(chars);
      assert.ok(
        needed >= previous,
        `${chars} characters needs fewer tokens than a smaller project`,
      );
      previous = needed;
    }
  });
});

describe('outputTokensToCarry', () => {
  it('sizes the live project at the unfavourable end of the range', () => {
    // 15,976 tokens of files at a 32% answer share. The run that truncated
    // needed about this much room just to carry its project.
    assert.equal(outputTokensToCarry(63903), 49925);
  });

  it('never reserves less than the explanation says a run needed', () => {
    // The two ends of one measurement, used in opposite directions (internal PR 210
    // review). If sizing ever came out smaller than explaining, a run could
    // be refused room it would later be told it needed.
    for (const chars of [0, 1, 4, 100, 10_000, 63_903, 160_000]) {
      assert.ok(
        outputTokensToCarry(chars) >= outputTokensToRewrite(chars),
        `${chars} characters: sized below what it is explained as needing`,
      );
    }
  });

  it('carries nothing when there is no project', () => {
    assert.equal(outputTokensToCarry(0), 0);
    assert.equal(outputTokensToCarry(-1), 0);
  });
});
