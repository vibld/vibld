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
import { FONTSOURCE_WEIGHTS } from './fontsource-weights.ts';

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

/** A stored id: kebab-case, at most 64 characters. */
export function isStyleGalleryId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && KEBAB.test(value);
}

/** What a picker narrows the gallery by. An empty value is "any". */
export interface StyleCardFilter {
  theme?: StyleGalleryTheme | '';
  category?: StyleGalleryCategory | '';
  group?: StyleGalleryGroup | '';
  /** Words, each of which must appear in the name, kind, tags or signature. */
  query?: string;
}

function searchText(card: StyleCard): string {
  return [card.name, card.kind, ...card.style_tags, ...card.signature]
    .join(' ')
    .toLowerCase();
}

/**
 * The cards that pass every filter, in their given order. The query is
 * split on spaces and every word must match somewhere, so "dark serif"
 * finds a dark style with a serif in any of its searched fields.
 */
export function filterStyleCards(
  cards: readonly StyleCard[],
  filter: StyleCardFilter,
): StyleCard[] {
  const words = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter(
    (card) =>
      (!filter.theme || card.theme === filter.theme) &&
      (!filter.category || card.category === filter.category) &&
      (!filter.group || card.group === filter.group) &&
      (words.length === 0 ||
        words.every((word) => searchText(card).includes(word))),
  );
}

/** The industries as the source's README names them. */
export const STYLE_GROUP_LABELS: Record<StyleGalleryGroup, string> = {
  saas: 'SaaS',
  'agency-portfolio': 'Agency and portfolio',
  ecommerce: 'E-commerce',
  general: 'General brand',
  ai: 'AI',
  'design-tools': 'Design tools',
  devtools: 'Developer tools',
  fintech: 'Fintech',
  productivity: 'Productivity',
  'media-publishing': 'Media and publishing',
  web3: 'Web3',
};

export const STYLE_CATEGORY_LABELS: Record<StyleGalleryCategory, string> = {
  'monochrome-minimal': 'Monochrome minimal',
  'editorial-serif': 'Editorial serif',
  'dark-cinematic': 'Dark cinematic',
  'dark-technical': 'Dark technical',
  'warm-minimal': 'Warm minimal',
  'soft-gradient': 'Soft gradient',
  'clean-corporate': 'Clean corporate',
  'bold-graphic': 'Bold graphic',
  'vivid-playful': 'Vivid playful',
};

/*
 * Applying a style (D145): its design tokens as the CSS a generated site
 * imports, every value the catalog's own. Colors, type steps, radii and
 * shadows go into Tailwind v4's `@theme` under its own namespaces, which is
 * what makes `bg-canvas`, `text-62`, `rounded-cards` and `shadow-1` mean
 * this style's values. Nothing is derived or rounded.
 */

/** A radius name as a CSS identifier: "hero panels" is `hero-panels`. */
function cssName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A Google font's self-hosted package: "Roboto Mono" is `@fontsource/roboto-mono`. */
export function fontsourcePackage(family: string): string {
  return `@fontsource/${cssName(family)}`;
}

/** Every family the gallery's styles name, in first-use order. */
export function styleGalleryFamilies(
  entries: readonly StyleGalleryEntry[],
): string[] {
  const families = new Set<string>();
  for (const { design_tokens: tokens } of entries) {
    families.add(tokens.fonts.display);
    families.add(tokens.fonts.body);
    if (tokens.fonts.mono) families.add(tokens.fonts.mono);
    for (const step of tokens.type_scale) families.add(step.font);
  }
  return [...families];
}

/**
 * The weight Fontsource ships closest to the one asked for: a family has
 * no file for a weight it does not publish (`FONTSOURCE_WEIGHTS`). A tie
 * goes the way a browser would synthesize it, heavier above 500 and
 * lighter below.
 */
export function fontsourceWeight(family: string, weight: number): number {
  const available = FONTSOURCE_WEIGHTS[family];
  if (!available || available.length === 0 || available.includes(weight)) {
    return weight;
  }
  return available.reduce((best, candidate) => {
    const d = Math.abs(candidate - weight) - Math.abs(best - weight);
    if (d !== 0) return d < 0 ? candidate : best;
    return weight > 500 === candidate > best ? candidate : best;
  });
}

/**
 * Each family the style names or a type step sets, with the weights its
 * type scale sets in it, each one a weight Fontsource ships (`fontsourceWeight`). A family no
 * step uses (a body face the scale leaves out) gets the regular weight.
 */
