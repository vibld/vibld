/**
 * Imports the design prompt catalog (Drummond-IT/designs-v1,
 * `design-prompt-catalog/`) into vibld's own shape, as
 * `packages/ai/data/design-templates.ts`, a data module rather than JSON so
 * every reader (Node, Vite, the Worker, TypeScript under any module
 * setting) can import it without import attributes. It is generated: change
 * this script, or the catalog, and run it again, never the output.
 *
 *   node --experimental-strip-types bin/import-design-catalog.ts \
 *     <path to design-prompt-catalog> <commit sha> [google fonts metadata json]
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
 * It refuses to write anything if a check fails: a missing field or build
 * prompt heading, a repeated id or name, a recorded contrast pair below its
 * WCAG target, a mapped text pair below 4.5:1, or a typeface that is neither
 * on Google Fonts nor given a substitute below.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from '../src/contrast.ts';
import { hexToHsl, shadeAgainst } from '../src/color-space.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../data/design-templates.ts');
/**
 * Enough to name every design and route to it, and nothing else, for code
 * that runs on every page (vibld.com's `site.ts`) and must not carry the
 * whole catalog.
 */
const INDEX_OUT = resolve(HERE, '../data/design-template-index.ts');

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
  'stack_observed',
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
  { collection: 'examples'; slug: string; reason: string }
> = {
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
  group: 'apps' | 'websites';
  category: string;
  purpose: string;
  audience: string[];
  layout: string[];
  visual_style: {
    palette: { role: string; hex: string }[];
    typography: { display: string; body: string; notes?: string };
    spacing: string;
    mood: string;
    imagery: string;
  };
  key_components: string[];
  interactions: string[];
  data_model: string[];
  stack_observed: string[];
  complexity: string;
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
    if (!USE_CASE[e.category])
      problems.push(`${e.id}: unknown category ${e.category}`);
    for (const c of e.contrast_checks) {
      // Decorative pairs are exempt, as the catalog records them. Every
      // other pair with a target is measured here, including the ones the
      // catalog wrote no ratio for, which its own validator skips.
      if (!c.fg || !c.bg || !c.target || c.exempt || /exempt/i.test(c.use))
        continue;
      const fg = c.fg.toLowerCase();
      const bg = c.bg.toLowerCase();
      if (!HEX6.test(fg) || !HEX6.test(bg)) {
        problems.push(`${e.id}: ${c.use} is not two 6-digit colours`);
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

/** A generated module whose one export is `value`, typed by its reader. */
function dataModule(value: unknown): string {
  return (
    '// Generated by packages/ai/bin/import-design-catalog.ts from\n' +
    '// Drummond-IT/designs-v1, design-prompt-catalog/. Do not edit: change the\n' +
    '// catalog or the importer and run it again.\n' +
    `const data: unknown = ${JSON.stringify(value, null, 2)};\n\nexport default data;\n`
  );
}

function main([dir, commit, fontsPath]: string[]) {
  if (!dir || !commit) {
    console.error(
      'usage: import-design-catalog.ts <design-prompt-catalog dir> <commit sha> [fonts metadata json]',
    );
    process.exit(2);
  }
  const source = JSON.parse(
    readFileSync(join(dir, 'design-catalog.json'), 'utf8'),
  ) as {
    updated: string;
    count: number;
    entries: SourceEntry[];
  };
  const baseline = readFileSync(join(dir, 'baseline.md'), 'utf8');
  const checkedPairs = checkSource(source.entries, source.count);
  for (const id of Object.keys(MERGED_INTO)) {
    if (!source.entries.some((e) => e.id === id)) {
      problems.push(`MERGED_INTO names ${id}, which the catalog does not have`);
    }
  }

  const fonts = makeFontResolver(googleFamilies(fontsPath));
  const templates = source.entries.map((e) => {
    const display = fonts.resolveFamily(
      e.id,
      e.visual_style.typography.display,
    );
    const body = fonts.resolveFamily(
      e.id,
      e.visual_style.typography.body,
      display,
    );
    const heading = display.onGoogleFonts
      ? display.family
      : display.substitute!;
    const bodyFont = body.onGoogleFonts ? body.family : body.substitute!;
    const { colors, derived } = mapColors(e.id, e.visual_style.palette);
    return {
      id: e.id,
      name: e.name,
      summary: e.kind,
      kind: e.group === 'apps' ? 'app' : 'site',
      useCase: USE_CASE[e.category],
      category: e.category,
      complexity: e.complexity,
      ...(MERGED_INTO[e.id] ? { mergedInto: MERGED_INTO[e.id] } : {}),
      purpose: e.purpose,
      audience: e.audience,
      layout: e.layout,
      components: e.key_components,
      interactions: e.interactions,
      dataModel: e.data_model,
      stack: e.stack_observed,
      style: {
        mood: e.visual_style.mood,
        imagery: e.visual_style.imagery,
        spacing: e.visual_style.spacing,
        palette: e.visual_style.palette,
        typography: e.visual_style.typography,
        fonts: { display, body },
        contrastChecks: e.contrast_checks,
        tokens: {
          colors,
          typography: {
            headingFont: heading,
            bodyFont,
            googleFontsUrl: fonts.cssUrl([heading, bodyFont]),
          },
          radius: radiusOf(e.visual_style.spacing),
        },
        derived,
      },
      buildPrompt: e.build_prompt,
    };
  });

  if (problems.length > 0) {
    console.error(`${problems.length} problems; nothing written:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const output = {
    source: {
      repository: 'Drummond-IT/designs-v1',
      path: 'design-prompt-catalog',
      commit,
      updated: source.updated,
    },
    baseline: housed(baseline),
    templates: housed(templates),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, dataModule(output));
  const index = output.templates.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.summary,
    kind: t.kind,
    useCase: t.useCase,
    ...(t.mergedInto ? { mergedInto: t.mergedInto.slug } : {}),
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
      `${Object.keys(MERGED_INTO).length} merged into examples, ` +
      `${dashesRewritten} em-dashes rewritten -> ${OUT}`,
  );
}

main(process.argv.slice(2));
