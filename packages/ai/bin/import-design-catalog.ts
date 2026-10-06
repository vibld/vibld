/**
 * Imports Drummond-IT/designs-v1's two catalogs, the design prompt catalog
 * (`design-prompt-catalog/`) and the SaaS screen patterns
 * (`saas-screen-patterns/`, D107 to D110), into vibld's own shape, as
 * `packages/ai/data/design-templates.ts`, a data module rather than JSON so
 * every reader (Node, Vite, the Worker, TypeScript under any module
 * setting) can import it without import attributes. It is generated: change
 * this script, or the catalog, and run it again, never the output.
 *
 *   node --experimental-strip-types bin/import-design-catalog.ts \
 *     <designs-v1 checkout> [google fonts metadata json]
 *
 * Each batch records the last commit in the checkout that changed it.
 *
 * The Google Fonts metadata (https://fonts.google.com/metadata/fonts) is
 * fetched when no file is given. It is read only here, to decide which of a
 * design's typefaces a generated project can load from Google Fonts, and the
 * answer is written into the output, so nothing downstream needs a network.
 *
 * What it keeps as it was: every entry's name, id, descriptor, purpose,
 * audience, layout, components, interactions, data model, palette, contrast
 * checks and build prompt, and the shared baseline. What it adds, in
 * vibld's terms (docs/decisions.md, D83 to D86):
 * - `kind` ('site' | 'app', as the examples catalogue says it) and
 *   `useCase` (the five use cases vibld.com is organised by), with the
 *   catalog's own category kept beside them;
 * - `mergedInto` for an entry that is the same product as one of vibld's
 *   own examples, which the gallery then shows once, on that example;
 * - an inspiration style: the palette mapped onto vibld's fifteen colour
 *   tokens, the type pairing as Google Fonts families, and a radius scale,
 *   in the same shape as a style preset's `tokens`.
 *
 * - its own set of typefaces (D103, `data/design-template-type.ts`): each
 *   family the design named is swapped, word for word, for one of the same
 *   construction, so no two designs share a set; a face the prompt does not
 *   yet name is added to its design system section;
 * - the batch it arrived in and when (D106), and its baseline;
 * - for a SaaS screen pattern (format `screen`), its screen types, patterns,
 *   states and guardrails, and the section a brief composes it as
 *   (`data/screen-patterns.ts`, D110). A screen keeps the catalog's faces
 *   (D108); an entry that is the same product as a design already here is
 *   merged into it (D107).
 *
 * It refuses to write anything if a check fails: a missing field or build
 * prompt heading, a repeated id or name, a recorded contrast pair below its
 * WCAG target, a mapped text pair below 4.5:1, or a typeface that is neither
 * on Google Fonts nor given a substitute below.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert as toUsEnglish } from '../../../scripts/us-english.mjs';
import { contrastRatio } from '../src/contrast.ts';
import { hexToHsl, shadeAgainst } from '../src/color-space.ts';
import { TYPE_SETS } from '../data/design-template-type.ts';
import { SAAS_TYPE_SETS } from '../data/saas-template-type.ts';
import type { TypeSet } from '../data/design-template-type.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../data/design-templates.ts');
/**
 * Enough to name every design and route to it, and nothing else, for code
 * that runs on every page (vibld.com's `site.ts`) and must not carry the
 * whole catalog.
 */
const INDEX_OUT = resolve(HERE, '../data/design-template-index.ts');
/**
 * The screen patterns as a brief composes them (D110), small enough for the
 * builder to load when its screen picker opens.
 */
const SCREENS_OUT = resolve(HERE, '../data/screen-patterns.ts');

const HEADINGS = [
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
];

const REQUIRED = [
  'id',
  'name',
  'kind',
  'group',
  'category',
  'purpose',
  'audience',
  'layout',
  'visual_style',
  'key_components',
  'interactions',
  'data_model',
  'complexity',
  'contrast_checks',
  'build_prompt',
];

/**
 * The catalog's twenty categories onto vibld.com's five use cases (D84).
 * Every app is a small tool or app; a website goes where its subject does.
 */
const USE_CASE: Record<string, string> = {
  'business-tools': 'tools',
  'developer-tools': 'tools',
  education: 'tools',
  finance: 'tools',
  'internal-tools': 'tools',
  lifestyle: 'tools',
  presentations: 'tools',
  'product-management': 'tools',
  productivity: 'tools',
  'project-management': 'tools',
  saas: 'tools',
  blog: 'small-business',
  ecommerce: 'small-business',
  editorial: 'small-business',
  services: 'small-business',
  events: 'events',
  'landing-page': 'saas-landing',
  music: 'portfolio',
  portfolio: 'portfolio',
  resume: 'portfolio',
};

/**
 * Entries that are the same product as one of vibld's own examples (D85).
 * Merged rather than listed twice: the gallery shows the example, with the
 * catalog's design attached to it. A similar subject is not enough, so the
 * coffee shop ordering site (daybreak-roasters) stays its own entry beside
 * the roaster's marketing site.
 */
const MERGED_INTO: Record<
  string,
  { collection: 'examples' | 'templates'; slug: string; reason: string }
