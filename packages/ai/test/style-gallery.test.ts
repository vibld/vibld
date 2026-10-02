import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  STYLE_GALLERY_FILE,
  importStyleGallery,
  readSource,
  takenNames,
} from '../bin/import-style-gallery.ts';
import {
  STYLE_GALLERY_CATEGORIES,
  STYLE_GALLERY_GROUPS,
  checkStyleEntry,
  checkStyleGallery,
  filterStyleCards,
  isStyleGalleryId,
  isDecorativeRole,
  parseStyleGallery,
  serializeStyleGallery,
  styleCardOf,
  styleGalleryCss,
  fontsourceWeight,
  styleGalleryFamilies,
  styleGalleryFontImports,
  styleGalleryFontWeights,
  upsertStyleGallery,
  styleTokensFile,
} from '../src/style-gallery.ts';
import { FONTSOURCE_WEIGHTS } from '../src/fontsource-weights.ts';
import type {
  StyleGalleryCatalog,
  StyleGalleryEntry,
} from '../src/style-gallery.ts';

const EM_DASH = String.fromCodePoint(0x2014);

/** One entry small enough to read, and valid. */
function sample(id: string, overrides: Partial<StyleGalleryEntry> = {}) {
  const palette = [
    { role: 'canvas', hex: '#ffffff' },
    { role: 'surface', hex: '#f6f6f6' },
    { role: 'text', hex: '#101010' },
    { role: 'muted text', hex: '#5f6672' },
    { role: 'divider (decorative)', hex: '#e5e7eb' },
  ];
  const entry: StyleGalleryEntry = {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    kind: 'Plain test style',
    group: 'general',
    category: 'monochrome-minimal',
    theme: 'light',
    style_tags: ['light'],
    signature: ['one move'],
    screen_types: ['landing'],
    patterns: ['hero'],
    purpose: 'A test.',
    audience: ['testers'],
    layout: ['hero'],
    visual_style: {
      palette,
      typography: { display: 'Inter 600', body: 'Inter 400', notes: '' },
      spacing: 'comfortable',
      mood: 'calm',
      imagery: 'none',
    },
    design_tokens: {
      theme: 'light',
      colors: palette.map((s) => ({
        token: `--color-${s.role.split(' ')[0]}`,
        ...s,
      })),
      fonts: { display: 'Inter', body: 'Inter' },
      type_scale: [
        {
          token: '--text-16',
          size: '16px',
          font: 'Inter',
          weight: 400,
          line_height: 1.5,
          tracking: '0',
        },
      ],
      spacing: { base_unit: '4px', density: 'comfortable', scale: ['4px'] },
      radius: { buttons: '4px' },
    },
    key_components: ['primary button'],
    component_specs: [{ component: 'primary button', spec: 'filled' }],
    interactions: ['hover'],
    states: ['empty'],
    data_model: ['posts'],
    stack_suggested: ['Astro'],
    complexity: 'static site',
    guardrails: { ux: ['a'], accessibility: ['b'], security: ['c'] },
    contrast_checks: [
      {
        use: 'text on canvas',
        fg: '#101010',
        bg: '#ffffff',
        ratio: 19.03,
        target: 4.5,
      },
      {
        use: 'text on surface',
        fg: '#101010',
        bg: '#f6f6f6',
        ratio: 17.61,
        target: 4.5,
      },
      {
        use: 'muted on canvas',
        fg: '#5f6672',
        bg: '#ffffff',
        ratio: 5.78,
        target: 4.5,
      },
      {
        use: 'muted on surface',
        fg: '#5f6672',
        bg: '#f6f6f6',
        ratio: 5.35,
        target: 4.5,
      },
      {
        use: 'divider, exempt (decorative)',
        fg: '#e5e7eb',
        bg: '#ffffff',
        target: 3,
      },
    ],
    build_prompt: [
      'Goal',
      'Stack',
      'Pages & layout',
      'Design system',
      'Components & interactions',
      'Data & state',
      'Accessibility',
      'Security',
      'Performance & SEO',
      'Guardrails',
    ]
      .map((h) => `### ${h}\n\ntext`)
      .join('\n\n'),
    ...overrides,
  };
  return entry;
}

