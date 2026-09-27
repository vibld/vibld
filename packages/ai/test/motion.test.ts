import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MOTION_RECIPES,
  findMotionRecipe,
  motionGuidance,
  selectMotion,
} from '../src/motion.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';
import { PLAN_SYSTEM_PROMPT } from '../src/plan-schema.ts';

describe('the motion catalogue', () => {
  it('has distinct ids and real triggers', () => {
    const ids = MOTION_RECIPES.map((recipe) => recipe.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const recipe of MOTION_RECIPES) {
      assert.ok(recipe.triggers.length > 0, `${recipe.id} needs a trigger`);
      assert.ok(
        recipe.guidance.length > 80,
        `${recipe.id} needs real guidance`,
      );
    }
  });

  it('keeps every trigger lowercase, since matching lowercases the request', () => {
    for (const recipe of MOTION_RECIPES) {
      for (const trigger of recipe.triggers) {
        assert.equal(
          trigger,
          trigger.toLowerCase(),
          `${recipe.id}: ${trigger}`,
        );
      }
    }
  });

  it('names no animation library but the one STACK declares', () => {
    // Motion is the package; framer-motion is its old name, and GSAP and
    // Lottie are not in the stack.
    for (const recipe of MOTION_RECIPES) {
      for (const banned of ['gsap', 'framer-motion', 'lottie']) {
        assert.ok(
          !recipe.guidance.toLowerCase().includes(banned),
          `${recipe.id} must not name ${banned}`,
        );
      }
    }
  });
});

describe('selectMotion', () => {
  it('matches a request that names a component directly', () => {
    assert.equal(
      selectMotion('Add a bottom sheet for filters')[0]?.id,
      'drawer',
    );
    assert.equal(
      selectMotion('A pricing page with a tooltip')[0]?.id,
      'overlay',
    );
  });

  it('returns nothing for a request that names no motion at all', () => {
    assert.deepEqual(selectMotion('A page about our history'), []);
  });

  it('is case-insensitive', () => {
    assert.equal(selectMotion('Add a MODAL')[0]?.id, 'modal');
  });

  it('caps how much it returns, so the prompt cannot balloon', () => {
    const many = 'a modal, a drawer, a toast, a tooltip and an accordion';
    assert.equal(selectMotion(many).length, 2);
    assert.equal(selectMotion(many, 4).length, 4);
  });
});

describe('findMotionRecipe', () => {
  it('returns the recipe, or null for anything unknown', () => {
    assert.equal(
      findMotionRecipe('drawer')?.name,
      'Drawer, sheet or side panel',
    );
    assert.equal(findMotionRecipe('nope'), null);
  });
});

describe('motionGuidance', () => {
  it('is null when nothing matched', () => {
    assert.equal(motionGuidance('A page about our history'), null);
  });

  it('subordinates itself to the request', () => {
    const guidance = motionGuidance('Add a modal');
    assert.ok(guidance);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with motion in the request', () => {
  it('appends the recipe', () => {
    const composed = buildUserPrompt({
      prompt: 'Add a bottom sheet for filters',
    });
    assert.match(composed, /cubic-bezier\(0\.32,0\.72,0,1\)/);
  });

  it('appends it even when a style preset was chosen, unlike the palette', () => {
    // Motion is technique, not taste: picking "Brutalism" does not mean the
    // drawer should stop using the drawer curve. See plan-provider.ts.
    const composed = buildUserPrompt(
      { prompt: 'Add a bottom sheet for filters' },
      'brutalism',
    );
    assert.match(composed, /cubic-bezier\(0\.32,0\.72,0,1\)/);
  });

  it('appends nothing for a request that names no motion', () => {
    const composed = buildUserPrompt({ prompt: 'Update the header copy' });
    assert.equal(composed, 'Update the header copy');
  });
});

describe('the MOTION section of the system prompt', () => {
  it('is expressive by default, through Motion (ADR-0014)', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /every page moves with intent/);
    assert.match(PLAN_SYSTEM_PROMPT, /<MotionConfig reducedMotion="user">/);
    assert.match(PLAN_SYSTEM_PROMPT, /from 'motion\/react'/);
    assert.match(PLAN_SYSTEM_PROMPT, /pointer-responsive/);
    assert.match(PLAN_SYSTEM_PROMPT, /cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  });

  it('treats reduced motion as gentler, not as off', () => {
    // The rule this replaced said "to disable it", which is the opposite of
    // what the specification and every source consulted actually ask for.
    assert.match(PLAN_SYSTEM_PROMPT, /fewer\s+and gentler, not none/);
  });

  it('says what MotionConfig does not stop', () => {
    // The design check warns about exactly this (design-checks.ts).
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /values linked to scroll or the pointer keep moving/,
    );
    assert.match(PLAN_SYSTEM_PROMPT, /motion-reduce:animate-none/);
  });

  it('states the frequency gate, which is what stops over-animation', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /many times a day/);
  });
});

