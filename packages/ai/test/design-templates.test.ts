import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BACKDROPS } from '../src/backdrops.ts';
import { contrastRatio } from '../src/contrast.ts';
import {
  BUILD_PROMPT_SECTIONS,
  DESIGN_BASELINE,
  DESIGN_TEMPLATES,
  DESIGN_USE_CASES,
  designBrief,
  designsForExample,
  findDesignTemplate,
  isDesignTemplateId,
  listedDesignTemplates,
} from '../src/design-templates.ts';
import { DESIGN_TEMPLATE_INDEX } from '../src/design-template-index.ts';
import { DIAGRAM_TYPES } from '../src/diagrams.ts';
import { MOTION_RECIPES } from '../src/motion.ts';
import { PALETTE_LIBRARY } from '../src/palette-library.ts';
import { PRODUCT_PALETTES } from '../src/palettes.ts';
import {
  MARKETING_PAGE_PATTERNS,
  SAAS_SCREEN_PATTERNS,
} from '../src/patterns.ts';
import { PRIMITIVE_RECIPES } from '../src/primitives.ts';
import { STYLE_PRESETS } from '../src/style-presets.ts';
import { SURFACE_TECHNIQUES } from '../src/surfaces.ts';

const EM_DASH = String.fromCodePoint(0x2014);

/** How two names are compared: case, spacing and punctuation ignored. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The pairs a reader reads, as `style-tokens.test.ts` holds a preset to. */
const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['cardForeground', 'card'],
  ['mutedForeground', 'muted'],
  ['mutedForeground', 'background'],
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onAccent', 'accent'],
  ['onDestructive', 'destructive'],
] as const;

describe('the design template catalog', () => {
  it('has every design the catalog does: 72 apps and 135 websites', () => {
    assert.equal(DESIGN_TEMPLATES.length, 207);
    assert.equal(DESIGN_TEMPLATES.filter((t) => t.kind === 'app').length, 72);
    assert.equal(DESIGN_TEMPLATES.filter((t) => t.kind === 'site').length, 135);
  });

  it('keeps ids and names unique', () => {
    for (const field of ['id', 'name'] as const) {
      const seen = new Set<string>();
      for (const template of DESIGN_TEMPLATES) {
        const value = key(template[field]);
        assert.ok(!seen.has(value), `${field} repeated: ${template[field]}`);
        seen.add(value);
      }
    }
  });

  it('maps every design onto one of vibld.com use cases', () => {
    for (const template of DESIGN_TEMPLATES) {
      assert.ok(
        DESIGN_USE_CASES.includes(template.useCase),
        `${template.id}: ${template.useCase}`,
      );
      if (template.kind === 'app') assert.equal(template.useCase, 'tools');
    }
    // Every use case has designs to show.
    for (const useCase of DESIGN_USE_CASES) {
      assert.ok(listedDesignTemplates({ useCase }).length > 0, useCase);
    }
  });

  it('keeps each build prompt whole, with its ten sections in order', () => {
    for (const template of DESIGN_TEMPLATES) {
      let at = -1;
      for (const section of BUILD_PROMPT_SECTIONS) {
        const found = template.buildPrompt.indexOf(`### ${section}`);
        assert.ok(found > at, `${template.id}: ### ${section}`);
        at = found;
      }
      assert.match(
        template.buildPrompt,
        /Verified contrast:/,
        `${template.id}: the accessibility section's verified pairs`,
      );
    }
  });

  it('keeps the baseline every build prompt assumes, first in a brief', () => {
    assert.match(DESIGN_BASELINE, /### Engineering baseline/);
    assert.match(DESIGN_BASELINE, /WCAG 2\.2 AA/);
    const brief = designBrief('tallyroot')!;
    assert.ok(brief.startsWith(DESIGN_BASELINE.trim()));
    assert.ok(brief.includes('## Tallyroot'));
    assert.ok(
      brief.includes(findDesignTemplate('tallyroot')!.buildPrompt.trim()),
    );
    assert.equal(designBrief('no-such-design'), undefined);
    assert.equal(isDesignTemplateId('tallyroot'), true);
    assert.equal(isDesignTemplateId('glassmorphism'), false);
  });

  it('is named by an index that agrees with it, entry for entry', () => {
    assert.deepEqual(
      DESIGN_TEMPLATE_INDEX,
      DESIGN_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        summary: t.summary,
        kind: t.kind,
        useCase: t.useCase,
        ...(t.mergedInto ? { mergedInto: t.mergedInto.slug } : {}),
      })),
    );
  });

  it('contains no em-dash, the one change made to its words', () => {
    const text = readFileSync(
      new URL('../data/design-templates.ts', import.meta.url),
      'utf8',
    );
    assert.ok(!text.includes(EM_DASH));
  });
});

