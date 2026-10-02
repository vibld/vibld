import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  DRAFT_MOCKUP_JSON_INSTRUCTION,
  DRAFT_MOCKUP_STYLE_PREAMBLE,
  DRAFT_MOCKUP_SYSTEM_PROMPT,
  GROUP_SYSTEM_PROMPT,
  MAX_CHOSEN_MOCKUP_CHARS,
  OUTLINE_SYSTEM_PROMPT,
  MAX_MOCKUP_LABEL_CHARS,
  MOCKUP_STYLE_PREAMBLE,
  MOCKUP_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  STYLE_PRESETS,
  buildUserPrompt,
  chosenMockupSection,
  mediaSection,
  styleDirection,
} from '@vibld/ai';
import {
  BUILD_INPUT_CHARS,
  MOCKUP_INPUT_CHARS,
} from '../worker/run-ceiling.ts';
import {
  MAX_BUILD_FIXED_PROMPT_CHARS,
  MAX_CHOSEN_MOCKUP_SECTION_CHARS,
  MAX_MEDIA_ENTRIES,
  MAX_MEDIA_SECTION_CHARS,
  MAX_REFERENCE_CHARS,
} from '@vibld/ai/limits';
import {
  parseStyleGallery,
  styleGalleryGuidance,
} from '@vibld/ai/style-gallery';
import { DEFAULT_LIMITS } from '../worker/request-guard.ts';

const STYLE_GALLERY_FILE = new URL(
  '../../../packages/ai/data/style-gallery.json',
  import.meta.url,
);

/** Each gallery style's guidance (D146), as a build in it is told. */
function galleryGuidances(): string[] {
  if (!existsSync(STYLE_GALLERY_FILE)) return [];
  const catalog = parseStyleGallery(readFileSync(STYLE_GALLERY_FILE, 'utf8'));
  return catalog.entries.map((entry) =>
    styleGalleryGuidance(catalog.baseline_rules_markdown, entry),
  );
}

/**
 * What a mockup run reserves against what it actually sends (internal PR 189 review).
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

  it('covers a draft, which is reserved as a look is', () => {
    // The draft a build shows while it runs (docs/decisions.md, 2026-09-28)
    // goes through the same route and the same reservation, so its own
    // text has to fit the same figure. The output instruction is counted
    // because DeepSeek appends it to the system message.
    const longestDirection = Math.max(
      ...STYLE_PRESETS.map((preset) => styleDirection(preset.id)?.length ?? 0),
    );
    const sent =
      DEFAULT_LIMITS.maxPromptChars +
      longestDirection +
      DRAFT_MOCKUP_STYLE_PREAMBLE.length +
      DRAFT_MOCKUP_SYSTEM_PROMPT.length +
      DRAFT_MOCKUP_JSON_INSTRUCTION.length;
    assert.ok(
      MOCKUP_INPUT_CHARS >= sent,
      `reserves ${MOCKUP_INPUT_CHARS} characters of input for a draft that can send ${sent}`,
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

/**
 * What a build reserves for a chosen direction (internal PR 189 review).
 *
 * Here rather than in `packages/ai` for the reason the suite above exists:
 * a mutation dropped the whole-section term from the Worker's own sum and
 * broke nothing, because the only assertion about it was on the constant.
 */
describe('what a build reserves for a chosen direction', () => {
  /**
   * Everything a build sends that is not the chosen direction.
   *
   * The reference budget belongs in here, and the first version of this
   * test left it out (internal PR 189 review). That made the assertion pass with the
   * bug reintroduced: `MAX_REFERENCE_CHARS` is 6,000, which is more than
   * enough to absorb the 500-odd characters of label and framing the old
   * sum was missing. A test that borrows another term's headroom is not
   * measuring the term it names.
   */
  const OTHER_TERMS =
    DEFAULT_LIMITS.maxPromptChars +
    DEFAULT_LIMITS.maxTotalContentChars +
    DEFAULT_LIMITS.maxKnowledgeChars +
    MAX_REFERENCE_CHARS +
    // The fixed prompt text has its own term and its own test below. Left
    // out here, its 32,000 characters would absorb any shortfall in the
    // section's, which is exactly the borrowed headroom described above.
    MAX_BUILD_FIXED_PROMPT_CHARS +
    MAX_MEDIA_SECTION_CHARS;

  /** A document at the cap whose CSS gives `measureMockup` the most to say. */
  function cssHeavyDocument(): string {
    // Built up to the cap and closed, rather than built long and sliced:
    // a slice cuts off `</style>`, and an unclosed style block measures as
    // nothing, which is how the first version of this passed a mutation
    // that shrank the bound back.
    let rules = '';
    for (let at = 0; ; at += 1) {
      const next = `--t${at}:rgba(${at % 255},10,18,.57);.c${at}{font-size:${at}px;border-radius:${at}px;backdrop-filter:blur(${at}px)}`;
      if (
        `<style>:root{${rules}${next}}</style>`.length > MAX_CHOSEN_MOCKUP_CHARS
      )
        break;
      rules += next;
    }
    return `<style>:root{${rules}}</style>`;
  }

  it('covers the whole section, not only the document', () => {
    const section = Math.max(
      chosenMockupSection(
        'x'.repeat(MAX_MOCKUP_LABEL_CHARS),
        'y'.repeat(MAX_CHOSEN_MOCKUP_CHARS),
      ).length,
      // The values measured from the document travel in the section too.
      chosenMockupSection(
        'x'.repeat(MAX_MOCKUP_LABEL_CHARS),
        cssHeavyDocument(),
      ).length,
    );
    assert.ok(
      BUILD_INPUT_CHARS - OTHER_TERMS >= section,
      `only ${BUILD_INPUT_CHARS - OTHER_TERMS} characters are left for a ${section}-character section`,
    );
  });

  it('reserves more than the document by itself', () => {
    // The finding as an assertion: the old sum used MAX_CHOSEN_MOCKUP_CHARS
    // here, so this difference was exactly zero.
    assert.ok(
      BUILD_INPUT_CHARS - OTHER_TERMS > MAX_CHOSEN_MOCKUP_CHARS,
      'the build reserves nothing for the label or the framing',
    );
  });
});