function catalogOf(entries: StyleGalleryEntry[]): StyleGalleryCatalog {
  return {
    title: 'Test',
    updated: '2026-10-02',
    source: { repository: 'x/y', path: 'z', commit: null },
    baseline_rules_markdown: '# Baseline',
    entries,
  };
}

describe('upsertStyleGallery', () => {
  it('adds, updates and drops by id', () => {
    const first = upsertStyleGallery(
      null,
      catalogOf([sample('beta'), sample('alpha'), sample('gamma')]),
    );
    assert.deepEqual(first.changes.added, ['alpha', 'beta', 'gamma']);
    assert.deepEqual(
      first.catalog.entries.map((e) => e.id),
      ['alpha', 'beta', 'gamma'],
    );

    const second = upsertStyleGallery(
      first.catalog,
      catalogOf([
        sample('alpha', { name: 'Renamed' }),
        sample('beta'),
        sample('delta'),
      ]),
    );
    assert.deepEqual(second.changes, {
      added: ['delta'],
      updated: ['alpha'],
      removed: ['gamma'],
      unchanged: 1,
    });
    assert.deepEqual(
      second.catalog.entries.map((e) => [e.id, e.name]),
      [
        ['alpha', 'Renamed'],
        ['beta', 'Beta'],
        ['delta', 'Delta'],
      ],
    );
  });

  it('changes nothing when run twice', () => {
    const input = catalogOf([sample('alpha'), sample('beta')]);
    const once = upsertStyleGallery(null, input);
    const twice = upsertStyleGallery(once.catalog, input);
    assert.deepEqual(twice.changes, {
      added: [],
      updated: [],
      removed: [],
      unchanged: 2,
    });
    assert.equal(
      serializeStyleGallery(twice.catalog),
      serializeStyleGallery(once.catalog),
    );
  });

  it('ignores key order when deciding what changed', () => {
    const entry = sample('alpha');
    const reordered = Object.fromEntries(
      Object.entries(entry).reverse(),
    ) as unknown as StyleGalleryEntry;
    const once = upsertStyleGallery(null, catalogOf([entry]));
    const again = upsertStyleGallery(once.catalog, catalogOf([reordered]));
    assert.equal(again.changes.unchanged, 1);
  });

  it('refuses an id given twice', () => {
    assert.throws(
      () => upsertStyleGallery(null, catalogOf([sample('a'), sample('a')])),
      /given twice/,
    );
  });
});

