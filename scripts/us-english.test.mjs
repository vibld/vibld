import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { convert, toUsEnglish, ukWords } from './us-english.mjs';

describe('US English in what people read (D120)', () => {
  it('spells words the US way, keeping their case', () => {
    assert.equal(
      toUsEnglish('Colours and behaviour; the CENTRE, organised and grey.'),
      'Colors and behavior; the CENTER, organized and gray.',
    );
    assert.equal(
      toUsEnglish('a colour-coded catalogue, cancelled whilst travelling'),
      'a color-coded catalog, canceled while traveling',
    );
  });

  it('leaves words that are right in both alone', () => {
    for (const word of [
      'advertise',
      'promise',
      'analyses',
      'cancellation',
      'license',
      'licensed',
      'toward',
      'dialogue',
      'Alegreya',
    ]) {
      assert.equal(toUsEnglish(word), word, word);
    }
  });

  it('keeps a proper noun its owner spells the UK way', () => {
    assert.equal(
      toUsEnglish('the Ubuntu Font Licence 1.0, a licence'),
      'the Ubuntu Font Licence 1.0, a license',
    );
  });

  it('changes what people read in code, not what code reads', () => {
    const cases = [
      // A status stored in D1, compared, and inside SQL.
      [
        `if (s === 'cancelled') return 'Run cancelled.';`,
        `if (s === 'cancelled') return 'Run canceled.';`,
      ],
      [
        `db.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?");`,
        `db.prepare("UPDATE runs SET status = 'cancelled' WHERE id = ?");`,
      ],
      // A route in a template literal, and an object key.
      [
        'const u = `${origin}/billing/cancelled`;',
        'const u = `${origin}/billing/cancelled`;',
      ],
      [
        `const labels = { colour: 'Pick a colour' };`,
        `const labels = { colour: 'Pick a color' };`,
      ],
      // A one-word label or message is read (Codex review of internal PR 336); the
      // lower-case status beside it is not.
      [
        `const labels = { cancelled: 'Cancelled' }; const m = 'Cancelled.';`,
        `const labels = { cancelled: 'Canceled' }; const m = 'Canceled.';`,
      ],
      [
        `const v = ['cancelled', 'grey-100', 'CANCELLED'];`,
        `const v = ['cancelled', 'grey-100', 'CANCELLED'];`,
      ],
      // Identifiers and comments.
      [
        `// the colour pass\nfunction normaliseColour(colour) { return colour; }`,
        `// the colour pass\nfunction normaliseColour(colour) { return colour; }`,
      ],
      // A quoted value inside prose.
      [
        `const hint = "Set status to 'cancelled' to stop the colour run.";`,
        `const hint = "Set status to 'cancelled' to stop the color run.";`,
      ],
    ];
    for (const [before, after] of cases) {
      assert.equal(convert(before, 'x.ts'), after, before);
    }
  });

  it('changes JSX text and the attributes people read, not class names', () => {
    assert.equal(
      convert(
        '<p className="bg-grey-100" title="A grey swatch">Colour</p>',
        'x.tsx',
      ),
      '<p className="bg-grey-100" title="A gray swatch">Color</p>',
    );
  });

  it("reads a component's own text props, such as lede and eyebrow", () => {
    // Missed at first: only a fixed list of HTML attributes was read, so
    // `lede="...colours..."` on a section heading went unchecked.
    assert.equal(
      convert(
        '<Section eyebrow="Changing or cancelling" lede="Its colours and type." className="grey card" />',
        'x.tsx',
      ),
      '<Section eyebrow="Changing or canceling" lede="Its colors and type." className="grey card" />',
    );
  });

  it('changes Markdown prose, not code or link targets', () => {
    assert.equal(
      convert(
        'The colour of [the licence](docs/licence.md) is `grey`.\n\n```\ncolour: grey\n```\n',
        'x.md',
      ),
      'The color of [the license](docs/licence.md) is `grey`.\n\n```\ncolour: grey\n```\n',
    );
  });

  it('changes HTML text, not styles or attributes', () => {
    assert.equal(
      convert(
        '<style>.grey { color: grey }</style><p class="grey">Grey colours</p>',
        'x.html',
      ),
      '<style>.grey { color: grey }</style><p class="grey">Gray colors</p>',
    );
  });

  it('finds what it would change', () => {
    assert.deepEqual(ukWords('colour, favourite, centre'), [
      'colour',
      'favourite',
      'centre',
    ]);
  });
});