/**
 * What a build reserves for the text nobody typed.
 *
 * The system prompt and the guidance `buildUserPrompt` retrieves went to
 * the model on every build and were never in the reservation. The spec made
 * the system prompt longer, which is what surfaced it. Measured here the
 * way the mockup route's fixed text is: the real artefacts, the largest
 * guidance any preset (or none) produces for a request that names every
 * catalogue's keywords, and every other term of the sum subtracted first.
 */
describe('what a build reserves for its own prompt text', () => {
  const EVERY_OTHER_TERM =
    DEFAULT_LIMITS.maxPromptChars +
    DEFAULT_LIMITS.maxTotalContentChars +
    DEFAULT_LIMITS.maxKnowledgeChars +
    MAX_REFERENCE_CHARS +
    MAX_CHOSEN_MOCKUP_SECTION_CHARS +
    MAX_MEDIA_SECTION_CHARS;

  // A request that trips as many retrieval keywords as possible, so the
  // guidance measured is the most any request is likely to pull in.
  const KITCHEN_SINK = [
    'landing page saas dashboard pricing hero testimonial faq signup waitlist',
    'blog portfolio ecommerce shop checkout restaurant menu booking agency',
    'conference schedule speakers docs changelog modal drawer dropdown tooltip',
    'accordion carousel tabs animation scroll parallax stagger aurora gradient',
    'mesh grain glass glassmorphism noise blob diagram flowchart architecture',
    'sequence timeline chart select combobox dialog popover security fintech',
    'health wellness education nonprofit game music photography travel',
    'real estate legal crypto ai video hero cinematic editorial',
  ].join(' ');

  // A gallery style's guidance (D146) stands in for a preset's and is
  // longer: the gallery's baseline rules plus the style's build prompt.
  const GALLERY = galleryGuidances();

  function largestFixedText(): number {
    const guidance = Math.max(
      ...[null, ...STYLE_PRESETS.map((preset) => preset.id)].map(
        (style) =>
          buildUserPrompt({ prompt: KITCHEN_SINK }, style).length -
          KITCHEN_SINK.length,
      ),
      ...GALLERY.map(
        (gallery) =>
          buildUserPrompt(
            { prompt: KITCHEN_SINK },
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            gallery,
          ).length - KITCHEN_SINK.length,
      ),
    );
    // Whichever system prompt is longest: the single-response one, or
    // either step of a bounded build, each of which sends the guidance too.
    return (
      Math.max(
        PLAN_SYSTEM_PROMPT.length,
        OUTLINE_SYSTEM_PROMPT.length,
        GROUP_SYSTEM_PROMPT.length,
      ) + guidance
    );
  }

  it('covers the system prompt and the largest guidance', () => {
    const fixed = largestFixedText();
    assert.ok(
      BUILD_INPUT_CHARS - EVERY_OTHER_TERM >= fixed,
      `only ${BUILD_INPUT_CHARS - EVERY_OTHER_TERM} characters are left for ${fixed} characters of prompt text`,
    );
  });

  it('tracks the real text rather than hiding it under a round number', () => {
    assert.ok(
      MAX_BUILD_FIXED_PROMPT_CHARS <= largestFixedText() * 2,
      'the bound has drifted far above what a build sends',
    );
  });
});

/**
 * What a build reserves for the caller's media library: every file the
 * account may hold, each with the longest path, a poster, and alt text that
 * JSON escaping doubles.
 */
describe('what a build reserves for the media library', () => {
  function largestMediaSection(): number {
    const stem = 'a'.repeat(48);
    return mediaSection(
      Array.from({ length: MAX_MEDIA_ENTRIES + 5 }, (_, at) => ({
        path: `media/${stem}-${at}.webm`,
        kind: 'video' as const,
        posterPath: `media/${stem}-${at}-poster.avif`,
        alt: '"'.repeat(300),
      })),
    )!.length;
  }

  it('covers the largest library a build can list', () => {
    const everyOther =
      DEFAULT_LIMITS.maxPromptChars +
      DEFAULT_LIMITS.maxTotalContentChars +
      DEFAULT_LIMITS.maxKnowledgeChars +
      MAX_REFERENCE_CHARS +
      MAX_CHOSEN_MOCKUP_SECTION_CHARS +
      MAX_BUILD_FIXED_PROMPT_CHARS;
    const largest = largestMediaSection();
    assert.ok(
      BUILD_INPUT_CHARS - everyOther >= largest,
      `only ${BUILD_INPUT_CHARS - everyOther} characters are left for a ${largest}-character media section`,
    );
  });

  it('tracks the real section rather than hiding it under a round number', () => {
    assert.ok(MAX_MEDIA_SECTION_CHARS <= largestMediaSection() * 2);
  });
});