describe('the stored form', () => {
  it('reads back what it wrote, one entry per line', () => {
    const catalog = upsertStyleGallery(
      null,
      catalogOf([sample('beta'), sample('alpha')]),
    ).catalog;
    const text = serializeStyleGallery(catalog);
    assert.deepEqual(parseStyleGallery(text), catalog);
    const lines = text.trimEnd().split('\n');
    assert.equal(lines.length, 5);
    assert.match(lines[2], /^\{"id":"alpha"/);
  });

  it('refuses a count that disagrees with the entries', () => {
    const text = serializeStyleGallery(catalogOf([sample('a')])).replace(
      '"count":1',
      '"count":2',
    );
    assert.throws(() => parseStyleGallery(text), /count 2 but 1/);
  });
});

describe('checkStyleEntry', () => {
  it('passes a valid entry', () => {
    assert.deepEqual(checkStyleEntry(sample('alpha'), new Set(['Inter'])), []);
  });

  it('reads a role as decorative only when every part of it is', () => {
    assert.equal(isDecorativeRole('divider (decorative)'), true);
    assert.equal(
      isDecorativeRole('canvas / supporting accent (decorative)'),
      false,
    );
    assert.equal(isDecorativeRole('a (decorative) / b (decorative)'), true);
  });

  it('refuses text on a decorative color', () => {
    const entry = sample('alpha');
    entry.contrast_checks.push({
      use: 'text on divider',
      fg: '#101010',
      bg: '#e5e7eb',
      ratio: 15.37,
      target: 4.5,
    });
    assert.deepEqual(checkStyleEntry(entry), [
      'alpha: text on divider: decorative #e5e7eb carries text',
    ]);
  });

  it('refuses a pair below its target, or recorded wrongly', () => {
    const entry = sample('alpha');
    entry.contrast_checks[2] = {
      use: 'muted on canvas',
      fg: '#9aa0aa',
      bg: '#ffffff',
      ratio: 4.6,
      target: 4.5,
    };
    const problems = checkStyleEntry(entry);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /below 4\.5/);
    assert.match(problems[1], /recorded 4\.6 but measures/);
  });

  it('refuses a text pair with no ratio unless it says exempt', () => {
    const entry = sample('alpha');
    delete entry.contrast_checks[0].ratio;
    assert.deepEqual(checkStyleEntry(entry), [
      'alpha: text on canvas: no recorded ratio',
    ]);
  });

  it('refuses small type, a missing section, a URL and an unlisted font', () => {
    const entry = sample('alpha', {
      purpose: 'See https://example.com.',
      build_prompt: '### Goal\n\ntext',
    });
    entry.design_tokens.type_scale.push({
      token: '--text-11',
      size: '11px',
      font: 'Comic Neue',
      weight: 300,
      line_height: 1.4,
      tracking: '0',
    });
    const problems = checkStyleEntry(entry, new Set(['Inter']));
    for (const pattern of [
      /font Comic Neue is not on the allowlist/,
      /a type step is below 12px/,
      /weight 300 at 11px/,
      /build prompt lacks Stack/,
      /contains a URL/,
    ]) {
      assert.ok(
        problems.some((p) => pattern.test(p)),
        `${pattern} in ${problems.join('; ')}`,
      );
    }
  });

  it('finds ids and names used twice or used elsewhere', () => {
    const problems = checkStyleGallery(
      catalogOf([sample('alpha'), sample('beta', { name: 'ALPHA' })]),
      { taken: new Set(['beta']) },
    );
    assert.deepEqual(problems, [
      'repeated name: ALPHA',
      'beta: id or name is already used elsewhere',
    ]);
  });
});

// The rest reads the imported data, which a copy without it (D143) lacks.
const stored = existsSync(STYLE_GALLERY_FILE);

describe('the imported style gallery', { skip: !stored }, () => {
  const text = stored ? readFileSync(STYLE_GALLERY_FILE, 'utf8') : '';
  const catalog = stored ? parseStyleGallery(text) : catalogOf([]);

  it('holds all 1,342 entries, one per id', () => {
    assert.equal(catalog.entries.length, 1342);
    assert.equal(new Set(catalog.entries.map((e) => e.id)).size, 1342);
  });

  it('round-trips every entry exactly', () => {
    assert.equal(serializeStyleGallery(parseStyleGallery(text)), text);
    for (const entry of catalog.entries) {
      assert.deepEqual(JSON.parse(JSON.stringify(entry)), entry);
    }
    // Importing what is stored over what is stored changes nothing.
    const again = upsertStyleGallery(catalog, catalog);
    assert.equal(again.changes.unchanged, 1342);
    assert.equal(serializeStyleGallery(again.catalog), text);
  });

  it('passes every check, against vibld’s other catalogs too', () => {
    assert.deepEqual(checkStyleGallery(catalog, { taken: takenNames() }), []);
  });

  it('uses only the controlled filter values', () => {
    for (const entry of catalog.entries) {
      assert.ok(STYLE_GALLERY_GROUPS.includes(entry.group), entry.id);
      assert.ok(STYLE_GALLERY_CATEGORIES.includes(entry.category), entry.id);
    }
  });

  it('has no em-dash', () => {
    assert.equal(text.includes(EM_DASH), false);
  });

  it('makes a card of each entry without its prompt', () => {
    const card = styleCardOf(catalog.entries[0]);
    assert.equal(card.id, catalog.entries[0].id);
    assert.equal('build_prompt' in card, false);
    assert.ok(JSON.stringify(card).length < 3000);
  });
});

