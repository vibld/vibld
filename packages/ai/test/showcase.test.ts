import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectBackdrops } from '../src/backdrops.ts';
import { MAX_PROMPT_CHARS } from '../src/limits.ts';
import { SCENE_EXAMPLES, selectScenes } from '../src/scenes.ts';
import {
  SHOWCASE_PROMPTS,
  findShowcasePrompt,
  type ShowcasePrompt,
} from '../src/showcase.ts';

/** What a prompt actually selects. */
function showcaseEffects(entry: ShowcasePrompt) {
  return {
    scenes: selectScenes(entry.prompt).map((recipe) => recipe.id),
    backdrops: selectBackdrops(entry.prompt).map((recipe) => recipe.id),
  };
}

const EM_DASH = String.fromCodePoint(0x2014);

describe('the showcase prompts', () => {
  it('have distinct ids a template link accepts', () => {
    const ids = SHOWCASE_PROMPTS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      // The id pattern apps/web's template-brief.ts reads from a link.
      assert.match(id, /^[a-z0-9-]{1,80}$/);
      assert.ok(id.startsWith('showcase-'), id);
      assert.equal(findShowcasePrompt(id)?.id, id);
    }
    assert.equal(findShowcasePrompt('showcase-none'), undefined);
  });

  it('fit in one message, with no em-dash and no stray whitespace', () => {
    for (const entry of SHOWCASE_PROMPTS) {
      assert.ok(entry.prompt.length <= MAX_PROMPT_CHARS, entry.id);
      assert.ok(entry.prompt.length >= 400, `${entry.id} is too thin`);
      assert.equal(entry.prompt, entry.prompt.trim(), entry.id);
      for (const text of [entry.prompt, entry.summary, entry.name]) {
        assert.ok(!text.includes(EM_DASH), entry.id);
        assert.ok(!text.includes('\r'), entry.id);
      }
    }
  });

  it('each select exactly the effect they are built around', () => {
    for (const entry of SHOWCASE_PROMPTS) {
      const { scenes, backdrops } = showcaseEffects(entry);
      assert.deepEqual(
        backdrops,
        entry.backdrop ? [entry.backdrop] : [],
        `${entry.id}: backgrounds`,
      );
      if (entry.scene) {
        assert.deepEqual(scenes, [entry.scene], `${entry.id}: scenes`);
      } else if (entry.effect.startsWith('3D')) {
        // Asks for 3D without naming a look, so any example may teach it.
        assert.equal(scenes.length, SCENE_EXAMPLES.length, entry.id);
      } else {
        assert.deepEqual(scenes, [], `${entry.id}: scenes`);
      }
    }
  });

  it('show off every example scene and every animated background', () => {
    const scenes = new Set(SHOWCASE_PROMPTS.map((entry) => entry.scene));
    for (const recipe of SCENE_EXAMPLES)
      assert.ok(scenes.has(recipe.id), recipe.id);
    const backdrops = new Set(SHOWCASE_PROMPTS.map((entry) => entry.backdrop));
    for (const id of [
      'aurora-mesh',
      'particle-field',
      'grain-blobs',
      'flow-lines',
    ] as const) {
      assert.ok(backdrops.has(id), id);
    }
  });
});
