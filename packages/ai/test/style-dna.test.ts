import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STYLE_DIMENSIONS,
  encodeStyleDna,
  findDimension,
  sanitizeStyleDna,
  styleDnaGuidance,
} from '../src/style-dna.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

describe('the style dimensions', () => {
  it('has distinct ids, and distinct values within each dimension', () => {
    const ids = STYLE_DIMENSIONS.map((dimension) => dimension.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const dimension of STYLE_DIMENSIONS) {
      const values = dimension.options.map((option) => option.value);
      assert.equal(new Set(values).size, values.length, dimension.id);
      assert.ok(values.length >= 3, `${dimension.id} needs real choices`);
    }
  });

  it('gives every option a direction concrete enough to act on', () => {
    for (const dimension of STYLE_DIMENSIONS) {
      for (const option of dimension.options) {
        assert.ok(
          option.direction.length > 15,
          `${dimension.id}/${option.value} is too vague to act on`,
        );
      }
    }
  });

  it('stays small enough to send on every request', () => {
    // The whole point of this over prose is that it is short and fixed. If
    // every dimension were set, the guidance must still be a fraction of the
    // knowledge budget it deliberately does not compete with.
    const everything = Object.fromEntries(
      STYLE_DIMENSIONS.map((dimension) => [
        dimension.id,
        dimension.options[0].value,
      ]),
    );
    const guidance = styleDnaGuidance(everything);
    assert.ok(guidance);
    assert.ok(guidance.length < 1200, String(guidance.length));
    assert.ok(encodeStyleDna(everything)!.length < 250);
  });
});

describe('sanitizeStyleDna', () => {
  it('keeps what the catalogue knows', () => {
    assert.deepEqual(sanitizeStyleDna({ corners: 'sharp' }), {
      corners: 'sharp',
    });
  });

  it('drops an unknown dimension, an unknown value and a non-string', () => {
    assert.deepEqual(
      sanitizeStyleDna({
        corners: 'sharp',
        nonsense: 'sharp',
        complexity: 'nonsense',
        density: 42,
      }),
      { corners: 'sharp' },
    );
  });

  it('survives anything at all, since this runs on network input', () => {
    for (const input of [null, undefined, 'sharp', 42, [], () => {}]) {
      assert.deepEqual(sanitizeStyleDna(input), {});
    }
  });
});

describe('findDimension', () => {
  it('returns the dimension, or null', () => {
    assert.equal(findDimension('corners')?.label, 'Corners');
    assert.equal(findDimension('nope'), null);
  });
});

describe('encodeStyleDna', () => {
  it('writes one compact line in catalogue order, not insertion order', () => {
    // Stable output matters: the same selection must read the same way every
    // turn, or it is prose with extra steps.
    assert.equal(
      encodeStyleDna({ corners: 'sharp', complexity: 'minimal' }),
      'complexity: minimal | corners: sharp',
    );
  });

  it('is null when nothing is set', () => {
    assert.equal(encodeStyleDna({}), null);
  });
});

describe('styleDnaGuidance', () => {
  it('is null when nothing is set', () => {
    assert.equal(styleDnaGuidance({}), null);
  });

  it('expands to the direction, not the bare value', () => {
    // A model given only a label invents its own reading of it. That is the
    // failure style-presets.ts documents, and the reason the direction text
    // exists at all.
    const guidance = styleDnaGuidance({ corners: 'sharp' });
    assert.ok(guidance);
    assert.match(guidance, /radius at or near zero/);
  });

  it('subordinates itself to the request', () => {
    const guidance = styleDnaGuidance({ motion: 'still' });
    assert.ok(guidance);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with standing preferences', () => {
  it('appends them', () => {
    const composed = buildUserPrompt(
      { prompt: 'Update the header copy' },
      null,
      null,
      null,
      { corners: 'sharp' },
    );
    assert.match(composed, /radius at or near zero/);
  });

  it('appends nothing when none are set', () => {
    assert.equal(
      buildUserPrompt(
        { prompt: 'Update the header copy' },
        null,
        null,
        null,
        {},
      ),
      'Update the header copy',
    );
  });
});
