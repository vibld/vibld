import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MOCKUP_STYLE_PREAMBLE,
  MOCKUP_SYSTEM_PROMPT,
  STYLE_PRESETS,
  styleDirection,
} from '@vibld/ai';
import { MOCKUP_INPUT_CHARS } from '../worker/run-ceiling.ts';
import { DEFAULT_LIMITS } from '../worker/request-guard.ts';

/**
 * What a mockup run reserves against what it actually sends (#189 review).
 *
 * This file exists because the fix without it did nothing measurable.
 * `MAX_MOCKUP_FIXED_PROMPT_CHARS` was added, `packages/ai` pinned the
 * prompt under it, and the Worker was changed to add it in -- and removing
 * that last part again broke no test, because every assertion lived one
 * layer away from the thing that had been wrong. A mutation said so.
 *
 * So the assertion here is against the artefacts rather than against the
 * arithmetic: measure everything a run really sends, and fail if the bound
 * the reservation uses does not cover it. Drop any term and this fails.
 */
describe('what a mockup run reserves', () => {
  /** Everything the provider puts in front of the model, measured. */
  function longestRequestChars(): number {
    const longestDirection = Math.max(
      ...STYLE_PRESETS.map((preset) => styleDirection(preset.id)?.length ?? 0),
    );
    return (
      // What the caller may type, which the request guard enforces.
      DEFAULT_LIMITS.maxPromptChars +
      // What a chosen preset adds, and the sentence wrapping it.
      longestDirection +
      MOCKUP_STYLE_PREAMBLE.length +
      // What goes on every run whether or not anyone chose anything.
      MOCKUP_SYSTEM_PROMPT.length
    );
  }

  it('covers everything the provider actually sends', () => {
    const sent = longestRequestChars();
    assert.ok(
      MOCKUP_INPUT_CHARS >= sent,
      `reserves ${MOCKUP_INPUT_CHARS} characters of input for a run that can send ${sent}`,
    );
  });

  // There was a third test here, asserting that the bound minus the
  // caller's half still covered the fixed prompt text. It is gone because
  // it survived the mutation that reintroduces the bug: the direction bound
  // alone is larger than the fixed text, so it passed while claiming in its
  // name to be checking the finding. A test that overclaims is worse than
  // no test, and this PR is largely about claims that outran their code.

  it('is not merely generous, which would hide the same bug', () => {
    // A bound ten times what is sent would pass the tests above while
    // saying nothing, and would over-reserve every caller's allowance. The
    // point is that it tracks the real figures, so it stays close to them.
    assert.ok(
      MOCKUP_INPUT_CHARS <= longestRequestChars() * 2,
      'the bound has drifted far above what a run can send',
    );
  });
});