> = {
  // The SaaS screen patterns (D107): the same product as a design already
  // in the catalog, shown on that design as another way to draw it.
  cuetide: {
    collection: 'templates',
    slug: 'queueline',
    reason:
      'A pre-launch waitlist page: a countdown, a signup count and an email form.',
  },
  dawnlist: {
    collection: 'templates',
    slug: 'queueline',
    reason:
      'A dark pre-launch waitlist page that collects names and emails for a launch.',
  },
  coquill: {
    collection: 'templates',
    slug: 'plainwrite',
    reason:
      'A collaborative documents editor with live cursors and inline comments.',
  },
  chorusdesk: {
    collection: 'templates',
    slug: 'plainwrite',
    reason:
      'A collaborative documents app with presence, live cursors and sharing.',
  },
  hexledger: {
    collection: 'templates',
    slug: 'nightvault',
    reason:
      'A dark marketing site for a payments and business-finance startup.',
  },
  gildway: {
    collection: 'templates',
    slug: 'tallyway',
    reason: 'A marketing site for a payments and cards startup.',
  },
  'kasimir-lund': {
    collection: 'examples',
    slug: 'freelance-portfolio-opus-5-5',
    reason: "An illustrator's portfolio with a gallery and a short bio.",
  },
  paysprout: {
    collection: 'examples',
    slug: 'budget-tracker-gpt-6-sol',
    reason: 'A personal budget tracker: income, expenses and a balance.',
  },
  'makers-forum-26': {
    collection: 'examples',
    slug: 'conference-gpt-6-sol',
    reason: 'A tech conference site with a schedule and speakers.',
  },
};

/**
 * Each batch this imports (D106), in the order they arrived: where it is in
 * Drummond-IT/designs-v1, its data file, and when vibld added it.
 */
export const SOURCES = [
  {
    batch: 'design-catalog',
    path: 'design-prompt-catalog',
    file: 'design-catalog.json',
    addedOn: '2026-09-30',
  },
  {
    batch: 'saas-screen-patterns',
    path: 'saas-screen-patterns',
    file: 'saas-screen-patterns.json',
    addedOn: '2026-09-30',
  },
] as const;

type Format = 'design' | 'page' | 'screen' | 'section';

/**
 * The SaaS screen patterns' entries that are one page rather than a site
 * (D106): its marketing-sites group holds one 404 page.
 */
const FORMAT_OVERRIDES: Record<string, Format> = { lostlane: 'page' };

/**
 * What an entry is, in vibld's terms (D84, D110). The design catalog's apps
 * are tools and its websites go where their subject does. Of the SaaS screen
 * patterns: an app screen is a screen pattern a template composes; a
 * marketing site is a SaaS landing site; a starter is a site when it is a
 * static site and an app otherwise, and a SaaS landing site when it is a
 * marketing site or a waitlist.
 */
function classify(e: SourceEntry): {
  kind: 'site' | 'app';
  useCase: string | undefined;
  format: Format;
} {
  const format = FORMAT_OVERRIDES[e.id] ?? 'design';
  switch (e.group) {
    case 'apps':
    case 'websites':
      return {
        kind: e.group === 'apps' ? 'app' : 'site',
        useCase: USE_CASE[e.category],
        format,
      };
    case 'app-screens':
      return { kind: 'app', useCase: 'tools', format: 'screen' };
    case 'marketing-sites':
      return { kind: 'site', useCase: 'saas-landing', format };
    case 'saas-starters':
      return {
        kind: e.complexity === 'static site' ? 'site' : 'app',
        useCase: /^(marketing-site|waitlist)$/.test(e.category)
          ? 'saas-landing'
          : 'tools',
        format,
      };
    default:
      return { kind: 'app', useCase: undefined, format };
  }
}

/**
 * Typefaces the catalog names that Google Fonts does not serve, and the
 * Google family a generated project loads in their place (D86). The design
 * keeps the name it was drawn with; only the file a project fetches changes.
 * Each substitute is the Google family closest in construction.
 */
const FONT_SUBSTITUTES: Record<string, string> = {
  Satoshi: 'Plus Jakarta Sans',
  'General Sans': 'Inter',
  Switzer: 'Inter',
  'Clash Display': 'Space Grotesk',
  'Clash Grotesk': 'Space Grotesk',
  'Cabinet Grotesk': 'Bricolage Grotesque',
  'Neue Montreal': 'Inter Tight',
  'PP Neue Montreal': 'Inter Tight',
  Supreme: 'Manrope',
  Gambetta: 'Fraunces',
  Erode: 'Fraunces',
  Sentient: 'Newsreader',
  Zodiak: 'Playfair Display',
  Boska: 'Instrument Serif',
  Chillax: 'Outfit',
  Panchang: 'Syne',
  Ranade: 'Plus Jakarta Sans',
  Synonym: 'DM Sans',
  Telma: 'Fraunces',
  Tanker: 'Anton',
  Helvetica: 'Inter',
  'Helvetica Neue': 'Inter',
  Arial: 'Inter',
  'SF Pro': 'Inter',
  'SF Pro Display': 'Inter',
  'SF Pro Text': 'Inter',
  Söhne: 'Inter',
  Georgia: 'Source Serif 4',
  'Times New Roman': 'Tinos',
  Menlo: 'JetBrains Mono',
  Monaco: 'JetBrains Mono',
  'SF Mono': 'JetBrains Mono',
  Consolas: 'JetBrains Mono',
  'Courier New': 'Courier Prime',
  // Named by construction rather than by family.
  Grotesk: 'Hanken Grotesk',
  Monospace: 'JetBrains Mono',
};

/** "System UI" and the like: the design asked for the platform's own face. */
const SYSTEM_FACE =
  /^(system(\s*ui)?|system-ui|system sans|-apple-system|platform)/i;
const SYSTEM_SUBSTITUTE = 'Inter';