// Against the source itself, when a designs-v1 checkout is at hand.
const checkout = resolve(
  process.env.DESIGNS_V1 ??
    new URL('../../../../designs-v1', import.meta.url).pathname,
);
const hasSource =
  stored &&
  existsSync(
    resolve(checkout, 'style-gallery-patterns/style-gallery-patterns.json'),
  );

describe('the import from designs-v1', { skip: !hasSource }, () => {
  it('is what is stored, and every source entry survives it', () => {
    const current = parseStyleGallery(readFileSync(STYLE_GALLERY_FILE, 'utf8'));
    const { catalog, changes, problems } = importStyleGallery(
      checkout,
      current,
    );
    assert.deepEqual(problems, []);
    assert.deepEqual(changes, {
      added: [],
      updated: [],
      removed: [],
      unchanged: 1342,
    });
    const source = readSource(checkout);
    assert.deepEqual(
      catalog.entries.map((e) => e.id),
      source.entries.map((e) => e.id).sort(),
    );
    const raw = JSON.parse(
      readFileSync(
        resolve(checkout, 'style-gallery-patterns/style-gallery-patterns.json'),
        'utf8',
      ),
    ) as { entries: StyleGalleryEntry[] };
    const byId = new Map(catalog.entries.map((e) => [e.id, e]));
    for (const entry of raw.entries) {
      const kept = byId.get(entry.id);
      assert.ok(kept, entry.id);
      // Code-read values are never changed; only readable words are.
      assert.deepEqual(kept.design_tokens.colors, entry.design_tokens.colors);
      assert.deepEqual(
        kept.design_tokens.type_scale,
        entry.design_tokens.type_scale,
      );
      assert.deepEqual(kept.design_tokens.fonts, entry.design_tokens.fonts);
      assert.deepEqual(kept.design_tokens.radius, entry.design_tokens.radius);
      assert.deepEqual(
        kept.contrast_checks.map((c) => [c.fg, c.bg, c.ratio, c.target]),
        entry.contrast_checks.map((c) => [c.fg, c.bg, c.ratio, c.target]),
      );
      assert.deepEqual(Object.keys(kept), Object.keys(entry));
    }
  });
});

