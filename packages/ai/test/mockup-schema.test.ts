import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MOCKUP_SYSTEM_PROMPT, MockupSetSchema } from '../src/mockup-schema.ts';
import {
  MOCKUP_OUTPUT_TOKENS,
  mockupMaxTokensFor,
} from '../src/plan-provider.ts';
import { MODEL_CATALOGUE } from '../src/model-catalogue.ts';
import {
  MAX_CHOSEN_MOCKUP_CHARS,
  MAX_MOCKUP_DIRECTION_CHARS,
} from '../src/limits.ts';
import { STYLE_PRESETS, styleDirection } from '../src/style-presets.ts';
import { maxTokensFor } from '../src/plan-provider.ts';

/**
 * Three directions to look at before committing to a build (#185).
 */

function mockup(over: Record<string, unknown> = {}) {
  return {
    label: 'Quiet editorial',
    rationale:
      'Suits a studio that wants the work to speak before the brand does.',
    html: '<!doctype html><html><body>Hello</body></html>',
    ...over,
  };
}

describe('what a mockup set may be', () => {
  it('accepts three well-formed directions', () => {
    const parsed = MockupSetSchema.safeParse({
      mockups: [mockup(), mockup(), mockup()],
    });
    assert.equal(parsed.success, true);
  });

  it('keeps a set of two rather than discarding a paid run', () => {
    // The run is already spent by the time this parses. Two usable
    // directions is still a choice, and refusing it to enforce a number the
    // reader never sees would turn a partly-good answer into no answer and
    // a second bill.
    const parsed = MockupSetSchema.safeParse({
      mockups: [mockup(), mockup()],
    });
    assert.equal(parsed.success, true);
  });

  it('refuses a single direction, which is not a choice', () => {
    const parsed = MockupSetSchema.safeParse({ mockups: [mockup()] });
    assert.equal(parsed.success, false);
  });

  it('refuses a mockup with no document to render', () => {
    const parsed = MockupSetSchema.safeParse({
      mockups: [mockup(), mockup(), mockup({ html: '' })],
    });
    assert.equal(parsed.success, false);
  });

  it('refuses a mockup with no label to choose it by', () => {
    const parsed = MockupSetSchema.safeParse({
      mockups: [mockup(), mockup(), mockup({ label: '' })],
    });
    assert.equal(parsed.success, false);
  });
});

describe('what the mockup prompt asks for', () => {
  it('asks for difference, not for three finishes on one answer', () => {
    // The failure mode of this feature: three tasteful variations on one
    // idea, which gives the reader nothing to decide.
    assert.match(MOCKUP_SYSTEM_PROMPT, /genuinely different/);
  });

  it('forbids every network reference', () => {
    // A mockup renders in the same sandboxed frame a preview does
    // (ADR-0004). One that reached the network would render differently
    // there than in the build it is meant to predict.
    for (const banned of [
      /no external stylesheet/i,
      /no script/i,
      /no web font/i,
      /no image URL/i,
    ]) {
      assert.match(MOCKUP_SYSTEM_PROMPT, banned);
    }
  });

  it('does not carry the build prompt with it', () => {
    // A mockup ships nothing, so it does not pay for the portability and
    // convention rules a shippable project needs. Those live in
    // PLAN_SYSTEM_PROMPT and paying for them per tile would spend the
    // budget that makes this cheap.
    assert.ok(
      MOCKUP_SYSTEM_PROMPT.length < 2_000,
      'the mockup prompt has grown into a second build prompt',
    );
  });
});

describe('what three mockups may cost', () => {
  it('asks every model for far less than a build would', () => {
    for (const model of MODEL_CATALOGUE) {
      const build = maxTokensFor(model.id);
      const mockups = mockupMaxTokensFor(model.id);
      assert.ok(
        mockups < build,
        `${model.id}: mockups (${mockups}) are not cheaper than a build (${build})`,
      );
    }
  });

  it('never asks a model for more than it can emit', () => {
    for (const model of MODEL_CATALOGUE) {
      assert.ok(mockupMaxTokensFor(model.id) <= model.maxOutputTokens);
    }
  });

  it('answers for a model the catalogue does not hold', () => {
    // A test double, in practice. It still gets the sketch-sized ceiling
    // rather than a build's.
    assert.equal(mockupMaxTokensFor('not-a-real-model'), MOCKUP_OUTPUT_TOKENS);
  });
});

describe('what a mockup prompt may carry', () => {
  it('keeps every style direction inside the bound the reservation uses', () => {
    // The worst-case cost of a mockup run adds this figure in before a
    // token is spent. Nothing truncates to it -- the directions are written
    // in this repository, not supplied by a caller -- so this walk is what
    // makes it an upper bound rather than a guess that stopped being true
    // the next time somebody wrote a longer description.
    for (const preset of STYLE_PRESETS) {
      const direction = styleDirection(preset.id);
      assert.ok(direction, `${preset.id} has no direction to send`);
      assert.ok(
        direction.length <= MAX_MOCKUP_DIRECTION_CHARS,
        `${preset.id}: ${direction.length} chars exceeds the ${MAX_MOCKUP_DIRECTION_CHARS} the reservation covers`,
      );
    }
  });
});

describe('carrying a chosen direction into the build', () => {
  it('can carry a mockup as large as this system can produce', () => {
    // The cap is derived from the mockup budget rather than picked: three
    // mockups share MOCKUP_OUTPUT_TOKENS, so one is at most a third of it,
    // at roughly four characters a token. A number chosen by eye would
    // either refuse a mockup this system itself produced, or promise to
    // carry one larger than it can make.
    const largestOneMockup = Math.floor((MOCKUP_OUTPUT_TOKENS / 3) * 4);
    assert.ok(
      MAX_CHOSEN_MOCKUP_CHARS >= largestOneMockup,
      `the cap (${MAX_CHOSEN_MOCKUP_CHARS}) refuses a mockup this system can produce (${largestOneMockup})`,
    );
  });
});