interface SourceEntry {
  id: string;
  name: string;
  kind: string;
  group:
    'apps' | 'websites' | 'app-screens' | 'marketing-sites' | 'saas-starters';
  category: string;
  purpose: string;
  audience: string[];
  layout: string[];
  visual_style: {
    palette: { role: string; hex: string }[];
    typography: { display: string; body: string; notes?: string };
    /** 37 SaaS screen patterns give it as named parts. */
    spacing: string | Record<string, string>;
    mood: string;
    imagery: string;
  };
  key_components: string[];
  interactions: string[];
  data_model: string[];
  /** The design catalog's word for it. */
  stack_observed?: string[];
  /** The SaaS screen patterns' word for it. */
  stack_suggested?: string[];
  complexity: string;
  /** SaaS screen patterns only. */
  screen_types?: string[];
  patterns?: string[];
  states?: string[];
  guardrails?: { ux: string[]; accessibility: string[]; security: string[] };
  contrast_checks: {
    use: string;
    fg?: string;
    bg?: string;
    ratio?: number;
    target?: number;
    exempt?: unknown;
  }[];
  build_prompt: string;
}

type ColorName =
  | 'primary'
  | 'onPrimary'
  | 'secondary'
  | 'onSecondary'
  | 'accent'
  | 'onAccent'
  | 'background'
  | 'foreground'
  | 'card'
  | 'cardForeground'
  | 'muted'
  | 'mutedForeground'
  | 'border'
  | 'destructive'
  | 'onDestructive';

/** The pairs a reader reads, as `style-tokens.test.ts` holds a preset to. */
export const TEXT_PAIRS: readonly (readonly [ColorName, ColorName])[] = [
  ['foreground', 'background'],
  ['cardForeground', 'card'],
  ['mutedForeground', 'muted'],
  ['mutedForeground', 'background'],
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onAccent', 'accent'],
  ['onDestructive', 'destructive'],
];

const HEX6 = /^#[0-9a-f]{6}$/;
const problems: string[] = [];

const EM_DASH = String.fromCodePoint(0x2014);
const EN_DASH = String.fromCodePoint(0x2013);
let dashesRewritten = 0;

/**
 * The one change made to the catalog's words (D87). vibld's house rule bans
 * the em-dash in every tracked file, and its design checks fail a generated
 * project that contains one, so a prompt asking for one would fail its own
 * build. A quoted em-dash is the glyph a design shows in an empty cell and
 * becomes an en-dash; one in prose becomes the repository's `--`.
 */
function house(text: string): string {
  if (!text.includes(EM_DASH)) return text;
  dashesRewritten += text.split(EM_DASH).length - 1;
  return text
    .replace(new RegExp(`(["'])${EM_DASH}(["'])`, 'g'), `$1${EN_DASH}$2`)
    .replace(new RegExp(`\\s*${EM_DASH}\\s*`, 'g'), ' -- ');
}

/** Every string in `value`, through `house`. */
function housed<T>(value: T): T {
  if (typeof value === 'string') return house(value) as T;
  if (Array.isArray(value)) return value.map(housed) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, housed(v)]),
    ) as T;
  }
  return value;
}

function ratio(a: string, b: string): number {
  return contrastRatio(a, b) ?? 0;
}

interface Swatch {
  role: string;
  hex: string;
}

function first(
  swatches: Swatch[],
  role: RegExp,
  not?: RegExp,
  accept: (hex: string) => boolean = () => true,
): string | undefined {
  return swatches.find(
    (s) => role.test(s.role) && !(not && not.test(s.role)) && accept(s.hex),
  )?.hex;
}

/**
 * The palette onto vibld's fifteen tokens. The catalog's own colours are
 * used wherever one holds the role and the pair it is read in passes; a
 * token no swatch can fill is solved from the nearest one and named in
 * `derived`, so what was drawn and what was worked out stay apart.
 */