describe('the WCAG AA check, rerun', () => {
  it('passes every contrast pair the catalog recorded', () => {
    // What the catalog's validate.py does, with vibld's own contrast code.
    // A pair with a target but no recorded ratio, which that script skips,
    // would be measured here too; today every such pair is a decorative
    // one marked exempt, which is the only kind left out.
    let measured = 0;
    for (const template of DESIGN_TEMPLATES) {
      for (const check of template.style.contrastChecks) {
        if (!check.fg || !check.bg || !check.target) continue;
        if (check.exempt || /exempt/i.test(check.use)) continue;
        const ratio = contrastRatio(check.fg, check.bg);
        assert.ok(ratio !== null, `${template.id}: ${check.use} unparseable`);
        assert.ok(
          ratio + 0.005 >= check.target,
          `${template.id}: ${check.use} ${check.fg} on ${check.bg} is ${ratio.toFixed(2)}:1`,
        );
        measured += 1;
      }
    }
    assert.equal(measured, 2001);
  });

  it("passes every text pair of each design's inspiration style", () => {
    for (const template of DESIGN_TEMPLATES) {
      const colors = template.style.tokens.colors;
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrastRatio(colors[fg], colors[bg]);
        assert.ok(
          ratio !== null && ratio >= 4.5,
          `${template.id}: ${fg} on ${bg} is ${ratio}`,
        );
      }
      const fill = contrastRatio(colors.primary, colors.background);
      assert.ok(fill !== null && fill >= 3, `${template.id}: primary ${fill}`);
      for (const [token, value] of Object.entries(colors)) {
        assert.match(value, /^#[0-9a-f]{6}$/, `${template.id}.${token}`);
      }
    }
  });
});

describe('the inspiration styles', () => {
  it("draw each style's tokens from its own palette, except what was solved", () => {
    for (const template of DESIGN_TEMPLATES) {
      const drawn = new Set(
        template.style.palette.map((s) => s.hex.toLowerCase()),
      );
      for (const [token, value] of Object.entries(
        template.style.tokens.colors,
      )) {
        const solved = (template.style.derived as string[]).includes(token);
        assert.ok(
          solved || drawn.has(value) || value === '#ffffff',
          `${template.id}.${token} ${value} is neither drawn nor marked solved`,
        );
      }
    }
  });

  it('load both typefaces from Google Fonts, naming a substitute when needed', () => {
    for (const template of DESIGN_TEMPLATES) {
      const { display, body } = template.style.fonts;
      const { headingFont, bodyFont, googleFontsUrl } =
        template.style.tokens.typography;
      for (const [font, loaded] of [
        [display, headingFont],
        [body, bodyFont],
      ] as const) {
        assert.equal(
          loaded,
          font.onGoogleFonts ? font.family : font.substitute,
          `${template.id}: ${font.asWritten}`,
        );
      }
      assert.match(
        googleFontsUrl,
        /^https:\/\/fonts\.googleapis\.com\/css2\?family=/,
      );
      for (const family of [headingFont, bodyFont]) {
        assert.ok(
          googleFontsUrl.includes(`family=${family.replace(/ /g, '+')}`),
          `${template.id}: ${family} in ${googleFontsUrl}`,
        );
      }
    }
  });

  it('write radius in px, as a style preset does', () => {
    for (const template of DESIGN_TEMPLATES) {
      for (const value of Object.values(template.style.tokens.radius)) {
        assert.match(value, /^\d+px$/, template.id);
      }
    }
  });
});

describe('merging with what vibld already has', () => {
  const catalogue = JSON.parse(
    readFileSync(
      new URL('../../../examples/catalogue.json', import.meta.url),
      'utf8',
    ),
  ) as { examples: { slug: string }[] };
  const slugs = new Set(catalogue.examples.map((entry) => entry.slug));

  it('merges a design into an example only when that example exists', () => {
    const merged = DESIGN_TEMPLATES.filter((t) => t.mergedInto);
    assert.deepEqual(merged.map((t) => t.id).sort(), [
      'kasimir-lund',
      'makers-forum-26',
      'paysprout',
    ]);
    for (const template of merged) {
      assert.ok(slugs.has(template.mergedInto!.slug), template.id);
      assert.deepEqual(designsForExample(template.mergedInto!.slug), [
        template,
      ]);
    }
    assert.equal(listedDesignTemplates().length, 207 - merged.length);
  });

  it("clashes with no name or id in vibld's own catalogues", () => {
    const ours = new Map<string, string>();
    const add = (where: string, ...names: string[]) => {
      for (const name of names) ours.set(key(name), `${where}: ${name}`);
    };
    for (const p of STYLE_PRESETS) add('style preset', p.id, p.name);
    for (const p of PRODUCT_PALETTES) add('product palette', p.id, p.name);
    for (const p of PALETTE_LIBRARY) add('palette library', p.id, p.name);
    for (const p of [...MARKETING_PAGE_PATTERNS, ...SAAS_SCREEN_PATTERNS]) {
      add('page pattern', p.id, p.name);
    }
    for (const r of BACKDROPS) add('backdrop', r.id, r.component);
    for (const s of SURFACE_TECHNIQUES) add('surface', s.id);
    for (const m of MOTION_RECIPES) add('motion recipe', m.id);
    for (const p of PRIMITIVE_RECIPES) add('primitive', p.id);
    for (const d of DIAGRAM_TYPES) add('diagram', d.id);
    for (const slug of slugs) add('example', slug);

    for (const template of DESIGN_TEMPLATES) {
      for (const name of [template.id, template.name]) {
        assert.equal(
          ours.get(key(name)),
          undefined,
          `${template.id}: "${name}" is already vibld's`,
        );
      }
    }
  });
});