describe('filterStyleCards', () => {
  const cards = [
    styleCardOf(
      sample('alpha', { kind: 'Dark editorial serif site', theme: 'dark' }),
    ),
    styleCardOf(
      sample('beta', { group: 'fintech', style_tags: ['pill corners'] }),
    ),
    styleCardOf(
      sample('gamma', {
        category: 'bold-graphic',
        signature: ['heavy 900 display'],
      }),
    ),
  ];
  const ids = (filter: Parameters<typeof filterStyleCards>[1]) =>
    filterStyleCards(cards, filter).map((card) => card.id);

  it('filters by theme, category and group', () => {
    assert.deepEqual(ids({ theme: 'dark' }), ['alpha']);
    assert.deepEqual(ids({ group: 'fintech' }), ['beta']);
    assert.deepEqual(ids({ category: 'bold-graphic' }), ['gamma']);
    assert.deepEqual(ids({ theme: '', category: '', group: '' }), [
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('searches name, kind, tags and signature, every word', () => {
    assert.deepEqual(ids({ query: 'GAMMA' }), ['gamma']);
    assert.deepEqual(ids({ query: 'editorial serif' }), ['alpha']);
    assert.deepEqual(ids({ query: 'pill' }), ['beta']);
    assert.deepEqual(ids({ query: 'heavy display' }), ['gamma']);
    assert.deepEqual(ids({ query: 'serif pill' }), []);
  });

  it('knows a stored id', () => {
    assert.equal(isStyleGalleryId('tealcairn'), true);
    assert.equal(isStyleGalleryId('Teal Cairn'), false);
    assert.equal(isStyleGalleryId('a'.repeat(65)), false);
    assert.equal(isStyleGalleryId(null), false);
  });
});

/** The `@theme` declarations of emitted CSS, read back. */
function themeOf(css: string): Map<string, string> {
  const block = /@theme \{\n([\s\S]*?)\n\}/.exec(css)![1]!;
  return new Map(
    block.split('\n').map((line) => {
      const match = /^\s*(--[\w-]+): (.*);$/.exec(line)!;
      return [match[1]!, match[2]!];
    }),
  );
}

/** What the tokens say each declaration should be, straight from the catalog. */
function expectedTheme(tokens: StyleGalleryEntry['design_tokens']) {
  const want = new Map<string, string>();
  for (const color of tokens.colors) want.set(color.token, color.hex);
  want.set('--font-display', `'${tokens.fonts.display}'`);
  want.set('--font-body', `'${tokens.fonts.body}'`);
  if (tokens.fonts.mono) want.set('--font-mono', `'${tokens.fonts.mono}'`);
  const declared = [tokens.fonts.display, tokens.fonts.body, tokens.fonts.mono];
  for (const step of tokens.type_scale) {
    if (!declared.includes(step.font)) {
      want.set(
        `--font-${step.font.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        `'${step.font}'`,
      );
    }
  }
  for (const step of tokens.type_scale) {
    want.set(step.token, step.size);
    want.set(`${step.token}--line-height`, String(step.line_height));
    want.set(`${step.token}--letter-spacing`, step.tracking);
    want.set(`${step.token}--font-weight`, String(step.weight));
  }
  for (const [element, value] of Object.entries(tokens.radius)) {
    want.set(
      `--radius-${element.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      value,
    );
  }
  (tokens.shadows ?? []).forEach((shadow, i) =>
    want.set(`--shadow-${i + 1}`, shadow),
  );
  return want;
}

describe('applying a style (D145)', () => {
  it("emits exactly the tokens, under Tailwind's namespaces", () => {
    const tokens = {
      theme: 'light',
      colors: [
        { token: '--color-canvas', role: 'canvas', hex: '#f9f6f2' },
        { token: '--color-text', role: 'text', hex: '#0e0e0e' },
      ],
      fonts: { display: 'Raleway', body: 'Poppins' },
      type_scale: [
        {
          token: '--text-16',
          size: '16px',
          font: 'Poppins',
          weight: 500,
          line_height: 1.5,
          tracking: '0',
        },
        {
          token: '--text-62',
          size: '62px',
          font: 'Raleway',
          weight: 700,
          line_height: 1.15,
          tracking: '0.154em',
        },
      ],
      spacing: { base_unit: '4px', density: 'comfortable', scale: [] },
      radius: { cards: '0px', 'hero panels': '30px' },
      shadows: ['rgba(0, 0, 0, 0.1) 0px 4px 8px 0px'],
    } as StyleGalleryEntry['design_tokens'];
    const css = styleGalleryCss(tokens);
    assert.deepEqual(
      [...themeOf(css)],
      [
        ['--color-canvas', '#f9f6f2'],
        ['--color-text', '#0e0e0e'],
        ['--font-display', "'Raleway'"],
        ['--font-body', "'Poppins'"],
        ['--text-16', '16px'],
        ['--text-16--line-height', '1.5'],
        ['--text-16--letter-spacing', '0'],
        ['--text-16--font-weight', '500'],
        ['--text-62', '62px'],
        ['--text-62--line-height', '1.15'],
        ['--text-62--letter-spacing', '0.154em'],
        ['--text-62--font-weight', '700'],
        ['--radius-cards', '0px'],
        ['--radius-hero-panels', '30px'],
        ['--shadow-1', 'rgba(0, 0, 0, 0.1) 0px 4px 8px 0px'],
      ],
    );
    assert.match(
      css,
      /body \{ font-family: var\(--font-body\); font-size: 16px; \}/,
    );
    assert.deepEqual(styleGalleryFontImports(tokens), [
      '@fontsource/raleway/700.css',
      '@fontsource/poppins/500.css',
    ]);
  });

  it('snaps a weight to the nearest one Fontsource ships', () => {
    assert.equal(fontsourceWeight('Bebas Neue', 600), 400);
    assert.equal(fontsourceWeight('Inter', 850), 900);
    assert.equal(fontsourceWeight('Inter', 600), 600);
    assert.equal(fontsourceWeight('Space Grotesk', 200), 300);
    assert.equal(fontsourceWeight('Not A Gallery Font', 650), 650);
  });

  it('imports a family only a type step sets', () => {
    const tokens = {
      fonts: { display: 'Anton', body: 'Space Grotesk' },
      type_scale: [
        {
          token: '--text-16',
          size: '16px',
          font: 'Space Grotesk',
          weight: 400,
        },
        { token: '--text-12', size: '12px', font: 'Archivo', weight: 600 },
        {
          token: '--text-64',
          size: '64px',
          font: 'Archivo Black',
          weight: 400,
        },
      ],
    } as unknown as StyleGalleryEntry['design_tokens'];
    assert.deepEqual(styleGalleryFontImports(tokens), [
      '@fontsource/anton/400.css',
      '@fontsource/space-grotesk/400.css',
      '@fontsource/archivo/600.css',
      '@fontsource/archivo-black/400.css',
    ]);
  });

  it('gives a face no step uses its regular weight', () => {
    const tokens = {
      fonts: { display: 'Inter', body: 'Inter', mono: 'Roboto Mono' },
      type_scale: [
        { token: '--text-16', size: '16px', font: 'Inter', weight: 400 },
        { token: '--text-40', size: '40px', font: 'Inter', weight: 600 },
      ],
    } as unknown as StyleGalleryEntry['design_tokens'];
    assert.deepEqual(styleGalleryFontImports(tokens), [
      '@fontsource/inter/400.css',
      '@fontsource/inter/600.css',
      '@fontsource/roboto-mono/400.css',
    ]);
  });
});

describe('applying the imported styles (D145)', { skip: !stored }, () => {
  const catalog = stored
    ? parseStyleGallery(readFileSync(STYLE_GALLERY_FILE, 'utf8'))
    : null;
  const byId = (id: string) => catalog!.entries.find((e) => e.id === id)!;

  it('imports only weights Fontsource ships', () => {
    for (const family of styleGalleryFamilies(catalog!.entries)) {
      assert.ok(FONTSOURCE_WEIGHTS[family], `no weights for ${family}`);
    }
    for (const entry of catalog!.entries) {
      const imported = new Set(
        styleGalleryFontWeights(entry.design_tokens).map((f) => f.family),
      );
      for (const step of entry.design_tokens.type_scale) {
        assert.ok(imported.has(step.font), `${entry.id}: ${step.font}`);
      }
      for (const { family, weights } of styleGalleryFontWeights(
        entry.design_tokens,
      )) {
        for (const weight of weights) {
          assert.ok(
            FONTSOURCE_WEIGHTS[family]!.includes(weight),
            `${entry.id}: ${family} ${weight}`,
          );
        }
      }
    }
    assert.ok(
      styleTokensFile(byId('cedarpool')).includes(
        "@import '@fontsource/inter/900.css';",
      ),
    );
    assert.ok(!styleTokensFile(byId('cedarpool')).includes('/850.css'));
    assert.ok(
      styleTokensFile(byId('bramblemore')).includes(
        "@import '@fontsource/bebas-neue/400.css';",
      ),
    );
    assert.ok(!styleTokensFile(byId('bramblemore')).includes('bebas-neue/600'));
  });

  for (const id of ['amberbrae', 'vinepool', 'mireby', 'tansyhaven']) {
    it(`matches design_tokens for ${id}`, () => {
      const tokens = byId(id).design_tokens;
      assert.deepEqual(themeOf(styleGalleryCss(tokens)), expectedTheme(tokens));
    });
  }

  it('matches design_tokens for every style', () => {
    for (const entry of catalog!.entries) {
      const tokens = entry.design_tokens;
      assert.deepEqual(
        themeOf(styleGalleryCss(tokens)),
        expectedTheme(tokens),
        entry.id,
      );
    }
  });
});
