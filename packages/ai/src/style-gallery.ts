/**
 * The style gallery: 1,342 website style presets from Drummond-IT/designs-v1
 * (`style-gallery-patterns/`), each a complete design system with tokens, a
 * type scale, component specs, contrast checks and a build prompt
 * (docs/decisions.md, D142).
 *
 * This module is the catalog's shape and the pure functions over it: the
 * entry types, the importer's upsert by `id`, the file format, the checks an
 * import must pass, and the small card a picker shows. It holds no data.
 * The data is `../data/style-gallery.json`, written by
 * `bin/import-style-gallery.ts` and read only by code that asks for it, so
 * its 30 MB never reach a bundle that imports this file.
 *
 * `id` is the stable key: a project stores it, and the importer upserts by
 * it. `name` is display text only and may change between imports.
 */
import { contrastRatio } from './contrast.ts';

export const STYLE_GALLERY_GROUPS = [
  'saas',
  'agency-portfolio',
  'ecommerce',
  'general',
  'ai',
  'design-tools',
  'devtools',
  'fintech',
  'productivity',
  'media-publishing',
  'web3',
] as const;

export const STYLE_GALLERY_CATEGORIES = [
  'monochrome-minimal',
  'editorial-serif',
  'dark-cinematic',
  'dark-technical',
  'warm-minimal',
  'soft-gradient',
  'clean-corporate',
  'bold-graphic',
  'vivid-playful',
] as const;

export const STYLE_GALLERY_THEMES = ['light', 'dark'] as const;

export const STYLE_GALLERY_COMPLEXITY = [
  'static site',
  'front-end app (local state)',
] as const;

export type StyleGalleryGroup = (typeof STYLE_GALLERY_GROUPS)[number];
export type StyleGalleryCategory = (typeof STYLE_GALLERY_CATEGORIES)[number];
export type StyleGalleryTheme = (typeof STYLE_GALLERY_THEMES)[number];

/** The ten `###` sections every build prompt has, in this order. */
export const STYLE_PROMPT_SECTIONS = [
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
] as const;

export interface StyleSwatch {
  role: string;
  hex: string;
}

export interface StyleColorToken extends StyleSwatch {
  /** A CSS custom property name, such as `--color-canvas`. */
  token: string;
}

export interface StyleTypeStep {
  /** A CSS custom property name, such as `--text-16`. */
  token: string;
  size: string;
  font: string;
  weight: number;
  line_height: number;
  tracking: string;
}

export interface StyleDesignTokens {
  theme: StyleGalleryTheme;
  colors: StyleColorToken[];
  fonts: { display: string; body: string; mono?: string };
  type_scale: StyleTypeStep[];
  spacing: { base_unit: string; density: string; scale: string[] };
  /** Corner radius per element, such as `{ buttons: '4px' }`. */
  radius: Record<string, string>;
  shadows?: string[];
  gradients?: string[];
  layout?: {
    max_width?: string;
    section_gap?: string;
    card_padding?: string;
    element_gap?: string;
  };
}

export interface StyleContrastCheck {
  use: string;
  fg: string;
  bg: string;
  /** Absent on a decorative pair, whose `use` says "exempt". */
  ratio?: number | null;
  target: number;
}

export interface StyleGalleryEntry {
  id: string;
  name: string;
  kind: string;
  group: StyleGalleryGroup;
  category: StyleGalleryCategory;
  theme: StyleGalleryTheme;
  style_tags: string[];
  signature: string[];
  screen_types: string[];
  patterns: string[];
  purpose: string;
  audience: string[];
  layout: string[];
  visual_style: {
    palette: StyleSwatch[];
    typography: { display: string; body: string; notes: string };
    spacing: string;
    mood: string;
    imagery: string;
  };
  design_tokens: StyleDesignTokens;
  key_components: string[];
  component_specs: { component: string; spec: string }[];
  interactions: string[];
  states: string[];
  data_model: string[];
  stack_suggested: string[];
  complexity: string;
  guardrails: { ux: string[]; accessibility: string[]; security: string[] };
  contrast_checks: StyleContrastCheck[];
  /** Markdown with the ten `STYLE_PROMPT_SECTIONS`. */
  build_prompt: string;
}

