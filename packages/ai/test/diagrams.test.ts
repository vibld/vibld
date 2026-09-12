import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIAGRAM_CRAFT,
  DIAGRAM_TYPES,
  diagramGuidance,
  findDiagramType,
  selectDiagrams,
} from '../src/diagrams.ts';
import { STYLE_PRESETS } from '../src/style-presets.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

describe('the diagram catalogue', () => {
  it('has distinct ids, lowercase triggers and real guidance', () => {
    const ids = DIAGRAM_TYPES.map((type) => type.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const type of DIAGRAM_TYPES) {
      assert.ok(type.triggers.length > 0, type.id);
      assert.ok(type.guidance.length > 150, type.id);
      for (const trigger of type.triggers) {
        assert.equal(trigger, trigger.toLowerCase(), trigger);
      }
    }
  });

  it('names no charting library, which would break STACK', () => {
    const all = DIAGRAM_CRAFT + DIAGRAM_TYPES.map((t) => t.guidance).join(' ');
    for (const banned of [
      'd3',
      'mermaid',
      'recharts',
      'chart.js',
      'npm install',
    ]) {
      assert.ok(!all.toLowerCase().includes(banned), banned);
    }
  });
});

describe('the craft rules', () => {
  it('carries the elbow and hop path formulae, not just the instruction', () => {
    // The rule "use rounded elbows" without the path data is the same as no
    // rule: a model that has to invent the arc produces a different curve
    // every time, and usually a diagonal.
    assert.match(DIAGRAM_CRAFT, /Q mid,y1 mid,y1\+8/);
    assert.match(DIAGRAM_CRAFT, /a 8,8 0 0,1 16,0/);
  });

  it('gives the fan-out formula for a shared edge', () => {
    assert.match(DIAGRAM_CRAFT, /L\*k\/\(N\+1\)/);
  });

  it('requires an accessible name, since an SVG has none by default', () => {
    assert.match(DIAGRAM_CRAFT, /role="img"/);
    assert.match(DIAGRAM_CRAFT, /aria-label/);
  });

  it("requires the project's own tokens rather than hardcoded colour", () => {
    assert.match(DIAGRAM_CRAFT, /var\(--card\)/);
    assert.match(DIAGRAM_CRAFT, /never hardcoded hex/);
  });

  it("does not import the source's shadow and radius bans", () => {
    // Those are that project's house style for its own standalone output.
    // As general rules they would contradict three style presets shipped
    // here, so the diagram defers to the project's tokens instead.
    assert.ok(!/Shadows are out/i.test(DIAGRAM_CRAFT));
    assert.ok(!/max(imum)? radius/i.test(DIAGRAM_CRAFT));
    const shadowPresets = STYLE_PRESETS.filter((preset) =>
      /shadow/i.test(preset.direction),
    );
    assert.ok(shadowPresets.length >= 3, 'presets that rely on shadow exist');
  });
});

describe('selectDiagrams', () => {
  it('matches a request naming a diagram type', () => {
    assert.equal(
      selectDiagrams('Add an architecture diagram')[0]?.id,
      'architecture',
    );
    assert.equal(selectDiagrams('A page with a user flow')[0]?.id, 'flow');
  });

  it('returns nothing for a page that needs no diagram', () => {
    assert.deepEqual(selectDiagrams('A pricing page with three tiers'), []);
  });

  it('returns one by default, because two grammars describe two pictures', () => {
    assert.equal(
      selectDiagrams('an architecture diagram and a flowchart').length,
      1,
    );
  });
});

describe('findDiagramType', () => {
  it('returns the type, or null', () => {
    assert.equal(findDiagramType('sequence')?.name, 'Sequence diagram');
    assert.equal(findDiagramType('nope'), null);
  });
});

describe('diagramGuidance', () => {
  it('is null when no diagram was asked for', () => {
    assert.equal(diagramGuidance('A pricing page'), null);
  });

  it('includes the craft rules once, alongside the type', () => {
    const guidance = diagramGuidance('Add an architecture diagram');
    assert.ok(guidance);
    assert.match(guidance, /viewBox/);
    assert.match(guidance, /labelled zones/);
    assert.match(guidance, /follow the request/i);
  });
});

describe('buildUserPrompt with a diagram', () => {
  it('appends it, and does so even under a style preset', () => {
    const composed = buildUserPrompt(
      { prompt: 'A landing page with an architecture diagram' },
      'brutalism',
    );
    assert.match(composed, /role="img"/);
  });

  it('appends nothing for a page that needs no diagram', () => {
    assert.equal(
      buildUserPrompt({ prompt: 'Update the header copy' }),
      'Update the header copy',
    );
  });
});