export function styleGalleryFontWeights(
  tokens: StyleDesignTokens,
): { family: string; weights: number[] }[] {
  // The declared faces, then any a type step sets that none of them is:
  // some styles set a label or a numeral step in a third family.
  const families = [
    tokens.fonts.display,
    tokens.fonts.body,
    ...(tokens.fonts.mono ? [tokens.fonts.mono] : []),
    ...tokens.type_scale.map((step) => step.font),
  ].filter((family, i, all) => all.indexOf(family) === i);
  return families.map((family) => {
    const asked = tokens.type_scale
      .filter((step) => step.font === family)
      .map((step) => step.weight);
    const weights = [
      ...new Set(
        (asked.length > 0 ? asked : [400]).map((weight) =>
          fontsourceWeight(family, weight),
        ),
      ),
    ].sort((a, b) => a - b);
    return { family, weights };
  });
}

/** The stylesheet imports that self-host the fonts, one per weight. */
export function styleGalleryFontImports(tokens: StyleDesignTokens): string[] {
  return styleGalleryFontWeights(tokens).flatMap(({ family, weights }) =>
    weights.map((weight) => `${fontsourcePackage(family)}/${weight}.css`),
  );
}

const quoted = (family: string) => `'${family.replace(/'/g, '')}'`;

/**
 * The font utility a type step's family is set with: the declared faces
 * by role, and any other family a step names by its own name
 * (`font-archivo`), which `styleGalleryCss` declares.
 */
export function styleGalleryFontUtility(
  tokens: StyleDesignTokens,
  family: string,
): string {
  if (family === tokens.fonts.display) return 'font-display';
  if (family === tokens.fonts.body) return 'font-body';
  if (family === tokens.fonts.mono) return 'font-mono';
  return `font-${cssName(family)}`;
}

/** The `@theme` block for a style's tokens, and the base it sets. */
export function styleGalleryCss(tokens: StyleDesignTokens): string {
  const theme: string[] = [];
  for (const color of tokens.colors)
    theme.push(`${color.token}: ${color.hex};`);
  theme.push(
    `--font-display: ${quoted(tokens.fonts.display)};`,
    `--font-body: ${quoted(tokens.fonts.body)};`,
  );
  if (tokens.fonts.mono)
    theme.push(`--font-mono: ${quoted(tokens.fonts.mono)};`);
  // A family only a type step sets gets a utility of its own.
  for (const family of new Set(tokens.type_scale.map((step) => step.font))) {
    const utility = styleGalleryFontUtility(tokens, family);
    if (!['font-display', 'font-body', 'font-mono'].includes(utility)) {
      theme.push(`--${utility}: ${quoted(family)};`);
    }
  }
  for (const step of tokens.type_scale) {
    theme.push(
      `${step.token}: ${step.size};`,
      `${step.token}--line-height: ${step.line_height};`,
      `${step.token}--letter-spacing: ${step.tracking};`,
      `${step.token}--font-weight: ${step.weight};`,
    );
  }
  for (const [element, value] of Object.entries(tokens.radius)) {
    theme.push(`--radius-${cssName(element)}: ${value};`);
  }
  (tokens.shadows ?? []).forEach((shadow, i) => {
    theme.push(`--shadow-${i + 1}: ${shadow};`);
  });
  return [
    '@theme {',
    ...theme.map((line) => `  ${line}`),
    '}',
    '',
    // Chris's rule: body text is 16px, in the style's body face.
    '@layer base {',
    '  body { font-family: var(--font-body); font-size: 16px; }',
    '}',
  ].join('\n');
}

/**
 * Where a gallery style's tokens file goes (D145). Written from the
 * catalog's values whenever a build has a gallery style, never by the
 * model, so the values cannot drift (`withScaffold`).
 */
export const STYLE_TOKENS_PATH = 'src/vibld-gallery-style.css';

/**
 * What the tokens file says on its first line, which is how a build tells
 * the file Vibld wrote from one a project made itself.
 */
export const STYLE_TOKENS_MARKER = 'written by Vibld from the style gallery';

/**
 * The whole tokens file a build writes for a gallery style (D145,
 * `STYLE_TOKENS_PATH`): its self-hosted fonts, then its theme.
 */
export function styleTokensFile(entry: StyleGalleryEntry): string {
  const tokens = entry.design_tokens;
  return [
    `/* ${entry.name}: ${STYLE_TOKENS_MARKER}. Edits here are replaced on the next build. */`,
    ...styleGalleryFontImports(tokens).map((sheet) => `@import '${sheet}';`),
    '',
    styleGalleryCss(tokens),
    '',
  ].join('\n');
}

