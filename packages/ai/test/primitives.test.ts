import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PRIMITIVE_BASICS,
  PRIMITIVE_RECIPES,
  findPrimitive,
  primitiveGuidance,
  selectPrimitives,
} from '../src/primitives.ts';
import { PLAN_SYSTEM_PROMPT } from '../src/plan-schema.ts';
import { MOTION_RECIPES } from '../src/motion.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

/** Verified against the published package, not recalled. */
const PACKAGE = '@base-ui/react';
const SUBPATHS = ['dialog', 'menu', 'select', 'combobox', 'popover', 'tooltip'];

describe('the primitive catalogue', () => {
  it('has distinct ids, lowercase triggers and real guidance', () => {
    const ids = PRIMITIVE_RECIPES.map((recipe) => recipe.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const recipe of PRIMITIVE_RECIPES) {
      assert.ok(recipe.triggers.length > 0, recipe.id);
      assert.ok(recipe.guidance.length > 150, recipe.id);
      for (const trigger of recipe.triggers) {
        assert.equal(trigger, trigger.toLowerCase(), trigger);
      }
    }
  });

  it('names exactly one package, and only its real subpaths', () => {
    // A wrong import here breaks the build of every generated project that
    // hits it, which is precisely why threejs-skills was not adopted.
    const all =
      PRIMITIVE_BASICS + PRIMITIVE_RECIPES.map((r) => r.guidance).join(' ');
    const imports = [...all.matchAll(/@base-ui\/react(\/[a-z-]+)?/g)];
    assert.ok(imports.length >= 6);
    for (const match of imports) {
      const subpath = match[1];
      if (!subpath) continue;
      assert.ok(
        SUBPATHS.includes(subpath.slice(1)),
        `${subpath} is not a verified subpath`,
      );
    }
    // The predecessor package name still exists on the registry, stuck on an
    // old release candidate. Shipping it would install and then not match.
    assert.ok(!all.includes('@base-ui-components/react'));
  });

  it('pins no version, which would go stale silently', () => {
    const all =
      PRIMITIVE_BASICS + PRIMITIVE_RECIPES.map((r) => r.guidance).join(' ');
    assert.ok(!/@base-ui\/react@/.test(all));
    assert.ok(!/\b1\.\d+\.\d+\b/.test(all));
  });

  it('keeps styling with the project, which is what preserves STACK', () => {
    assert.match(PRIMITIVE_BASICS, /ships no styles/);
    assert.match(PRIMITIVE_BASICS, /src\/styles\.css/);
  });

  it('recommends no second library', () => {
    const all =
      PRIMITIVE_BASICS + PRIMITIVE_RECIPES.map((r) => r.guidance).join(' ');
    for (const other of [
      'radix',
      'headless',
      'sonner',
      'cmdk',
      'framer',
      'recharts',
      'zustand',
    ]) {
      assert.ok(!all.toLowerCase().includes(other), other);
    }
  });
});

describe('the STACK exception', () => {
  it('is stated where the rule is, so the two cannot contradict', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /STACK[\s\S]*?One exception, and only this one/,
    );
    assert.ok(PLAN_SYSTEM_PROMPT.includes(PACKAGE));
  });

  it('says why, in terms of the defect rather than of convenience', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /focus trapping/);
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /nobody testing with a mouse will\s+notice/,
    );
  });

  it('holds the line everywhere else', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /Everything else is still built by hand/);
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /No CSS framework or styled component library unless the\s+request asks for one by name/,
    );
  });

  it('does not contradict the motion recipes for the same components', () => {
    // Both fire for "modal". Motion says how it animates, primitives say what
    // to build it with; neither may tell the model to hand-roll the other's.
    for (const recipe of MOTION_RECIPES) {
      assert.ok(
        !/hand-roll|build it from divs/i.test(recipe.guidance),
        recipe.id,
      );
    }
  });
});

describe('selectPrimitives', () => {
  it('matches the controls that are dangerous hand-rolled', () => {
    assert.equal(selectPrimitives('Add a modal')[0]?.id, 'dialog');
    assert.equal(selectPrimitives('a searchable select')[0]?.id, 'combobox');
  });

  it('returns nothing for a page with no such control', () => {
    assert.deepEqual(selectPrimitives('A pricing page with three tiers'), []);
  });

  it('caps what it returns', () => {
    assert.equal(
      selectPrimitives('a modal, a dropdown, a tooltip and a combobox').length,
      2,
    );
  });
});

describe('findPrimitive', () => {
  it('returns the recipe, or null', () => {
    assert.equal(findPrimitive('combobox')?.name, 'Combobox or autocomplete');
    assert.equal(findPrimitive('nope'), null);
  });
});

describe('primitiveGuidance', () => {
  it('is null when no such control was asked for', () => {
    assert.equal(primitiveGuidance('A pricing page'), null);
  });

  it('carries the install line once, alongside the anatomy', () => {
    const guidance = primitiveGuidance('Add a modal');
    assert.ok(guidance);
    assert.equal(guidance.match(/Install @base-ui\/react/g)?.length, 1);
    assert.match(guidance, /Dialog\.Root/);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with a primitive', () => {
  it('appends it', () => {
    const composed = buildUserPrompt({ prompt: 'A dashboard with a dropdown' });
    assert.match(composed, /@base-ui\/react\/menu/);
  });

  it('appends nothing for a page with no such control', () => {
    assert.equal(
      buildUserPrompt({ prompt: 'Update the header copy' }),
      'Update the header copy',
    );
  });
});
