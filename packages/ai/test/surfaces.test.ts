import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SURFACE_TECHNIQUES,
  findSurfaceTechnique,
  selectSurfaces,
  surfaceGuidance,
} from '../src/surfaces.ts';
import { MOTION_RECIPES } from '../src/motion.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

describe('the surface catalogue', () => {
  it('has distinct ids, lowercase triggers and real guidance', () => {
    const ids = SURFACE_TECHNIQUES.map((technique) => technique.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const technique of SURFACE_TECHNIQUES) {
      assert.ok(technique.triggers.length > 0, technique.id);
      assert.ok(technique.guidance.length > 120, technique.id);
      for (const trigger of technique.triggers) {
        assert.equal(trigger, trigger.toLowerCase(), trigger);
      }
    }
  });

  it('names no library, which would break STACK', () => {
    for (const technique of SURFACE_TECHNIQUES) {
      for (const banned of ['gsap', 'framer', 'npm install', 'three.js']) {
        assert.ok(
          !technique.guidance.toLowerCase().includes(banned),
          `${technique.id} must not name ${banned}`,
        );
      }
    }
  });
});

describe('selectSurfaces', () => {
  it('matches a request naming the technique', () => {
    assert.equal(
      selectSurfaces('A hero with a mesh gradient')[0]?.id,
      'mesh-gradient',
    );
    assert.equal(selectSurfaces('Add a progress ring')[0]?.id, 'conic-ring');
  });

  it('returns nothing for a request naming none', () => {
    assert.deepEqual(selectSurfaces('A page about our history'), []);
  });

  it('caps what it returns', () => {
    const many = 'a mesh gradient, a progress ring, a blend mode and grain';
    assert.equal(selectSurfaces(many).length, 2);
  });
});

describe('findSurfaceTechnique', () => {
  it('returns the technique, or null', () => {
    assert.equal(
      findSurfaceTechnique('noise-texture')?.name,
      'Grain or paper texture',
    );
    assert.equal(findSurfaceTechnique('nope'), null);
  });
});

describe('surfaceGuidance', () => {
  it('is null when nothing matched, and subordinate when it is not', () => {
    assert.equal(surfaceGuidance('A page about our history'), null);
    const guidance = surfaceGuidance('A hero with a mesh gradient');
    assert.ok(guidance);
    assert.match(guidance, /follow the request/i);
  });
});

describe('the css-native motion recipes', () => {
  it('adds the four platform-capability entries', () => {
    const ids = MOTION_RECIPES.map((recipe) => recipe.id);
    for (const id of [
      'scroll-driven',
      'view-transition',
      'discrete-transition',
      'anchor-position',
    ]) {
      assert.ok(ids.includes(id), id);
    }
  });

  it('requires a guard on every feature that needs one', () => {
    // The point of these entries is that the page still works where the
    // feature is missing. An unguarded scroll-driven reveal leaves some
    // readers on a blank page, which is worse than no animation at all.
    for (const id of ['scroll-driven', 'anchor-position']) {
      const recipe = MOTION_RECIPES.find((entry) => entry.id === id);
      assert.ok(recipe);
      assert.match(recipe.guidance, /@supports/, id);
    }
    const viewTransition = MOTION_RECIPES.find(
      (entry) => entry.id === 'view-transition',
    );
    assert.ok(viewTransition);
    assert.match(viewTransition.guidance, /Feature-detect/i);
  });

  it('states no perishable browser-support claim', () => {
    // Deliberate: the source skill version-stamps these because they expire,
    // and a stale fact in a prompt is never corrected. The durable half is
    // the discipline, which is what the guidance carries instead.
    for (const recipe of MOTION_RECIPES) {
      for (const vendor of ['Firefox', 'Safari', 'Chrome', 'Baseline']) {
        assert.ok(
          !recipe.guidance.includes(vendor),
          `${recipe.id} names ${vendor}`,
        );
      }
    }
  });

  it('warns off `forwards` on a scroll-driven animation', () => {
    const recipe = MOTION_RECIPES.find((entry) => entry.id === 'scroll-driven');
    assert.ok(recipe);
    assert.match(recipe.guidance, /never `forwards`/);
  });
});

describe('buildUserPrompt with a surface technique', () => {
  it('appends it, and does so even under a style preset', () => {
    const composed = buildUserPrompt(
      { prompt: 'A hero with a mesh gradient' },
      'brutalism',
    );
    assert.match(composed, /radial-gradient/);
  });

  it('appends nothing for a request naming none', () => {
    assert.equal(
      buildUserPrompt({ prompt: 'Update the header copy' }),
      'Update the header copy',
    );
  });
});
