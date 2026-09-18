import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_MOCKUP_LABEL_CHARS,
  MOCKUP_STYLE_PREAMBLE,
  MOCKUP_SYSTEM_PROMPT,
  MockupSetSchema,
} from '../src/mockup-schema.ts';
import { MAX_MOCKUP_FIXED_PROMPT_CHARS } from '../src/limits.ts';
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

  it('refuses a direction too large for the build to accept back', () => {
    // The two numbers have to agree. A run that offers a direction its own
    // build route would refuse spends the money and then takes the choice
    // away, which is the worst moment to find out.
    const parsed = MockupSetSchema.safeParse({
      mockups: [
        mockup(),
        mockup(),
        mockup({ html: 'x'.repeat(MAX_CHOSEN_MOCKUP_CHARS + 1) }),
      ],
    });
    assert.equal(parsed.success, false);
  });

  it("accepts one exactly at the build's limit", () => {
    const parsed = MockupSetSchema.safeParse({
      mockups: [
        mockup(),
        mockup(),
        mockup({ html: 'x'.repeat(MAX_CHOSEN_MOCKUP_CHARS) }),
      ],
    });
    assert.equal(parsed.success, true);
  });

  it('refuses a document that is only whitespace', () => {
    // `.min(1)` counts spaces and `parseChosenMockup` does not (#189
    // review). A whitespace document renders as a blank tile, reads as a
    // direction that failed, and is then refused on the way back -- the
    // paid-run-then-unbuildable failure again, in a different disguise.
    for (const html of [' ', '\n\n', '\t  \n']) {
      const parsed = MockupSetSchema.safeParse({
        mockups: [mockup(), mockup(), mockup({ html })],
      });
      assert.equal(
        parsed.success,
        false,
        `accepted a document of ${JSON.stringify(html)}`,
      );
    }
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

/**
 * What the reservation has to cover but the caller never sends (#189
 * review).
 *
 * `MAX_MOCKUP_FIXED_PROMPT_CHARS` is documentation of a contract, like the
 * direction bound above, and worth exactly as much as the walk that checks
 * it. The worst case bounded what a caller could type and reserved as
 * though that were the whole prompt; it is not, by about 1,600 characters
 * of text written in this repository.
 */
describe('what every mockup run sends regardless of who asked', () => {
  it('keeps the fixed prompt text inside the bound the reservation uses', () => {
    const fixed = MOCKUP_SYSTEM_PROMPT.length + MOCKUP_STYLE_PREAMBLE.length;
    assert.ok(
      fixed <= MAX_MOCKUP_FIXED_PROMPT_CHARS,
      `fixed prompt text is ${fixed} chars, past the reserved ${MAX_MOCKUP_FIXED_PROMPT_CHARS}`,
    );
  });

  it('still says what it needs to say', () => {
    // The bound must not be met by gutting the prompt: the preamble is what
    // keeps a styled run varying within its direction rather than against
    // it, and it is now counted rather than invisible.
    assert.match(MOCKUP_STYLE_PREAMBLE, /within this visual direction/);
  });
});

/**
 * A label of whitespace, which is the `html` finding in a second field.
 *
 * `parseChosenMockup` requires `label.trim().length > 0`. I fixed `html`
 * when it was found and did not ask which other field had the same shape,
 * so the same paid-run-then-unbuildable failure was still reachable through
 * a nameless tile (#189 review).
 */
describe('what a direction must be called', () => {
  it('refuses a label that is only whitespace', () => {
    for (const label of [' ', '\n', '\t  ']) {
      const parsed = MockupSetSchema.safeParse({
        mockups: [mockup(), mockup(), mockup({ label })],
      });
      assert.equal(
        parsed.success,
        false,
        `accepted a label of ${JSON.stringify(label)}`,
      );
    }
  });

  it('refuses a rationale that is only whitespace', () => {
    const parsed = MockupSetSchema.safeParse({
      mockups: [mockup(), mockup(), mockup({ rationale: '   ' })],
    });
    assert.equal(parsed.success, false);
  });

  it('bounds the label at the figure the build reads back', () => {
    // One constant now, rather than two that happened to agree.
    const parsed = MockupSetSchema.safeParse({
      mockups: [
        mockup(),
        mockup(),
        mockup({ label: 'x'.repeat(MAX_MOCKUP_LABEL_CHARS + 1) }),
      ],
    });
    assert.equal(parsed.success, false);
  });
});
