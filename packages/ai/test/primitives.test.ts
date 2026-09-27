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
import { OPTIONAL_PACKAGES } from '../src/stack.ts';
import { MOTION_RECIPES } from '../src/motion.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

/**
 * The namespaces `radix-ui` exports, read from its type declarations on
 * 2026-09-26 rather than recalled.
 */
const RADIX = [
  'Dialog',
  'DropdownMenu',
  'Select',
  'Popover',
  'Tooltip',
  'Tabs',
  'Accordion',
];

const ALL =
  PRIMITIVE_BASICS + PRIMITIVE_RECIPES.map((r) => r.guidance).join(' ');

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

  it('names only primitives radix-ui really exports', () => {
    // A wrong import here breaks the build of every generated project that
    // hits it.
    const named = [...ALL.matchAll(/\b([A-Z][A-Za-z]+) from 'radix-ui'/g)].map(
      (match) => match[1]!,
    );
    assert.ok(named.length >= 5);
    for (const name of named) {
      assert.ok(RADIX.includes(name), `${name} is not a verified export`);
    }
    // The unified package, not the per-primitive scoped ones, and not the
    // library the prompt used before (#74).
    assert.ok(!/@radix-ui\//.test(ALL));
    assert.ok(!ALL.includes('@base-ui'));
  });

  it('takes versions from stack.ts, and pins none of its own', () => {
    assert.ok(ALL.includes(`cmdk@${OPTIONAL_PACKAGES.cmdk}`));
    const versions = [...ALL.matchAll(/@\^?\d+\.\d+\.\d+/g)];
    assert.equal(versions.length, 1);
  });

  it('styles with the project and stops its own animation for reduced motion', () => {
    assert.match(PRIMITIVE_BASICS, /cn\(\) from @\/lib\/utils/);
    assert.match(PRIMITIVE_BASICS, /tokens/);
    assert.match(PRIMITIVE_BASICS, /motion-reduce:animate-none/);
  });

  it('recommends no library outside the stack', () => {
    for (const other of [
      'headless',
      'sonner',
      'framer',
      'recharts',
      'zustand',
      'react-aria',
    ]) {
      assert.ok(!ALL.toLowerCase().includes(other), other);
    }
  });
});

describe('the STACK rule for these controls', () => {
  it('is stated where the rule is, so the two cannot contradict', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /STACK[\s\S]*?always the shadcn\/ui component on Radix/,
    );
    assert.match(PLAN_SYSTEM_PROMPT, /from\s+'radix-ui'/);
  });

  it('says why, in terms of the defect rather than of convenience', () => {
    assert.match(PLAN_SYSTEM_PROMPT, /focus trapping/);
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /nobody testing with a\s+mouse will\s+notice/,
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

  it('carries the shared shape once, alongside the anatomy', () => {
    const guidance = primitiveGuidance('Add a modal and a tooltip');
    assert.ok(guidance);
    assert.equal(guidance.match(/Keep shadcn's file/g)?.length, 1);
    assert.match(guidance, /Portal > Overlay > Content/);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with a primitive', () => {
  it('appends it', () => {
    const composed = buildUserPrompt({ prompt: 'A dashboard with a dropdown' });
    assert.match(composed, /dropdown-menu\.tsx/);
  });

  it('appends nothing for a page with no such control', () => {
    assert.equal(
      buildUserPrompt({ prompt: 'Update the header copy' }),
      'Update the header copy',
    );
  });
});