function mapColors(entryId: string, palette: Swatch[]) {
  const swatches = palette
    .map((s) => ({ role: s.role.toLowerCase(), hex: s.hex.toLowerCase() }))
    .filter((s) => HEX6.test(s.hex));
  const all = swatches.map((s) => s.hex);
  const derived: ColorName[] = [];

  const background =
    first(
      swatches,
      /\b(background|canvas|page|base|paper|ground|app bg|body bg)\b/,
      /overlay|scrim|hero|dark section|dark band|footer|header|nav|button|chip|badge|tag|alt\b|inverse|hover|selected/,
    ) ??
    first(swatches, /background|canvas/) ??
    swatches[0]!.hex;

  /** The palette's best reader on `ground`, or a solved one. */
  const reader = (
    ground: string,
    prefer: RegExp,
    name: ColorName,
    target = 4.5,
    avoid = /\b(muted|secondary|subtle|placeholder|disabled)\b/,
  ): string => {
    const preferred = swatches
      .filter((s) => prefer.test(s.role) && !avoid.test(s.role))
      .map((s) => s.hex)
      .filter((hex) => ratio(hex, ground) >= target)
      .sort((a, b) => ratio(b, ground) - ratio(a, ground));
    if (preferred[0]) return preferred[0];
    const any = all
      .filter((hex) => hex !== ground && ratio(hex, ground) >= target)
      .sort((a, b) => ratio(b, ground) - ratio(a, ground));
    if (any[0]) return any[0];
    derived.push(name);
    return ratio('#ffffff', ground) >= ratio('#000000', ground)
      ? '#ffffff'
      : '#000000';
  };

  const TEXT = /\b(text|ink|foreground|body|heading|copy|type)\b/;
  const foreground = reader(background, TEXT, 'foreground');

  const surface = (role: RegExp, not: RegExp, fallback: string): string =>
    first(swatches, role, not, (hex) => ratio(foreground, hex) >= 4.5) ??
    fallback;
  const card = surface(
    /\b(card|surface|panel|tile|sheet|paper|well|elevated)\b/,
    /muted|secondary|dark|inverse|hover|border|text|overlay|scrim/,
    background,
  );
  const cardForeground =
    ratio(foreground, card) >= 4.5
      ? foreground
      : reader(card, TEXT, 'cardForeground');
  const muted = surface(
    /\b(muted|subtle|secondary surface|alt|tint|wash|sunken|track|zebra)\b/,
    /text|foreground|border|ink|label|on /,
    card,
  );

  // Muted text must read on the page, on a card and on a muted surface.
  const mutedCandidates = swatches
    .filter((s) =>
      /\b(muted|secondary|subtle|meta|caption|placeholder)\b.*\b(text|ink|foreground|label|copy)\b|\b(text|ink)\b.*\b(muted|secondary|subtle)\b/.test(
        s.role,
      ),
    )
    .map((s) => s.hex)
    .filter((hex) =>
      [background, card, muted].every((g) => ratio(hex, g) >= 4.5),
    );
  const mutedForeground = mutedCandidates[0] ?? foreground;

  const border =
    first(
      swatches,
      /\b(border|divider|rule|hairline|line|stroke|outline|separator)\b/,
      /decorative|focus|chart|text/,
    ) ??
    first(swatches, /\b(border|divider|rule|hairline)\b/) ??
    muted;

  // A fill a button or a link is drawn with, distinguishable from the page.
  const ACTION =
    /\b(primary|brand|accent|cta|button|action|link|highlight|key|signal)\b/;
  const NOT_FILL =
    /\b(text|foreground|ink|on |label|border|divider|background|canvas|overlay|scrim|surface|card)\b/;
  const fills = swatches
    .filter((s) => ACTION.test(s.role) && !NOT_FILL.test(s.role))
    .map((s) => s.hex);
  let primary = fills.find((hex) => ratio(hex, background) >= 3);
  if (!primary) {
    const saturated = all
      .filter(
        (hex) =>
          (hexToHsl(hex)?.saturation ?? 0) >= 30 && ratio(hex, background) >= 3,
      )
      .sort((a, b) => ratio(b, background) - ratio(a, background));
    primary = saturated[0];
  }
  if (!primary) {
    const seed = hexToHsl(fills[0] ?? foreground)!;
    primary =
      shadeAgainst(seed.hue, seed.saturation, background, 3) ?? foreground;
    derived.push('primary');
  }

  /** A label on a fill: the palette's page, ink, white or black, else solved. */
  const labelOn = (fill: string, name: ColorName): string => {
    const options = [background, foreground, card, ...all, '#ffffff'];
    const passing = options
      .filter((hex) => ratio(hex, fill) >= 4.5)
      .sort((a, b) => ratio(b, fill) - ratio(a, fill));
    if (passing[0]) return passing[0];
    derived.push(name);
    return ratio('#ffffff', fill) >= ratio('#000000', fill)
      ? '#ffffff'
      : '#000000';
  };

  const onPrimary = labelOn(primary, 'onPrimary');
  const secondary =
    first(swatches, /\bsecondary\b/, /text|foreground|ink|label|border/) ??
    muted;
  const onSecondary = labelOn(secondary, 'onSecondary');
  const accent =
    first(
      swatches,
      /\baccent\b/,
      /text|foreground|ink|label|border/,
      (hex) => hex !== primary,
    ) ?? secondary;
  const onAccent = labelOn(accent, 'onAccent');

  let destructive = first(
    swatches,
    /\b(error|danger|destructive|negative|alert|critical|overdue|liability)\b/,
    /text|foreground|ink|background|surface|border|tint/,
    (hex) => ratio(hex, background) >= 3,
  );
  if (!destructive) {
    destructive = shadeAgainst(4, 76, background, 3) ?? '#b42318';
    derived.push('destructive');
  }
  const onDestructive = labelOn(destructive, 'onDestructive');

  const colors: Record<ColorName, string> = {
    primary,
    onPrimary,
    secondary,
    onSecondary,
    accent,
    onAccent,
    background,
    foreground,
    card,
    cardForeground,
    muted,
    mutedForeground,
    border,
    destructive,
    onDestructive,
  };
  for (const [fg, bg] of TEXT_PAIRS) {
    const measured = ratio(colors[fg], colors[bg]);
    if (measured < 4.5) {
      problems.push(
        `${entryId}: mapped ${fg} ${colors[fg]} on ${bg} ${colors[bg]} is ${measured.toFixed(2)}:1`,
      );
    }
  }
  if (ratio(primary, background) < 3) {
    problems.push(`${entryId}: primary on background below 3:1`);
  }
  return { colors, derived: [...new Set(derived)] };
}

interface GoogleFamily {
  family: string;
  fonts: Record<string, unknown>;
}

function googleFamilies(metadataPath: string | undefined): GoogleFamily[] {
  const text = metadataPath
    ? readFileSync(metadataPath, 'utf8')
    : execFileSync(
        'curl',
        ['-sS', '-m', '60', 'https://fonts.google.com/metadata/fonts'],
        {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        },
      );
  const json = JSON.parse(text.replace(/^\)\]\}'\n?/, '')) as {
    familyMetadataList: GoogleFamily[];
  };
  return json.familyMetadataList;
}

const WEIGHT_WORDS =
  /\b(thin|hairline|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|condensed|expanded)\b/gi;

interface FontChoice {
  asWritten: string;
  family: string;
  onGoogleFonts: boolean;
  substitute?: string;
}

