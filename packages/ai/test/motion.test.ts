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

  it('never recommends a motion library, which would break STACK', () => {
    for (const recipe of MOTION_RECIPES) {
      for (const banned of ['gsap', 'framer-motion', 'motion.dev', 'lottie']) {
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
    assert.match(composed, /--ease-drawer/);
  });

  it('appends it even when a style preset was chosen, unlike the palette', () => {
    // Motion is technique, not taste: picking "Brutalism" does not mean the
    // drawer should stop using the drawer curve. See plan-provider.ts.
    const composed = buildUserPrompt(
      { prompt: 'Add a bottom sheet for filters' },
      'brutalism',
    );
    assert.match(composed, /--ease-drawer/);
  });

  it('appends nothing for a request that names no motion', () => {
    const composed = buildUserPrompt({ prompt: 'Update the header copy' });
    assert.equal(composed, 'Update the header copy');
  });
});

describe('the motion baseline in the system prompt', () => {
  it('ships the three easing tokens the recipes assume are on :root', () => {
    for (const token of ['--ease-out', '--ease-in-out', '--ease-drawer']) {
      assert.ok(PLAN_SYSTEM_PROMPT.includes(token), token);
    }
    assert.match(PLAN_SYSTEM_PROMPT, /cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  });

  it('treats reduced motion as gentler, not as off', () => {
    // The rule this replaced said "to disable it", which is the opposite of
    // what the specification and every source consulted actually ask for.
    assert.match(PLAN_SYSTEM_PROMPT, /fewer and gentler, not\s+none/);
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