/**
 * The direction a mockup run is given for a gallery style (D146): the
 * same style a build in it gets, said in the few lines a sketch has room
 * for (`MAX_MOCKUP_DIRECTION_CHARS`, which `mockup-schema.test.ts` holds
 * every style to). Its colors with their roles, its faces and type steps,
 * its corners and what makes it recognizable.
 */
export function styleGalleryDirection(entry: StyleGalleryEntry): string {
  const tokens = entry.design_tokens;
  const decorative = tokens.colors
    .filter((color) => isDecorativeRole(color.role))
    .map((color) => color.hex);
  const faces = [
    `display ${tokens.fonts.display}`,
    `body ${tokens.fonts.body}`,
    ...(tokens.fonts.mono ? [`mono ${tokens.fonts.mono}`] : []),
  ];
  const steps = tokens.type_scale.map(
    (step) => `${step.size} ${step.font} ${step.weight}`,
  );
  const corners = Object.entries(tokens.radius).map(
    ([element, value]) => `${element} ${value}`,
  );
  return [
    `Draw it in one style from the style gallery, ${entry.name}: ${entry.kind}. Where this conflicts with an instruction in the request above, follow the request.`,
    `Colors, only these: ${tokens.colors.map((color) => `${color.role} ${color.hex}`).join('; ')}.`,
    ...(decorative.length > 0
      ? [`Decorative, never behind text: ${decorative.join(', ')}.`]
      : []),
    `Fonts, from Google Fonts: ${faces.join(', ')}. Type steps: ${steps.join('; ')}. Body text 16px; nothing under 12px.`,
    `Corners: ${corners.join('; ')}.${(tokens.shadows ?? []).length === 0 ? ' No shadows.' : ''}`,
    `What makes it this style: ${entry.signature.join('; ')}.`,
  ].join('\n');
}

/**
 * What a build in a gallery style is told (D146): the tokens file it has,
 * then the gallery's baseline rules, then the style's own build prompt, as
 * Chris asked. The style replaces the color, style preset and standing
 * preference guidance a build would otherwise get (`buildUserPrompt`).
 */
export function styleGalleryGuidance(
  baseline: string,
  entry: StyleGalleryEntry,
): string {
  const tokens = entry.design_tokens;
  const name = (token: string, prefix: string) => token.slice(prefix.length);
  const colors = tokens.colors.map((color) => name(color.token, '--color-'));
  const decorative = tokens.colors
    .filter((color) => isDecorativeRole(color.role))
    .map((color) => name(color.token, '--color-'));
  const steps = tokens.type_scale.map(
    (step) =>
      `${name(step.token, '--')} in ${styleGalleryFontUtility(tokens, step.font)}`,
  );
  const fonts = [
    ...new Set([
      'font-display',
      'font-body',
      ...(tokens.fonts.mono ? ['font-mono'] : []),
      ...tokens.type_scale.map((step) =>
        styleGalleryFontUtility(tokens, step.font),
      ),
    ]),
  ];
  const radii = Object.keys(tokens.radius).map(
    (element) => `rounded-${cssName(element)}`,
  );
  const shadows = (tokens.shadows ?? []).map((_, i) => `shadow-${i + 1}`);
  const lines = [
    `This build is in one complete style from the style gallery: ${entry.name}.`,
    `${STYLE_TOKENS_PATH} holds its tokens and fonts and is written for you; src/styles.css imports it. Do not write it and do not redeclare its tokens. Use them through utilities:`,
    `- colors (bg-, text-, border-): ${colors.join(', ')}`,
    `- type steps, each with its own line height, tracking and weight, and set in the face beside it: ${steps.join(', ')}`,
    `- fonts: ${fonts.join(', ')}`,
    `- corners: ${radii.join(', ')}`,
    ...(shadows.length > 0 ? [`- shadows: ${shadows.join(', ')}`] : []),
    ...(decorative.length > 0
      ? [
          `Decorative colors never sit behind text, at any size: ${decorative.join(', ')}.`,
        ]
      : []),
    'Body text is 16px or larger, and no text is below 12px.',
    'The rules and the build prompt below were written for any coding agent. Where they name a stack, package, backend or service that STACK above does not have, keep to STACK and build the page without it. The request itself outranks the style.',
  ];
  return `${lines.join('\n')}

--- BEGIN STYLE GALLERY RULES ---
${baseline.trim()}
--- END STYLE GALLERY RULES ---

--- BEGIN STYLE BUILD PROMPT ---
${entry.build_prompt.trim()}
--- END STYLE BUILD PROMPT ---`;
}