function makeFontResolver(families: GoogleFamily[]) {
  const byLower = new Map(families.map((f) => [f.family.toLowerCase(), f]));
  const names = families
    .map((f) => f.family)
    .sort((a, b) => b.length - a.length);
  const substitutes = Object.keys(FONT_SUBSTITUTES).sort(
    (a, b) => b.length - a.length,
  );

  const resolveFamily = (
    entryId: string,
    text: string,
    fallback?: FontChoice,
  ): FontChoice => {
    const asWritten = text.split(/[,;(]/)[0]!.trim();
    if (/^(same|as (above|display)|matches)/i.test(asWritten) && fallback) {
      return { ...fallback, asWritten };
    }
    const cleaned = asWritten
      .replace(WEIGHT_WORDS, ' ')
      .replace(/\b\d+(\.\d+)?(px|rem|pt)?\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (SYSTEM_FACE.test(cleaned) || SYSTEM_FACE.test(asWritten)) {
      return {
        asWritten,
        family: 'system-ui',
        onGoogleFonts: false,
        substitute: SYSTEM_SUBSTITUTE,
      };
    }
    // Longest Google family the text starts with, then anywhere in it.
    const lower = cleaned.toLowerCase();
    for (const name of substitutes) {
      if (lower.startsWith(name.toLowerCase())) {
        return {
          asWritten,
          family: name,
          onGoogleFonts: false,
          substitute: FONT_SUBSTITUTES[name]!,
        };
      }
    }
    for (const name of names) {
      const n = name.toLowerCase();
      if (lower === n || lower.startsWith(n + ' ')) {
        return {
          asWritten,
          family: byLower.get(n)!.family,
          onGoogleFonts: true,
        };
      }
    }
    const whole = text.toLowerCase();
    for (const name of substitutes) {
      if (new RegExp(`\\b${name.toLowerCase()}\\b`).test(whole)) {
        return {
          asWritten,
          family: name,
          onGoogleFonts: false,
          substitute: FONT_SUBSTITUTES[name]!,
        };
      }
    }
    for (const name of names) {
      if (name.length < 4) continue;
      const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(whole)) {
        return { asWritten, family: name, onGoogleFonts: true };
      }
    }
    problems.push(
      `${entryId}: no Google Fonts family or substitute for "${text}"`,
    );
    return {
      asWritten,
      family: asWritten,
      onGoogleFonts: false,
      substitute: SYSTEM_SUBSTITUTE,
    };
  };

  const weightsOf = (family: string): string => {
    const meta = byLower.get(family.toLowerCase());
    const upright = Object.keys(meta?.fonts ?? {})
      .filter((k) => /^\d+$/.test(k))
      .map(Number);
    const wanted = [400, 500, 600, 700].filter((w) => upright.includes(w));
    return (wanted.length > 0 ? wanted : upright.slice(0, 1)).join(';');
  };

  const cssUrl = (families: string[]): string => {
    const unique = [...new Set(families)];
    const params = unique
      .map((f) => {
        const weights = weightsOf(f);
        return `family=${f.replace(/ /g, '+')}${weights ? `:wght@${weights}` : ''}`;
      })
      .join('&');
    return `https://fonts.googleapis.com/css2?${params}&display=swap`;
  };

  return { resolveFamily, cssUrl };
}

function radiusOf(spacing: string) {
  const text = spacing.toLowerCase();
  let md = 8;
  if (
    /\b(no|zero|0px?)\s+radius|square corners|sharp corners|hard corners|radius:?\s*0\b/.test(
      text,
    )
  ) {
    md = 0;
  } else {
    const match =
      /(\d+(?:\.\d+)?)\s*(px|rem)\s*(?:corner\s*)?radi/.exec(text) ??
      /radi\w*\s*(?:of|at|~|about|around|:)?\s*~?(\d+(?:\.\d+)?)\s*(px|rem)/.exec(
        text,
      );
    if (match) {
      const value = Number(match[1]);
      md = Math.round(match[2] === 'rem' ? value * 16 : value);
    }
  }
  const px = (n: number) => `${Math.max(0, Math.round(n))}px`;
  return {
    sm: px(md === 0 ? 0 : Math.max(2, md / 2)),
    md: px(md),
    lg: px(md * 1.5),
    pill: '999px',
  };
}

function checkSource(entries: SourceEntry[], count: number) {
  if (entries.length !== count) {
    problems.push(`count ${count} != ${entries.length} entries`);
  }
  for (const key of ['id', 'name'] as const) {
    const seen = new Set<string>();
    for (const e of entries) {
      const v = String(e[key]).toLowerCase();
      if (seen.has(v)) problems.push(`duplicate ${key}: ${e[key]}`);
      seen.add(v);
    }
  }
  let checked = 0;
  for (const e of entries) {
    const missing = REQUIRED.filter((k) => !(k in e));
    if (missing.length) problems.push(`${e.id}: missing ${missing.join(', ')}`);
    for (const h of HEADINGS) {
      if (!e.build_prompt.includes(`### ${h}`)) {
        problems.push(`${e.id}: build prompt lacks "### ${h}"`);
      }
    }
    if (!classify(e).useCase)
      problems.push(`${e.id}: unknown category ${e.category}`);
    if (!e.stack_observed && !e.stack_suggested)
      problems.push(`${e.id}: missing stack_observed or stack_suggested`);
    for (const c of e.contrast_checks) {
      // Decorative pairs are exempt, as the catalog records them. Every
      // other pair with a target is measured here, including the ones the
      // catalog wrote no ratio for, which its own validator skips.
      if (!c.fg || !c.bg || !c.target || c.exempt || /exempt/i.test(c.use))
        continue;
      const fg = c.fg.toLowerCase();
      const bg = c.bg.toLowerCase();
      if (!HEX6.test(fg) || !HEX6.test(bg)) {
        problems.push(`${e.id}: ${c.use} is not two 6-digit colors`);
        continue;
      }
      checked += 1;
      const measured = ratio(fg, bg);
      if (measured + 0.005 < c.target) {
        problems.push(
          `${e.id}: ${c.use} ${fg} on ${bg} is ${measured.toFixed(2)}:1, below ${c.target}`,
        );
      }
    }
  }
  return checked;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every Google Fonts family name, read once by `main`. */
let familyNames: readonly string[] = [];

/**
 * Swaps each family a type set replaces, as a whole name: never inside a
 * longer word or a hyphenated one, and never where it begins a longer
 * family ("Inter" is left alone in "Inter Tight" unless the set replaces
 * "Inter Tight" itself). Longest name first.
 */
function renamer(set: TypeSet): (text: string) => string {
  const pairs = Object.entries(set.replaces).sort(
    ([a], [b]) => b.length - a.length,
  );
  const patterns = pairs.map(([from, to]) => {
    const longer = familyNames
      .filter((name) => name.startsWith(`${from} `))
      .map((name) => `(?!${escapeRegExp(name.slice(from.length))}(?![A-Za-z]))`)
      .join('');
    return [
      new RegExp(
        `(?<![A-Za-z-])${escapeRegExp(from)}(?![A-Za-z]|-[A-Za-z])${longer}`,
        'g',
      ),
      to,
    ] as const;
  });
  // Two names the catalog gave as alternatives ("JetBrains Mono (or Geist
  // Mono)") can both become one family; the second is then dropped rather
  // than left reading "Martian Mono (or Martian Mono)".
  const collapses = [...new Set(pairs.map(([, to]) => to))].map(
    (to) =>
      [
        new RegExp(
          `(["']?)${escapeRegExp(to)}\\1(?:\\s*\\((?:or |and )?["']?${escapeRegExp(to)}["']?\\)|\\s*(?:/|,| or | and )\\s*["']?${escapeRegExp(to)}["']?)(?![A-Za-z])`,
          'g',
        ),
        `$1${to}$1`,
      ] as const,
  );
  const phrases = Object.entries(set.phrases ?? {});
  return (text) =>
    [...patterns, ...collapses].reduce(
      (out, [pattern, to]) => out.replace(pattern, to),
      phrases.reduce((out, [from, to]) => out.split(from).join(to), text),
    );
}

/**
 * The build prompt with its type set in it: every family named once
 * renamed, and a face the prompt does not mention added as a line at the end
 * of its design system section, with the use the set gives it.
 */
function withTypeSet(id: string, prompt: string, set: TypeSet): string {
  const renamed = renamer(set)(prompt);
  const missing = set.faces.filter(
    (face, i) =>
      set.faces.findIndex((f) => f.family === face.family) === i &&
      !new RegExp(`(?<![A-Za-z])${escapeRegExp(face.family)}(?![A-Za-z])`).test(
        renamed,
      ),
  );
  if (missing.length === 0) return renamed;
  const marker = '\n### Components & interactions';
  const at = renamed.indexOf(marker);
  if (at < 0) {
    problems.push(`${id}: no design system section to add a typeface to`);
    return renamed;
  }
  const lines = missing
    .map((face) => `- Typeface: ${face.family} (Google Fonts) for ${face.use}.`)
    .join('\n');
  return `${renamed.slice(0, at).trimEnd()}\n${lines}\n${renamed.slice(at)}`;
}

/** A generated module whose one export is `value`, typed by its reader. */
function dataModule(value: unknown): string {
  // US English in what people read (D120): the catalog's own text is
  // written the UK way, and scripts/us-english.mjs fails CI on it.
  return toUsEnglish(
    '// Generated by packages/ai/bin/import-design-catalog.ts from\n' +
      '// Drummond-IT/designs-v1 (design-prompt-catalog/, saas-screen-patterns/).\n' +
      '// Do not edit: change a catalog or the importer and run it again.\n' +
      `const data: unknown = ${JSON.stringify(value, null, 2)};\n\nexport default data;\n`,
    'data.ts',
  );
}

/** The body of a markdown section, from its heading to the next of its level. */
function sectionOf(text: string, heading: string, level = '### '): string {
  const start = text.indexOf(`${level}${heading}\n`);
  if (start < 0) return '';
  const body = text.slice(start + level.length + heading.length + 1);
  const next = body.indexOf(`\n${level}`);
  return (next < 0 ? body : body.slice(0, next)).trim();
}

/**
 * What a screen pattern adds to a brief it is composed into (D110): what it
 * is for, its patterns, layout, components, data and states, and its
 * guardrails. Its stack, design system and performance notes are left out:
 * the template's own apply.
 */
function screenSection(t: {
  name: string;
  summary: string;
  purpose: string;
  screenTypes?: readonly string[];
  patterns?: readonly string[];
  states?: readonly string[];
  guardrails?: {
    ux: readonly string[];
    accessibility: readonly string[];
    security: readonly string[];
  };
  buildPrompt: string;
}): string {
  const list = (items: readonly string[] | undefined) =>
    (items ?? []).map((item) => `- ${item}`).join('\n');
  const parts = [
    `### ${t.name}: ${t.summary}`,
    `Screen types: ${(t.screenTypes ?? []).join(', ')}.`,
    t.purpose,
    `#### Patterns\n${list(t.patterns)}`,
    ...(
      ['Pages & layout', 'Components & interactions', 'Data & state'] as const
    ).map((h) => `#### ${h}\n${sectionOf(t.buildPrompt, h)}`),
    `#### States to design\n${list(t.states)}`,
    `#### Guardrails\nUX:\n${list(t.guardrails?.ux)}\nAccessibility:\n${list(t.guardrails?.accessibility)}\nSecurity:\n${list(t.guardrails?.security)}`,
  ];
  return parts.join('\n\n');
}

/**
 * Spacing as one string: 37 SaaS screen patterns give it as named parts
 * ({ density, grid, radius, ... }), which become "Density: ... Grid: ...",
 * in the catalog's own order and words.
 */
function spacingText(spacing: string | Record<string, string>): string {
  if (typeof spacing === 'string') return spacing;
  return Object.entries(spacing)
    .map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${v}`)
    .join(' ');
}

/** The last commit in `checkout` that changed `path`. */
function commitOf(checkout: string, path: string): string {
  return execFileSync(
    'git',
    ['-C', checkout, 'log', '-1', '--format=%H', '--', path],
    {
      encoding: 'utf8',
    },
  ).trim();
}

/**
 * A screen pattern keeps the faces the catalog drew it in (D108): composed
 * into a template, it is drawn in that template's type, so its own set is
 * not one of the unique sets D103 gives a template.
 */
const SCREEN_TYPE_WHY =
  "The catalog's own faces. A screen composed into a template is drawn in that template's typefaces.";

function main([checkout, fontsPath]: string[]) {
  if (!checkout) {
    console.error(
      'usage: import-design-catalog.ts <Drummond-IT/designs-v1 checkout> [fonts metadata json]',
    );
    process.exit(2);
  }
  const loaded = SOURCES.map((src) => {
    const dir = join(checkout, src.path);
    const json = JSON.parse(readFileSync(join(dir, src.file), 'utf8')) as {
      updated: string;
      count: number;
      entries: SourceEntry[];
    };
    return {
      ...src,
      dir,
      commit: commitOf(checkout, src.path),
      updated: json.updated,
      count: json.count,
      entries: json.entries,
      baseline: readFileSync(join(dir, 'baseline.md'), 'utf8'),
    };
  });
  const entries = loaded.flatMap((src) =>
    src.entries.map((e) => ({ e, batch: src.batch, addedOn: src.addedOn })),
  );
  let checkedPairs = 0;
  for (const src of loaded) checkedPairs += checkSource(src.entries, src.count);
  // An id or a name is unique across every batch, not only within one.
  for (const key of ['id', 'name'] as const) {
    const seen = new Map<string, string>();
    for (const { e, batch } of entries) {
      const v = e[key].toLowerCase();
      const other = seen.get(v);
      if (other && other !== batch)
        problems.push(`${key} ${e[key]} is in both ${other} and ${batch}`);
      seen.set(v, batch);
    }
  }
  const byId = new Map(entries.map(({ e }) => [e.id, e]));
  for (const [id, merge] of Object.entries(MERGED_INTO)) {
    if (!byId.has(id)) {
      problems.push(`MERGED_INTO names ${id}, which the catalog does not have`);
    }
    if (merge.collection === 'templates') {
      if (!byId.has(merge.slug)) {
        problems.push(`${id} merges into ${merge.slug}, which is not a design`);
      } else if (MERGED_INTO[merge.slug]) {
        problems.push(
          `${id} merges into ${merge.slug}, which is itself merged`,
        );
      }
    }
  }
  const typeSets: Record<string, TypeSet> = { ...TYPE_SETS, ...SAAS_TYPE_SETS };

  const families = googleFamilies(fontsPath);
  familyNames = families.map((f) => f.family);
  const fonts = makeFontResolver(families);
  for (const id of Object.keys(typeSets)) {
    const e = byId.get(id);
    if (!e) {
      problems.push(`a type set names ${id}, which the catalog does not have`);
    } else if (classify(e).format === 'screen') {
      problems.push(`${id} is a screen, which keeps its own faces (D108)`);
    }
  }
  const templates = entries.map(({ e, batch, addedOn }) => {
    const { kind, useCase, format } = classify(e);
    const screenSet = (): TypeSet => {
      const display = fonts.resolveFamily(
        e.id,
        e.visual_style.typography.display,
      );
      const body = fonts.resolveFamily(
        e.id,
        e.visual_style.typography.body,
        display,
      );
      const family = (f: typeof display) =>
        f.onGoogleFonts ? f.family : (f.substitute ?? SYSTEM_SUBSTITUTE);
      return {
        faces: [
          {
            family: family(display),
            role: 'display',
            use: e.visual_style.typography.display,
          },
          {
            family: family(body),
            role: 'body',
            use: e.visual_style.typography.body,
          },
        ],
        replaces: {},
        why: SCREEN_TYPE_WHY,
      };
    };
    const set = format === 'screen' ? screenSet() : typeSets[e.id];
    if (!set) {
      problems.push(`${e.id}: no type set in data/design-template-type.ts`);
    }
    const typeSet: TypeSet = set ?? { faces: [], replaces: {}, why: '' };
    const rename = renamer(typeSet);
    const displayFace = typeSet.faces.find((f) => f.role === 'display');
    const bodyFace = typeSet.faces.find((f) => f.role === 'body');
    // The catalog's words, then the family each named is now (D103). A face
    // that was never on Google Fonts keeps its name, with the set's face as
    // what a project loads.
    const restyle = (
      font: ReturnType<typeof fonts.resolveFamily>,
      face: TypeSet['faces'][number] | undefined,
    ) => {
      if (!font.onGoogleFonts) {
        return { ...font, substitute: face?.family ?? font.substitute };
      }
      const renamed = typeSet.replaces[font.family];
      if (renamed !== undefined) {
        return {
          asWritten: rename(font.asWritten),
          family: renamed,
          onGoogleFonts: true,
        };
      }
      // Kept as it was, when the set keeps it; otherwise the set's own face
      // for the role (the resolver reads "Archivo Black" as Archivo in its
      // black weight, and the set names Archivo Black).
      return typeSet.faces.some((f) => f.family === font.family) || !face
        ? font
        : { ...font, family: face.family };
    };
    const display = restyle(
      fonts.resolveFamily(e.id, e.visual_style.typography.display),
      displayFace,
    );
    const body = restyle(
      fonts.resolveFamily(
        e.id,
        e.visual_style.typography.body,
        fonts.resolveFamily(e.id, e.visual_style.typography.display),
      ),
      bodyFace,
    );
    const heading = displayFace?.family ?? display.family;
    const bodyFont = bodyFace?.family ?? body.family;
    const typography = {
      ...e.visual_style.typography,
      display: rename(e.visual_style.typography.display),
      body: rename(e.visual_style.typography.body),
      ...(e.visual_style.typography.notes
        ? { notes: rename(e.visual_style.typography.notes) }
        : {}),
    };
    const { colors, derived } = mapColors(e.id, e.visual_style.palette);
    return {
      id: e.id,
      name: e.name,
      summary: e.kind,
      kind,
      useCase,
      category: e.category,
      complexity: e.complexity,
      format,
      batch,
      addedOn,
      ...(MERGED_INTO[e.id] ? { mergedInto: MERGED_INTO[e.id] } : {}),
      purpose: e.purpose,
      audience: e.audience,
      layout: e.layout,
      components: e.key_components,
      interactions: e.interactions,
      dataModel: e.data_model,
      stack: e.stack_observed ?? e.stack_suggested ?? [],
      ...(e.screen_types ? { screenTypes: e.screen_types } : {}),
      ...(e.patterns ? { patterns: e.patterns } : {}),
      ...(e.states ? { states: e.states } : {}),
      ...(e.guardrails ? { guardrails: e.guardrails } : {}),
      style: {
        mood: e.visual_style.mood,
        imagery: e.visual_style.imagery,
        spacing: spacingText(e.visual_style.spacing),
        palette: e.visual_style.palette,
        typography,
        fonts: { display, body },
        typeSet: typeSet.faces,
        typeWhy: typeSet.why,
        contrastChecks: e.contrast_checks,
        tokens: {
          colors,
          typography: {
            headingFont: heading,
            bodyFont,
            googleFontsUrl: fonts.cssUrl(typeSet.faces.map((f) => f.family)),
          },
          radius: radiusOf(spacingText(e.visual_style.spacing)),
        },
        derived,
      },
      buildPrompt: withTypeSet(e.id, e.build_prompt, typeSet),
    };
  });
  // No two designs share a set of families (D103); a screen keeps the
  // catalog's own (D108).
  const sets = new Map<string, string>();
  for (const t of templates) {
    if (t.format === 'screen') continue;
    const key = [...new Set(t.style.typeSet.map((f) => f.family))]
      .sort()
      .join(' + ');
    const other = sets.get(key);
    if (other)
      problems.push(`${t.id} has the same typefaces as ${other}: ${key}`);
    sets.set(key, t.id);
  }

  if (problems.length > 0) {
    console.error(`${problems.length} problems; nothing written:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const output = {
    sources: loaded.map((src) => ({
      batch: src.batch,
      repository: 'Drummond-IT/designs-v1',
      path: src.path,
      commit: src.commit,
      updated: src.updated,
      baseline: housed(src.baseline),
    })),
    templates: housed(templates),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, dataModule(output));
  const screenBaseline = output.sources
    .map((src) => sectionOf(src.baseline, 'SaaS screen baseline', '### '))
    .find(Boolean);
  if (!screenBaseline) {
    console.error('No "### SaaS screen baseline" in any baseline.md');
    process.exit(1);
  }
  writeFileSync(
    SCREENS_OUT,
    dataModule({
      baseline: `### SaaS screen baseline\n${screenBaseline}`,
      screens: output.templates
        .filter((t) => t.format === 'screen')
        .map((t) => ({
          id: t.id,
          name: t.name,
          summary: t.summary,
          category: t.category,
          screenTypes: t.screenTypes ?? [],
          section: screenSection(t),
        })),
    }),
  );
  const index = output.templates.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.summary,
    kind: t.kind,
    useCase: t.useCase,
    category: t.category,
    format: t.format,
    batch: t.batch,
    addedOn: t.addedOn,
    ...(t.mergedInto
      ? {
          mergedInto: {
            collection: t.mergedInto.collection,
            slug: t.mergedInto.slug,
          },
        }
      : {}),
  }));
  writeFileSync(INDEX_OUT, dataModule(index));
  const substituted = templates.filter(
    (t) =>
      !t.style.fonts.display.onGoogleFonts || !t.style.fonts.body.onGoogleFonts,
  ).length;
  const solved = templates.filter((t) => t.style.derived.length > 0).length;
  console.log(
    `${templates.length} templates, ${checkedPairs} recorded contrast pairs measured, ` +
      `${templates.length * TEXT_PAIRS.length} mapped text pairs at 4.5:1, ` +
      `${substituted} with a substituted typeface, ${solved} with a solved token, ` +
      `${Object.keys(MERGED_INTO).length} merged into another entry, ` +
      `${dashesRewritten} em-dashes rewritten -> ${OUT}`,
  );
}

main(process.argv.slice(2));