/** Where an import came from: enough to find the exact source again. */
export interface StyleGallerySource {
  repository: string;
  path: string;
  /** The last commit that changed `path`, or null if it was not a checkout. */
  commit: string | null;
}

export interface StyleGalleryCatalog {
  title: string;
  /** The source catalog's own `updated` date. */
  updated: string;
  source: StyleGallerySource;
  /** The rules every build prompt assumes, sent ahead of it. */
  baseline_rules_markdown: string;
  /** Sorted by `id`. */
  entries: StyleGalleryEntry[];
}

/** What an upsert did, by id. */
export interface StyleGalleryChanges {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** `value` with every object's keys sorted, so key order never counts. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

const byId = (a: StyleGalleryEntry, b: StyleGalleryEntry) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The catalog after an import: every incoming entry upserted by `id`, and
 * every existing id the source no longer has dropped. Running it again with
 * the same input changes nothing, which is what makes an import idempotent.
 *
 * An incoming id given twice is refused rather than silently resolved,
 * because which one wins would depend on order.
 */
export function upsertStyleGallery(
  existing: StyleGalleryCatalog | null,
  incoming: Omit<StyleGalleryCatalog, 'entries'> & {
    entries: readonly StyleGalleryEntry[];
  },
): { catalog: StyleGalleryCatalog; changes: StyleGalleryChanges } {
  const before = new Map(existing?.entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const changes: StyleGalleryChanges = {
    added: [],
    updated: [],
    removed: [],
    unchanged: 0,
  };
  const entries: StyleGalleryEntry[] = [];
  for (const entry of incoming.entries) {
    if (seen.has(entry.id)) {
      throw new Error(`style gallery: id ${entry.id} is given twice`);
    }
    seen.add(entry.id);
    const old = before.get(entry.id);
    if (!old) changes.added.push(entry.id);
    else if (!sameValue(old, entry)) changes.updated.push(entry.id);
    else changes.unchanged += 1;
    // An unchanged entry keeps the stored object, so nothing reorders it.
    entries.push(old && sameValue(old, entry) ? old : entry);
  }
  for (const id of before.keys()) if (!seen.has(id)) changes.removed.push(id);
  changes.added.sort();
  changes.updated.sort();
  changes.removed.sort();
  return {
    catalog: {
      title: incoming.title,
      updated: incoming.updated,
      source: incoming.source,
      baseline_rules_markdown: incoming.baseline_rules_markdown,
      entries: entries.sort(byId),
    },
    changes,
  };
}

/**
 * The stored form: valid JSON, with one entry per line in `id` order, so a
 * re-import's diff names the styles that changed and nothing else.
 */
export function serializeStyleGallery(catalog: StyleGalleryCatalog): string {
  const entries = [...catalog.entries].sort(byId);
  const head = JSON.stringify({
    title: catalog.title,
    updated: catalog.updated,
    source: catalog.source,
    count: entries.length,
    baseline_rules_markdown: catalog.baseline_rules_markdown,
  });
  const lines = entries.map((entry) => JSON.stringify(entry));
  return `${head.slice(0, -1)},\n"entries":[\n${lines.join(',\n')}\n]}\n`;
}

/** The stored form, read back. Throws if `count` disagrees with the entries. */
export function parseStyleGallery(text: string): StyleGalleryCatalog {
  const raw = JSON.parse(text) as StyleGalleryCatalog & { count: number };
  if (raw.count !== raw.entries.length) {
    throw new Error(
      `style gallery: count ${raw.count} but ${raw.entries.length} entries`,
    );
  }
  return {
    title: raw.title,
    updated: raw.updated,
    source: raw.source,
    baseline_rules_markdown: raw.baseline_rules_markdown,
    entries: raw.entries,
  };
}

const HEX = /^#[0-9a-f]{6}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED: readonly (keyof StyleGalleryEntry)[] = [
  'id',
  'name',
  'kind',
  'group',
  'category',
  'theme',
  'style_tags',
  'signature',
  'screen_types',
  'patterns',
  'purpose',
  'audience',
  'layout',
  'visual_style',
  'design_tokens',
  'key_components',
  'component_specs',
  'interactions',
  'states',
  'data_model',
  'stack_suggested',
  'complexity',
  'guardrails',
  'contrast_checks',
  'build_prompt',
];

/**
 * Whether a swatch is decorative only. A role ending in "(decorative)"
 * never carries text; a swatch can hold several roles separated by " / "
 * ("canvas / supporting accent (decorative)"), and is decorative only when
 * every one of them is.
 */
export function isDecorativeRole(role: string): boolean {
  return role
    .split(' / ')
    .every((part) => /\(decorative\)\s*$/i.test(part.trim()));
}

/**
 * A contrast pair the catalog marks decorative, by saying "exempt" in its
 * `use`. Only that exempts it: a text pair that merely lacks a ratio is a
 * problem, not a pass.
 */
export function isExemptCheck(check: StyleContrastCheck): boolean {
  return /exempt/i.test(check.use);
}

const px = (size: string) => Number.parseFloat(size);

/**
 * Every problem with one entry, as `id: problem` lines; empty when it is
 * fine. These are the rules Chris set for the gallery and the ones the
 * source's own `validate.py` checks, measured again with vibld's contrast
 * code rather than taken on trust.
 *
 * `fonts`, when given, is the set of families an entry may use.
 */
export function checkStyleEntry(
  entry: StyleGalleryEntry,
  fonts?: ReadonlySet<string>,
): string[] {
  const id = entry.id ?? '(no id)';
  const problems: string[] = [];
  const say = (problem: string) => problems.push(`${id}: ${problem}`);
  const missing = REQUIRED.filter((field) => entry[field] === undefined);
  if (missing.length > 0) {
    say(`missing ${missing.join(', ')}`);
    return problems;
  }
  if (!KEBAB.test(entry.id)) say('id is not kebab-case');
  if (!(STYLE_GALLERY_GROUPS as readonly string[]).includes(entry.group)) {
    say(`unknown group ${entry.group}`);
  }
  if (
    !(STYLE_GALLERY_CATEGORIES as readonly string[]).includes(entry.category)
  ) {
    say(`unknown category ${entry.category}`);
  }
  if (!(STYLE_GALLERY_THEMES as readonly string[]).includes(entry.theme)) {
    say(`unknown theme ${entry.theme}`);
  }
  if (
    !(STYLE_GALLERY_COMPLEXITY as readonly string[]).includes(entry.complexity)
  ) {
    say(`unknown complexity ${entry.complexity}`);
  }

  const tokens = entry.design_tokens;
  const palette = entry.visual_style.palette;
  if (palette.length < 5 || palette.length > 12) {
    say(`palette has ${palette.length} swatches, not 5 to 12`);
  }
  for (const swatch of [...palette, ...tokens.colors]) {
    if (!HEX.test(swatch.hex)) say(`${swatch.hex} is not lowercase #rrggbb`);
  }
  const paletteKey = (list: StyleSwatch[]) =>
    list
      .map((s) => `${s.role}=${s.hex}`)
      .sort()
      .join('|');
  if (paletteKey(palette) !== paletteKey(tokens.colors)) {
    say('design_tokens.colors are not the palette');
  }
  for (const color of tokens.colors) {
    if (!/^--[a-z0-9-]+$/.test(color.token)) {
      say(`color token ${color.token} is not a CSS custom property`);
    }
  }

  const families = new Set<string>(
    [tokens.fonts.display, tokens.fonts.body, tokens.fonts.mono].filter(
      (font): font is string => Boolean(font),
    ),
  );
  for (const step of tokens.type_scale) families.add(step.font);
  if (fonts) {
    for (const family of families) {
      if (!fonts.has(family)) say(`font ${family} is not on the allowlist`);
    }
  }

  // Body text 16px or larger; nothing below 12px; light weights only large.
  const sizes = tokens.type_scale.map((step) => px(step.size));
  if (sizes.some((size) => !(size >= 12))) say('a type step is below 12px');
  // A body size of 16px must exist. It is not required to be in the body
  // family: one entry (vinepool) names Roboto Mono 16px as its body text but
  // lists Roboto Mono only at 15px, and its 16px step in Inter. Applying a
  // style sets body text at 16px whatever the scale says (D142).
  if (!sizes.some((size) => size === 16)) say('no 16px type step');
  for (const step of tokens.type_scale) {
    if (step.weight <= 300 && px(step.size) < 24) {
      say(`weight ${step.weight} at ${step.size}`);
    }
  }

  for (const kind of ['ux', 'accessibility', 'security'] as const) {
    if (entry.guardrails[kind].length === 0) say(`guardrails.${kind} is empty`);
  }
  if (entry.signature.length === 0) say('signature is empty');

  const at = STYLE_PROMPT_SECTIONS.map((heading) =>
    entry.build_prompt.indexOf(`### ${heading}`),
  );
  const absent = STYLE_PROMPT_SECTIONS.filter((_, i) => at[i] < 0);
  if (absent.length > 0) say(`build prompt lacks ${absent.join(', ')}`);
  else if (at.some((value, i) => i > 0 && value < at[i - 1])) {
    say('build prompt sections are out of order');
  }

  // The rules: no external links, and no decorative color behind text.
  if (/https?:\/\//i.test(JSON.stringify(entry))) say('contains a URL');
  // A hex two swatches share is decorative only if both swatches are.
  const carrying = new Set(
    tokens.colors.filter((c) => !isDecorativeRole(c.role)).map((c) => c.hex),
  );
  const decorative = new Set(
    tokens.colors
      .filter((c) => isDecorativeRole(c.role) && !carrying.has(c.hex))
      .map((c) => c.hex),
  );

  let measured = 0;
  for (const check of entry.contrast_checks) {
    if (isExemptCheck(check)) continue;
    measured += 1;
    if (typeof check.ratio !== 'number') {
      say(`${check.use}: no recorded ratio`);
      continue;
    }
    const ratio = contrastRatio(check.fg, check.bg);
    if (ratio === null) {
      say(`${check.use}: ${check.fg} on ${check.bg} is not hex`);
      continue;
    }
    if (ratio + 0.005 < check.target) {
      say(
        `${check.use}: ${check.fg} on ${check.bg} is ${ratio.toFixed(2)}, below ${check.target}`,
      );
    }
    if (Math.abs(ratio - check.ratio) > 0.02) {
      say(
        `${check.use}: recorded ${check.ratio} but measures ${ratio.toFixed(2)}`,
      );
    }
    for (const hex of [check.fg, check.bg]) {
      if (decorative.has(hex)) {
        say(`${check.use}: decorative ${hex} carries text`);
      }
    }
  }
  if (measured < 4) say(`only ${measured} measured contrast pairs`);
  return problems;
}

/**
 * Every problem with a catalog: each entry's, and ids or names repeated
 * within it or used by `taken` (other catalogs' ids and names, lower case).
 */
export function checkStyleGallery(
  catalog: StyleGalleryCatalog,
  options: { fonts?: ReadonlySet<string>; taken?: ReadonlySet<string> } = {},
): string[] {
  const problems: string[] = [];
  for (const field of ['id', 'name'] as const) {
    const seen = new Set<string>();
    for (const entry of catalog.entries) {
      const value = String(entry[field]).toLowerCase();
      if (seen.has(value)) problems.push(`repeated ${field}: ${entry[field]}`);
      seen.add(value);
    }
  }
  for (const entry of catalog.entries) {
    problems.push(...checkStyleEntry(entry, options.fonts));
    if (
      options.taken?.has(entry.id.toLowerCase()) ||
      options.taken?.has(entry.name.toLowerCase())
    ) {
      problems.push(`${entry.id}: id or name is already used elsewhere`);
    }
  }
  if (catalog.baseline_rules_markdown.trim() === '') {
    problems.push('the baseline rules are empty');
  }
  return problems;
}

/**
 * What a picker shows and filters on, and nothing else: a card is about 1%
 * of its entry. Search covers `name`, `kind`, `style_tags` and `signature`.
 */
export interface StyleCard {
  id: string;
  name: string;
  kind: string;
  group: StyleGalleryGroup;
  category: StyleGalleryCategory;
  theme: StyleGalleryTheme;
  style_tags: string[];
  signature: string[];
  palette: StyleSwatch[];
  fonts: { display: string; body: string };
}

export function styleCardOf(entry: StyleGalleryEntry): StyleCard {
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    group: entry.group,
    category: entry.category,
    theme: entry.theme,
    style_tags: entry.style_tags,
    signature: entry.signature,
    palette: entry.visual_style.palette,
    fonts: {
      display: entry.design_tokens.fonts.display,
      body: entry.design_tokens.fonts.body,
    },
  };
}