describe('the copy rules in the system prompt', () => {
  it('names the structural tells, not only vocabulary', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /not-X-but-Y/);
    assert.match(PLAN_SYSTEM_PROMPT, /restates the section above it/);
  });

  it('guards against over-correcting into affectless copy', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /one flagged word is not the problem/);
  });
});

describe('the em-dash rule', () => {
  it('states it absolutely, and separately from the tells', () => {
    // A house rule (CLAUDE.md), not a pattern to weigh. The catalogue the
    // CONTENT rules are adapted from (credited in plan-schema.ts) marks its
    // dash pattern "weak alone"; that qualification does not apply here, so
    // the rule is stated above the list rather than in it.
    assert.match(PLAN_SYSTEM_PROMPT, /Never use an em-dash/);
    assert.match(PLAN_SYSTEM_PROMPT, /absolute, not a preference/);
  });

  it('does not itself contain one', () => {
    // Built rather than written literally: Prettier rewrites a \u escape
    // back to the character, which would trip the repo's own guard.
    assert.equal(
      PLAN_SYSTEM_PROMPT.includes(String.fromCharCode(0x2014)),
      false,
    );
  });
});

describe('the rest of the copy rules', () => {
  it('covers the tells beyond the first pass', () => {
    for (const tell of [
      'Borrowed authority',
      'Chatbot residue',
      'Curly quotes',
      'Shallow -ing riders',
      'Vague connection',
      'knowledge cutoff',
    ]) {
      assert.ok(PLAN_SYSTEM_PROMPT.includes(tell), tell);
    }
  });

  it('forbids inventing proof, which is the one with real consequences', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /Never invent a source, a logo, a customer\s+name, a statistic, a testimonial or a review/,
    );
  });
});

describe('the spec, and the DESIGN.md written from it', () => {
  it('asks for the spec before any file', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /the design spec \(see SPEC\), and\s+the full set of files, in that order/,
    );
    assert.match(PLAN_SYSTEM_PROMPT, /SPEC\nBefore any file, write the spec/);
  });

  it('asks for measured values, not adjectives', () => {
    // The whole point of the spec. A colour with its alpha, a clamp() for
    // display type, copy verbatim, what changes at which width, what not to
    // add, and checks a person can see.
    for (const required of [
      'rgba(2,10,18,.57)',
      'clamp()',
      'verbatim',
      'Design for 375 and\n  1440px',
      'avoid:',
      'checks:',
    ]) {
      assert.ok(PLAN_SYSTEM_PROMPT.includes(required), required);
    }
  });

  it('holds the files to the spec', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /every colour is a\s+custom property on :root with the spec's value[\s\S]*?every copy string\s+appears verbatim; every breakpoint is a responsive variant or @media at that\s+width/,
    );
  });

  it('leaves DESIGN.md to the renderer, so there is one record', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /Do\s+not write DESIGN\.md: it is written for you from the spec/,
    );
  });

  it('forbids writing the rules from a named company', () => {
    // The convention is adopted from a corpus of real brands; the corpus is
    // not. Without this line the easiest way to fill the lists is to name one.
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /never from a named company's\s+design language/,
    );
  });
});
