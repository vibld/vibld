import { blockTracker, compareLayers, oklchToRgb } from './contrast.ts';
import { DESIGN_MD_PATH, readDesignSpec } from './design-spec.ts';
import type { DesignSpec, MotionEntry } from './design-spec.ts';
import { motionCoverage } from './motion-syntax.ts';
import type { MotionBindings } from './motion-syntax.ts';
import { dialectOf, expressionEnds, scriptSyntax } from './script-syntax.ts';
import type { ScriptDialect, ScriptSyntax } from './script-syntax.ts';

/**
 * Whether a finished project is the one its spec describes, and whether it
 * holds the few rules every generated page must.
 *
 * Before this the only question asked of a finished project was "does it
 * build". A page can build and still have dropped the scrim colour its
 * spec named, never loaded its display face, lost its mobile breakpoint,
 * shipped an image with no alt text or animated with no reduced-motion
 * rule. Those are exactly the specifics a measured brief exists to pin
 * down, and nothing looked.
 *
 * Static: every check reads the files, none renders them. It cannot see
 * computed contrast or a layout that overflows at 375px; it can see whether
 * the values and the rules the spec named made it into the code, which is
 * where a model most often drifts.
 *
 * Two severities, because a repair is a paid call that rewrites the whole
 * project. An error is something the checker is confident about: a colour,
 * font or breakpoint the spec named that appears nowhere, a page with no
 * `lang`, an image with no alt text. Only errors buy a repair. A warning is
 * a mismatch the checker could be wrong about (copy assembled at runtime,
 * a type size written another way) and rides along with a repair that is
 * happening anyway rather than causing one.
 */

export type FindingSeverity = 'error' | 'warning';

/** Written as a code point so this file does not trip its own rule. */
const EM_DASH = String.fromCodePoint(0x2014);

export interface DesignFinding {
  severity: FindingSeverity;
  /** A short stable name: `color`, `font`, `breakpoint`, `lang`, ... */
  check: string;
  /** What is wrong, specifically enough to fix without reading the checker. */
  detail: string;
}

export interface DesignReport {
  /** Whether the project had a spec to check against. */
  hasSpec: boolean;
  errors: DesignFinding[];
  warnings: DesignFinding[];
}

interface ProjectFileLike {
  path: string;
  content: string;
}

const SOURCE = /\.(tsx|jsx|ts|js|mjs|cjs|mts|cts|html|vue|svelte|astro)$/i;
const STYLE = /\.(css|scss|sass|less)$/i;
/** Tailwind's own config, the only place its `theme.screens` means anything. */
const TAILWIND_CONFIG = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts|cts|mts)$/i;
/** Source whose attributes follow HTML's rules rather than JSX's. */
const MARKUP = /\.(html|vue|svelte|astro)$/i;

/**
 * A CSS value in the one spelling the checker compares: lower case, no
 * whitespace, no leading zero before a decimal point, three-digit hex
 * expanded, and CSS Color 4's space-separated `rgb()` written the classic
 * way. So `rgba(2, 10, 18, 0.57)`, `rgb(2 10 18 / 57%)` and
 * `rgba(2,10,18,.57)` are the same value, which they are, and `#FFF` is
 * `#ffffff`. Percentage channels become 0-255 in either form, so
 * `rgb(100%, 0%, 0%)` is `rgb(255,0,0)`.
 */
export function normalizeCssValue(value: string): string {
  const classic = (
    r: string,
    g: string,
    b: string,
    a: string | undefined,
  ): string => {
    const channel = (part: string) =>
      Math.round(
        part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part),
      );
    const rgb = [r, g, b].map(channel).join(',');
    if (a === undefined) return `rgb(${rgb})`;
    const alpha = a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return `rgba(${rgb},${Number(alpha.toFixed(3))})`;
  };
  return value
    .replace(
      /rgba?\(\s*(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?%?)\s*(?:\/\s*(\d*\.?\d+%?)\s*)?\)/gi,
      (_, r: string, g: string, b: string, a: string | undefined) =>
        classic(r, g, b, a),
    )
    .replace(
      /rgba?\(\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*,\s*(\d+(?:\.\d+)?%?)\s*(?:,\s*(\d*\.?\d+%?)\s*)?\)/gi,
      (_, r: string, g: string, b: string, a: string | undefined) =>
        classic(r, g, b, a),
    )
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(^|[^0-9.])0+\.(\d)/g, '$1.$2')
    .replace(
      /#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?(?![0-9a-f])/g,
      (_, r: string, g: string, b: string, a: string | undefined) =>
        `#${r}${r}${g}${g}${b}${b}${a ? a + a : ''}`,
    );
}

/** Visible text in the one spelling the checker compares. */
function normalizeText(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&apos;|&#0?39;|&rsquo;|&lsquo;|[‘’]/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;|[“”]/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * JSX and HTML with the markup taken out, so "Know it <em>all.</em>" reads
 * as the "Know it all." a visitor sees. JSX's `{' '}` spacer goes with it.
 */
function visibleText(source: string): string {
  return source
    .replace(/\{\s*(['"`])\s*\1\s*\}/g, ' ')
    .replace(/\{\s*(['"`]) \1\s*\}/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/**
 * Every spelling of one colour the checker accepts as that colour: the
 * spec may say `#020a12cc` and the page `rgba(2, 10, 18, 0.8)`, and asking
 * for a paid repair over that would be a waste. Hex and `rgb()`/`rgba()`
 * are converted into each other; anything else (a named colour, `oklch()`)
 * is matched as written.
 */
/**
 * CSS's named colours (CSS Color Module Level 4), as six-digit hex.
 * `transparent` is black at zero alpha.
 */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
  transparent: '#00000000',
};

/**
 * The keywords that name the same colour as `value`, whichever way round
 * it was written: `#ffffff` is `white`, and `white` is itself.
 */
function colorKeywords(value: string): string[] {
  const written = normalizeCssValue(value);
  if (NAMED_COLORS[written] !== undefined) {
    return Object.keys(NAMED_COLORS).filter(
      (name) => NAMED_COLORS[name] === NAMED_COLORS[written],
    );
  }
  const hex = written.replace(/^(#[0-9a-f]{6})ff$/, '$1');
  return Object.keys(NAMED_COLORS).filter((name) => NAMED_COLORS[name] === hex);
}

/**
 * Whether a colour keyword is used as a colour: in a CSS declaration (in a
 * stylesheet, a `<style>` block or a `style` attribute), as a quoted value
 * in a style object (`color: 'white'`), or as a Tailwind colour
 * (`bg-white`). Copy that says the word is not a use of it.
 */
function usesColorKeyword(
  css: string,
  source: string,
  keyword: string,
): boolean {
  const word = `(?<![\\w-])${keyword}(?![\\w-])`;
  const declared = new RegExp(
    `(?:^|[;{\\s])-*[a-z][\\w-]*\\s*:[^;{}]*${word}`,
    'i',
  );
  const styles = [
    css,
    ...[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
      (match) => match[1]!,
    ),
    ...[...source.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map(
      (match) => `{${match[1]!}}`,
    ),
  ];
  if (styles.some((text) => declared.test(text))) return true;
  if (
    new RegExp(`\\b[a-z][\\w]*\\s*:\\s*["'\`]${keyword}["'\`]`, 'i').test(
      source,
    )
  ) {
    return true;
  }
  return classLists(source).some((names) =>
    new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*(?:bg|text|border|fill|stroke|from|via|to|ring|outline|decoration|accent|caret|divide|placeholder|shadow)-${keyword}(?![\\w-])`,
      'i',
    ).test(names),
  );
}

/** A colour as 8-bit sRGB channels and an alpha from 0 to 1. */
interface Channels {
  rgb: [number, number, number];
  alpha: number;
}

/**
 * A colour value as channels, for comparing one written in two different
 * ways: hex of any length, `rgb()`/`rgba()`, a named colour or `oklch()`.
 * Null for anything else, which is then compared by spelling alone.
 */
function colorChannels(value: string): Channels | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('oklch(')) return oklchToRgb(trimmed);
  const written = normalizeCssValue(NAMED_COLORS[trimmed] ?? trimmed);
  if (trimmed === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(
    written,
  );
  if (hex) {
    return {
      rgb: [hex[1]!, hex[2]!, hex[3]!].map((part) => parseInt(part, 16)) as [
        number,
        number,
        number,
      ],
      alpha: hex[4] === undefined ? 1 : parseInt(hex[4], 16) / 255,
    };
  }
  const fn =
    /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,(\.\d+|\d+(?:\.\d+)?))?\)$/.exec(
      written,
    );
  if (fn) {
    return {
      rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])],
      alpha: fn[4] === undefined ? 1 : Math.min(1, Number(fn[4])),
    };
  }
  return null;
}

/** Whether two colours are the same to within 8-bit rounding. */
function sameChannels(a: Channels, b: Channels): boolean {
  return (
    a.rgb.every((channel, i) => Math.abs(channel - b.rgb[i]!) <= 1) &&
    Math.abs(a.alpha - b.alpha) <= 0.02
  );
}

/**
 * The utilities that take a colour, as Tailwind names them, with the
 * important modifier in either place: `!bg-primary`, and v4's
 * `bg-primary!` (internal PR 239 review). Behind any variants, each read whole, so
 * one with a selector or a name in it, `[&>a]:`, `data-[state=open]:` or
 * `group-hover/item:`, still leaves the utility (internal PR 239 review).
 */
const COLOR_UTILITY =
  /^(?:(?:[\w@*/.-]|\[[^\]\s]*\])+:)*!?(?:bg|text|border(?:-[trblxyse])?|fill|stroke|from|via|to|ring|ring-offset|outline|decoration|accent|caret|divide|placeholder|shadow|inset-shadow)-(\[[^\]\s]{1,80}\]|\(--[\w-]{1,80}\)|[a-z][a-z0-9-]{0,40})(?:\/(\d{1,3}|\[\d*\.?\d+%?\]))?!?$/;

/**
 * Tailwind's default palette families. Names only: the checker does not
 * carry their values, so a spec colour a page may be drawing from one of
 * them cannot be confirmed or ruled out.
 */
const TAILWIND_PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)$/;

/**
 * Every custom property the stylesheets declare, last declaration winning,
 * read in one pass: a lookup per utility name would rescan the whole of
 * somebody else's CSS once for every distinct class on the page.
 */
function customProperties(css: string): Map<string, string[]> {
  // Last declaration wins within one block's selector, as the cascade does
  // there, while each selector keeps its own: shadcn/ui declares
  // `--primary` in :root and again in .dark, and `bg-primary` draws each
  // in its theme, so either is a colour the page uses (internal PR 239 review). One
  // pass, a stack of the selectors the cursor is inside.
  const scoped = new Map<string, string>();
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === '{') {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (char === '}') {
      stack.pop();
      start = i + 1;
    } else if (char === ';') {
      start = i + 1;
    } else if (char === '-' && css[i + 1] === '-' && stack.length > 0) {
      const match = /^--([\w-]{1,80})\s*:([^;{}]{1,200})/.exec(
        css.slice(i, i + 290),
      );
      if (match && /^[\s;{]?$/.test(css[i - 1] ?? '')) {
        scoped.set(`${stack.join(' ')}\u0000${match[1]}`, match[2]!.trim());
        i += match[0].length - 1;
      }
    }
  }
  const declared = new Map<string, string[]>();
  for (const [key, value] of scoped) {
    const name = key.slice(key.indexOf('\u0000') + 1);
    const values = declared.get(name) ?? [];
    values.push(value);
    declared.set(name, values);
  }
  return declared;
}

/**
 * What the colour utilities in the markup resolve to, as far as the project
 * itself says: a named colour (`bg-black/50`), an arbitrary value
 * (`bg-[#0a0a0a]`) or one of the project's own tokens (`bg-primary/80`,
 * through `--color-primary` or `--primary`), each with its opacity
 * modifier applied. Class strings are read wherever they are written, not
 * only in `className`: shadcn/ui keeps its variants in `cva()` calls.
 *
 * `palette` lists the Tailwind palette colours used (`bg-slate-900`), whose
 * values the checker does not hold.
 */
/** The opacity a modifier sets: `/20` and `/[20%]` are 0.2, `/[.2]` too. */
function opacityOf(modifier: string): number {
  const raw = modifier.replace(/^\[|\]$/g, '');
  const amount = raw.endsWith('%')
    ? parseFloat(raw) / 100
    : modifier.startsWith('[')
      ? parseFloat(raw)
      : parseFloat(raw) / 100;
  return Math.min(1, amount);
}

/**
 * A class-like token, keeping a `[...]` arbitrary value whole, and v4's
 * custom-property shorthand, `bg-(--accent)` (internal PR 239 review), as often as a
 * token has them: `[&>a]:bg-[#fff]`.
 */
const CLASS_TOKEN =
  /(?:[^\s"'`{}(),;[\]]*(?:\[[^\]\s"'`]*\]|-\(--[\w-]{1,80}\)))+[^\s"'`{}(),;[\]]*|[^\s"'`{}(),;[\]]+/g;

function tailwindColors(
  source: string,
  css: string,
): { channels: Channels[]; palette: string[] } {
  const declared = customProperties(css);
  const lookup = (name: string) => declared.get(name) ?? [];
  const channels: Channels[] = [];
  const palette = new Set<string>();
  const seen = new Set<string>();
  // A bracketed arbitrary value is one token whatever it holds:
  // `bg-[rgb(255,0,0)]` has parentheses and commas that separate class
  // strings everywhere else, in cva() calls and objects (internal PR 239 review).
  for (const token of source.match(CLASS_TOKEN) ?? []) {
    if (token.length > 160 || seen.has(token)) continue;
    seen.add(token);
    const match = COLOR_UTILITY.exec(token);
    if (!match) continue;
    const [, name, modifier] = match;
    if (TAILWIND_PALETTE.test(name!)) {
      // Keyed with its opacity, since `bg-red-500/20` and `bg-red-500/60`
      // draw two colours (internal PR 239 review).
      // Canonical, since `/100`, `/[100%]` and none draw the same.
      const alpha = modifier === undefined ? 1 : opacityOf(modifier);
      palette.add(`${name}@${Number(alpha.toFixed(3))}`);
      continue;
    }
    let values: string[];
    if (name!.startsWith('(')) {
      // `bg-(--accent)` is `bg-[var(--accent)]`, which may hold a value per
      // theme, as a token does.
      values = lookup(name!.slice(3, -1)).flatMap((value) => {
        const pointer = /^var\(\s*--([\w-]+)\s*\)$/.exec(value);
        return pointer ? lookup(pointer[1]!) : [value];
      });
    } else if (name!.startsWith('[')) {
      const value = name!.slice(1, -1).replace(/_/g, ' ');
      // `bg-[var(--accent)]` is `bg-(--accent)` (internal PR 239 review).
      const pointer = /^var\(\s*--([\w-]+)\s*\)$/.exec(value);
      values = pointer
        ? lookup(pointer[1]!).flatMap((inner) => {
            const next = /^var\(\s*--([\w-]+)\s*\)$/.exec(inner);
            return next ? lookup(next[1]!) : [inner];
          })
        : [value];
    } else if (NAMED_COLORS[name!] !== undefined || name === 'transparent') {
      values = [name!];
    } else {
      const own = lookup(`color-${name}`);
      // One step of indirection: `--color-primary: var(--primary)`, where
      // --primary may hold a value per theme.
      values = (own.length > 0 ? own : lookup(name!)).flatMap((value) => {
        const pointer = /^var\(\s*--([\w-]+)\s*\)$/.exec(value);
        return pointer ? lookup(pointer[1]!) : [value];
      });
    }
    for (const value of values) {
      const resolved = colorChannels(value);
      if (!resolved) continue;
      const alpha =
        modifier === undefined
          ? resolved.alpha
          : resolved.alpha * opacityOf(modifier);
      channels.push({ rgb: resolved.rgb, alpha });
    }
  }
  return { channels, palette: [...palette] };
}

export function colorSpellings(value: string): string[] {
  // A keyword is spelled by its hex too: `white` is `#ffffff`.
  const keyword = NAMED_COLORS[normalizeCssValue(value)];
  const written = normalizeCssValue(keyword ?? value);
  const spellings = new Set([written]);
  const alphaText = (alpha: number) =>
    [2, 3].map((digits) =>
      String(Number(alpha.toFixed(digits))).replace(/^0\./, '.'),
    );

  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(
    written,
  );
  if (hex) {
    const [r, g, b] = [hex[1]!, hex[2]!, hex[3]!].map((part) =>
      parseInt(part, 16),
    );
    // An alpha of ff is opaque: `#ffffffff` is `#ffffff`.
    if (hex[4] === undefined || hex[4] === 'ff') {
      spellings.add(`#${hex[1]}${hex[2]}${hex[3]}`);
      spellings.add(`#${hex[1]}${hex[2]}${hex[3]}ff`);
      spellings.add(`rgb(${r},${g},${b})`);
      spellings.add(`rgba(${r},${g},${b},1)`);
    } else {
      for (const alpha of alphaText(parseInt(hex[4], 16) / 255)) {
        spellings.add(`rgba(${r},${g},${b},${alpha})`);
        spellings.add(`rgb(${r},${g},${b},${alpha})`);
      }
    }
  }

  const fn =
    /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,(\.\d+|\d+(?:\.\d+)?))?\)$/.exec(
      written,
    );
  if (fn) {
    const channels = [fn[1], fn[2], fn[3]].map((part) => Number(part));
    if (channels.every((channel) => channel <= 255)) {
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      const base = `#${channels.map(toHex).join('')}`;
      const alpha = fn[4] === undefined ? 1 : Number(fn[4]);
      if (alpha >= 1) {
        spellings.add(base);
        spellings.add(`${base}ff`);
        spellings.add(`rgb(${channels.join(',')})`);
        spellings.add(`rgba(${channels.join(',')},1)`);
      } else {
        spellings.add(`${base}${toHex(Math.round(alpha * 255))}`);
        spellings.add(`rgba(${channels.join(',')},${fn[4]})`);
        spellings.add(`rgb(${channels.join(',')},${fn[4]})`);
      }
    }
  }
  return [...spellings];
}

/**
 * Whether `spelling` appears in `corpus` as a whole value rather than the
 * start or end of a longer one: `#07121c` is not satisfied by `#07121c00`
 * (the same colour, fully transparent), nor `white` by `whitesmoke`.
 */
function containsToken(corpus: string, spelling: string): boolean {
  const joins = /[0-9a-z_-]/;
  let at = corpus.indexOf(spelling);
  while (at !== -1) {
    const before = corpus[at - 1];
    const after = corpus[at + spelling.length];
    const startsWord = /^[a-z]/.test(spelling);
    const endsWord = /[0-9a-z]$/.test(spelling);
    const cleanStart =
      !startsWord || before === undefined || !/[0-9a-z_#-]/.test(before);
    const cleanEnd = !endsWord || after === undefined || !joins.test(after);
    if (cleanStart && cleanEnd) return true;
    at = corpus.indexOf(spelling, at + 1);
  }
  return false;
}

/**
 * The places a project names a typeface, lower-cased, one per line:
 * `font-family` declarations (CSS, inline styles, `@font-face`), custom
 * properties with "font" in the name, `fontFamily` in a style object or a
 * Tailwind config, Tailwind's `font-['...']` arbitrary values, Google Fonts
 * `family=` parameters, `@fontsource` package names, and string literals on
 * a line about fonts.
 *
 * Only these, and not the whole source: a family named `Inter` must not be
 * found in `interface` or `pointer`.
 */
function fontReferences(text: string): string {
  const found: string[] = [];
  const collect = (pattern: RegExp, clean = (value: string) => value) => {
    for (const match of text.matchAll(pattern)) found.push(clean(match[1]!));
  };
  collect(/font-family\s*:\s*([^;}\n]+)/gi);
  // The shorthand names its family last: `font: 16px/1.5 Inter, sans-serif`.
  collect(/(?<![\w-])font\s*:\s*([^;}\n]+)/gi);
  collect(/--[\w-]*font[\w-]*\s*:\s*([^;}\n]+)/gi);
  collect(/fontFamily\s*:\s*(\{[^}]*\}|\[[^\]]*\]|[^,;}\n]+)/g);
  collect(/\bfont-\[([^\]]+)\]/g, (value) => value.replace(/_/g, ' '));
  collect(/[?&;]family=([^&"'`)\s]+)/gi, (value) =>
    decodeURIComponentSafe(value).replace(/\+/g, ' '),
  );
  collect(/@fontsource(?:-variable)?\/([\w-]+)/gi, (value) =>
    value.replace(/-/g, ' '),
  );
  // `font-family: var(--heading-face)` names whatever that property holds,
  // whatever it is called, and so on through properties that hold others.
  const resolved = new Set<string>();
  for (let next = 0; next < found.length && next < 500; next++) {
    for (const reference of found[next]!.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (resolved.has(reference[1]!)) continue;
      resolved.add(reference[1]!);
      collect(
        new RegExp(
          `(?<![\\w-])${escapeRegExp(reference[1]!)}\\s*:\\s*([^;}\\n]+)`,
          'g',
        ),
      );
    }
  }
  // A string literal names a typeface only where its line is about fonts
  // (`const displayFont = 'Inter'`, `fonts: { body: 'Inter' }`), not as UI
  // copy or an unrelated label that happens to spell the same word.
  for (const line of text.split('\n')) {
    if (!/font/i.test(line)) continue;
    for (const match of line.matchAll(/(["'`])([^"'`\n]{1,80})\1/g)) {
      found.push(match[2]!);
    }
  }
  return found.join('\n').toLowerCase();
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether `name` appears in `corpus` as a whole name, bounded by anything
 * but a letter or digit on both sides, compared without case.
 */
function containsName(corpus: string, name: string): boolean {
  const wanted = name.toLowerCase().trim();
  if (!wanted) return true;
  let at = corpus.indexOf(wanted);
  while (at !== -1) {
    const before = corpus[at - 1];
    const after = corpus[at + wanted.length];
    if (
      (before === undefined || !/[0-9a-z]/.test(before)) &&
      (after === undefined || !/[0-9a-z]/.test(after))
    ) {
      return true;
    }
    at = corpus.indexOf(wanted, at + 1);
  }
  return false;
}

/** Tailwind's default breakpoints, for a project that asked for Tailwind. */
const TAILWIND_BREAKPOINTS: Record<string, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

/**
 * Tailwind's breakpoints as this project has them: the defaults, with any
 * the project configures on top (`screens: { mobile: '650px' }` in its
 * config, or v4's `--breakpoint-mobile: 40.625rem` in CSS).
 */
function tailwindBreakpoints(
  text: string,
  config: string,
): Map<string, number> {
  const px = (amount: string, unit: string) =>
    Math.round(Number(amount) * (unit.toLowerCase() === 'px' ? 1 : 16));
  // Only Tailwind's own: `theme.screens` replaces the defaults and
  // `theme.extend.screens` adds to them. An application object that
  // happens to have a `screens` key is neither, and neither is a
  // `theme` object anywhere but the Tailwind config. v4's
  // `--breakpoint-*: initial` replaces them too.
  // `screens: { ...defaultTheme.screens, xs: '475px' }` keeps them, where
  // `defaultTheme` is Tailwind's own; a spread of anything else does not.
  const defaults = [
    ...config.matchAll(
      /\b(?:import\s+([\w$]+)\s+from|(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\()\s*["']tailwindcss\/defaultTheme(?:\.js)?["']/g,
    ),
  ].map((match) => match[1] ?? match[2]!);
  const spreadsDefaults = (body: string) =>
    defaults.some((name) =>
      new RegExp(
        `\\.\\.\\.\\s*${escapeRegExp(name)}\\s*\\.\\s*screens\\b`,
      ).test(body),
    );
  // Each `screens` under `theme` or `extend`, as the object it is: written
  // out, or a binding it names (`const screens = { ... }; theme: {
  // screens }`). Tailwind's own `defaultTheme.screens` is the defaults;
  // a binding the config does not spell out is an unknown set, which
  // still replaces them.
  const screens: { index: number; body: string }[] = [
    ...[...config.matchAll(/\bscreens\s*:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(
      (match) => ({ index: match.index, body: match[1]! }),
    ),
    ...[
      ...config.matchAll(
        /\bscreens\s*(?::\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*))?\s*(?=[,}])/g,
      ),
    ].map((match) => {
      const bound = (match[1] ?? 'screens').replace(/\s+/g, '');
      const [base, property] = bound.split('.');
      if (property === 'screens' && defaults.includes(base!)) {
        return { index: match.index, body: `...${bound}` };
      }
      // `screens: custom.screens` is `screens` of the object `custom`.
      const object = new RegExp(
        `\\b(?:const|let|var)\\s+${escapeRegExp(base!)}\\s*(?::[^=]+)?=\\s*\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}`,
      ).exec(config)?.[1];
      const body =
        property === undefined
          ? object
          : object === undefined
            ? undefined
            : new RegExp(
                `(?<![\\w$])${escapeRegExp(property)}\\s*:\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`,
              ).exec(object)?.[1];
      return { index: match.index, body: body ?? '' };
    }),
  ].filter((found) =>
    ['theme', 'extend'].includes(enclosingKey(config, found.index) ?? ''),
  );
  const replaced =
    screens.some(
      (found) =>
        enclosingKey(config, found.index) === 'theme' &&
        !spreadsDefaults(found.body),
    ) || /--breakpoint-\*\s*:\s*initial\b/i.test(text);
  const widths = new Map(replaced ? [] : Object.entries(TAILWIND_BREAKPOINTS));
  for (const found of screens) {
    for (const entry of found.body.matchAll(
      /(["']?)([\w-]+)\1\s*:\s*(?:\{[^{}]*?)?["'](\d+(?:\.\d+)?)(px|em|rem)["']/gi,
    )) {
      widths.set(entry[2]!, px(entry[3]!, entry[4]!));
    }
  }
  // Tailwind v4: `--breakpoint-md: 50rem` sets one, and `--breakpoint-md:
  // initial` removes it, the later declaration winning.
  for (const entry of text.matchAll(
    /--breakpoint-([\w-]+)\s*:\s*(?:(initial)\b|(\d+(?:\.\d+)?)(px|em|rem)\b)/gi,
  )) {
    if (entry[2]) widths.delete(entry[1]!);
    else widths.set(entry[1]!, px(entry[3]!, entry[4]!));
  }
  return widths;
}

/**
 * The key of the object literal that holds `at`: `extend` for a property
 * inside `extend: { ... }`.
 */
function enclosingKey(text: string, at: number): string | undefined {
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    const char = text[index]!;
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth === 0) {
        return /([\w$]+)["']?\s*:\s*$/.exec(text.slice(0, index))?.[1];
      }
      depth -= 1;
    }
  }
  return undefined;
}

/**
 * A Sass or Less stylesheet with its variables resolved inside width
 * queries (`$mobile: 650px` then `@media (max-width: $mobile)`), as the
 * query compiles. Each file against its own declarations: two files may
 * use the same name for different widths.
 */
function withResolvedQueries(
  path: string,
  content: string,
  files: ProjectFileLike[] = [],
): string {
  if (!/\.(scss|sass|less)$/i.test(path)) return content;
  // `@use 'a' as a` keeps a's members under `a.`, apart from `b.`'s.
  const namespaces = new Map<string, Map<string, string>>();
  for (const { file, namespace } of importedStylesheets(path, content, files)) {
    if (namespace === undefined) continue;
    const members = namespaces.get(namespace) ?? new Map<string, string>();
    declareVariables(file.content, members);
    namespaces.set(namespace, members);
  }
  // `@use './vars' as v with ($mobile: 650px)` configures the module: its
  // defaults give way to what the `with` sets.
  for (const { namespace, config } of directImports(path, content, files)) {
    if (namespace === undefined) continue;
    for (const { name, value } of config)
      namespaces.get(namespace)?.set(name, value);
  }
  // Every other declaration where it stands: this file's own where they
  // are written, and what an `@import` brings in at the import, in the
  // order the imported file (and what it imports) makes them.
  const events: {
    at: number;
    name: string;
    value: string;
    scope?: [number, number];
  }[] = [...declarations(content)];
  for (const { file, namespace, at, config } of directImports(
    path,
    content,
    files,
  )) {
    if (namespace !== undefined) continue;
    for (const { name, value } of [
      ...orderedDeclarations(file, files, new Set([path, file.path])),
      ...config,
    ]) {
      events.push({ at, name, value });
    }
  }
  // Stable, so what one import brings in keeps its own order.
  events.sort((a, b) => a.at - b.at);
  // Sass reads a variable as it stands where the query is. Less reads the
  // last definition in scope, wherever it is written.
  // Either way, only what is in scope where the query is: a variable set
  // inside `.card { ... }` is not seen by a query outside it.
  const lazy = /\.less$/i.test(path);
  return content.replace(
    /\([^()]*\bwidth\b[^()]*\)/gi,
    (query, offset: number) => {
      const variables = new Map<string, string>();
      for (const event of events) {
        if (!lazy && event.at >= offset) break;
        if (
          event.scope &&
          !(event.scope[0] < offset && offset < event.scope[1])
        ) {
          continue;
        }
        variables.set(event.name, event.value);
      }
      return query.replace(
        /(?:([\w-]+)\.)?([$@][\w-]+)/g,
        (whole, namespace: string | undefined, name: string) =>
          (namespace === undefined
            ? resolved(variables, name)
            : resolved(namespaces.get(namespace), name)) ?? whole,
      );
    },
  );
}

/**
 * A width variable's value, through any variables it is set to: `$base:
 * 650px; $mobile: $base` makes `$mobile` 650px.
 */
function resolved(
  variables: Map<string, string> | undefined,
  name: string,
): string | undefined {
  let value = variables?.get(name);
  for (let hops = 0; value !== undefined && /^[$@]/.test(value); hops++) {
    if (hops > 10) return undefined;
    value = variables?.get(value);
  }
  return value;
}

/** Sass and Less width variables declared in `content`, into `into`. */
function declareVariables(content: string, into: Map<string, string>): void {
  // What a module offers is what it declares at its top level.
  for (const { name, value, scope } of declarations(content)) {
    if (!scope) into.set(name, value);
  }
}

/** Sass and Less width variables declared in `content`, where each is. */
function declarations(
  content: string,
): { at: number; name: string; value: string; scope?: [number, number] }[] {
  // Each block, as its braces: a variable declared inside one is local to
  // it, unless it is marked `!global`.
  const blocks: [number, number][] = [];
  const open: number[] = [];
  for (let at = 0; at < content.length; at++) {
    if (content[at] === '{') open.push(at);
    else if (content[at] === '}' && open.length > 0) {
      blocks.push([open.pop()!, at]);
    }
  }
  return [
    ...content.matchAll(
      /(?:^|[;{\s])([$@][\w-]+)\s*:\s*(\d+(?:\.\d+)?(?:px|em|rem)\b|[$@][\w-]+(?![\w-]))/gi,
    ),
  ].map((match) => {
    const end = match.index + match[0].length;
    const global = /^\s*(?:!default\s*)?!global\b/.test(
      content.slice(end, end + 30),
    );
    const scope = global
      ? undefined
      : blocks
          .filter(([from, to]) => from < match.index && match.index < to)
          .sort((a, b) => b[0] - a[0])[0];
    return {
      at: match.index,
      name: match[1]!,
      value: match[2]!,
      ...(scope ? { scope } : {}),
    };
  });
}

/**
 * The stylesheets `content` imports (`@import`, `@use`, `@forward`), and
 * theirs in turn, found among the project's files the way Sass and Less
 * look for them: relative to the importing file, with or without the
 * extension and Sass's `_` partial prefix.
 */
function importedStylesheets(
  path: string,
  content: string,
  files: ProjectFileLike[],
  // Only the chain that led here: a module imported twice, under two
  // aliases, is recorded under each.
  ancestors = new Set<string>([path]),
): { file: ProjectFileLike; namespace?: string }[] {
  const found: { file: ProjectFileLike; namespace?: string }[] = [];
  for (const { file, namespace } of directImports(
    path,
    content,
    files,
    ancestors,
  )) {
    // What that module brings in comes along under the same name.
    for (const nested of importedStylesheets(
      file.path,
      file.content,
      files,
      new Set([...ancestors, file.path]),
    )) {
      found.push({ file: nested.file, namespace });
    }
    found.push({ file, namespace });
  }
  return found;
}

/**
 * A stylesheet's width declarations in the order it makes them, each
 * `@import` (not a namespaced `@use`) bringing in the imported file's own,
 * in its order, where the import stands.
 */
function orderedDeclarations(
  file: ProjectFileLike,
  files: ProjectFileLike[],
  ancestors: Set<string>,
): { name: string; value: string }[] {
  const items: { at: number; list: { name: string; value: string }[] }[] =
    declarations(file.content)
      .filter((declaration) => !declaration.scope)
      .map((declaration) => ({
        at: declaration.at,
        list: [declaration],
      }));
  for (const imported of directImports(
    file.path,
    file.content,
    files,
    ancestors,
  )) {
    if (imported.namespace !== undefined) continue;
    items.push({
      at: imported.at,
      list: orderedDeclarations(
        imported.file,
        files,
        new Set([...ancestors, imported.file.path]),
      ),
    });
  }
  return items.sort((a, b) => a.at - b.at).flatMap((item) => item.list);
}

/**
 * The stylesheets `content` itself imports, where each import stands and
 * the namespace a `@use` gives it.
 */
function directImports(
  path: string,
  content: string,
  files: ProjectFileLike[],
  ancestors = new Set<string>([path]),
): {
  file: ProjectFileLike;
  namespace?: string;
  at: number;
  config: { name: string; value: string }[];
}[] {
  const found: {
    file: ProjectFileLike;
    namespace?: string;
    at: number;
    config: { name: string; value: string }[];
  }[] = [];
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  for (const match of content.matchAll(
    /@(import|use|forward)\s+(?:\([^)]*\)\s*)?["']([^"']+)["']([^;]*)/g,
  )) {
    const target = normalizePath(dir ? `${dir}/${match[2]!}` : match[2]!);
    const slash = target.lastIndexOf('/');
    const folder = slash === -1 ? '' : target.slice(0, slash + 1);
    const base = target.slice(slash + 1);
    const candidates = [target, `${folder}_${base}`].flatMap((stem) => [
      stem,
      `${stem}.scss`,
      `${stem}.sass`,
      `${stem}.less`,
      `${stem}/_index.scss`,
      `${stem}/index.scss`,
    ]);
    const file = files.find(
      (candidate) =>
        candidates.includes(candidate.path) && !ancestors.has(candidate.path),
    );
    if (!file) continue;
    // `@use` puts a module's members under its namespace: the alias after
    // `as`, or the file's own name. `as *` and `@import` do not.
    const alias = /\bas\s+([\w-]+|\*)/.exec(match[3]!)?.[1];
    const namespace =
      match[1] === 'use' && alias !== '*'
        ? (alias ?? base.replace(/^_/, '').replace(/\.(scss|sass|less)$/, ''))
        : undefined;
    // What `with (...)` configures the module with.
    const config = declarations(
      /\bwith\s*\(([^)]*)\)/.exec(match[3]!)?.[1] ?? '',
    ).map(({ name, value }) => ({ name, value }));
    found.push({ file, namespace, at: match.index, config });
  }
  return found;
}

/** A path with `./` and `../` segments resolved. */
function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * The widths, in px, at which the project changes its layout: any width
 * query in parentheses (`@media`, `@container`, `matchMedia`, the range
 * syntax), plus Tailwind's prefixes (named, including the project's own
 * configured names, and arbitrary `max-[650px]:`) when the project uses
 * Tailwind. A
 * `max-width` declaration on a container is not in parentheses and is not
 * counted.
 */
function layoutWidths(
  text: string,
  tailwind: boolean,
  tailwindConfig: string,
): Set<number> {
  const widths = new Set<number>();
  for (const query of text.matchAll(/\([^()]*\bwidth\b[^()]*\)/gi)) {
    for (const match of query[0].matchAll(/(\d+(?:\.\d+)?)(px|em|rem)\b/gi)) {
      const amount = Number(match[1]);
      const px = match[2]!.toLowerCase() === 'px' ? amount : amount * 16;
      widths.add(Math.round(px));
    }
  }
  if (tailwind) {
    const named = tailwindBreakpoints(text, tailwindConfig);
    const names = [...named.keys()]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    for (const match of text.matchAll(
      new RegExp(`(?:^|[\\s"'\`{])(?:max-)?(${names}):[\\w[-]`, 'g'),
    )) {
      widths.add(named.get(match[1]!)!);
    }
    // Arbitrary values: `max-[650px]:hidden`, `min-[40.625rem]:flex`.
    for (const match of text.matchAll(
      /(?:^|[\s"'`{])(?:min|max)-\[(\d+(?:\.\d+)?)(px|em|rem)\]:/g,
    )) {
      const amount = Number(match[1]);
      widths.add(Math.round(match[2] === 'px' ? amount : amount * 16));
    }
  }
  return widths;
}

function specFindings(
  spec: DesignSpec,
  css: string,
  cssNormalized: string,
  source: string,
  corpusNormalized: string,
  textRaw: string,
  textVisible: string,
  tailwind: boolean,
  tailwindConfig: string,
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  const utilities = tailwind
    ? tailwindColors(source, css)
    : { channels: [], palette: [] };
  const unmatched: DesignSpec['tokens']['colors'] = [];
  for (const color of spec.tokens.colors) {
    const wanted = colorChannels(color.value);
    const used =
      colorSpellings(color.value).some((spelling) =>
        containsToken(corpusNormalized, spelling),
      ) ||
      colorKeywords(color.value).some((keyword) =>
        usesColorKeyword(css, source, keyword),
      ) ||
      (wanted !== null &&
        utilities.channels.some((found) => sameChannels(found, wanted)));
    if (!used) unmatched.push(color);
  }
  // The page draws from Tailwind's palette, whose values the checker does
  // not carry, so an unmatched colour may be one of them: not certain, so
  // a warning, as an error would buy a paid repair on a guess. But each
  // palette utility draws one colour, so when more distinct colours are
  // unmatched than there are palette utilities, some are certainly missing
  // and they stay errors (internal PR 239 review).
  const distinct = new Set(
    unmatched.map((color) => normalizeCssValue(color.value)),
  );
  // A palette utility's opacity is known even where its colour is not: a
  // `bg-red-500/20` cannot draw an opaque spec colour, so only utilities of
  // a colour's own opacity count for it, group by group (internal PR 239 review).
  const candidateAlphas = utilities.palette.map((key) =>
    Number(key.slice(key.lastIndexOf('@') + 1)),
  );
  const byAlpha = new Map<number, number>();
  let unknownAlpha = 0;
  for (const value of distinct) {
    const alpha = colorChannels(value)?.alpha;
    if (alpha === undefined) unknownAlpha += 1;
    else {
      const key = Number(alpha.toFixed(2));
      byAlpha.set(key, (byAlpha.get(key) ?? 0) + 1);
    }
  }
  const paletteMayCover =
    utilities.palette.length > 0 &&
    distinct.size <= utilities.palette.length &&
    [...byAlpha].every(
      ([alpha, count]) =>
        candidateAlphas.filter(
          (candidate) => Math.abs(candidate - alpha) <= 0.02,
        ).length >= count,
    ) &&
    unknownAlpha <= utilities.palette.length;
  for (const color of unmatched) {
    const define = tailwind
      ? `Define it as --${color.name}: ${color.value} and map it in @theme as --color-${color.name}, then use it where the spec says.`
      : `Define it as --${color.name}: ${color.value} on :root and use it where the spec says.`;
    if (paletteMayCover) {
      findings.push({
        severity: 'warning',
        check: 'color',
        detail: `The spec's colour "${color.name}" (${color.value}, ${color.use}) is not written anywhere in the CSS or markup, unless it is one of the Tailwind palette colours the page uses (${utilities.palette.slice(0, 6).join(', ')}). ${define}`,
      });
      continue;
    }
    findings.push({
      severity: 'error',
      check: 'color',
      detail: `The spec's colour "${color.name}" (${color.value}, ${color.use}) is not used anywhere in the CSS or markup. ${define}`,
    });
  }

  const fontNames = fontReferences(css + '\n' + source);
  for (const font of spec.tokens.fonts) {
    if (!containsName(fontNames, font.family)) {
      findings.push({
        severity: 'error',
        check: 'font',
        detail: `The spec's ${font.role} face "${font.family}" is never loaded or named in a font-family. Load it (weights ${font.weights.join(', ') || 'as used'}) and apply it with the fallback "${font.fallback}".`,
      });
    }
  }

  const widths = layoutWidths(css + '\n' + source, tailwind, tailwindConfig);
  for (const breakpoint of spec.breakpoints) {
    const w = Math.round(breakpoint.maxWidth);
    if (![w - 1, w, w + 1].some((near) => widths.has(near))) {
      findings.push({
        severity: 'error',
        check: 'breakpoint',
        detail: `The spec changes the layout at ${w}px (${breakpoint.changes.join('; ')}), but no media query uses that width.`,
      });
    }
  }

  for (const step of spec.tokens.type) {
    if (!cssNormalized.includes(normalizeCssValue(step.size))) {
      const inSource = corpusNormalized.includes(normalizeCssValue(step.size));
      if (!inSource) {
        findings.push({
          severity: 'warning',
          check: 'type',
          detail: `The spec's "${step.name}" size (${step.size}) does not appear in the styles.`,
        });
      }
    }
  }

  findings.push(...motionFindings(spec.motion, `${css}\n${source}`));

  for (const section of spec.sections) {
    for (const copy of section.copy) {
      const wanted = normalizeText(copy.text);
      if (wanted.length < 2) continue;
      if (!textRaw.includes(wanted) && !textVisible.includes(wanted)) {
        findings.push({
          severity: 'warning',
          check: 'copy',
          detail: `The ${copy.role} in "${section.id}" should read "${copy.text}" and that text was not found verbatim.`,
        });
      }
    }
  }

  return findings;
}

/** A number as JavaScript would print it: `0.2`, never `0.20000000000000001`. */
function printed(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * Whether `code` carries a duration of `ms` milliseconds in any of the
 * spellings a build uses: CSS (`200ms`), a Tailwind class (`duration-200`,
 * `delay-200`), or Motion's seconds (`0.2`, `.2`). Loose on purpose: a
 * number that happens to match for another reason costs a missed warning,
 * never a false one.
 */
function hasDuration(code: string, ms: number): boolean {
  const whole = printed(ms);
  if (new RegExp(`(?<![\\d.])${escapeRegExp(whole)}\\s*ms\\b`).test(code)) {
    return true;
  }
  if (
    new RegExp(`\\b(?:duration|delay)-${escapeRegExp(whole)}(?![\\d])`).test(
      code,
    )
  ) {
    return true;
  }
  const seconds = printed(ms / 1000);
  const bare = seconds.startsWith('0.') ? seconds.slice(1) : seconds;
  return new RegExp(
    `(?<![\\w.])(?:${escapeRegExp(seconds)}|${escapeRegExp(bare)})(?![\\d])`,
  ).test(code);
}

/**
 * The spec's motion rows whose numbers the code does not carry (D75).
 *
 * Only the numbers a row names are looked for: a spring's stiffness and
 * damping, and every duration in milliseconds. A row that names none
 * ("8s linear loop", "follows the cursor") has nothing checkable and
 * passes. Warnings, never errors: motion is written many ways, and a
 * build that animates the same thing with other numbers still builds.
 */
export function motionFindings(
  motion: readonly MotionEntry[],
  code: string,
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  for (const entry of motion) {
    const missing: string[] = [];
    for (const key of ['stiffness', 'damping', 'mass'] as const) {
      const named = new RegExp(`${key}\\D{0,4}?(\\d+(?:\\.\\d+)?)`, 'i').exec(
        entry.timing,
      );
      if (!named) continue;
      const value = printed(Number(named[1]));
      const used = new RegExp(
        `${key}["']?\\s*[:=]\\s*\\{?\\s*${escapeRegExp(value)}(?![\\d.])`,
      ).test(code);
      if (!used) missing.push(`${key} ${value}`);
    }
    const texts = [entry.timing, entry.behaviour];
    for (const text of texts) {
      for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*ms\b/gi)) {
        // A bound on a sequence ("completes within 810ms", "under 1000ms
        // in total") is a sum of the other numbers, not one the code
        // writes down (measured on a gpt-6-luna build, try-generation run
        // 36650410531).
        const before = text.slice(Math.max(0, match.index - 24), match.index);
        if (/\b(?:within|under|total|up to|at most)\b/i.test(before)) continue;
        const ms = Number(match[1]);
        if (ms > 0 && !hasDuration(code, ms) && !missing.includes(`${ms}ms`)) {
          missing.push(`${ms}ms`);
        }
      }
    }
    if (missing.length > 0) {
      findings.push({
        severity: 'warning',
        check: 'motion',
        detail: `The spec's motion for "${entry.element}" (${entry.trigger}) names ${missing.join(', ')}, and the code does not use ${missing.length === 1 ? 'it' : 'them'}.`,
      });
    }
  }
  return findings;
}

/** Longest tag the alt check reads, so one unclosed `<img` stays cheap. */
const MAX_TAG_CHARS = 4000;

/**
 * The tag that opens at `start`, up to the `>` that closes it: one outside
 * quotes and outside `{...}` expressions, so `src={items.find(x => x.on)}`
 * does not end the tag at the arrow. Strings inside an expression are
 * skipped whole.
 */
function readJsxTag(text: string, start: number): string {
  const limit = Math.min(text.length, start + MAX_TAG_CHARS);
  let depth = 0;
  let quote: string | undefined;
  for (let i = start + 1; i < limit; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === '\\' && depth > 0) i++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'" || (char === '`' && depth > 0)) {
      quote = char;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      if (depth > 0) depth--;
    } else if (char === '>' && depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return text.slice(start, limit);
}

/**
 * The bodies of the `@media` blocks whose query matches `condition`, and
 * `text` with those blocks taken out. Braces are counted, so a block with
 * rules nested inside it is taken whole. With `alone`, only a query that
 * asks nothing else counts: `(prefers-reduced-motion: reduce) and
 * (min-width: 1024px)` leaves every narrower screen out.
 */
function mediaBlocks(
  text: string,
  condition: string,
  { alone = false }: { alone?: boolean } = {},
): { bodies: string[]; rest: string } {
  const opener = new RegExp(`@media([^{;]*${condition}[^{;]*)\\{`, 'gi');
  const bodies: string[] = [];
  let rest = '';
  let from = 0;
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    // A comma is "or": one part that is the condition alone is enough.
    if (
      alone &&
      !match[1]!.split(',').some(
        (part) =>
          new RegExp(condition, 'i').test(part) &&
          part
            .replace(new RegExp(`\\(\\s*${condition}\\s*\\)`, 'i'), '')
            .replace(/\b(?:only|all|screen|and)\b/gi, '')
            .trim() === '',
      )
    ) {
      continue;
    }
    rest += text.slice(from, match.index);
    const start = match.index + match[0].length;
    let depth = 1;
    let at = start;
    for (; at < text.length && depth > 0; at++) {
      if (text[at] === '{') depth++;
      else if (text[at] === '}') depth--;
    }
    bodies.push(text.slice(start, at - 1));
    from = at;
    opener.lastIndex = at;
  }
  return { bodies, rest: rest + text.slice(from) };
}

/**
 * `text` without the motion that already waits for the visitor's consent:
 * the bodies of `@media (prefers-reduced-motion: no-preference)` blocks and
 * Tailwind's `motion-safe:` classes. What is left is motion that plays for
 * everyone, which is what needs a `reduce` rule. A `no-preference` block
 * elsewhere on the page does not answer for it.
 */
function withoutMotionSafe(text: string): string {
  return mediaBlocks(
    text,
    'prefers-reduced-motion\\s*:\\s*no-preference',
  ).rest.replace(/\bmotion-safe:[^\s"'`]+/g, ' ');
}

/** Longest duration, in ms, that still counts as no motion (`.01ms`, `0s`). */
const NEGLIGIBLE_MS = 10;

/**
 * Whether a `reduce` block's body stops movement: a declaration that
 * removes it, or an animation or transition duration short enough that
 * nothing is seen to move. A duration of two seconds is still motion.
 */
function stopsMotion(body: string): boolean {
  return stopsAnimation(body) || stopsTransition(body);
}

/** Hiding the element stops whatever it was doing. */
const HIDES = /\b(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;

/**
 * Whether a body hides the element by the declarations that win in it:
 * `display: none; display: block` shows it (internal PR 239 review).
 */
function hides(body: string): boolean {
  if (!HIDES.test(body)) return false;
  return (
    /^none$/i.test(winningValue(body, 'display') ?? '') ||
    /^hidden$/i.test(winningValue(body, 'visibility') ?? '')
  );
}

/** Whether a duration of this kind is set short enough to show no motion. */
function negligibleDuration(body: string, kind: 'animation' | 'transition') {
  // Every duration in the list: `0s, 2s` stops the first animation and
  // leaves the second running for two seconds.
  // Only the declaration that wins: `0s` then `2s` runs for two seconds
  // (internal PR 239 review).
  const won = winningValue(body, `${kind}-duration`);
  return won !== undefined && negligibleList(won);
}

/** Whether every duration in a list is too short to show motion. */
function negligibleList(list: string): boolean {
  return list
    .split(',')
    .map((part) => /^\s*(\d*\.?\d+)(ms|s)?\s*$/i.exec(part))
    .every((duration) => {
      if (!duration) return false;
      const amount = Number(duration[1]);
      const ms = duration[2]?.toLowerCase() === 's' ? amount * 1000 : amount;
      return ms <= NEGLIGIBLE_MS;
    });
}

/**
 * Whether a body stops an animation: no animation, a paused one, a
 * negligible duration, or the element hidden. `transition: none` does
 * nothing to an animation.
 */
function stopsAnimation(
  body: string,
  { hidden = true }: { hidden?: boolean } = {},
): boolean {
  // Every entry of the list: `animation: none, spin 1s` stops the first
  // animation and leaves the second running. The same for paused. Only
  // the declaration that wins counts: `animation: none; animation: spin
  // 1s` animates (internal PR 239 review).
  const every = (property: string, value: RegExp) => {
    const won = winningValue(body, property);
    return (
      won !== undefined &&
      won.split(',').every((entry) => value.test(entry.trim()))
    );
  };
  return (
    every('animation(?:-name)?', /^none$/i) ||
    every('animation(?:-play-state)?', /^paused$/i) ||
    (hidden && hides(body)) ||
    negligibleDuration(body, 'animation')
  );
}

/**
 * The value of the declaration of `property` (a pattern) that wins in a
 * body: the last `!important` one, or the last of all, without the flag.
 */
function winningValue(body: string, property: string): string | undefined {
  return winningDeclaration(body, property)?.value;
}

/**
 * The declaration of `property` (a pattern) that wins in a body, as
 * `name: value` with the flag taken off, or undefined.
 */
function winningDeclaration(
  body: string,
  property: string,
):
  | { name: string; value: string; text: string; important: boolean }
  | undefined {
  const declared = [
    ...body.matchAll(new RegExp(`\\b(${property})\\s*:\\s*([^;}]+)`, 'gi')),
  ].map((match) => ({ name: match[1]!, raw: match[2]! }));
  const important = declared.filter(({ raw }) => /!\s*important/i.test(raw));
  const won = (important.length > 0 ? important : declared).at(-1);
  if (!won) return undefined;
  const value = won.raw.replace(/!\s*important/i, '').trim();
  return {
    name: won.name,
    value,
    text: `${won.name}: ${value}`,
    important: important.length > 0,
  };
}

/**
 * Whether a body stops a transitioned transform: no transition, no
 * transform, a negligible duration, or the element hidden.
 */
function stopsTransition(
  body: string,
  { hidden = true }: { hidden?: boolean } = {},
): boolean {
  // The declaration that wins, as for animations (internal PR 239 review).
  return (
    /^none$/i.test(winningValue(body, 'transition(?:-property)?') ?? '') ||
    /^none$/i.test(winningValue(body, 'transform') ?? '') ||
    (hidden && hides(body)) ||
    negligibleDuration(body, 'transition')
  );
}

/**
 * A transition that carries transform: of it by name, of `all`, or a
 * `transition` shorthand that names no property at all
 * (`transition: 200ms ease`), which defaults to `all`.
 */
const TRANSITIONS_TRANSFORM = {
  test(body: string): boolean {
    for (const match of body.matchAll(
      /\btransition(-property)?\s*:\s*['"]?([^;}'"]+)/gi,
    )) {
      const value = match[2]!.toLowerCase();
      if (/\b(?:transform|translate|scale|rotate|all)\b/.test(value)) {
        return true;
      }
      if (match[1] || /^\s*none\b/.test(value)) continue;
      const namesNoProperty = value.split(',').every((part) =>
        part
          .trim()
          .split(/\s+/)
          .every((token) =>
            /^(?:-?\d*\.?\d+m?s|ease(?:-in|-out|-in-out)?|linear|step-start|step-end|(?:cubic-bezier|steps|linear)\(.*|.*\)|allow-discrete|normal)$/.test(
              token,
            ),
          ),
      );
      if (namesNoProperty) return true;
    }
    return false;
  },
};

/** A transform that is not `none`. */
const SETS_TRANSFORM =
  /\b(?:transform|translate|scale|rotate)\s*:\s*['"]?(?!none\b)[^;}\s'"]/i;

/**
 * What a selector's subject (its last compound) is keyed by: its classes
 * and id, or its element name when it has neither. `.card:hover` and
 * `.card.is-open` share `.card`, which is how a state is tied to the
 * element whose transition carries it.
 */
function subjectKeys(selector: string): string[] {
  return subjectGroups(selector).flat();
}

/**
 * `subjectKeys` for each part of a selector list on its own: one group per
 * element the rule targets, with every key that element can be reached by.
 * `.card.is-open` is one element, reached as `.card` or as `.is-open`.
 */
function subjectGroups(selector: string): string[][] {
  return subjectMembers(selector).map((member) => member.keys);
}

/** One member of a selector list: its subject's keys, and what scopes it. */
interface SelectorMember {
  keys: string[];
  /** Pseudo-classes on the subject, `:hover`, which weigh as classes do. */
  pseudoClasses?: number;
  /** Their names: a stop under `:hover` reaches only a hovered element. */
  pseudo?: string[];
  /** The compounds before the subject, as written: `.dialog` in `.dialog .card`. */
  scope: string;
  /** The classes and ids in that scope. */
  scopeNames: string[];
  /**
   * Its specificity, where it differs from what its keys say: what a
   * `:where()` holds weighs nothing (internal PR 239 review).
   */
  weight?: number;
}

/**
 * `subjectGroups`, with each member's scope kept: `.dialog .card` targets
 * a card inside a dialog, not every card.
 */
/** A subject's plain pseudo-classes, not the functional ones. */
function pseudoOf(subject: string): string[] {
  // Not inside a functional one either: `.card:not(:hover)` asks the
  // opposite of `:hover` (internal PR 239 review).
  let plain = subject;
  for (let i = 0; i < 4; i += 1) {
    plain = plain.replace(/:(?:is|not|has|where)\([^()]*\)/gi, '');
  }
  return [...plain.matchAll(/(?<!:):(?!:)([\w-]+)/g)].map((match) =>
    match[1]!.toLowerCase(),
  );
}

/** A selector with each `:where()` and what it holds taken out. */
function withoutWhere(text: string): string {
  let plain = text;
  for (let i = 0; i < 4; i += 1) {
    plain = plain.replace(/:where\([^()]*\)/gi, '');
  }
  return plain;
}

function subjectMembers(selector: string): SelectorMember[] {
  return selector
    .split(',')
    .map((part) => {
      const compounds = part.trim().split(/\s*[\s>+~]\s*/);
      const subject = compounds.pop() ?? '';
      const scope = compounds.join(' ');
      // `.card:where(.active)` weighs as `.card` does (internal PR 239 review).
      const weighed = withoutWhere(subject);
      const weighedScope = withoutWhere(scope);
      return {
        weight: memberWeight({
          keys: subjectKeysOf(weighed),
          scope: weighedScope,
          scopeNames: weighedScope.match(/[.#][\w-]+/g) ?? [],
          pseudoClasses: pseudoOf(weighed).length,
        }),
        keys: subjectKeysOf(subject),
        scope,
        scopeNames: scope.match(/[.#][\w-]+/g) ?? [],
        // Not the functional ones, `:is(.active)`: their argument is
        // already among the keys (internal PR 239 review).
        pseudoClasses: pseudoOf(subject).length,
        pseudo: pseudoOf(subject),
      };
    })
    .filter((member) => member.keys.length > 0);
}

/** The keys of one compound selector, the subject of a rule. */
function subjectKeysOf(subject: string): string[] {
  // A pseudo-element is an element of its own: `.card::before` animates
  // separately from `.card`, and a rule for one does not reach the
  // other.
  const pseudo =
    /::?(before|after|marker|placeholder|selection|backdrop|first-line|first-letter)\b/i.exec(
      subject,
    );
  const suffix = pseudo ? `::${pseudo[1]!.toLowerCase()}` : '';
  const named = subject.match(/[.#][\w-]+/g);
  if (named) return named.map((key) => key + suffix);
  const element = /^[a-z][\w-]*/i.exec(subject);
  if (element) return [element[0].toLowerCase() + suffix];
  // Keyed only by attributes: `[data-open="true"]` is the element that
  // carries `data-open`, whatever its value.
  const attributes = [...subject.matchAll(/\[\s*([\w:-]+)/g)];
  return attributes.map((match) => `[${match[1]!.toLowerCase()}]${suffix}`);
}

/**
 * Whether a rule for `stopper` reaches every element `moving` names: its
 * subject asks for no more than the moving element has (`.card` reaches
 * `.card.special`, not the other way round), and it is not scoped to
 * part of the page the moving rule is not (`.dialog .card` does not reach
 * every `.card`).
 */
function covers(
  stopper: SelectorMember,
  moving: SelectorMember,
  { states = false }: { states?: boolean } = {},
): boolean {
  // With `states`, nor one that asks a state the moving rule does not: an
  // animation on `.card` runs whenever the card is not hovered, whatever
  // `.card:hover` says (internal PR 239 review). A transitioned transform moves by
  // entering the state, so a stop there answers it.
  return (
    (stopper.scope === '' || stopper.scope === moving.scope) &&
    stopper.keys.every((key) => moving.keys.includes(key)) &&
    (!states ||
      (stopper.pseudo ?? []).every((name) =>
        (moving.pseudo ?? []).includes(name),
      ))
  );
}

/**
 * Whether a selector covers the whole page: `*`, `*::before`, or `*` under
 * `html`, `body` or `:root`. `.modal *` covers the modal, not the page.
 */
function coversEverything(selector: string): boolean {
  return selector.split(',').some((part) =>
    // `*::before` matches generated content only (internal PR 239 review).
    /^(?:(?:html|body|:root)\s+)?\*$/i.test(part.trim()),
  );
}

/** An `animation` or `animation-name` that applies keyframes. */
const ANIMATES = /\banimation(?:-name)?\s*:\s*['"]?(?!none\b)[^;\s'"]/i;

/** One CSS rule with no rule inside it, and where it sits in the text. */
interface RuleMatch {
  start: number;
  end: number;
  selector: string;
  body: string;
}

/**
 * Every CSS rule with no rule inside it: a selector and its declarations.
 *
 * Exactly what `/([^{}]+)\{([^{}]*)\}/g` matches, found in one pass. The
 * regex was quadratic on any long run without a brace, because every start
 * position rescanned that run to its end, and it runs over the source as
 * well as the stylesheets: one 66 KB class list took 8.6 seconds of Worker
 * time. `design-checks.test.ts` holds the scanner to the regex's answers.
 */
function cssRuleMatches(text: string): RuleMatch[] {
  const found: RuleMatch[] = [];
  const nextBrace = (from: number) => {
    for (let at = from; at < text.length; at++) {
      const char = text.charCodeAt(at);
      if (char === 123 || char === 125) return at;
    }
    return -1;
  };
  // Where the current selector could begin: just after the last brace.
  let segment = 0;
  let at = 0;
  while (at < text.length) {
    const brace = nextBrace(at);
    if (brace === -1) break;
    if (text[brace] === '}') {
      segment = brace + 1;
      at = brace + 1;
      continue;
    }
    const close = nextBrace(brace + 1);
    if (close === -1) break;
    if (text[close] === '}' && brace > segment) {
      found.push({
        start: segment,
        end: close + 1,
        selector: text.slice(segment, brace),
        body: text.slice(brace + 1, close),
      });
      segment = close + 1;
      at = close + 1;
    } else {
      segment = brace + 1;
      at = brace + 1;
    }
  }
  return found;
}

/** The text with every rule `cssRuleMatches` finds replaced. */
function withoutCssRules(
  text: string,
  replace: (rule: string) => string,
): string {
  let out = '';
  let from = 0;
  for (const rule of cssRuleMatches(text)) {
    out +=
      text.slice(from, rule.start) + replace(text.slice(rule.start, rule.end));
    from = rule.end;
  }
  return out + text.slice(from);
}

interface Rule {
  selector: string;
  keys: string[];
  body: string;
  /** Where the rule starts in the text it was read from. */
  at: number;
}

function cssRules(text: string, offset = 0): Rule[] {
  return cssRuleMatches(text).map((match) => ({
    selector: match.selector,
    keys: subjectKeys(match.selector),
    body: match.body,
    at: offset + match.start,
  }));
}

/**
 * A selector member's specificity, as one number: ids, then classes and
 * attributes, then element names, in its subject and its scope.
 */
function memberWeight(member: SelectorMember): number {
  if (member.weight !== undefined) return member.weight;
  const names = [...member.keys, ...member.scopeNames];
  const ids = names.filter((key) => key.startsWith('#')).length;
  const classes = names.filter(
    (key) => key.startsWith('.') || key.startsWith('['),
  ).length;
  const elements =
    member.keys.filter((key) => /^[a-z]/i.test(key)).length +
    (member.scope.match(/(?:^|\s)[a-z][\w-]*/gi) ?? []).length;
  return ids * 100 + (classes + (member.pseudoClasses ?? 0)) * 10 + elements;
}

/** What moves on the page, as `motionSources` finds it. */
interface MotionSources {
  /**
   * The elements CSS rules move, one selector member (its subject's
   * classes, id or element name, and its scope) per element, with how it
   * moves: a stopper of that kind that covers it stops it.
   */
  groups: (SelectorMember & { kind: 'animation' | 'transition' })[];
  /** The class lists of elements that Tailwind utilities move. */
  tailwind: string[];
  /** Movement tied to no element: an inline style object. */
  other: boolean;
}

/** A class list's Tailwind movement: `animate-*`, or a transitioned transform. */
function tailwindMoves(names: string): boolean {
  return tailwindAnimates(names) || tailwindTransitionsTransform(names);
}

/**
 * A class list's utilities with their variants: `md:hover:animate-spin`
 * is `{ variants: ['md', 'hover'], utility: 'animate-spin' }`. A
 * `motion-reduce:` utility applies only to visitors who asked for less
 * motion, so it never counts as motion itself.
 */
function utilitiesOf(
  names: string,
): { variants: string[]; utility: string; important: boolean }[] {
  return names
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const parts = token.split(/:(?![^[]*\])/);
      return { variants: parts.slice(0, -1), ...importanceOf(parts.at(-1)!) };
    })
    .filter(({ variants }) => !variants.includes('motion-reduce'));
}

/**
 * A utility without Tailwind's important modifier, at either end
 * (`!animate-spin`, v4's `animate-spin!`), and whether it had one
 * (internal PR 239 review).
 */
function importanceOf(utility: string): {
  utility: string;
  important: boolean;
} {
  const important = /^!|!$/.test(utility);
  return { utility: utility.replace(/^!|!$/g, ''), important };
}

/**
 * Whether a class list stops its own motion of `kind` for reduced-motion
 * visitors: a `motion-reduce:` stopper whose other variants are a subset
 * of the moving utility's, so it applies wherever the motion does.
 */
function tailwindStops(
  names: string,
  kind: 'animation' | 'transition',
): boolean {
  const tokens = names
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const parts = token.split(/:(?![^[]*\])/);
      return { variants: parts.slice(0, -1), ...importanceOf(parts.at(-1)!) };
    });
  const stopper =
    kind === 'animation'
      ? /^(?:animate-none|hidden|invisible)$/
      : /^(?:transition-none|transform-none|duration-0|hidden|invisible|translate-[xy]-0|scale-100|rotate-0)$/;
  const moving = tokens.filter(
    ({ variants, utility }) =>
      !variants.includes('motion-reduce') &&
      (kind === 'animation'
        ? /^animate-(?!none$)[\w[]/.test(utility)
        : /^-?(?:translate|scale|rotate)-/.test(utility) ||
          /^transition(?:-(?:all|transform))?$/.test(utility)),
  );
  const stoppers = tokens.filter(
    ({ variants, utility }) =>
      variants.includes('motion-reduce') && stopper.test(utility),
  );
  // A reset stops the transform it resets: `motion-reduce:translate-x-0`
  // leaves `hover:scale-110` moving. What stops the transition itself
  // stops them all, and a transition utility moves only through the
  // transforms it carries (internal PR 239 review).
  const transformOf = (utility: string) =>
    /^-?(translate-[xy]|scale|rotate)(?:-[xy])?-/.exec(utility)?.[1];
  const resets: Record<string, RegExp> = {
    'translate-x': /^translate-x-0$/,
    'translate-y': /^translate-y-0$/,
    scale: /^scale-100$/,
    rotate: /^rotate-0$/,
  };
  const generic =
    /^(?:transition-none|transform-none|duration-0|hidden|invisible)$/;
  const transforms = moving.filter(({ utility }) => transformOf(utility));
  const required =
    kind === 'transition' && transforms.length > 0 ? transforms : moving;
  const stopsToken = (
    candidate: { utility: string; important: boolean },
    token: { utility: string; important: boolean },
  ) => {
    // An important utility is stopped only by an important reset:
    // `animate-spin!` keeps spinning over `motion-reduce:animate-none`
    // (internal PR 239 review).
    if (token.important && !candidate.important) return false;
    if (kind === 'animation') return true;
    if (generic.test(candidate.utility)) return true;
    const transform = transformOf(token.utility);
    return (
      transform !== undefined && resets[transform]!.test(candidate.utility)
    );
  };
  // Both sides are read by the same rule. An animation runs under its
  // state variants too, so `hover:animate-spin` is stopped by
  // `hover:motion-reduce:animate-none` and `animate-spin` is not. A
  // transitioned transform moves by entering and leaving a state, so the
  // state is not part of where it applies.
  const scopeOf = (variants: string[]) =>
    variants.filter(
      (variant) =>
        variant !== 'motion-reduce' &&
        (kind === 'animation' || !STATE_VARIANT.test(variant)),
    );
  // A reset of the transform itself is different: it has to hold in the
  // state the transform moves to. `hover:scale-110` outweighs
  // `motion-reduce:scale-100`, which the hovered card leaves behind, unless
  // the reset is important (internal PR 239 review).
  const holdsState = (
    candidate: { variants: string[]; utility: string; important: boolean },
    token: { variants: string[]; important: boolean },
  ) =>
    kind === 'animation' ||
    generic.test(candidate.utility) ||
    (candidate.important && !token.important) ||
    token.variants
      .filter((variant) => STATE_VARIANT.test(variant))
      .every((variant) => candidate.variants.includes(variant));
  return required.every((token) => {
    const scope = scopeOf(token.variants);
    return stoppers.some(
      (candidate) =>
        stopsToken(candidate, token) &&
        holdsState(candidate, token) &&
        scopeOf(candidate.variants).every((variant) => scope.includes(variant)),
    );
  });
}

/**
 * A Tailwind variant for a state the element enters and leaves, where a
 * transitioned transform moves: hover, focus and the like, an open or
 * checked element, and one driven by an attribute, `data-[state=open]:`
 * or `aria-expanded:`, or an arbitrary one (internal PR 239 review).
 */
const STATE_VARIANT =
  /^(?:group-|peer-|in-)?(?:hover|focus|focus-visible|focus-within|active|open|checked|selected|expanded|target|visited|disabled|enabled|required|optional|invalid|valid|user-invalid|user-valid|indeterminate|default|placeholder-shown|autofill|read-only|read-write|in-range|out-of-range|empty|popover-open|(?:data|aria|has|not)-.+|\[.+\])(?:\/[\w-]+)?$/;

/** `animate-*` under any variant (`md:animate-spin`, `hover:animate-bounce`). */
function tailwindAnimates(names: string): boolean {
  return utilitiesOf(names).some(({ utility }) =>
    /^animate-(?!none$)[\w[]/.test(utility),
  );
}

/**
 * A transform in a hover, focus or active state (under any other
 * variants) that a transition utility carries.
 */
function tailwindTransitionsTransform(names: string): boolean {
  const utilities = utilitiesOf(names);
  return (
    utilities.some(({ utility }) =>
      /^transition(?:-(?:all|transform))?$/.test(utility),
    ) &&
    utilities.some(
      ({ variants, utility }) =>
        variants.some((variant) => STATE_VARIANT.test(variant)) &&
        /^-?(?:translate|scale|rotate)-/.test(utility),
    )
  );
}

/** Every class list written in the markup. */
function classLists(text: string): string[] {
  const lists: string[] = [];
  for (const match of text.matchAll(/\sclass(?:Name)?\s*=\s*/g)) {
    const at = match.index + match[0].length;
    const quoted = /^["'`]([^"'`]*)["'`]/.exec(text.slice(at, at + 2000));
    if (quoted) {
      lists.push(quoted[1]!);
      continue;
    }
    if (text[at] !== '{') continue;
    // An expression, `{cn("animate-spin", className)}`: every string in it
    // is part of the element's class list.
    const expression = readJsxTag(`<${text.slice(at, at + 2000)}>`, 0);
    lists.push(
      [...expression.matchAll(/(["'`])([^"'`]*)\1/g)]
        .map((part) => part[2]!)
        .join(' '),
    );
  }
  return lists;
}

/**
 * What moves: an `animation` that applies keyframes, a transition of
 * transform (or `all`) on an element that another rule transforms (a
 * hover or focus state, or a class toggled on it), Tailwind's `animate-*`,
 * and Tailwind's `hover:translate-*` and the like where a transition
 * utility on the same element carries them. Colour and opacity transitions
 * are not movement, keyframes nothing applies move nothing, and a static
 * transform on one element does not make another element's transition
 * move.
 */
function motionSources(text: string): MotionSources {
  const rules = cssRules(text);
  const groups: MotionSources['groups'] = [];
  let other = false;
  const add = (rule: Rule) => {
    const found = subjectMembers(rule.selector);
    if (found.length === 0) other = true;
    groups.push(
      ...found.map((member) => ({ ...member, kind: 'animation' as const })),
    );
  };
  for (const rule of rules) {
    // By the declaration that wins: `animation: spin 1s; animation: none`
    // moves nothing (internal PR 239 review).
    if (
      ANIMATES.test(
        winningDeclaration(rule.body, 'animation(?:-name)?')?.text ?? '',
      )
    ) {
      add(rule);
    }
  }
  // Each member of a selector list on its own: `.card, .logo` transitions
  // two elements, and only the one whose transform changes moves.
  for (const rule of rules) {
    if (
      !TRANSITIONS_TRANSFORM.test(
        winningDeclaration(rule.body, 'transition(?:-property)?')?.text ?? '',
      )
    ) {
      continue;
    }
    for (const member of subjectMembers(rule.selector)) {
      const group = member.keys;
      const changes = rules.some(
        (state) =>
          state !== rule &&
          !TRANSITIONS_TRANSFORM.test(state.body) &&
          SETS_TRANSFORM.test(state.body) &&
          state.keys.some((key) => group.includes(key)),
      );
      // Or the state rule declares both: `.card:hover { transition:
      // transform .2s; transform: scale(1.1) }` moves on hover.
      const inState =
        SETS_TRANSFORM.test(rule.body) &&
        /:(?:hover|focus|focus-visible|focus-within|active)\b/i.test(
          rule.selector,
        );
      if (changes || inState) groups.push({ ...member, kind: 'transition' });
    }
  }
  // Outside any CSS rule: inline style objects.
  const loose = withoutCssRules(text, () => ' ');
  if (
    ANIMATES.test(
      loose.replace(/\sclass(?:Name)?\s*=\s*\{?\s*["'`][^"'`]*["'`]/g, ' '),
    )
  ) {
    other = true;
  }
  for (const style of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    if (
      TRANSITIONS_TRANSFORM.test(style[1]!) &&
      SETS_TRANSFORM.test(style[1]!)
    ) {
      other = true;
    }
  }
  return { groups, tailwind: classLists(text).filter(tailwindMoves), other };
}

/** An import of the Motion library, under either of its package names. */
const IMPORTS_MOTION =
  /\bfrom\s*["'](?:motion\/react(?:-m|-client)?|framer-motion|motion)["']/;

/** A prop on a Motion element that animates it. */
const MOTION_PROP =
  /\s(?:initial|animate|exit|whileInView|whileHover|whileTap|whileFocus|whileDrag|layout|layoutId|drag)(?![\w-])/;

/**
 * What the Motion library moves: `declarative` for animation set in props
 * (`<motion.div animate={...}>`) or started from script (`animate(...)`,
 * `useAnimate()`), which `MotionConfig`'s reduced-motion setting governs;
 * `linked` for motion values driven by scroll, the pointer or time, which it
 * does not. Only in a project that imports the library: `animate` is too
 * common a word to count on its own.
 */
function motionLibrary(
  text: string,
  imported: Set<string> = new Set(),
): {
  declarative: boolean;
  linked: boolean;
  imperative: boolean;
  /** Where each tag that animates in props opens. */
  declarativeAt: number[];
} {
  if (!IMPORTS_MOTION.test(text) && imported.size === 0) {
    return {
      declarative: false,
      linked: false,
      imperative: false,
      declarativeAt: [],
    };
  }
  const declarativeAt: number[] = [];
  // The names the factory goes by here, as the file imports it: `motion`,
  // `m`, an alias, `import { motion as animated }`, or a namespace's,
  // `Motion.motion` (internal PR 239 review).
  const factories = motionNames(text, ['motion', 'm']);
  const factory =
    factories.size > 0 ? [...factories].map(escapeRegExp).join('|') : '(?!)';
  // Components Motion wraps, `const MotionButton = motion.create(Button)`
  // or the older `motion(Button)`, or an element of its own bound to a
  // name, `const MotionButton = motion.button`, animate as <motion.*> does
  // (internal PR 239 review).
  // And those another module created and this one imports (internal PR 239 review).
  const created = [...motionCreated(text, factory), ...imported];
  const tags = new RegExp(
    `<(?:(?:${factory})\\.[a-z][\\w]*${created.map((name) => `|${escapeRegExp(name)}(?![\\w$.])`).join('')})`,
    'g',
  );
  for (const match of text.matchAll(tags)) {
    const tag = readJsxTag(text, match.index);
    if (MOTION_PROP.test(tag)) declarativeAt.push(match.index);
  }
  const declarative = declarativeAt.length > 0;
  // Hooks and functions only as the file imports them from Motion, under
  // their own names, an alias, `useScroll as usePageScroll`, or a
  // namespace, `Motion.useScroll`: a helper of its own called `animate` is
  // not Motion's (internal PR 239 review).
  const aliases = (names: string[]) => {
    const found = motionNames(text, names);
    if (found.size === 0) return /(?!)/;
    return new RegExp(
      `(?<![\\w$.])(?:${[...found].map(escapeRegExp).join('|')})\\s*\\(`,
    );
  };
  const linked = aliases([
    'useScroll',
    'useMotionValue',
    'useSpring',
    'useTransform',
    'useVelocity',
    'useTime',
    'useAnimationFrame',
    'useMotionTemplate',
  ]).test(text);
  // animate() and useAnimate() start animation from script, outside the
  // React tree MotionConfig governs (internal PR 239 review).
  // useAnimate() starts nothing until the animate it returns is called
  // (internal PR 239 review).
  const starters = motionStarters(text);
  const imperative =
    starters.size > 0 &&
    new RegExp(
      `(?<![\\w$.])(?:${[...starters].map(escapeRegExp).join('|')})\\s*\\(`,
    ).test(text);
  return { declarative, linked, imperative, declarativeAt };
}

/**
 * Components bound from Motion's factory: `motion.create(Button)`, the
 * older `motion(Button)`, or an element of its own, `motion.button`.
 */
function motionCreated(text: string, factory: string): string[] {
  // And a component that hands its props to one, `<motion.div {...props}
  // />`: what a use passes it animates (internal PR 239 review).
  const forwarders = [
    ...text.matchAll(
      new RegExp(
        `<(?:${factory})\\.[a-z][\\w]*(?=[^<>]*\\{\\s*\\.\\.\\.)`,
        'g',
      ),
    ),
  ].flatMap((use) => enclosingComponent(text, use.index) ?? []);
  return [
    ...forwarders,
    ...[
      ...text.matchAll(
        new RegExp(
          `\\b(?:const|let|var)\\s+([A-Z][\\w$]*)\\s*=\\s*(?:${factory})(?:(?:\\.create)?\\s*\\(|\\.[a-z][\\w]*(?![\\w$.(]))`,
          'g',
        ),
      ),
    ].map((match) => match[1]!),
  ];
}

/**
 * The names that start Motion from script: `animate` as imported, and the
 * animate `useAnimate()` hands back, `const [scope, run] = useAnimate()`.
 */
function motionStarters(text: string): Set<string> {
  const starters = motionNames(text, ['animate']);
  for (const hook of motionNames(text, ['useAnimate'])) {
    for (const bound of text.matchAll(
      new RegExp(
        `\\[\\s*[A-Za-z_$][\\w$]*\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*${escapeRegExp(hook)}\\s*\\(`,
        'g',
      ),
    )) {
      starters.add(bound[1]!);
    }
  }
  // And each local name one is given, `const run = animate` (internal PR 239 review).
  for (
    let grew = starters.size > 0, rounds = 0;
    grew && rounds < 8;
    rounds += 1
  ) {
    grew = false;
    for (const alias of text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${[...starters].map(escapeRegExp).join('|')})\\s*(?=[;,)\\n]|$)`,
        'g',
      ),
    )) {
      if (!starters.has(alias[1]!)) {
        starters.add(alias[1]!);
        grew = true;
      }
    }
  }
  return starters;
}

/** What a file calls Motion's exports, for reading its syntax tree. */
function motionBindings(
  text: string,
  imported: Set<string> = new Set(),
): MotionBindings {
  const factories = motionNames(text, ['motion', 'm']);
  return {
    factories,
    created: new Set([
      ...(factories.size > 0
        ? motionCreated(text, [...factories].map(escapeRegExp).join('|'))
        : []),
      ...imported,
    ]),
    preference: motionNames(text, ['useReducedMotion']),
    animate: motionNames(text, ['animate']),
    useAnimate: motionNames(text, ['useAnimate']),
    linked: motionNames(text, LINKED_HOOKS),
    config: motionNames(text, ['MotionConfig']),
    frame: motionNames(text, ['useAnimationFrame']),
  };
}

/**
 * Where each configured `<MotionConfig>` in a file starts and ends, from
 * its syntax tree, where the name resolves to Motion's in scope
 * (internal PR 239 review), or from its text when it does not parse.
 */
function providerExtents(file: ProjectFileLike): Array<[number, number]> {
  const dialect = dialectOf(file.path);
  const coverage = dialect
    ? motionCoverage(file.content, dialect, motionBindings(file.content))
    : undefined;
  return coverage ? coverage.providers : motionConfigExtents(file.content);
}

/**
 * Whether every Motion animation of `kind` in a file is stopped for a
 * visitor who asked, each on its own (internal PR 239 review): read from the syntax
 * tree, and from the text only when the file does not parse or the tree
 * finds none of the animations the text did.
 */
function fileMotionAnswered(
  file: ProjectFileLike,
  kind: 'declarative' | 'scripted',
  imported: Set<string>,
  fallback: () => boolean,
  { providerEverywhere = false }: { providerEverywhere?: boolean } = {},
): boolean {
  const dialect = dialectOf(file.path);
  const coverage = dialect
    ? motionCoverage(
        file.content,
        dialect,
        motionBindings(file.content, imported),
        { providerEverywhere },
      )
    : undefined;
  // The tree is the answer when the file parses: a linked value that
  // reaches no moving style, or useAnimate() whose animate is never
  // called, moves nothing (internal PR 239 review).
  if (!coverage) return fallback();
  return coverage[kind].uncovered === 0;
}

/**
 * For each script, the components another module of the project created
 * with Motion's factory and exported, under the names this script imports
 * them by: `export const MotionCard = motion.div` in one file animates as
 * `<MotionCard animate={...}>` in the file that imports it (internal PR 239 review).
 */
function importedMotionComponents(
  scripts: ProjectFileLike[],
  aliases: Alias[] = [],
): Map<string, Set<string>> {
  const exported = new Map<string, Set<string>>();
  for (const file of scripts) {
    const factories = motionNames(file.content, ['motion', 'm']);
    if (factories.size === 0) continue;
    const factory = [...factories].map(escapeRegExp).join('|');
    const created = motionCreated(file.content, factory);
    const names = new Set(
      created.filter((name) =>
        new RegExp(
          `\\bexport\\s+(?:const|let|var|function)\\s+${escapeRegExp(name)}\\b`,
        ).test(file.content),
      ),
    );
    // An export list gives each its exported name, alias and all:
    // `export { Card as MotionCard }` (internal PR 239 review). A list re-exported
    // from another module is read below.
    for (const list of file.content.matchAll(
      /\bexport\s*\{([^}]{0,400})\}(?!\s*from\b)/g,
    )) {
      for (const part of list[1]!.split(',')) {
        const binding =
          /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
            part,
          );
        if (binding && created.includes(binding[1]!)) {
          names.add(binding[2] ?? binding[1]!);
        }
      }
    }
    // The default export too, by name or as the factory itself:
    // `export default MotionCard`, `export default motion.div`
    // (internal PR 239 review).
    if (
      created.some((name) =>
        new RegExp(
          `\\bexport\\s+default\\s+(?:function\\s+)?${escapeRegExp(name)}\\b`,
        ).test(file.content),
      ) ||
      new RegExp(
        `\\bexport\\s+default\\s+(?:${factory})(?:(?:\\.create)?\\s*\\(|\\.[a-z][\\w]*(?![\\w$.(]))`,
      ).test(file.content)
    ) {
      names.add('default');
    }
    if (names.size > 0) exported.set(file.path, names);
  }
  // Through re-exports, as far as they go: a barrel's `export { MotionCard }
  // from './motion-card'`, `export * from`, or `export { default as Card }
  // from` (internal PR 239 review).
  for (
    let changed = exported.size > 0, rounds = 0;
    changed && rounds < scripts.length;
    rounds += 1
  ) {
    changed = false;
    for (const file of scripts) {
      for (const match of file.content.matchAll(
        /\bexport\s*(\*|\{([^}]{0,400})\})\s*from\s*["']([^"']+)["']/g,
      )) {
        const target = resolveModule(scripts, file.path, match[3]!, aliases);
        const names = target ? exported.get(target.path) : undefined;
        if (!names) continue;
        const own = exported.get(file.path) ?? new Set<string>();
        const before = own.size;
        if (match[1] === '*') {
          for (const name of names) if (name !== 'default') own.add(name);
        } else {
          for (const part of match[2]!.split(',')) {
            const binding =
              /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
                part,
              );
            if (binding && names.has(binding[1]!)) {
              own.add(binding[2] ?? binding[1]!);
            }
          }
        }
        if (own.size > before) {
          exported.set(file.path, own);
          changed = true;
        }
      }
    }
  }
  const imported = new Map<string, Set<string>>();
  if (exported.size === 0) return imported;
  for (const file of scripts) {
    const found = new Set<string>();
    for (const match of file.content.matchAll(
      /\bimport\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]{0,400})\})?\s*from\s*["']([^"']+)["']/g,
    )) {
      const target = resolveModule(scripts, file.path, match[3]!, aliases);
      const names = target ? exported.get(target.path) : undefined;
      if (!names) continue;
      if (match[1] && names.has('default')) found.add(match[1]);
      for (const part of (match[2] ?? '').split(',')) {
        const binding =
          /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
            part,
          );
        if (binding && names.has(binding[1]!)) {
          found.add(binding[2] ?? binding[1]!);
        }
      }
    }
    // Through a namespace, `<Cards.MotionCard>` (internal PR 239 review).
    for (const match of file.content.matchAll(
      /\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g,
    )) {
      const target = resolveModule(scripts, file.path, match[2]!, aliases);
      const names = target ? exported.get(target.path) : undefined;
      if (!names) continue;
      for (const name of names) {
        if (name !== 'default') found.add(`${match[1]!}.${name}`);
      }
    }
    if (found.size > 0) imported.set(file.path, found);
  }
  return imported;
}

/** Motion's hooks whose values follow scroll, the pointer or time. */
const LINKED_HOOKS = [
  'useScroll',
  'useMotionValue',
  'useSpring',
  'useTransform',
  'useVelocity',
  'useTime',
  'useAnimationFrame',
  'useMotionTemplate',
];

/** The props on a Motion element that set what it animates. */
const MOTION_PROP_NAMES = [
  'initial',
  'animate',
  'exit',
  'whileInView',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'layout',
  'layoutId',
  'drag',
  'transition',
  'variants',
];

/**
 * Whether a read of the reduced-motion preference decides the motion in
 * this file, not merely something (internal PR 239 review): a read that picks a
 * label leaves the animation running. A static reading cannot follow the
 * value, so the answer is held to where it is used:
 *
 * - a condition inside the call or prop that makes the motion, up to three
 *   brackets out (`useTransform(p, [0, 1], reduce ? [0, 0] : [0, 200])`,
 *   `animate={reduce ? {} : { y: 0 }}`, `animate(el, { x: reduce ? 0 : 100 })`),
 *   or inside the braces around a linked value (`style={{ y: reduce ? 0 : y }}`);
 * - a condition on the same line whose motion runs only without the
 *   preference: `reduce || animate(...)`, `!reduce && animate(...)`,
 *   `reduce ? null : animate(...)` (internal PR 239 review);
 * - an `if (!reduce)` whose body starts motion, or an `if (reduce)` that
 *   returns before motion that follows; `if (reduce) animate(...)`
 *   animates for exactly the people who asked it not to (internal PR 239 review).
 */
function preferenceGovernsMotion(
  text: string,
  kind: 'declarative' | 'scripted',
): boolean {
  const read = preferenceRead(text, { motion: true });
  const names = [
    ...text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${read}`,
        'g',
      ),
    ),
  ].map((match) => escapeRegExp(match[1]!));
  const use = `(?:${read}${names.map((name) => `|(?<![\\w$.])${name}(?![\\w$])`).join('')})`;
  // What makes motion here, for this kind.
  const hooks = [...motionNames(text, LINKED_HOOKS)];
  const starters = [...motionNames(text, ['animate'])];
  for (const hook of motionNames(text, ['useAnimate'])) {
    for (const bound of text.matchAll(
      new RegExp(
        `\\[\\s*[A-Za-z_$][\\w$]*\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*${escapeRegExp(hook)}\\s*\\(`,
        'g',
      ),
    )) {
      starters.push(bound[1]!);
    }
  }
  const values: string[] = [];
  if (hooks.length > 0) {
    const called = `(?:${hooks.map(escapeRegExp).join('|')})\\s*\\(`;
    for (const bound of text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+(?:([A-Za-z_$][\\w$]*)|\\{([^}]{0,200})\\})\\s*=\\s*${called}`,
        'g',
      ),
    )) {
      if (bound[1]) values.push(bound[1]);
      for (const part of (bound[2] ?? '').split(',')) {
        const local = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim());
        if (local) values.push(local[1]!);
      }
    }
  }
  const callers = kind === 'scripted' ? [...hooks, ...starters] : [];
  const props = kind === 'declarative' ? MOTION_PROP_NAMES : [];
  const callsMotion =
    callers.length > 0
      ? new RegExp(
          `(?<![\\w$.])(?:${callers.map(escapeRegExp).join('|')})\\s*\\(`,
        )
      : /(?!)/;
  const startsMotion = new RegExp(
    [
      callers.length > 0 ? callsMotion.source : '',
      props.length > 0 ? `\\s(?:${props.join('|')})\\s*=` : '',
    ]
      .filter(Boolean)
      .join('|') || '(?!)',
  );
  const linkedValue =
    kind === 'scripted' && values.length > 0
      ? new RegExp(
          `(?<![\\w$.])(?:${values.map(escapeRegExp).join('|')})(?![\\w$])`,
        )
      : /(?!)/;
  const OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

  for (const match of text.matchAll(
    new RegExp(`(!\\s*)?${use}\\s*(\\?|&&|\\|\\|)`, 'g'),
  )) {
    const at = match.index;
    const lineEnd = text.indexOf('\n', at);
    // The rest of the line, and which part of it runs without the
    // preference.
    const rest = text.slice(
      at + match[0].length,
      lineEnd === -1 ? undefined : lineEnd,
    );
    const negated = Boolean(match[1]);
    const operator = match[2];
    let unreduced = '';
    if (operator === '&&') unreduced = negated ? rest : '';
    else if (operator === '||') unreduced = negated ? '' : rest;
    else {
      const colon = rest.indexOf(':');
      unreduced = negated
        ? rest.slice(0, colon === -1 ? undefined : colon)
        : colon === -1
          ? ''
          : rest.slice(colon + 1);
    }
    if (callsMotion.test(unreduced)) return true;
    // Out through the brackets around the condition.
    let cursor = at;
    for (let level = 0; level < 3; level += 1) {
      let depth = 0;
      let opener = -1;
      for (let i = cursor - 1; i >= Math.max(0, at - 2000); i -= 1) {
        const char = text[i]!;
        if (char === ')' || char === ']' || char === '}') depth += 1;
        else if (char === '(' || char === '[' || char === '{') {
          if (depth === 0) {
            opener = i;
            break;
          }
          depth -= 1;
        }
      }
      if (opener === -1) break;
      const before = text.slice(Math.max(0, opener - 80), opener);
      if (
        (callers.length > 0 &&
          new RegExp(
            `(?<![\\w$.])(?:${callers.map(escapeRegExp).join('|')})\\s*$`,
          ).test(before)) ||
        (props.length > 0 &&
          new RegExp(`\\s(?:${props.join('|')})\\s*=\\s*$`).test(before))
      ) {
        return true;
      }
      if (level === 0) {
        const close = matchingClose(text, opener, OPEN);
        if (linkedValue.test(text.slice(opener, close))) return true;
      }
      cursor = opener;
    }
  }
  for (const match of text.matchAll(
    new RegExp(`\\bif\\s*\\(\\s*(!\\s*)?${use}\\s*\\)\\s*`, 'g'),
  )) {
    const after = match.index + match[0].length;
    if (!match[1]) {
      // A return leaves the block it is in: the motion has to follow it
      // there, not in some other callback (internal PR 239 review).
      if (/^(?:\{\s*)?return\b/.test(text.slice(after, after + 20))) {
        const block = enclosingOpen(text, match.index);
        const end =
          block === -1 ? text.length : matchingClose(text, block, OPEN);
        if (startsMotion.test(text.slice(after, end))) return true;
      }
      continue;
    }
    const body =
      text[after] === '{'
        ? text.slice(after, matchingClose(text, after, OPEN))
        : text.slice(after, text.indexOf(';', after) + 1 || undefined);
    if (startsMotion.test(body)) return true;
  }
  return false;
}

/**
 * The unclosed `{` nearest before `at`: the block a statement there is in,
 * or -1. Bounded, as matchingClose is.
 */
function enclosingOpen(text: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= Math.max(0, at - 4000); i -= 1) {
    const char = text[i];
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Where the bracket opened at `open` closes, or the end of the text. The
 * walk is bounded, and skips nothing: strings with brackets in them are
 * rare in the expressions it reads.
 */
function matchingClose(
  text: string,
  open: number,
  pairs: Record<string, string>,
): number {
  let depth = 0;
  const limit = Math.min(text.length, open + 4000);
  for (let i = open; i < limit; i += 1) {
    const char = text[i]!;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (pairs[char] !== undefined) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

/** The module names Motion is imported from. */
const MOTION_MODULE =
  /["'](?:motion\/react(?:-m|-client)?|framer-motion|motion)["']/.source;

/**
 * The local names a file binds to these Motion exports: each one it
 * imports by name, under that name or the alias it gives it, and
 * `Namespace.name` for a namespace import of the library.
 */
function motionNames(text: string, exports: string[]): Set<string> {
  return importedNames(text, exports, MOTION_MODULE);
}

/**
 * The local names a file binds to these exports of the modules `module`
 * (a pattern for the quoted specifier) names, as motionNames reads them.
 */
function importedNames(
  text: string,
  exports: string[],
  module: string,
): Set<string> {
  const names = new Set<string>();
  for (const clause of text.matchAll(
    new RegExp(
      `\\bimport\\s*(?:type\\s+)?\\{([^}]{0,400})\\}\\s*from\\s*${module}`,
      'g',
    ),
  )) {
    for (const binding of clause[1]!.matchAll(
      /(?:^|,)\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*(?=,|$)/g,
    )) {
      if (exports.includes(binding[1]!)) names.add(binding[2] ?? binding[1]!);
    }
  }
  for (const space of text.matchAll(
    new RegExp(
      `\\bimport\\s*\\*\\s*as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*${module}`,
      'g',
    ),
  )) {
    for (const name of exports) names.add(`${space[1]!}.${name}`);
  }
  return names;
}

/** A `motion-reduce:` utility that stops an animation. */
const MOTION_REDUCE_STOPS_ANIMATION =
  /(?:^|\s)motion-reduce:!?(?:animate-none|hidden|invisible)!?(?![\w-])/;

/**
 * A `motion-reduce:` utility that stops a transitioned transform whatever
 * it is. A reset of one transform, `translate-x-0`, leaves the others
 * moving, and is weighed against them where the utilities are read
 * (internal PR 239 review).
 */
const MOTION_REDUCE_STOPS_TRANSITION =
  /(?:^|\s)motion-reduce:!?(?:transition-none|transform-none|duration-0|hidden|invisible)!?(?![\w-])/;

/**
 * Whether what moves is stopped for a visitor who asked for less motion.
 *
 * Each element that moves needs its own answer: a `reduce` rule that stops
 * it (by any of its classes, its id or its element name), a rule that
 * covers the whole page (`*`), or, for an element with classes, a
 * `motion-reduce:` utility in its own class list. A rule that stops a
 * spinner does not stop a card, and a `motion-reduce:` class on a sibling
 * does not stop a Tailwind spinner. An inline style is answered by any
 * stopping rule, or by script that reads the preference. Script answers
 * a class only where the read decides it: a `className={...}` expression
 * that uses the read, or the name it was given, answers the classes in it.
 * A read that turns off one library effect leaves a CSS spinner running.
 */
function answersReducedMotion(text: string, sources: MotionSources): boolean {
  const reads = READS_PREFERENCE.test(text);
  const gated = reads ? gatedClassLists(text) : [];
  // Each reduce rule where it sits in the stylesheet, so a later rule that
  // restarts the motion can be weighed against it (internal PR 239 review).
  let searched = 0;
  const reduceRules = [
    ...mediaBlocks(text, 'prefers-reduced-motion\\s*:\\s*reduce', {
      alone: true,
    }).bodies.flatMap((body) => {
      const at = text.indexOf(body, searched);
      if (at !== -1) searched = at + body.length;
      return cssRules(body, at === -1 ? 0 : at);
    }),
    // A class script adds for the visitor who asked is applied after
    // everything the stylesheet says.
    ...(reads ? gatedRules(text) : []).map((rule) => ({
      ...rule,
      at: Number.POSITIVE_INFINITY,
    })),
  ];
  // Not a rule only a visitor who did not ask sees: `@media
  // (prefers-reduced-motion: no-preference)` never applies to one who did
  // (internal PR 239 review).
  const unseen: Array<[number, number]> = [];
  for (const block of text.matchAll(
    /@media[^{;]*prefers-reduced-motion\s*:\s*no-preference[^{;]*\{/gi,
  )) {
    const open = block.index + block[0].length - 1;
    unseen.push([open, matchingClose(text, open, { '}': '{' })]);
  }
  const everyRule = cssRules(text).filter(
    (rule) => !unseen.some(([start, end]) => rule.at > start && rule.at < end),
  );
  // The cascade layer each rule sits in: a later layer holds over an
  // earlier one whatever the specificity (internal PR 239 review).
  const layerAt = new Map<number, number[]>();
  {
    const tracker = blockTracker(text);
    for (const at of [
      ...new Set(
        [...everyRule, ...reduceRules]
          .map((rule) => rule.at)
          .filter(Number.isFinite),
      ),
    ].sort((a, b) => a - b)) {
      layerAt.set(at, tracker(at).layer);
    }
  }
  const layerOf = (rule: Rule) => layerAt.get(rule.at) ?? [];
  /**
   * Whether `other`'s declaration holds over `rule`'s in the cascade:
   * important over normal; then the later layer (the earlier one among
   * important declarations); then more specific; then later.
   */
  const beats = (
    other: Rule,
    otherWeight: number,
    otherImportant: boolean,
    rule: Rule,
    weight: number,
    stopImportant: boolean,
  ) => {
    if (otherImportant !== stopImportant) return otherImportant;
    const layers = compareLayers(layerOf(other), layerOf(rule));
    if (layers !== 0) return stopImportant ? layers < 0 : layers > 0;
    return (
      otherWeight > weight || (otherWeight === weight && other.at > rule.at)
    );
  };
  /**
   * Each way a stop works, read from the declaration that wins in a rule:
   * whether it stops the motion that way, whether another rule's winning
   * declaration undoes it, and whether that declaration is important. A
   * stop holds while any of the ways it works holds (internal PR 239 review).
   */
  interface Mechanism {
    stops(body: string): boolean;
    undoes(body: string): boolean;
    important(body: string): boolean;
  }
  const declared =
    (property: string): Mechanism['important'] =>
    (body) =>
      winningDeclaration(body, property)?.important ?? false;
  // Display and visibility hide on their own, each weighed by its own
  // declaration: an important `visibility: visible` does not make a
  // normal `display: none` important (internal PR 239 review).
  const hidingByDisplay: Mechanism = {
    stops: (body) => /^none$/i.test(winningValue(body, 'display') ?? ''),
    undoes: (body) => {
      const won = winningValue(body, 'display');
      return won !== undefined && !/^none$/i.test(won);
    },
    important: declared('display'),
  };
  const hidingByVisibility: Mechanism = {
    stops: (body) => /^hidden$/i.test(winningValue(body, 'visibility') ?? ''),
    undoes: (body) => /^visible$/i.test(winningValue(body, 'visibility') ?? ''),
    important: declared('visibility'),
  };
  const mechanisms: Record<'animation' | 'transition', Mechanism[]> = {
    animation: [
      {
        stops: (body) =>
          (winningValue(body, 'animation(?:-name)?') ?? '')
            .split(',')
            .every((entry) => /^none$/i.test(entry.trim())),
        undoes: (body) =>
          ANIMATES.test(
            winningDeclaration(body, 'animation(?:-name)?')?.text ?? '',
          ),
        important: declared('animation(?:-name)?'),
      },
      {
        stops: (body) =>
          winningDeclaration(body, 'animation(?:-play-state)?')?.name ===
            'animation-play-state' &&
          (winningValue(body, 'animation(?:-play-state)?') ?? '')
            .split(',')
            .every((entry) => /^paused$/i.test(entry.trim())),
        undoes: (body) => {
          const won = winningDeclaration(body, 'animation(?:-play-state)?');
          return won !== undefined && !/^paused$/i.test(won.value);
        },
        important: declared('animation(?:-play-state)?'),
      },
      {
        stops: (body) => {
          const won = winningDeclaration(body, 'animation(?:-duration)?');
          return (
            won?.name.toLowerCase() === 'animation-duration' &&
            negligibleList(won.value)
          );
        },
        undoes: (body) => {
          const won = winningDeclaration(body, 'animation(?:-duration)?');
          if (!won) return false;
          return won.name.toLowerCase() === 'animation-duration'
            ? !negligibleList(won.value)
            : ANIMATES.test(won.text);
        },
        important: declared('animation(?:-duration)?'),
      },
      hidingByDisplay,
      hidingByVisibility,
    ],
    transition: [
      {
        stops: (body) =>
          /^none$/i.test(winningValue(body, 'transition(?:-property)?') ?? ''),
        undoes: (body) =>
          TRANSITIONS_TRANSFORM.test(
            winningDeclaration(body, 'transition(?:-property)?')?.text ?? '',
          ),
        important: declared('transition(?:-property)?'),
      },
      // `transform: none` is undone by a transform set again over it
      // (internal PR 239 review).
      {
        stops: (body) => /^none$/i.test(winningValue(body, 'transform') ?? ''),
        undoes: (body) => {
          const won = winningValue(body, 'transform');
          return won !== undefined && !/^none$/i.test(won);
        },
        important: declared('transform'),
      },
      {
        stops: (body) => {
          const won = winningDeclaration(body, 'transition(?:-duration)?');
          return (
            won?.name.toLowerCase() === 'transition-duration' &&
            negligibleList(won.value)
          );
        },
        undoes: (body) => {
          const won = winningDeclaration(body, 'transition(?:-duration)?');
          if (!won) return false;
          return won.name.toLowerCase() === 'transition-duration'
            ? !negligibleList(won.value)
            : TRANSITIONS_TRANSFORM.test(won.text);
        },
        important: declared('transition(?:-duration)?'),
      },
      hidingByDisplay,
      hidingByVisibility,
    ],
  };
  /**
   * Whether every way a reduce rule stops the element is undone by another
   * rule the cascade applies over it: important over normal, whatever the
   * specificity; between two alike, more specific, or as specific and
   * later. `.spinner { animation: spin 1s }` after the reduce block, or a
   * more specific `.spinner.active` before it, starts the motion again
   * (internal PR 239 review).
   */
  const overridden = (
    rule: Rule,
    weight: number,
    moving: SelectorMember,
    kind: 'animation' | 'transition',
  ) =>
    mechanisms[kind]
      .filter((mechanism) => mechanism.stops(rule.body))
      .every((mechanism) => {
        const stopImportant = mechanism.important(rule.body);
        return everyRule.some((other) => {
          if (other === rule || !mechanism.undoes(other.body)) return false;
          const otherImportant = mechanism.important(other.body);
          return subjectMembers(other.selector).some(
            (member) =>
              covers(member, moving, { states: kind === 'animation' }) &&
              beats(
                other,
                memberWeight(member),
                otherImportant,
                rule,
                weight,
                stopImportant,
              ),
          );
        });
      });
  /**
   * Whether a page-wide stop holds over inline motion: an inline style
   * outweighs every normal declaration in a stylesheet, so only a way of
   * stopping declared important does (internal PR 239 review).
   */
  // And that no other important rule, which may reach the element too,
  // starts it again over the stop (internal PR 239 review).
  const overInline = (rule: Rule) =>
    [...mechanisms.animation, ...mechanisms.transition].some(
      (mechanism) =>
        mechanism.stops(rule.body) &&
        mechanism.important(rule.body) &&
        // Only a rule that reaches every element can be known to reach
        // the one with the inline style: `.other` may not (internal PR 239 review).
        !everyRule.some(
          (other) =>
            other !== rule &&
            coversEverything(other.selector) &&
            mechanism.undoes(other.body) &&
            mechanism.important(other.body) &&
            beats(
              other,
              Math.max(0, ...subjectMembers(other.selector).map(memberWeight)),
              true,
              rule,
              0,
              true,
            ),
        ),
    );
  const stoppers = reduceRules.filter((rule) => stopsMotion(rule.body));
  const stops = {
    animation: stopsAnimation,
    transition: stopsTransition,
  } as const;
  const utilities = {
    animation: MOTION_REDUCE_STOPS_ANIMATION,
    transition: MOTION_REDUCE_STOPS_TRANSITION,
  } as const;
  const lists = classLists(text);
  const stopped = (moving: SelectorMember, kind: 'animation' | 'transition') =>
    reduceRules.some(
      (rule) =>
        stops[kind](rule.body) &&
        ((coversEverything(rule.selector) &&
          !overridden(rule, 0, moving, kind)) ||
          subjectMembers(rule.selector).some(
            (member) =>
              covers(member, moving, { states: kind === 'animation' }) &&
              !overridden(rule, memberWeight(member), moving, kind),
          )),
    ) ||
    moving.keys.some(
      (key) =>
        key.startsWith('.') &&
        lists.some(
          (names) =>
            // An important class is stopped only by an important reset
            // (internal PR 239 review).
            (/^\.!|!$/.test(key)
              ? names
                  .split(/\s+/)
                  .some(
                    (token) =>
                      /^motion-reduce:/.test(token) &&
                      /^!|!$/.test(token.slice('motion-reduce:'.length)) &&
                      utilities[kind].test(` ${token}`),
                  )
              : utilities[kind].test(names)) &&
            names.split(/\s+/).includes(key.slice(1)),
        ),
    );
  const groupsStopped = sources.groups.every(
    (group) =>
      stopped(group, group.kind) ||
      group.keys.some(
        (key) =>
          key.startsWith('.') &&
          gated.some(
            ({ all, reduced }) =>
              all.split(/\s+/).includes(key.slice(1)) &&
              !reduced.split(/\s+/).includes(key.slice(1)),
          ),
      ),
  );
  // Each kind a class list moves by is answered on its own, and a
  // `motion-reduce:` stopper only answers the motion whose variants it
  // shares: `md:motion-reduce:animate-none` leaves a small screen's
  // `animate-spin` running.
  const tailwindStopped = sources.tailwind.every((names) => {
    const decided = gated.find(({ all }) => all === names);
    if (decided && !tailwindMoves(decided.reduced)) return true;
    const kinds = [
      ...(tailwindAnimates(names) ? (['animation'] as const) : []),
      ...(tailwindTransitionsTransform(names) ? (['transition'] as const) : []),
    ];
    return kinds.every(
      (kind) =>
        tailwindStops(names, kind) ||
        reduceRules.some(
          (rule) => stops[kind](rule.body) && coversEverything(rule.selector),
        ) ||
        stopped(
          {
            keys: names.split(/\s+/).map((name) => `.${name.split(':').pop()}`),
            scope: '',
            scopeNames: [],
          },
          kind,
        ),
    );
  });
  return (
    groupsStopped &&
    tailwindStopped &&
    (!sources.other ||
      stoppers.some(
        (rule) => coversEverything(rule.selector) && overInline(rule),
      ) ||
      (reads && inlineMotionGoverned(text)))
  );
}

/**
 * Whether every inline motion (a style object or attribute, or script
 * that sets one) is decided by the preference: it uses the read, as in
 * `animation: reduce ? 'none' : 'spin 1s'`, or sits under a condition
 * that does. A read that only sets `<Card compact={reduce} />` leaves an
 * inline spinner running.
 */
function inlineMotionGoverned(text: string): boolean {
  const uses = preferenceUses(text);
  const blank = (match: string) => ' '.repeat(match.length);
  const loose = withoutCssRules(text, blank).replace(
    /\sclass(?:Name)?\s*=\s*\{?\s*["'`][^"'`]*["'`]/g,
    blank,
  );
  // The declaration's own value (`animation: reduce ? 'none' : ...`), or
  // a condition in front of the element that leaves it out for a visitor
  // who asked (`{!reduce && <div style={{ animation: ... }} />}`).
  const governed = (at: number, snippet: string) => {
    const tag = text.lastIndexOf('<', at);
    return (
      uses.test(snippet) ||
      (tag !== -1 &&
        !appliesWhenReduced(text.slice(Math.max(0, tag - 80), tag), uses))
    );
  };
  for (const match of loose.matchAll(new RegExp(ANIMATES.source, 'gi'))) {
    const value = text.slice(
      match.index,
      expressionEnd(text, match.index, { commas: true }),
    );
    if (!governed(match.index, value)) return false;
  }
  for (const style of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    if (
      TRANSITIONS_TRANSFORM.test(style[1]!) &&
      SETS_TRANSFORM.test(style[1]!) &&
      !governed(style.index, style[1]!)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Rules that apply once script that read the preference has added a class
 * to the page: with `classList.add('calm')`, `.calm .card { transition:
 * none }` is a reduce rule for `.card`. Each comes back with the class
 * taken off its selector, as the rule the class switches on.
 */
function gatedRules(text: string): Rule[] {
  const classes = new Set(
    [
      ...text.matchAll(
        /classList\s*\.\s*(?:add|toggle)\s*\(\s*["'`]([\w-]+)["'`]/g,
      ),
    ].map((match) => match[1]!),
  );
  if (classes.size === 0) return [];
  const rules: Rule[] = [];
  for (const rule of cssRules(text)) {
    const selectors = rule.selector
      .split(',')
      .map((part) => part.trim().split(/\s*[\s>+~]\s*/))
      .filter(
        (compounds) =>
          compounds.length > 1 &&
          (compounds[0]!.match(/\.[\w-]+/g) ?? []).some((name) =>
            classes.has(name.slice(1)),
          ),
      )
      .map((compounds) => compounds.slice(1).join(' '));
    if (selectors.length === 0) continue;
    const selector = selectors.join(', ');
    rules.push({
      selector,
      body: rule.body,
      keys: subjectKeys(selector),
      at: rule.at,
    });
  }
  return rules;
}

/**
 * A use of the reduced-motion preference: the read itself, or a name it
 * was given (`const reduce = useReducedMotion()`).
 */
function preferenceUses(text: string): RegExp {
  const names = [
    ...text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${preferenceRead(text)}`,
        'g',
      ),
    ),
  ].map((match) => escapeRegExp(match[1]!));
  return new RegExp(
    [
      preferenceRead(text),
      ...names.map((name) => `(?<![\\w$.])${name}(?![\\w$])`),
    ].join('|'),
  );
}

/**
 * Whether the preference, not its negation, guards the few lines before
 * `at`: `if (reduce) video.pause()` stops it for reduced-motion visitors,
 * `if (!reduce) video.pause()` stops it for everyone else.
 */
function guardedByPreference(text: string, at: number, uses: RegExp): boolean {
  const guard = guardOf(text, at);
  return guard !== undefined && affirmed(uses).test(guard);
}

/**
 * The condition that governs the statement at `at`: its own `if (...)`,
 * a `cond && ...` or `cond ? ... :` in front of it, or else the `if` of
 * the block it sits in. `if (reduce) stop(); if (!reduce) v.pause()`
 * gives `!reduce` for the pause, not the `reduce` before it.
 */
function guardOf(text: string, at: number): string | undefined {
  const start = Math.max(
    text.lastIndexOf(';', at - 1),
    text.lastIndexOf('{', at - 1),
    text.lastIndexOf('}', at - 1),
  );
  // Up to the handle, without the receiver it hangs off
  // (`document.` in `document.querySelector(...)`).
  const statement = text
    .slice(start + 1, at)
    .replace(/(?:[A-Za-z_$][\w$]*\s*\??\.\s*)+$/, '');
  const own = /^\s*(?:else\s+)?if\s*\(([\s\S]*)\)\s*$/.exec(statement);
  if (own) return own[1];
  const inline = /^\s*([\s\S]*?)\s*(?:&&|\?)\s*$/.exec(statement);
  if (inline && inline[1]!.trim()) return inline[1];
  // The block around it: its header, when that is an `if`.
  let depth = 0;
  for (let index = at - 1; index >= 0; index -= 1) {
    const char = text[index]!;
    if (char === '}') depth += 1;
    else if (char === '{') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const header = text.slice(
        Math.max(
          text.lastIndexOf(';', index - 1),
          text.lastIndexOf('}', index - 1),
          text.lastIndexOf('{', index - 1),
        ) + 1,
        index,
      );
      return /^\s*(?:else\s+)?if\s*\(([\s\S]*)\)\s*$/.exec(header)?.[1];
    }
  }
  return undefined;
}

/** A use of the preference that is not negated. */
function affirmed(uses: RegExp): RegExp {
  return new RegExp(`(?<!!\\s*)(?:${uses.source})`);
}

/** A negated use of the preference: `!reduce`. */
function negated(uses: RegExp): RegExp {
  return new RegExp(`!\\s*(?:${uses.source})`);
}

/**
 * Whether a render condition leaves the video out when the preference is
 * set: `{!reduce && <video />}`, `reduce ? <img /> : <video />` or
 * `!reduce ? <video /> : <img />`. `{reduce && <video />}` renders it for
 * exactly the visitors who asked for less motion.
 */
function omitsWhenReduced(condition: string, uses: RegExp): boolean {
  const operator = /(&&|\?|:)\s*\(?\s*$/.exec(condition)?.[1];
  if (operator === ':') return affirmed(uses).test(condition);
  return negated(uses).test(condition);
}

/**
 * The class lists that a preference read decides: `className={...}`
 * expressions that use the read itself, or a name it was given. Each is
 * joined the way `classLists` joins it.
 */
function gatedClassLists(text: string): { all: string; reduced: string }[] {
  const uses = preferenceUses(text);
  const lists: { all: string; reduced: string }[] = [];
  for (const match of text.matchAll(/\sclass(?:Name)?\s*=\s*\{/g)) {
    const at = match.index + match[0].length - 1;
    const expression = readJsxTag(`<${text.slice(at, at + 2000)}>`, 0);
    if (!uses.test(expression)) continue;
    const literals = [...expression.matchAll(/(["'`])([^"'`]*)\1/g)];
    lists.push({
      all: literals.map((part) => part[2]!).join(' '),
      reduced: literals
        .filter((part) =>
          appliesWhenReduced(expression.slice(0, part.index), uses),
        )
        .map((part) => part[2]!)
        .join(' '),
    });
  }
  return lists;
}

/**
 * Whether a class string in a `className` expression applies once the
 * preference is set: `reduce ? 'a' : 'b'` applies `a`, `!reduce && 'b'`
 * applies nothing, and a string no preference decides always applies.
 */
function appliesWhenReduced(before: string, uses: RegExp): boolean {
  const use = `(?:${uses.source})`;
  // `reduce && 'x'` and `!reduce && 'x'`.
  const and = new RegExp(`(!?)\\s*${use}\\s*&&\\s*\\(?\\s*$`).exec(before);
  if (and) return and[1] !== '!';
  // The true branch: `reduce ? 'x' : ...`.
  const whenTrue = new RegExp(`(!?)\\s*${use}\\s*\\?\\s*\\(?\\s*$`).exec(
    before,
  );
  if (whenTrue) return whenTrue[1] !== '!';
  // The false branch: `reduce ? ... : 'x'`.
  const whenFalse = new RegExp(
    `(!?)\\s*${use}\\s*\\?\\s*(["'\`])[^"'\`]*\\2\\s*:\\s*\\(?\\s*$`,
  ).exec(before);
  if (whenFalse) return whenFalse[1] === '!';
  return true;
}

/** The classes and id an opening tag carries. */
function namesOf(tag: string): string[] {
  const names: string[] = [];
  for (const match of tag.matchAll(
    /\s(class(?:Name)?|id)\s*=\s*\{?\s*["'`]([^"'`]+)["'`]/g,
  )) {
    // As a selector would write them: `.hero` for a class, `#hero` for an
    // id. A rule for one does not reach the other.
    const prefix = match[1] === 'id' ? '#' : '.';
    names.push(
      ...match[2]!
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => prefix + name),
    );
  }
  return names;
}

/** How far back the ancestor scan looks for the elements around a video. */
const MAX_ANCESTOR_SCAN = 8000;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * The opening tags of the elements still open at `at`: its ancestors, not
 * siblings that happen to come before it. Tags that close themselves, void
 * elements and anything already closed are dropped as the scan goes.
 */
function openAround(text: string, at: number): string[] {
  const from = Math.max(0, at - MAX_ANCESTOR_SCAN);
  const open: { name: string; tag: string }[] = [];
  const tags = /<(\/?)([A-Za-z][\w.:-]*)/g;
  tags.lastIndex = from;
  for (
    let match = tags.exec(text);
    match && match.index < at;
    match = tags.exec(text)
  ) {
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      const last = open.map((element) => element.name).lastIndexOf(name);
      if (last !== -1) open.length = last;
      continue;
    }
    const tag = readJsxTag(text, match.index);
    tags.lastIndex = match.index + Math.max(tag.length, 1);
    if (/\/\s*>$/.test(tag) || VOID_ELEMENTS.has(name)) continue;
    open.push({ name, tag });
  }
  return open.map((element) => element.tag);
}

/** `value` for use inside a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether script pauses this video or takes its autoplay away, through a
 * handle on it: its `ref`, `getElementById` of its id, a query for it, or
 * a name given one of those. A `.pause()` on something else does nothing
 * for it.
 */
function stoppedByScript(
  text: string,
  tag: string,
  videos: number,
  uses: RegExp,
): boolean {
  const handles: string[] = [];
  const ref = /\sref\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(tag)?.[1];
  if (ref) handles.push(`(?<![\\w$.])${escapeRegExp(ref)}(?:\\.current)?`);
  // `querySelector('video')` finds the first video only: a selector that
  // is not an id reaches this one only when it is the page's only video.
  const selectors: string[] = videos === 1 ? ['video'] : [];
  const id = /\sid\s*=\s*["']([^"']+)["']/.exec(tag)?.[1];
  if (id) {
    handles.push(`getElementById\\(\\s*["'\`]${escapeRegExp(id)}["'\`]\\s*\\)`);
    selectors.push(`#${id}`);
  }
  for (const name of namesOf(tag)) {
    if (name.startsWith('.') && videos === 1) selectors.push(name);
  }
  {
    // Every video a `querySelectorAll(...).forEach(v => v.pause())` finds,
    // this one among them.
    const reaching = [
      'video',
      ...(id ? [`#${id}`] : []),
      ...namesOf(tag).filter((name) => name.startsWith('.')),
    ];
    const all = `querySelectorAll\\(\\s*["'\`][^"'\`]*(?:${reaching.map(escapeRegExp).join('|')})(?![\\w-])[^"'\`]*["'\`]\\s*\\)\\.forEach\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\{?\\s*\\1\\.pause\\s*\\(`;
    for (const match of text.matchAll(new RegExp(all, 'g'))) {
      if (guardedByPreference(text, match.index, uses)) return true;
    }
  }
  if (selectors.length === 0) {
    return stoppedThrough(text, handles, uses);
  }
  handles.push(
    `querySelector\\(\\s*["'\`][^"'\`]*(?:${selectors.map(escapeRegExp).join('|')})(?![\\w-])[^"'\`]*["'\`]\\s*\\)`,
  );
  return stoppedThrough(text, handles, uses);
}

/** Whether script pauses, or takes autoplay from, anything `handles` names. */
function stoppedThrough(
  text: string,
  handles: string[],
  uses: RegExp,
): boolean {
  if (handles.length === 0) return false;
  const handle = handles.join('|');
  const named = [
    ...text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${handle})`,
        'g',
      ),
    ),
  ].map((match) => `(?<![\\w$.])${escapeRegExp(match[1]!)}`);
  // And only where the preference guards it, in the lines just before.
  for (const match of text.matchAll(
    new RegExp(
      `(?:${[handle, ...named].join('|')})\\??\\.(?:pause\\s*\\(|removeAttribute\\s*\\(\\s*["'\`]autoplay|autoplay\\s*=\\s*false)`,
      'gi',
    ),
  )) {
    if (guardedByPreference(text, match.index, uses)) return true;
  }
  return false;
}

/**
 * The expression that decides whether the element at `at` renders:
 * `{open && <video />}` gives `open &&`, `(reduce ? <img /> : <video />)`
 * gives the whole ternary up to the video. Read back to the bracket that
 * opens it, so a preference used elsewhere nearby is not taken for it.
 * `undefined` when the element is not rendered on a condition.
 */
function renderCondition(text: string, at: number): string | undefined {
  const before = text.slice(Math.max(0, at - 400), at);
  if (!/(?:&&|\?|:)\s*\(?\s*$/.test(before)) return undefined;
  let depth = 0;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const char = before[index]!;
    if (char === ')' || char === '}' || char === ']') depth += 1;
    else if (char === '(' || char === '{' || char === '[') {
      if (depth === 0) {
        // `(` straight after the operator is the element's own wrapper.
        if (char === '(' && /(?:&&|\?|:)\s*$/.test(before.slice(0, index))) {
          continue;
        }
        return before.slice(index + 1);
      }
      depth -= 1;
    }
  }
  return before;
}

/** An autoplaying `<video>`, as `autoplayingVideos` finds it. */
interface AutoplayingVideo {
  tag: string;
  /** Every name a stylesheet could reach it or its wrappers by. */
  names: string[];
  /** Those names per element, outermost ancestor first, the video last. */
  chain: string[][];
  /** Whether script decides whether it plays. */
  controlled: boolean;
}

/**
 * The autoplaying `<video>` tags, each with the names a stylesheet could
 * reach it by: `video`, its own classes and id, and those of the elements
 * still open around it, which is where its wrapper is.
 */
function autoplayingVideos(text: string): AutoplayingVideo[] {
  const found: AutoplayingVideo[] = [];
  const videos = [...text.matchAll(/<video\b/gi)].length;
  const uses = preferenceUses(text);
  for (const opener of text.matchAll(/<video\b/gi)) {
    const tag = readJsxTag(text, opener.index);
    if (!/\sautoplay\b(?!\s*=\s*\{\s*false\s*\})/i.test(tag)) continue;
    const chain = [
      ...openAround(text, opener.index).map(namesOf),
      ['video', ...namesOf(tag)],
    ];
    // Something script decides: autoplay set from an expression, the video
    // rendered only on a condition, or script that pauses it or takes its
    // autoplay away.
    // Each only when the preference is what decides it: `autoPlay=
    // {!reduce}`, `reduce ? <img /> : <video />`, `if (reduce) v.pause()`.
    // `autoPlay={carouselActive}` is script, but not this preference.
    const autoplay = /\sautoplay\s*=\s*\{([^}]*)\}/i.exec(tag)?.[1];
    const condition = renderCondition(text, opener.index);
    // And the right way round: autoplay off, or the video left out, when
    // the preference is set. `autoPlay={reduce}` plays it for exactly the
    // visitors who asked for less motion.
    const controlled =
      (autoplay !== undefined &&
        (negated(uses).test(autoplay) ||
          new RegExp(`(?:${uses.source})\\s*\\?\\s*false\\b`).test(
            autoplay,
          ))) ||
      (condition !== undefined && omitsWhenReduced(condition, uses)) ||
      stoppedByScript(text, tag, videos, uses);
    found.push({ tag, names: chain.flat(), chain, controlled });
  }
  return found;
}

/** Whether a `<video>` plays by itself, which is movement, and usually the page's most. */
function autoplaysVideo(text: string): boolean {
  return autoplayingVideos(text).length > 0;
}

/**
 * Whether every autoplaying video is dealt with for a visitor who asked
 * for less motion. CSS cannot pause a video, so a `reduce` rule that stops
 * an animation elsewhere does nothing for it, and nor does one that hides
 * something else: under `reduce` a rule has to hide the video itself or
 * its wrapper (by element, class or id), or the video has to carry
 * `motion-reduce:hidden`, or script has to read the preference and act.
 */
function answersForVideo(text: string): boolean {
  // Script that reads the preference, but not a motion library told to
  // follow it: `<MotionConfig reducedMotion="user">` changes the library's
  // own animations and does nothing to a native `<video autoPlay>`.
  // And the read has to be able to reach the video: one used only to turn
  // off a library animation leaves a native video playing.
  const reads = readsPreference(text, { framework: false });
  const { bodies } = mediaBlocks(
    text,
    'prefers-reduced-motion\\s*:\\s*reduce',
    { alone: true },
  );
  const hiders: string[] = [];
  for (const body of bodies) {
    for (const rule of cssRuleMatches(body)) {
      if (/\b(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(rule.body)) {
        hiders.push(rule.selector);
      }
    }
  }
  // The rule has to hide the video or its wrapper itself: the selector's
  // subject, not an ancestor on the way to something else inside it.
  // And its scope has to be one the video is in: `.dialog video` hides a
  // video inside a dialog, not every video.
  // In order: `.hero .dialog` is a dialog inside a hero, not a hero inside
  // a dialog. A compound with no class or id (`main`) is not checked.
  const reaches = (selector: string, chain: string[][]) =>
    subjectMembers(selector).some((member) =>
      chain.some((element, at) => {
        if (!member.keys.some((key) => element.includes(key))) return false;
        const scope = member.scope
          .split(' ')
          .filter(Boolean)
          .map((compound) => compound.match(/[.#][\w-]+/g) ?? []);
        let ancestor = at - 1;
        for (const compound of scope.reverse()) {
          while (
            ancestor >= 0 &&
            !compound.every((name) => chain[ancestor]!.includes(name))
          ) {
            ancestor -= 1;
          }
          if (ancestor < 0) return false;
          ancestor -= 1;
        }
        return true;
      }),
    );
  return autoplayingVideos(text).every(
    ({ tag, chain, controlled }) =>
      (reads && controlled) ||
      // Unscoped: `md:motion-reduce:hidden` leaves a small screen playing.
      /(?<![\w:-])motion-reduce:!?(?:hidden|invisible)!?(?![\w-])/.test(tag) ||
      hiders.some((selector) => reaches(selector, chain)),
  );
}

/** Script that reads the reduced-motion preference, which exists to act on it. */
const READS_PREFERENCE = {
  test: readsPreference,
};

/** Reading the preference through the media query. */
const MEDIA_QUERY_READ =
  /(?:window\.)?matchMedia\(\s*['"`]\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*['"`]\s*\)(?:\.matches)?/
    .source;

/**
 * Reading the preference: `useReducedMotion()`, under its own name, the
 * alias a Motion import gives it, `useReducedMotion as usePrefersReduced`,
 * or a namespace's (internal PR 239 review), or the media query.
 */
function preferenceRead(
  text: string,
  { motion = false }: { motion?: boolean } = {},
): string {
  // For Motion, only Motion's hook as the file imports it: a hook of its
  // own by that name may answer anything (internal PR 239 review). Elsewhere the name
  // alone, as before: react-spring and others have one too.
  const hooks = motionNames(text, ['useReducedMotion']);
  if (!motion) hooks.add('useReducedMotion');
  if (hooks.size === 0) return `(?:${MEDIA_QUERY_READ})`;
  return `(?:(?<![\\w$.])(?:${[...hooks].map(escapeRegExp).join('|')})\\s*\\(\\s*\\)|${MEDIA_QUERY_READ})`;
}

/**
 * Script that reads the reduced-motion preference and uses the answer: a
 * framework told to follow it (`<MotionConfig reducedMotion="user">`), the
 * read used in place (`useReducedMotion() ? ...`, `.matches && ...`,
 * `if (...)`), or assigned to a name that is used again. A read whose
 * result nothing looks at changes nothing.
 */
function readsPreference(
  text: string,
  { framework = true }: { framework?: boolean } = {},
): boolean {
  if (framework && configuresReducedMotion(text)) {
    return true;
  }
  const source = preferenceRead(text);
  if (new RegExp(`${source}\\s*(?:\\?|&&|\\|\\|)`).test(text)) return true;
  if (new RegExp(`\\bif\\s*\\(\\s*!?\\s*${source}`).test(text)) return true;
  for (const match of text.matchAll(
    new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${source}`,
      'g',
    ),
  )) {
    const name = match[1]!;
    const uses = text.match(
      new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'),
    );
    if (uses && uses.length > 1) return true;
  }
  return false;
}

/**
 * Whether a configured MotionConfig wraps the whole app: what the entry's
 * `createRoot().render()` or `hydrateRoot()` renders, what the component
 * it renders returns (`import App from './App'`, `<App />`), or what a
 * framework's root layout returns. Tied to that render or that component's
 * return, not any provider-wrapped return in the file (internal PR 239 review), and
 * not to any file named `index.tsx` (internal PR 239 review).
 */
function rootProviderWraps(
  scripts: ProjectFileLike[],
  aliases: Alias[] = [],
): boolean {
  const rootsByPath = new Map<string, Record<string, string[]>>();
  const returnRootsOf = (file: ProjectFileLike): Record<string, string[]> => {
    let roots = rootsByPath.get(file.path);
    if (!roots) {
      const dialect = dialectOf(file.path);
      roots =
        (dialect
          ? motionCoverage(file.content, dialect, motionBindings(file.content))
              ?.returnRoots
          : undefined) ?? {};
      rootsByPath.set(file.path, roots);
    }
    return roots;
  };
  const returns = (
    file: ProjectFileLike,
    matches: (component: string) => boolean,
    seen: Set<string> = new Set(),
  ): boolean =>
    providerExtents(file).some((extent) => {
      if (!wrapsRender(file.content, extent, 'return')) return false;
      const component = enclosingComponent(file.content, extent[0]);
      return component !== undefined && matches(component);
    }) ||
    // Or through a wrapper it returns whole, `return <Providers>...`,
    // whose own return a provider wraps (internal PR 239 review).
    Object.entries(returnRootsOf(file)).some(
      ([component, roots]) =>
        matches(component) &&
        roots.length > 0 &&
        // Each return on its own path: a second branch returning the same
        // wrapper is not a cycle (internal PR 239 review).
        roots.every((tag) => wrapper(file, tag, new Set(seen))),
    );
  const wrapper = (
    file: ProjectFileLike,
    tag: string,
    seen: Set<string>,
  ): boolean => {
    if (!/^[A-Z][\w$]*$/.test(tag)) return false;
    const key = `${file.path}\u0000${tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (
      tag in returnRootsOf(file) &&
      returns(file, (name) => name === tag, seen)
    ) {
      return true;
    }
    for (const match of file.content.matchAll(
      /\bimport\s+([A-Z][\w$]*)?\s*,?\s*(?:\{([^}]{0,400})\})?\s*from\s*["']([^"']+)["']/g,
    )) {
      const target = resolveModule(scripts, file.path, match[3]!, aliases);
      if (!target) continue;
      if (
        match[1] === tag &&
        returns(target, defaultExport(target.content), seen)
      ) {
        return true;
      }
      for (const part of (match[2] ?? '').split(',')) {
        const binding =
          /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
            part,
          );
        if (
          binding &&
          (binding[2] ?? binding[1]) === tag &&
          returns(target, (name) => name === binding[1], seen)
        ) {
          return true;
        }
      }
    }
    return false;
  };
  const defaultExport = (text: string) => (name: string) =>
    new RegExp(
      `\\bexport\\s+default\\s+(?:function\\s+)?${escapeRegExp(name)}\\b`,
    ).test(text);
  // Every root the entries mount, each wrapped on its own: a provider
  // around one root does not reach a second one (internal PR 239 review).
  const roots: boolean[] = [];
  for (const file of scripts) {
    if (
      !/\b(?:createRoot|hydrateRoot)\s*\(|\bReactDOM\.render\s*\(/.test(
        file.content,
      )
    ) {
      continue;
    }
    const extents = providerExtents(file);
    const imports = [
      ...file.content.matchAll(
        /\bimport\s+([A-Z][\w$]*)?\s*,?\s*(?:\{([^}]{0,400})\})?\s*from\s*["']([^"']+)["']/g,
      ),
    ];
    // What each root render is handed, not any tag in the file: an unused
    // `const preview = <Preview />` renders nothing (internal PR 239 review).
    for (const call of file.content.matchAll(
      /\b(?:render|hydrateRoot)\s*\(/g,
    )) {
      // React's, not another library's `renderer.render(scene, camera)`
      // (internal PR 239 review).
      if (!reactRender(file.content, call.index, call[0])) continue;
      const open = call.index + call[0].length - 1;
      const close = matchingClose(file.content, open, {
        ')': '(',
        ']': '[',
        '}': '{',
      });
      const argument = file.content.slice(open, close);
      // The component the render is handed whole, inside nothing but
      // wrappers of its own: `<><Providers /><App /></>` leaves App
      // outside the provider (internal PR 239 review).
      const rendered = (local: string) => wrapsArgument(argument, local);
      const direct = extents.some(
        (extent) =>
          extent[0] > open &&
          extent[0] < close &&
          wrapsRender(file.content, extent, 'render'),
      );
      const viaComponent = imports.some((match) => {
        const target = resolveModule(scripts, file.path, match[3]!, aliases);
        if (!target) return false;
        const exported = new Set<string>();
        for (const part of (match[2] ?? '').split(',')) {
          const binding =
            /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
              part,
            );
          if (binding && rendered(binding[2] ?? binding[1]!)) {
            exported.add(binding[1]!);
          }
        }
        return (
          (exported.size > 0 &&
            returns(target, (name) => exported.has(name))) ||
          (match[1] !== undefined &&
            rendered(match[1]) &&
            returns(target, defaultExport(target.content)))
        );
      });
      // Or a component the entry declares itself (internal PR 239 review).
      const local = returns(file, (name) => rendered(name));
      roots.push(direct || viaComponent || local);
    }
  }
  if (roots.length > 0) return roots.every(Boolean);
  // No entry mounts a root here: a framework's root layout does.
  return scripts.some(
    (file) =>
      /(?:^|\/)(?:app\/(?:layout|root)|root)\.[jt]sx$/.test(file.path) &&
      !/(?:^|\/)components\//.test(file.path) &&
      returns(file, defaultExport(file.content)),
  );
}

/**
 * Whether a `<MotionConfig reducedMotion="user">` (or "always") is written:
 * the prop on that element only, since another component can take a prop
 * of the same name and govern nothing (internal PR 239 review).
 */
function configuresReducedMotion(text: string): boolean {
  return motionConfigExtents(text).length > 0;
}

/**
 * Where each `<MotionConfig reducedMotion="user">` (or "always") opens and
 * where its closing tag ends: what it governs lies between. A self-closing
 * one governs nothing.
 */
function motionConfigExtents(text: string): Array<[number, number]> {
  // Under its own name, an import's alias, `MotionConfig as Config`, or a
  // namespace's, `<Motion.MotionConfig>` (internal PR 239 review).
  // Only as the file imports it: a component of its own called
  // MotionConfig configures nothing (internal PR 239 review).
  const names = motionNames(text, ['MotionConfig']);
  if (names.size === 0) return [];
  const extents: Array<[number, number]> = [];
  const tags = new RegExp(
    `<(${[...names].map(escapeRegExp).join('|')})(?=[\\s/>])`,
    'g',
  );
  for (const match of text.matchAll(tags)) {
    const tag = readJsxTag(text, match.index);
    // A literal only: `reducedMotion={userSetting}` could hold "never"
    // (internal PR 239 review).
    if (
      !/\sreducedMotion\s*=\s*(?:(["'])(?:user|always)\1|\{\s*(["'`])(?:user|always)\2\s*\})/.test(
        tag,
      ) ||
      /\/\s*>$/.test(tag)
    ) {
      continue;
    }
    const close = text.indexOf(`</${match[1]!}`, match.index + tag.length);
    if (close === -1) continue;
    const end = text.indexOf('>', close);
    extents.push([match.index, end === -1 ? text.length : end + 1]);
  }
  return extents;
}

/**
 * Whether a provider wraps everything a render or return renders: only
 * opening tags stand between `render(` or `return (` and it, and only
 * closing tags after it (internal PR 239 review). A provider around one subtree
 * leaves its siblings moving.
 */
function wrapsRender(
  text: string,
  [start, end]: [number, number],
  via: 'render' | 'return',
): boolean {
  let from = -1;
  for (const match of text
    .slice(Math.max(0, start - 4000), start)
    .matchAll(
      via === 'render'
        ? /\b(?:render\s*\(|hydrateRoot\s*\([^<]{0,200}?,\s*)/g
        : /(?:\breturn\b\s*\(?|=>\s*\(?)/g,
    )) {
    from = Math.max(0, start - 4000) + match.index + match[0].length;
  }
  if (from === -1) return false;
  return (
    /^\s*(?:(?:<[A-Za-z][\w.]*(?:\s[^<>]*)?>|<>)\s*)*$/.test(
      text.slice(from, start),
    ) &&
    /^\s*(?:(?:<\/[A-Za-z][\w.]*\s*>|<\/>)\s*)*(?:[),;]|$)/.test(
      text.slice(end, end + 400),
    )
  );
}

/**
 * Whether Motion's declarative animation follows the reduced-motion
 * preference. Neither answer can be traced through React by a static
 * reading, so each is held to where it is written (internal PR 239 review):
 * `<MotionConfig reducedMotion="user">` counts in the file the app renders
 * from, or else in the file that animates; a read of the preference counts
 * in the file that animates.
 */
function declarativeMotionAnswered(
  files: ProjectFileLike[],
  everything: string,
): boolean {
  const scripts = files.filter((file) => /\.[jt]sx?$/.test(file.path));
  // A provider in the app's root file counts when it wraps what that file
  // renders (internal PR 239 review).
  // It covers what MotionConfig stops, transforms and layout, not every
  // animation (internal PR 239 review).
  const aliases = projectAliases(files);
  const rootWrapped = rootProviderWraps(scripts, aliases);
  // In the file that animates: a provider around each animating tag, or a
  // read of the preference that decides the animation (internal PR 239 review).
  const imports = importedMotionComponents(scripts, aliases);
  const importsOf = (file: ProjectFileLike) =>
    imports.get(file.path) ?? new Set<string>();
  const answered = (file: ProjectFileLike) =>
    fileMotionAnswered(
      file,
      'declarative',
      importsOf(file),
      () => {
        if (rootWrapped) return true;
        const text = file.content;
        const extents = motionConfigExtents(text);
        const { declarativeAt } = motionLibrary(text, importsOf(file));
        if (
          extents.length > 0 &&
          declarativeAt.length > 0 &&
          declarativeAt.every((at) =>
            extents.some(([start, end]) => at > start && at < end),
          )
        ) {
          return true;
        }
        return preferenceGovernsMotion(text, 'declarative');
      },
      { providerEverywhere: rootWrapped },
    );
  const animating = scripts.filter(
    (file) => motionLibrary(file.content, importsOf(file)).declarative,
  );
  if (animating.length === 0) {
    return (
      configuresReducedMotion(everything) ||
      readsPreference(everything, { framework: false })
    );
  }
  return animating.every((file) => answered(file));
}

/**
 * Whether Motion that MotionConfig does not govern, values linked to scroll
 * or the pointer and animation started from script, reads the preference
 * in each file that does it (internal PR 239 review).
 */
function scriptedMotionAnswered(
  files: ProjectFileLike[],
  everything: string,
): boolean {
  const scripts = files.filter((file) => /\.[jt]sx?$/.test(file.path));
  const imports = importedMotionComponents(scripts, projectAliases(files));
  const importsOf = (file: ProjectFileLike) =>
    imports.get(file.path) ?? new Set<string>();
  const moving = files.filter((file) => {
    if (!/\.[jt]sx?$/.test(file.path)) return false;
    const library = motionLibrary(file.content, importsOf(file));
    return library.linked || library.imperative;
  });
  if (moving.length === 0) {
    return readsPreference(everything, { framework: false });
  }
  // A read that decides the motion, not one used for something else
  // (internal PR 239 review).
  return moving.every((file) =>
    fileMotionAnswered(file, 'scripted', importsOf(file), () =>
      preferenceGovernsMotion(file.content, 'scripted'),
    ),
  );
}

function universalFindings(
  files: ProjectFileLike[],
  css: string,
  source: string,
  /** The files as written, for the one rule that holds in comments too. */
  written: ProjectFileLike[] = files,
): DesignFinding[] {
  const findings: DesignFinding[] = [];
  const index = files.find((file) => file.path === 'index.html');

  if (index) {
    if (
      !/<html[^>]*\slang\s*=\s*(?:"[^"]+"|'[^']+'|[^\s"'`=<>]+)/i.test(
        index.content,
      )
    ) {
      findings.push({
        severity: 'error',
        check: 'lang',
        detail:
          'index.html has no lang attribute on <html>, so screen readers guess the language. Add lang="en" (or the page\'s language).',
      });
    }
    // Named viewport and saying what the viewport is: a tag with no
    // `content`, or one that sets neither the width nor the scale, leaves
    // phones on the desktop layout.
    const viewport = [...index.content.matchAll(/<meta\b[^>]*>/gi)]
      .map((match) => match[0])
      .find((tag) => /\sname\s*=\s*["']?viewport(?![\w-])/i.test(tag));
    // The value of `content` itself, quoted or not: an unquoted value ends
    // at whitespace, and what follows is another attribute.
    const content = viewport
      ? /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(viewport)
      : null;
    const directives = content
      ? (content[1] ?? content[2] ?? content[3] ?? '')
      : '';
    if (
      !/(?:^|[\s,;])(?:width\s*=\s*device-width(?![\w-])|initial-scale\s*=\s*\d*\.?\d)/i.test(
        directives,
      )
    ) {
      findings.push({
        severity: 'error',
        check: 'viewport',
        detail:
          'index.html has no viewport meta tag, so phones render the desktop layout zoomed out. Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
      });
    }
  }

  // What one file exports and another hands to a sink is rendered too.
  const sunk = sunkExports(files);
  for (const file of files) {
    if (!SOURCE.test(file.path)) continue;
    // An `<img>` inside a string (`{'<img src="a.jpg">'}`, a code sample)
    // is text on the page, not an image, in a script file or in a markup
    // file's own script.
    const blank = (text: string, dialect?: ScriptDialect) =>
      withoutStringContents(text, sunk.get(file.path), dialect);
    // What a component's template hands to a raw-HTML directive is read
    // as a sink at the end of each of its scripts, then cut off again.
    const sinks = templateSinks(file);
    const blankScript = (code: string) =>
      blank(code + sinks, 'ts').slice(0, code.length);
    const markup = MARKUP.test(file.path)
      ? mapStyles(mapScripts(file.content, blankScript), (css) => blank(css))
      : blank(file.content, dialectOf(file.path));
    // A component nothing renders (not exported, never referred to) puts
    // no image on the page. Markup files have no such functions.
    const depths = MARKUP.test(file.path) ? [] : braceDepths(file.content);
    const unrendered = (at: number) =>
      !MARKUP.test(file.path) &&
      (functionsAround(file.content, depths, at).some((fn) =>
        unreferenced(file.content, fn),
      ) ||
        deadBranch(file.content, depths, at));
    // An intrinsic <img>: in HTML any case, elsewhere lowercase only, so
    // a component (`<Img />`) or a custom element (`<img-carousel>`) is
    // not one.
    const image = /\.html?$/i.test(file.path)
      ? /<img(?=[\s/>])/gi
      : /<img(?=[\s/>])/g;
    for (const opener of markup.matchAll(image)) {
      if (unrendered(opener.index)) continue;
      const tag = readJsxTag(markup, opener.index);
      // `alt={undefined}`, `alt={null}` and a boolean `alt={true}` are
      // omitted by React, so they are no alt at all, and a later prop wins
      // over anything a spread before it carried.
      const nullish = [
        ...tag.matchAll(
          /\salt\s*=\s*\{\s*(?:undefined|null|void\s+0|true|false)\s*\}|\s(?::|v-bind:)alt\s*=\s*(["'])\s*(?:undefined|null|void\s+0)\s*\1/gi,
        ),
      ].pop();
      // `{...attrs}` in JSX, Svelte and Astro, `v-bind="attrs"` in Vue.
      const spread = [...tag.matchAll(/\{\s*\.\.\.|\sv-bind\s*=/g)].pop();
      const clearedAfterSpread =
        nullish !== undefined &&
        (spread === undefined || nullish.index > spread.index);
      // A spread otherwise can carry alt, and the checker cannot see what it
      // holds.
      if (spread && !clearedAfterSpread) continue;
      // An attribute of its own: `data-alt` or `aria-alt` is not alt. In
      // markup a bare `alt` is `alt=""`, a decorative image, and Vue's
      // `:alt` and Svelte's `{alt}` bind one; in JSX a bare `alt` is
      // `alt={true}`, which React drops.
      const hasAlt = MARKUP.test(file.path)
        ? /[\s:]alt(?![\w:.-])|\{\s*alt\s*\}/i.test(tag)
        : /\salt\s*=/i.test(tag);
      if (!hasAlt || clearedAfterSpread) {
        findings.push({
          severity: 'error',
          check: 'alt',
          detail: `${file.path} has an <img> with no alt attribute. Describe the image, or use alt="" if it is decorative.`,
        });
        break;
      }
    }
  }

  // Each kind of movement is answered on its own terms: a rule that stops
  // a spinner does nothing for a video that plays by itself.
  //
  // Warnings, not errors. Whether a page's motion is stopped for a visitor
  // who asked for less is a reading of CSS, markup and script together,
  // and a static reading of it is a heuristic however careful: variants,
  // cascades, script and frameworks all decide it. An error buys a paid
  // repair on its own and is kept for what the checker is sure of; this
  // rides along with a repair that is happening anyway.
  const everything = css + '\n' + source;
  const unconsented = withoutMotionSafe(everything);
  const sources = motionSources(unconsented);
  if (
    (sources.groups.length > 0 ||
      sources.tailwind.length > 0 ||
      sources.other) &&
    !answersReducedMotion(everything, sources)
  ) {
    findings.push({
      severity: 'warning',
      check: 'reduced-motion',
      detail:
        'The page animates but has no @media (prefers-reduced-motion: reduce) rule that stops it. Keep opacity and colour changes there and drop the movement.',
    });
  }
  // Motion (motion/react, formerly framer-motion) moves elements from
  // script, where none of the rules above can see it. Declarative
  // animation follows `<MotionConfig reducedMotion="user">`; values linked
  // to scroll or the pointer do not, and only a read of the preference
  // that decides them stops those.
  // Classified file by file, then combined: an import in one file does not
  // make a helper named animate() in another Motion (internal PR 239 review).
  const library = { declarative: false, linked: false, imperative: false };
  const motionImports = importedMotionComponents(
    files.filter((file) => /\.[jt]sx?$/.test(file.path)),
    projectAliases(files),
  );
  for (const file of files) {
    if (!/\.[jt]sx?$/.test(file.path)) continue;
    const found = motionLibrary(
      withoutMotionSafe(file.content),
      motionImports.get(file.path),
    );
    library.declarative ||= found.declarative;
    library.linked ||= found.linked;
    library.imperative ||= found.imperative;
  }
  if (library.declarative && !declarativeMotionAnswered(files, everything)) {
    findings.push({
      severity: 'warning',
      check: 'reduced-motion',
      detail:
        'The page animates with Motion but ignores the reduced-motion preference. Wrap the app in <MotionConfig reducedMotion="user">, which keeps opacity and colour changes and drops the movement.',
    });
  }
  // Checked on its own, not as an else: MotionConfig, which the warning
  // above prescribes, does not stop these (internal PR 239 review).
  if (
    (library.linked || library.imperative) &&
    !scriptedMotionAnswered(files, everything)
  ) {
    const what = [
      library.linked
        ? 'values linked to scroll or the pointer (useScroll, useSpring, useMotionValue, useTransform)'
        : '',
      library.imperative
        ? 'animation started from script (animate(), useAnimate())'
        : '',
    ]
      .filter(Boolean)
      .join(' and ');
    findings.push({
      severity: 'warning',
      check: 'reduced-motion',
      detail: `Motion ${what} keep moving under <MotionConfig reducedMotion="user">. Read useReducedMotion() and leave them still when it is true.`,
    });
  }
  if (autoplaysVideo(unconsented) && !answersForVideo(everything)) {
    findings.push({
      severity: 'warning',
      check: 'reduced-motion',
      detail:
        'A video plays by itself, and nothing changes for visitors who ask for reduced motion. Under @media (prefers-reduced-motion: reduce), hide the video and show its poster image instead.',
    });
  }

  for (const file of written) {
    // DESIGN.md is Vibld's record of the spec, rewritten from it on every
    // build; the page never shows it, and a repair cannot change it. Every
    // other file is held to the rule, whatever it is: copy imported from
    // `content.json` or drawn in an SVG reaches the page as surely.
    if (file.path === DESIGN_MD_PATH) continue;
    if (file.content.includes(EM_DASH)) {
      findings.push({
        severity: 'error',
        check: 'em-dash',
        detail: `${file.path} contains an em-dash. Use a comma, a colon, parentheses, or two sentences.`,
      });
    }
  }

  // The uses of a wrapper that spreads its props onto an input, each
  // counted if it names nothing. An id there names nothing without a label
  // for it, and an aria-labelledby nothing without its target, as on an
  // input (internal PR 239 review). A use that spreads its own props on is itself a
  // pass-through: its component's uses carry the name, followed up the
  // chain (internal PR 239 review).
  const unlabelledUses = (wrapper: string, seen: Set<string>): number => {
    if (seen.has(wrapper) || seen.size >= 8) return 0;
    seen.add(wrapper);
    let count = 0;
    const names = componentNames(source, wrapper);
    for (const use of source.matchAll(
      new RegExp(
        `<(?:${[...names].map(escapeRegExp).join('|')})(?![\\w$.])`,
        'g',
      ),
    )) {
      const call = readJsxTag(source, use.index);
      if (
        namedBy(call, source) ||
        openAround(source, use.index).some((open) => /^<label\b/i.test(open))
      ) {
        continue;
      }
      if (spreadMayName(call)) {
        const outer = enclosingComponent(source, use.index);
        if (outer === undefined) count += 1;
        // `<Input>` uses are read by the scan below.
        else if (!/^input$/i.test(outer)) count += unlabelledUses(outer, seen);
        continue;
      }
      count += 1;
    }
    return count;
  };

  /**
   * The uses of a wrapper that clear `attribute` and name nothing else:
   * each replaces, through the wrapper's later spread, the name the
   * wrapper gave (internal PR 239 review).
   */
  const clearedUses = (wrapper: string, attribute: string): number => {
    let count = 0;
    const names = componentNames(source, wrapper);
    const clears = new RegExp(
      `\\s${escapeRegExp(attribute)}\\s*=\\s*(?:\\{\\s*(?:undefined|null|void\\s+0|false|(["'\`])\\s*\\1)\\s*\\}|(["'])\\s*\\2)`,
    );
    for (const use of source.matchAll(
      new RegExp(
        `<(?:${[...names].map(escapeRegExp).join('|')})(?![\\w$.])`,
        'g',
      ),
    )) {
      const call = readJsxTag(source, use.index);
      if (!clears.test(call)) continue;
      if (
        namedBy(call, source) ||
        openAround(source, use.index).some((open) => /^<label\b/i.test(open))
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  };

  // Each input on its own: a label around it, a label pointing at its id,
  // or a name of its own. A label or aria-label elsewhere names something
  // else.
  let unlabelled = 0;
  for (const opener of source.matchAll(/<input\b/gi)) {
    const tag = readJsxTag(source, opener.index);
    if (
      /\stype\s*=\s*\{?\s*["'`]?(?:hidden|submit|button|reset)\b/i.test(tag)
    ) {
      continue;
    }
    // A name a later spread can replace holds unless a use of the wrapper
    // clears it: `<input aria-label="Search" {...props} />` used as
    // `<Search aria-label={undefined} />` names nothing (internal PR 239 review).
    const replaced = (at: number, attribute: string): number => {
      if (!/\{\s*\.\.\./.test(tag.slice(at))) return 0;
      const wrapper = enclosingComponent(source, opener.index);
      // `<Input>` uses are read by this same scan.
      if (wrapper === undefined || /^input$/i.test(wrapper)) return 0;
      return clearedUses(wrapper, attribute);
    };
    // An image button is named by its alt text.
    const alt =
      /\salt\s*=\s*(?:"[^"]*\S[^"]*"|'[^']*\S[^']*'|\{(?!\s*(?:(["'`])\s*\1|undefined|null|void\s+0|false|true)\s*\})[^}]*\S[^}]*\})/i.exec(
        tag,
      );
    if (/\stype\s*=\s*\{?\s*["'`]?image\b/i.test(tag) && alt) {
      unlabelled += replaced(alt.index, 'alt');
      continue;
    }
    // A name of its own that names something: `aria-label=""` does not,
    // and `aria-labelledby` has to point at an id the page has.
    const own =
      /\saria-label\s*=\s*(?:"[^"]*\S[^"]*"|'[^']*\S[^']*'|\{(?!\s*(?:(["'`])\s*\1|undefined|null|void\s+0|false)\s*\})[^}]*\S[^}]*\})/i.exec(
        tag,
      );
    if (own) {
      unlabelled += replaced(own.index, 'aria-label');
      continue;
    }
    const labelledby =
      /\saria-labelledby\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/i.exec(tag);
    if (labelledby) {
      // An expression names its target unless it is statically empty.
      if (
        labelledby[3] !== undefined &&
        !/^\{\s*(?:(["'`])\s*\1|undefined|null|void\s+0|false)\s*\}$/.test(
          labelledby[3],
        )
      ) {
        continue;
      }
      const ids = (labelledby[1] ?? labelledby[2] ?? '')
        .split(/\s+/)
        .filter(Boolean);
      if (
        ids.some((id) =>
          new RegExp(
            `\\sid\\s*=\\s*\\{?\\s*["'\`]${escapeRegExp(id)}["'\`]`,
          ).test(source),
        )
      ) {
        continue;
      }
    }
    if (
      openAround(source, opener.index).some((open) => /^<label\b/i.test(open))
    ) {
      continue;
    }
    const id = /\sid\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/.exec(tag)?.[1];
    if (id) {
      const value = escapeRegExp(id.replace(/^\{\s*|\s*\}$/g, ''));
      if (
        new RegExp(`\\s(?:for|htmlFor)\\s*=\\s*\\{?\\s*${value}\\s*\\}?`).test(
          source,
        )
      ) {
        continue;
      }
    }
    // A spread can carry the id or aria-label, and the checker cannot see
    // what it holds, as with alt: shadcn/ui's `<input {...props} />` is
    // labelled where `<Input id=... />` is used, and that use is checked.
    // Unless a naming attribute is cleared after it, which React applies
    // over whatever the spread carried, so the label the call site gives
    // never arrives (internal PR 239 review).
    if (spreadMayName(tag)) {
      // The wrapper is labelled where it is used. `<Input>` uses are read by
      // this same scan; any other name's uses are read here, each counted
      // if it names nothing (internal PR 239 review).
      const wrapper = enclosingComponent(source, opener.index);
      if (wrapper === undefined) {
        unlabelled += 1;
        continue;
      }
      if (/^input$/i.test(wrapper)) continue;
      unlabelled += unlabelledUses(wrapper, new Set());
      continue;
    }
    unlabelled += 1;
  }
  if (unlabelled > 0) {
    findings.push({
      severity: 'warning',
      check: 'label',
      detail: `${unlabelled} ${unlabelled === 1 ? 'input has' : 'inputs have'} no label. Every input needs a label, visible or aria-label.`,
    });
  }

  return findings;
}

/**
 * Whether a tag has a spread that can carry its name, which the checker
 * cannot see into: not when an `aria-label`, `aria-labelledby` or `id` is
 * cleared after it, which React applies over whatever the spread carried
 * (internal PR 239 review).
 */
function spreadMayName(tag: string): boolean {
  const spread = [...tag.matchAll(/\{\s*\.\.\./g)].pop();
  if (spread === undefined) return false;
  const cleared = [
    ...tag.matchAll(
      /\s(?:aria-label|aria-labelledby|id)\s*=\s*(?:\{\s*(?:undefined|null|void\s+0|false|true|(["'`])\s*\1)\s*\}|(["'])\s*\2)/g,
    ),
  ].pop();
  return !(cleared !== undefined && cleared.index > spread.index);
}

/**
 * Whether a tag names what it renders by its own attributes: an
 * `aria-label` with text in it, an `aria-labelledby` whose target the page
 * has, or an `id` a label points at with `for` or `htmlFor`.
 */
function namedBy(tag: string, source: string): boolean {
  if (
    /\saria-label\s*=\s*(?:"[^"]*\S[^"]*"|'[^']*\S[^']*'|\{(?!\s*(?:(["'`])\s*\1|undefined|null|void\s+0|false|true)\s*\})[^}]*\S[^}]*\})/i.test(
      tag,
    )
  ) {
    return true;
  }
  const labelledby =
    /\saria-labelledby\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/i.exec(tag);
  if (labelledby) {
    // An expression names its target unless it is statically empty.
    if (
      labelledby[3] !== undefined &&
      !/^\{\s*(?:(["'`])\s*\1|undefined|null|void\s+0|false|true)\s*\}$/.test(
        labelledby[3],
      )
    ) {
      return true;
    }
    const ids = (labelledby[1] ?? labelledby[2] ?? '')
      .split(/\s+/)
      .filter(Boolean);
    if (
      ids.some((id) =>
        new RegExp(
          `\\sid\\s*=\\s*\\{?\\s*["'\`]${escapeRegExp(id)}["'\`]`,
        ).test(source),
      )
    ) {
      return true;
    }
  }
  const id = /\sid\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/.exec(tag)?.[1];
  if (id) {
    const value = escapeRegExp(id.replace(/^\{\s*|\s*\}$/g, ''));
    if (
      value.replace(/["'`\s]/g, '') !== '' &&
      new RegExp(`\\s(?:for|htmlFor)\\s*=\\s*\\{?\\s*${value}\\s*\\}?`).test(
        source,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The names a component is used under: its own, a named import's alias
 * (`import { TextField as Field }`), and, when it is a default export, a
 * default import from a module named for it (`import Field from
 * './text-field'`) (internal PR 239 review).
 */
function componentNames(source: string, name: string): Set<string> {
  const names = new Set([name]);
  for (const clause of source.matchAll(/\bimport\s*\{([^}]{0,400})\}/g)) {
    for (const alias of clause[1]!.matchAll(
      /\b([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g,
    )) {
      if (alias[1] === name) names.add(alias[2]!);
    }
  }
  if (
    new RegExp(
      `\\bexport\\s+default\\s+(?:function\\s+)?${escapeRegExp(name)}\\b`,
    ).test(source)
  ) {
    const flat = (text: string) => text.toLowerCase().replace(/[-_.]/g, '');
    for (const match of source.matchAll(
      /\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']([^"']+)["']/g,
    )) {
      const base = match[2]!
        .split('/')
        .pop()!
        .replace(/\.[jt]sx?$/, '');
      if (flat(base) === flat(name)) names.add(match[1]!);
    }
  }
  // Through a namespace import, `<Fields.TextField>` (internal PR 239 review): any
  // namespace, since which module holds the wrapper is not traced, and a
  // use read that renders something else only reads more call sites.
  for (const space of source.matchAll(
    /\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*["'][^"']+["']/g,
  )) {
    names.add(`${space[1]!}.${name}`);
  }
  return names;
}

/**
 * The name of the component whose body holds `at`: the nearest
 * `function Name` or `const Name =` before it with a capitalised name, as
 * React requires of a component.
 */
function enclosingComponent(source: string, at: number): string | undefined {
  let found: string | undefined;
  for (const match of source
    .slice(Math.max(0, at - 4000), at)
    .matchAll(
      /\b(?:function\s+([A-Z][\w$]*)|(?:const|let|var)\s+([A-Z][\w$]*)\s*=)/g,
    )) {
    found = match[1] ?? match[2];
  }
  return found;
}

/**
 * A file without its comments. A value that only survives in a comment is
 * not in the page: a model that comments out the live rule has removed it,
 * and must not be credited with it, nor blamed for a commented-out `<img>`.
 *
 * Script is read as script (`//` and `/* *\/`, outside strings); markup
 * loses `<!-- -->` and the block comments of any inline style or script;
 * a stylesheet loses its block comments.
 */
function withoutComments(file: ProjectFileLike): string {
  if (/\.(tsx|jsx|ts|js|mjs|cjs|mts|cts)$/i.test(file.path)) {
    return withoutScriptComments(file.content, {
      regex: true,
      dialect: dialectOf(file.path),
    });
  }
  // Sass and Less have `//` comments too, and the same strings to protect,
  // but a `/` there is division (`12px/1.5`), never a regular expression.
  if (/\.(scss|sass|less)$/i.test(file.path)) {
    return withoutScriptComments(file.content, { regex: false });
  }
  // Markup with script in it (a component file, or an HTML page with an
  // inline script): its `<script>` blocks, and an Astro file's `---`
  // frontmatter, are read as script.
  if (/\.(vue|svelte|astro|html)$/i.test(file.path)) {
    return mapScripts(file.content, (code) =>
      withoutScriptComments(code, { regex: true, dialect: 'ts' }),
    )
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
  }
  const blocks = file.content.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return STYLE.test(file.path)
    ? blocks
    : blocks.replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * Script without `//` and `/* *\/` comments, leaving strings alone so a
 * URL or a glob in one is not cut short. A `//` straight after `:` is a
 * URL written in JSX text, and after `\` is inside a regular expression.
 *
 * With `regex`, a regular expression literal's body is blanked, so a quote
 * in `/['"]/` does not open a string that swallows the comment after it.
 */
function withoutScriptComments(
  text: string,
  { regex, dialect }: { regex: boolean; dialect?: ScriptDialect },
): string {
  const syntax = regex && dialect ? scriptSyntax(text, dialect) : undefined;
  if (syntax) return withoutParsedComments(text, syntax);
  let out = '';
  let quote: string | undefined;
  const braces = new Braces();
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (
      regex &&
      !quote &&
      char === '/' &&
      text[at + 1] !== '/' &&
      text[at + 1] !== '*' &&
      braces.opensPattern(out)
    ) {
      const end = regexEnd(text, at);
      if (end !== undefined) {
        const close = text.lastIndexOf('/', end - 1);
        // What a pattern matches is no markup, and a bracket or a quote in
        // it (`/{/`) opens nothing: its body is blanked. A pattern made a
        // string (`/<img>/.source`) is not read as markup either: whether
        // that string is what the expression leaves takes a parser to know.
        out += '/'.padEnd(close - at) + text.slice(close, end);
        at = end;
        continue;
      }
    }
    if (quote) {
      // A template literal is often CSS (`<style>{`...`}</style>`, styled
      // components), and a CSS comment in it is as dead as one in a
      // stylesheet.
      if (quote === '`' && char === '/' && text[at + 1] === '*') {
        const end = text.indexOf('*/', at + 2);
        at = end === -1 ? text.length : end + 2;
        out += ' ';
        continue;
      }
      out += char;
      if (char === '\\') {
        out += text[at + 1] ?? '';
        at += 2;
        continue;
      }
      if (char === quote || (char === '\n' && quote !== '`')) quote = undefined;
      at += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      at += 1;
      continue;
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      const next = end === -1 ? text.length : end + 2;
      // One that spans a line end is a line end to the script: after
      // `return` it ends the statement.
      out += /[\n\r\u2028\u2029]/.test(text.slice(at, next)) ? '\n' : ' ';
      at = next;
      continue;
    }
    if (
      char === '/' &&
      text[at + 1] === '/' &&
      text[at - 1] !== ':' &&
      text[at - 1] !== '\\'
    ) {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
      continue;
    }
    braces.read(char, out);
    out += char;
    at += 1;
  }
  return out;
}

/**
 * Markup with the text between its tags blanked, so a colour a page shows
 * as copy (`<code>#123456</code>`) is not taken for one it styles with.
 * Tags, their attributes and script outside JSX text are kept.
 */
function withoutTextNodes(text: string): string {
  const blank = (copy: string) => copy.replace(/[^\n]/g, ' ');
  return (
    text
      // Text after a tag (a fragment's `<>` too), up to the next tag or
      // expression.
      .replace(/(?<=[\w"'}\/]>|<>)([^<>{}]*)(?=[<{])/g, (_, copy: string) =>
        blank(copy),
      )
      // A string shown as a child: `<p>{'#071722'}</p>`.
      .replace(
        /(?<=>|\})(\s*\{\s*)(["'`])((?:(?!\2)[^\\\n]|\\.)*)\2(\s*\})/g,
        (_, open: string, quote: string, copy: string, close: string) =>
          open + quote + blank(copy) + quote + close,
      )
  );
}

/**
 * Markup with `map` applied to the script inside it: each `<script>` block
 * and an Astro file's `---` frontmatter.
 */
function mapScripts(text: string, map: (code: string) => string): string {
  return text
    .replace(
      /^---\n([\s\S]*?)\n---/,
      (_, code: string) => `---\n${map(code)}\n---`,
    )
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_, open: string, code: string, close: string) =>
        `${open}${map(code)}${close}`,
    );
}

/** Markup with `map` applied to the CSS in each `<style>` block. */
function mapStyles(text: string, map: (css: string) => string): string {
  return text.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open: string, css: string, close: string) =>
      `${open}${map(css)}${close}`,
  );
}

/**
 * Script with the contents of its strings and template literals blanked,
 * quotes kept. A quote opens a string only where a value can start (after
 * `=`, `(`, `{`, `,`, an operator or `return`), so an apostrophe in JSX
 * text (`Don't`) is left as text, a string handed to an HTML sink
 * (`HTML_SINK`) is left whole, and a tagged template such as lit's
 * `html\`<img ...>\``, which renders its markup, is read as markup.
 */
function withoutStringContents(
  text: string,
  // Names this file exports that another file hands to a sink.
  exported: ReadonlySet<string> = new Set(),
  dialect?: ScriptDialect,
): string {
  // What a sink is handed is its whole right-hand side:
  // `innerHTML = show ? '<img>' : ''` renders the `<img>` as surely as
  // `innerHTML = '<img>'` does.
  const rendered: [number, number][] = [];
  const starts = new RegExp(
    [
      `(?:\\b__html|"__html"|'__html'|\x60__html\x60)\\s*:`,
      `(?:\\.\\s*|\\[\\s*["'\x60])(?:inner|outer)HTML(?:["'\x60]\\s*\\])?\\s*\\+?=`,
      `\\binsertAdjacentHTML\\s*\\([^,()]*,`,
      `\\bdocument\\.write(?:ln)?\\s*\\(`,
    ].join('|'),
    'g',
  );
  const depths = braceDepths(text);
  // Names a rendered value hands on, read with the sinks' own names below.
  const handed: { index: number; name: string; member: string | undefined }[] =
    [];
  const hand: Follow = (name, member, index) =>
    handed.push({ index, name, member });
  for (const entry of exported) {
    if (CALL_ENTRY.test(entry)) continue;
    // `bundle.safe`: the export `bundle`, of which only `safe` is sunk.
    const [name, member] = splitEntry(entry);
    const escaped = escapeRegExp(name);
    // `export const markup = '...'`, `export default '...'`, or a local
    // declaration named in `export { markup }`.
    // `export default hero` renders what `hero` is bound to.
    const local =
      name === 'default'
        ? /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|$)/m.exec(text)?.[1]
        : undefined;
    const declaration =
      name === 'default' && local !== undefined
        ? new RegExp(
            `\\b(?:const|let|var)\\s+${escapeRegExp(local)}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
          ).exec(text)
        : name === 'default'
          ? /\bexport\s+default\s+/.exec(text)
          : (new RegExp(
              `\\bexport\\s+(?:const|let|var)\\s+${escaped}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
            ).exec(text) ??
            // `export { markup as hero }` exports `markup` as `hero`.
            ((alias) =>
              alias
                ? new RegExp(
                    `\\b(?:const|let|var)\\s+${escapeRegExp(alias)}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
                  ).exec(text)
                : null)(
              new RegExp(
                `\\bexport\\s*\\{[^}]*?(?<![\\w$])([\\w$]+)\\s+as\\s+${escaped}(?![\\w$])`,
              ).exec(text)?.[1],
            ) ??
            (new RegExp(
              `\\bexport\\s*\\{[^}]*(?<![\\w$])${escaped}(?![\\w$])`,
            ).test(text)
              ? new RegExp(
                  `\\b(?:const|let|var)\\s+${escaped}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
                ).exec(text)
              : null));
    if (declaration) {
      const ranges = renderedRange(
        text,
        depths,
        declaration.index + declaration[0].length,
        member,
        hand,
      );
      rendered.push(...ranges);
    }
  }
  // A sink in a named function that nothing in the file refers to, and
  // that is not exported, never runs: `function never() { root.innerHTML
  // = '<img>' }` puts nothing on the page. A function with no name (a
  // callback, a handler) or one that is referred to may.
  const dead = (at: number) =>
    functionsAround(text, depths, at).some((fn) => unreferenced(text, fn));
  for (const match of text.matchAll(starts)) {
    if (dead(match.index)) continue;
    const from = match.index + match[0].length;
    // A call's arguments run to its closing bracket; an assignment or a
    // property ends at the first comma too.
    const call = /[(,]$/.test(match[0]);
    const end = expressionEnd(text, from, { commas: !call });
    if (wholeVoid(text, from, end)) continue;
    rendered.push([from, end]);
  }
  // A name handed to a sink (`root.innerHTML = markup`) renders the
  // initialiser of the declaration it refers to: the nearest one before
  // the sink whose block still encloses it, or else a module-level one
  // anywhere in the file. A same-named constant in an unrelated function
  // is not rendered.
  // What a local helper that a sink calls returns is rendered too, where
  // it is a literal the helper hands back itself.
  // Another file's sink can call a helper exported here (`render()`).
  const seeds = [...exported]
    .filter((entry) => CALL_ENTRY.test(entry))
    .map((entry) => entry.replace('()', ''));
  for (const expression of sinkExpressions(text, depths, seeds)) {
    if (expression.kind === 'returned') {
      rendered.push(...topLevelLiterals(text, expression.from, expression.end));
    } else if (expression.kind === 'argument') {
      // `render({ markup })` with `function render({ markup })`: the part
      // of the argument the parameter takes.
      rendered.push(
        ...(expression.member === undefined
          ? [[expression.from, expression.end] as [number, number]]
          : renderedRange(
              text,
              depths,
              expression.from,
              expression.member,
              hand,
            )),
      );
    }
  }
  // A binding whose value is only another name (`const html = markup`)
  // is followed to that one, so the queue grows as it is read.
  const queue = [...namedSinks(text, depths, seeds), ...handed];
  const queued = new Set(
    queue.map((item) => `${item.index}:${item.name}:${item.member ?? ''}`),
  );
  const enqueue: Follow = (name, member, index) => {
    const key = `${index}:${name}:${member ?? ''}`;
    if (queued.has(key)) return;
    queued.add(key);
    queue.push({ index, name, member });
  };
  for (let next = 0; next < queue.length && next < 500; next++) {
    const named = queue[next]!;
    if (dead(named.index)) continue;
    // A name destructured from an object is that property of it.
    let sink = named;
    // What a `let` or `var` a pattern binds is set to again before the
    // sink (`html = '<p>'`).
    const later: { start: number; member: string | undefined }[] = [];
    for (let hops = 0; hops < 5; hops++) {
      // A plain declaration of the name that the sink sees, not one in a
      // function elsewhere, is what it reads instead.
      const direct = [
        ...text.matchAll(
          new RegExp(
            `\\b(?:const|let|var)\\s+${escapeRegExp(sink.name)}(?![\\w$])`,
            'g',
          ),
        ),
      ].some((declaration) =>
        declaration.index < sink.index
          ? encloses(depths, declaration.index, sink.index)
          : depths[declaration.index] === 0,
      );
      const from = direct
        ? undefined
        : destructuredFrom(text, depths, sink.name, sink.index, sink.member);
      if (!from) break;
      // What it is set to again reaches the sink as well, and one
      // unconditional `=` at the pattern's own level replaces what the
      // pattern gave it.
      const again = reachingValues(
        text,
        depths,
        Object.assign(['='] as RegExpMatchArray, { index: from.assigned }),
        sink.name,
        sink.member,
        sink.index,
      );
      later.push(...again.filter(({ start }) => start !== from.assigned + 1));
      if (!again.some(({ start }) => start === from.assigned + 1)) break;
      // A default the pattern gives (`{ hero = '<img>' }`) reaches the sink
      // too, read by the member the sink reads.
      if (from.fallback !== undefined) {
        rendered.push(
          ...renderedRange(text, depths, from.fallback, sink.member, enqueue),
          ...calledReturns(text, depths, from.fallback, sink.member, enqueue),
        );
      }
      // Destructured from a value written out in place: that part of it.
      if ('ranges' in from) {
        rendered.push(...from.ranges);
        break;
      }
      sink = { index: sink.index, name: from.name, member: from.member };
    }
    const name = escapeRegExp(sink.name);
    let binding: RegExpMatchArray | undefined;
    for (const declaration of text.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+${name}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
        'g',
      ),
    )) {
      if (declaration.index < sink.index) {
        if (encloses(depths, declaration.index, sink.index)) {
          binding = declaration;
        }
      } else if (!binding && depths[declaration.index] === 0) {
        // A module-level constant is in scope for a function above it.
        binding = declaration;
      }
    }
    // A parameter of a function the sink is inside shadows any binding
    // declared outside that function: `function render(markup) {
    // root.innerHTML = markup }` renders what the caller passes.
    const shadow = shadowingFunction(text, depths, sink.name, sink.index);
    if (
      binding &&
      shadow !== undefined &&
      outsideBody(text, depths, shadow, binding.index!)
    ) {
      binding = undefined;
    }
    {
      const values = [
        ...(binding
          ? reachingValues(
              text,
              depths,
              binding,
              sink.name,
              sink.member,
              sink.index,
            )
          : []),
        ...later,
      ];
      for (const { start, member: part } of values) {
        const copy = new RegExp(
          String.raw`^\s*([A-Za-z_$][\w$]*)((?:${MEMBER_STEP})*)\s*(?:[;\n]|$)`,
          'm',
        ).exec(text.slice(start, start + 400));
        if (copy && !NOT_A_BINDING.has(copy[1]!)) {
          const chain = chainPath(copy[2]!);
          const member =
            [...chain, part].filter(Boolean).join('.') || undefined;
          const item = {
            index: start + copy[0].indexOf(copy[1]!),
            name: copy[1]!,
            member,
          };
          const key = `${item.index}:${item.name}:${item.member ?? ''}`;
          if (!queued.has(key)) {
            queued.add(key);
            queue.push(item);
          }
          continue;
        }
        const ranges = renderedRange(
          text,
          depths,
          start,
          part,
          (name, member, index) => {
            const item = { index, name, member };
            const key = `${index}:${name}:${member ?? ''}`;
            if (!queued.has(key)) {
              queued.add(key);
              queue.push(item);
            }
          },
        );
        rendered.push(...ranges);
      }
    }
  }
  const inRendered = (at: number) =>
    rendered.some(([from, to]) => at >= from && at < to);
  const syntax = dialect ? scriptSyntax(text, dialect) : undefined;
  if (syntax) return withoutParsedStrings(text, syntax, inRendered);
  let out = '';
  const braces = new Braces();
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    // A regular expression (`/<img\b/i`) is a pattern, not markup.
    if (
      char === '/' &&
      text[at + 1] !== '/' &&
      text[at + 1] !== '*' &&
      braces.opensPattern(out)
    ) {
      const end = regexEnd(text, at);
      if (end !== undefined) {
        const close = text.lastIndexOf('/', end - 1);
        out += '/' + ' '.repeat(close - at - 1) + text.slice(close, end);
        at = end;
        continue;
      }
    }
    // A tagged template renders markup only for a markup tag (lit's
    // `html`, `svg`); `styled.div`, `css` and the rest hold CSS or data.
    const tag =
      char === '`' ? /([A-Za-z_$][\w$]*)\s*$/.exec(out)?.[1] : undefined;
    const tagged =
      tag !== undefined &&
      !/(?:^|\W)(?:return|typeof|case|do|else|in|of|void|yield|await|delete|instanceof|new|throw)\s*$/.test(
        out,
      );
    if (
      (char === '"' || char === "'" || char === '`') &&
      (startsValue(out) || (tagged && !MARKUP_TAGS.has(tag!))) &&
      !inRendered(at)
    ) {
      const end = char === '`' ? templateEnd(text, at) : quoteEnd(text, at);
      if (end !== undefined) {
        out += char + text.slice(at + 1, end).replace(/[^\n]/g, ' ') + char;
        at = end + 1;
        continue;
      }
    }
    braces.read(char, out);
    out += char;
    at += 1;
  }
  return out;
}

/**
 * `withoutScriptComments` for script the parser read: each comment goes,
 * a block comment that spans a line end leaving one (after `return` it ends
 * the statement), and each regular expression keeps its slashes and flags
 * with its body blanked at the same length, so a bracket or a quote in it
 * opens nothing. A CSS comment in a template literal goes too: a template
 * is often a stylesheet (`<style>{`...`}</style>`, styled components).
 */
function withoutParsedComments(text: string, syntax: ScriptSyntax): string {
  const edits: { start: number; end: number; with: string }[] = [];
  for (const comment of syntax.comments) {
    edits.push({
      start: comment.start,
      end: comment.end,
      with: !comment.block
        ? ''
        : /[\n\r\u2028\u2029]/.test(text.slice(comment.start, comment.end))
          ? '\n'
          : ' ',
    });
  }
  for (const regex of syntax.regexes) {
    edits.push({
      start: regex.start,
      end: regex.end,
      with:
        '/'.padEnd(regex.close - regex.start) +
        text.slice(regex.close, regex.end),
    });
  }
  for (const template of syntax.templates) {
    for (const quasi of template.quasis) {
      const css = /\/\*[\s\S]*?(?:\*\/|$)/g;
      const body = text.slice(quasi.start, quasi.end);
      for (const match of body.matchAll(css)) {
        edits.push({
          start: quasi.start + match.index,
          end: quasi.start + match.index + match[0].length,
          with: ' ',
        });
      }
    }
  }
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.start) + edit.with;
    at = edit.end;
  }
  return out + text.slice(at);
}

/**
 * `withoutStringContents` for script the parser read: the contents of each
 * string and template literal blanked, quotes kept, except one a sink is
 * handed (`inRendered`) and a template tagged to render markup (lit's
 * `html`). Regular expressions were blanked with the comments.
 */
function withoutParsedStrings(
  text: string,
  syntax: ScriptSyntax,
  inRendered: (at: number) => boolean,
): string {
  // By UTF-16 unit, as the parser counts, not by code point.
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      if (out[at] !== '\n') out[at] = ' ';
    }
  };
  for (const string of syntax.strings) {
    if (!inRendered(string.start)) blank(string.start + 1, string.end - 1);
  }
  for (const template of syntax.templates) {
    if (inRendered(template.start)) continue;
    // Tagged or not, unless the tag renders markup: `styled(Button)`'s
    // template is CSS as surely as `styled.div`'s.
    if (!MARKUP_TAGS.has(template.tag ?? '')) {
      blank(template.start + 1, template.end - 1);
    }
  }
  return out.join('');
}

/**
 * The values that reach `at` through `name`, declared by `binding`, each
 * with the part of it still to read (`member`): the initialiser, and what
 * the name, or a member on the path read (`bundle.hero = ...` for
 * `bundle.hero`), is set to again before `at` in the binding's scope. An
 * unconditional `=` at the binding's own level replaces everything before
 * it: `let m = '<img>'; m = '<p>'; root.innerHTML = m` renders `<p>`.
 */
function reachingValues(
  text: string,
  depths: number[],
  binding: RegExpMatchArray,
  name: string,
  member: string | undefined,
  at: number,
): { start: number; member: string | undefined }[] {
  const path = member ? member.split('.') : [];
  const values = [{ start: binding.index! + binding[0].length, member }];
  const writes: {
    index: number;
    operator: string;
    target: string[];
    starts: { start: number; member: string | undefined }[];
  }[] = [];
  for (const assignment of text.matchAll(
    new RegExp(
      String.raw`(?<![\w$.]|\b(?:const|let|var)\s+)${escapeRegExp(name)}((?:${MEMBER_STEP})*)\s*(\+=|=(?!=))`,
      'g',
    ),
  )) {
    const target = chainPath(assignment[1]!);
    writes.push({
      index: assignment.index,
      operator: assignment[2]!,
      target,
      starts: [
        {
          start: assignment.index + assignment[0].length,
          member: path.slice(target.length).join('.') || undefined,
        },
      ],
    });
  }
  // A pattern that sets it (`({ html } = { ... })`, `[html] = [...]`):
  // the part of what it is handed that the pattern takes.
  for (const statement of text.matchAll(
    /(?:^|[;{}\n)]|\belse)\s*\(?\s*(?=[{[])/g,
  )) {
    const open = statement.index + statement[0].length;
    const close = bracketEnd(text, open);
    const equals =
      close === undefined
        ? null
        : /^\s*=(?![=>])\s*/.exec(text.slice(close + 1));
    if (!equals) continue;
    let bound: PatternBinding | undefined;
    patternBindings(text, open, 0, [], (candidate) => {
      if (candidate.name === name) bound = candidate;
    });
    if (!bound) continue;
    const part = joinMember(bound.member, path);
    if (part === null) continue;
    writes.push({
      index: open,
      operator: '=',
      target: [],
      starts: [{ start: close! + 1 + equals[0].length, member: part }],
    });
  }
  writes.sort((a, b) => a.index - b.index);
  for (const assignment of writes) {
    if (assignment.index <= binding.index!) continue;
    if (assignment.index >= at) break;
    if (!encloses(depths, binding.index!, assignment.index)) continue;
    // Only a write to the path read, or to a part of it: `bundle.safe =`
    // does not change `bundle.hero`.
    const target = assignment.target;
    if (target.some((part, index) => part !== path[index])) continue;
    // One inside a function the sink is not in reaches it only if
    // that function is called: `function prepare() { m = '<img>' }`
    // changes nothing until something runs `prepare()`.
    if (
      !functionsAround(text, depths, assignment.index).every(
        (fn) =>
          (at >= fn.start && at < fn.end) ||
          calledBefore(text, depths, fn, binding.index!, at),
      )
    ) {
      continue;
    }
    const replaces =
      assignment.operator === '=' &&
      depths[assignment.index] === depths[binding.index!] &&
      !conditional(text, assignment.index);
    if (replaces) values.length = 0;
    values.push(...assignment.starts);
  }
  return values;
}

/**
 * Where the body of the innermost function around `at` that takes `name`
 * as a parameter begins, or `undefined` if none does. Arrow functions
 * with and without braces, and `function` and method declarations.
 */
function shadowingFunction(
  text: string,
  depths: number[],
  name: string,
  at: number,
): number | undefined {
  const param = new RegExp(`(?<![\\w$.:])${escapeRegExp(name)}(?![\\w$])`);
  let found: number | undefined;
  for (const head of functionHeads(text)) {
    if (head.index >= at) break;
    const { params, arrow, brace } = head;
    // `(a) {` is a method or `function` body only; `(a) =>` is an arrow.
    if (!arrow && !brace) continue;
    // `if (markup) {` is a condition, not a parameter list.
    if (
      !arrow &&
      /\b(?:if|for|while|switch|with)\s*$/.test(text.slice(0, head.index))
    ) {
      continue;
    }
    if (!head.list && !arrow) continue;
    // A name read by a default (`html = markup`) is not a parameter.
    if (!param.test(withoutDefaults(params))) continue;
    const bodyStart = head.end;
    const inside = brace
      ? encloses(depths, bodyStart, at)
      : at < expressionEnd(text, bodyStart, { commas: true });
    if (inside) found = bodyStart;
  }
  return found;
}

/**
 * Whether a declaration at `declared` lies outside the body of the function
 * that starts at `body`, so that function's parameter of the same name
 * hides it. Wherever it is written: a const declared after the function,
 * lower in the file, is hidden just the same (internal issue 226).
 */
function outsideBody(
  text: string,
  depths: number[],
  body: number,
  declared: number,
) {
  if (declared < body) return true;
  // A braced body starts just past its `{`; a concise arrow's body is one
  // expression, and depth alone would run it to the end of the file
  // (internal PR 249 review).
  return text[body - 1] === '{'
    ? !encloses(depths, body, declared)
    : declared >= expressionEnd(text, body, { commas: true });
}

/**
 * A parameter list with each default value blanked out, so only the names
 * it binds are left: `html = markup, { a = b }` reads as `html , { a }`.
 */
function withoutDefaults(params: string): string {
  let out = '';
  for (let at = 0; at < params.length; at++) {
    const char = params[at]!;
    const next = params[at + 1];
    if (
      char !== '=' ||
      next === '=' ||
      next === '>' ||
      /[=!<>]/.test(params[at - 1] ?? '')
    ) {
      out += char;
      continue;
    }
    // Skip the default to the `,` or bracket that ends it.
    let depth = 0;
    for (at += 1; at < params.length; at++) {
      const inner = params[at]!;
      if (inner === '"' || inner === "'" || inner === '`') {
        const close =
          inner === '`' ? templateEnd(params, at) : quoteEnd(params, at);
        if (close !== undefined) at = close;
        continue;
      }
      if ('([{'.includes(inner)) depth += 1;
      else if (')]}'.includes(inner)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (inner === ',' && depth === 0) break;
    }
    out += ' ';
    at -= 1;
  }
  return out;
}

/** A function body in `text`: where it runs, and the name it is called by. */
interface FunctionBody {
  /** Where its name is declared, which is not a call of it. */
  declared?: number;
  start: number;
  end: number;
  name?: string;
  /**
   * For a method (`render() { ... }`, `render: () => ...`), the name of
   * the object it belongs to, when that is a named object literal; `null`
   * for a method of anything else (a class, an unnamed object). Absent
   * for a function that is not a method.
   */
  owner?: string | null;
  /** Where the declaration of that named object is. */
  ownerDeclared?: number;
  /** Its parameter list, as written. */
  params?: string;
  /** Where that list starts in the text. */
  paramsAt?: number;
  /**
   * For a method of a class, the class: its name, if it has one, and where
   * `class` is written.
   */
  ownerClass?: { name?: string; at: number };
  /** For a method, whether its object is exported, so others may call it. */
  ownerExported?: boolean;
}

/**
 * What refers to `fn`: its bare name for a function, and for a method a
 * member access through its owner (or `this`), or through anything when
 * the owner is unknown. `const render = 'label'` does not refer to
 * `view.render`.
 */
/**
 * Type arguments that may come between a function's name and the brackets
 * of a call to it (`show<string>(`), function and literal types among
 * them (`show<() => string>(`, `show<'a' | 'b'>(`).
 */
const typeArguments = `(?:\\s*${angled(
  String.raw`=>|\([^()]*\)|'[^'\n]*'|"[^"\n]*"|[^<>()'"\x60]`,
)})?`;

/**
 * What opens a call after the name called: type arguments, if any, then
 * `(` or `?.(` (`show<string>(`, `show?.(`).
 */
const CALL_OPEN = `${typeArguments}\\s*(?:\\?\\.\\s*)?\\(`;

/**
 * A pattern for a type written in angle brackets of `char`s (a pattern
 * for one part of it), with others nested in it up to three deep
 * (`<Array<Record<string, T>>>`).
 */
function angled(char: string): string {
  let inner = '(?!)';
  for (let depth = 0; depth < 3; depth++) {
    inner = `<(?:${char}|${inner})*>`;
  }
  return inner;
}

/**
 * `before` without type parameters at its end (`function show<T>`, or an
 * arrow's `= <T,>`), so what is left ends with the function's name. Not
 * a tag in markup (`return <b>`): no `/` or quotes inside, and a name
 * before it, or `=` or `:` before an arrow's.
 */
function withoutTypeParameters(before: string, arrow: boolean): string {
  const generic = new RegExp(
    String.raw`([A-Za-z_$][\w$]*|[=:])\s*${angled(String.raw`[^<>()/'"\x60]`)}\s*$`,
  ).exec(before);
  if (
    !generic ||
    (/^[=:]$/.test(generic[1]!) && !arrow) ||
    /^(?:return|yield|await|case|typeof|new|in|of|else|do|void)$/.test(
      generic[1]!,
    )
  ) {
    return before;
  }
  return before.slice(0, generic.index + generic[1]!.length);
}

/**
 * Where the arguments start of a call of what is named from `at` to `end`:
 * past the `(` right after it (`show(`, `show<T>(`, `show?.(`, `show!(`),
 * past the first argument of `show.call(`, into the array `show.apply(` is
 * given, or past brackets that only group it (`(show)(`, `(0, show)(`,
 * `(show as typeof show)(`). `undefined` when it is not called there, or
 * not with arguments seen here.
 */
function callArguments(
  text: string,
  at: number,
  end: number,
): number | undefined {
  const direct = new RegExp(
    `^(?:\\s*!)?${typeArguments}\\s*(?:\\?\\.\\s*)?\\(`,
  ).exec(text.slice(end));
  if (direct) return end + direct[0].length;
  // `show.apply(self, [...])`: the elements of that array, when it is
  // written out.
  const apply = new RegExp(`^${indirectCall('apply')}`).exec(text.slice(end));
  if (apply) {
    const list = nthArgument(text, end + apply[0].length, 1);
    const open = list && /^\s*\[/.exec(text.slice(list.from, list.end));
    return open ? list.from + open[0].length : undefined;
  }
  // `show.call(self, ...)`: its arguments start after the first.
  const call = new RegExp(`^${indirectCall('call')}`).exec(text.slice(end));
  if (call) {
    const open = end + call[0].length;
    const self = nthArgument(text, open, 0)?.end ?? open;
    const comma = /^\s*,/.exec(text.slice(self));
    return comma ? self + comma[0].length : self;
  }
  // `(show)(` or, with something before it, `(0, show)(`, and with only
  // what keeps its value after it (`(show!)(`, `(show as typeof show)(`).
  const before = Math.max(0, at - 40);
  const group = /(?<![\w$)\]]\s*)\(\s*(?:[\w$.]+\s*,\s*)?$/.exec(
    text.slice(before, at),
  );
  if (!group) return undefined;
  const close = bracketEnd(text, before + group.index);
  if (
    close === undefined ||
    !/^(?:\s*!|\s+(?:as|satisfies)\b[\s\S]*)?\s*$/.test(text.slice(end, close))
  ) {
    return undefined;
  }
  const grouped = /^\s*(?:\?\.\s*)?\(/.exec(text.slice(close + 1));
  return grouped ? close + 1 + grouped[0].length : undefined;
}

/**
 * `.call(`, `.apply(` or `.bind(` of a function, optionally
 * (`show?.call(`, `show.call?.(`).
 */
function indirectCall(method: string): string {
  return String.raw`\s*\??\.\s*${method}\s*(?:\?\.\s*)?\(`;
}

/**
 * Whether what is named up to `end` is only read from there, not handed
 * on: its `length` or `name`.
 */
function inspectedAt(text: string, end: number): boolean {
  return /^\s*\??\.\s*(?:length|name)(?![\w$])/.test(text.slice(end));
}

/**
 * Whether the name `declared` at is that of a function expression
 * (`(function show() {})()`, a callback `on('click', function show()
 * {})`, `const x = function show() {}`): bound by that name only inside
 * itself, so how it runs is not seen here.
 */
function namedExpression(text: string, declared: number): boolean {
  return /(?:[(,=:[!&|?]|\breturn)\s*(?:async\s+)?function\s*\*?\s*$/.test(
    text.slice(Math.max(0, declared - 40), declared),
  );
}

/**
 * The `position`th argument that a call of what is named from `at` to
 * `end` passes: `null` when it passes none there, and `undefined` when it
 * is not called there, or not with arguments seen here. A function bound
 * (`show.bind(self, a)`) is passed the bound ones first, whenever it is
 * called.
 */
function argumentAt(
  text: string,
  at: number,
  end: number,
  position: number,
): { from: number; end: number } | null | undefined {
  const bound = new RegExp(`^${indirectCall('bind')}`).exec(text.slice(end));
  if (bound) {
    const open = end + bound[0].length;
    const close = bracketEnd(text, open - 1);
    if (close === undefined) return undefined;
    const called = /^\s*\(/.exec(text.slice(close + 1));
    // After `self`, the bound ones, then those of the call. Bound and
    // kept (`const later = show.bind(self, a)`), whatever calls it later
    // passes the bound ones, and the rest are not seen here.
    let count = 0;
    while (nthArgument(text, open, count + 1)) count++;
    if (position < count) return nthArgument(text, open, position + 1)!;
    if (!called) return undefined;
    return (
      nthArgument(text, close + 1 + called[0].length, position - count) ?? null
    );
  }
  const open = callArguments(text, at, end);
  if (open === undefined) return undefined;
  return nthArgument(text, open, position) ?? null;
}

/**
 * A function bound and kept by a name (`const later = show.bind(self,
 * a)`): that name, how many arguments it binds, and where the arguments
 * of each call of it start.
 */
function storedBind(
  text: string,
  at: number,
  end: number,
): { count: number; calls: number[]; escapes: boolean } | undefined {
  const bound = new RegExp(`^${indirectCall('bind')}`).exec(text.slice(end));
  // Held by a `const`, which nothing sets again, under a type however it
  // is written (`later: (html: string) => void`).
  const held = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=;]|=>)+)?=\s*$/.exec(
    text.slice(Math.max(0, at - 120), at),
  );
  if (!bound || !held) return undefined;
  const open = end + bound[0].length;
  const close = bracketEnd(text, open - 1);
  if (close === undefined || !/^\s*(?:;|\n|$)/.test(text.slice(close + 1))) {
    return undefined;
  }
  let count = 0;
  while (nthArgument(text, open, count + 1)) count++;
  // Calls of that binding, not of another of the same name.
  const declared = Math.max(0, at - 120) + held.index;
  const calls: number[] = [];
  // Whether it is also handed on, to be called where this file cannot see.
  let escapes = false;
  for (const use of text.matchAll(
    new RegExp(`(?<![\\w$.])${escapeRegExp(held[1]!)}(?![\\w$])`, 'g'),
  )) {
    if (!boundTo(text, depthsOf(text), held[1]!, declared, use.index)) continue;
    if (/\b(?:const|let|var)\s+$/.test(text.slice(declared, use.index))) {
      continue;
    }
    const start = callArguments(text, use.index, use.index + use[0].length);
    if (start !== undefined) calls.push(start);
    else escapes = true;
  }
  return { count, calls, escapes };
}

/**
 * Whether what is named from `at` to `end` is called there: directly, by
 * `.call(` or `.apply(`, or bound and called at once, but not bound and
 * kept for later.
 */
function invokedAt(text: string, at: number, end: number): boolean {
  if (callArguments(text, at, end) !== undefined) return true;
  const indirect = new RegExp(`^${indirectCall('(apply|bind)')}`).exec(
    text.slice(end),
  );
  if (!indirect) return false;
  if (indirect[1] === 'apply') return true;
  const close = bracketEnd(text, end + indirect[0].length - 1);
  return close !== undefined && /^\s*\(/.test(text.slice(close + 1));
}

/**
 * Whether the name from `at` to `end` is one a signature declares, not a
 * call: an overload's (`function show(html?: string): void;`), or a
 * method's in an interface or a type (`{ show(html?: string): void }`,
 * `show?(): void`), a member with a type after its brackets.
 */
function signature(text: string, at: number, end: number): boolean {
  if (/\bfunction\s*\*?\s*$/.test(text.slice(Math.max(0, at - 24), at))) {
    return true;
  }
  if (!/[{;,]\s*$/.test(text.slice(Math.max(0, at - 24), at))) return false;
  const rest = text.slice(end);
  const close = callEnd(rest);
  return close !== undefined && /^\s*:/.test(rest.slice(close));
}

/** What stands for a `.` inside one key of a member path. */
const KEY_DOT = '\u2024';

/**
 * A key as one step of a member path: a `.` in it (`'hero.image'`) would
 * read as two steps, so it is written as `KEY_DOT`.
 */
function pathKey(key: string): string {
  return key.replaceAll('.', KEY_DOT);
}

/**
 * The part of a binding's value (`nested`) that the steps read off it
 * (`[0]`) reach. A rest that starts past the first elements of an array
 * (`nested.~1`) moves an index read off it along by that many; one of an
 * object without some keys (`nested.!safe`) holds nothing at those, so
 * reading one reaches `null`: no part at all. One argument of a rest
 * parameter (`@1`) is what an index read off the rest reaches only when
 * it is that one.
 */
function joinMember(
  member: string | undefined,
  read: string[],
): string | undefined | null {
  const path = member ? member.split('.') : [];
  const steps = [...read];
  const start = /^~(\d+)$/.exec(path.at(-1) ?? '');
  const without = /^!(.*)$/.exec(path.at(-1) ?? '');
  const argument = /^@(\d+)$/.exec(path.at(-1) ?? '');
  if (argument) {
    // One argument of a rest parameter: an index read off the rest
    // reaches this one or another.
    path.pop();
    if (/^\d+$/.test(steps[0] ?? '')) {
      if (steps.shift() !== argument[1]) return null;
    }
  } else if (start) {
    path.pop();
    if (steps.length) steps[0] = `${Number(start[1]) + Number(steps[0])}`;
  } else if (without) {
    path.pop();
    if (without[1]!.split(',').includes(steps[0]!)) return null;
  }
  return [...path, ...steps].join('.') || undefined;
}

function referenceTo(fn: FunctionBody & { name: string }): string {
  const name = escapeRegExp(fn.name);
  if (fn.owner === undefined) return `(?<![\\w$.])${name}(?![\\w$])`;
  // `.render` or, written as a string, `['render']`.
  const member = `(?:\\??\\.\\s*${name}(?![\\w$])|(?:\\?\\.)?\\[\\s*(?:'${name}'|"${name}"|\`${name}\`)\\s*\\])`;
  if (fn.owner === null) return member;
  return `(?<![\\w$.])(?:${escapeRegExp(fn.owner)}|this)\\s*${member}`;
}

let exportsOf: { text: string; ranges: [number, number][] } | undefined;

let depthsCache: { text: string; depths: number[] } | undefined;

/** `braceDepths` of `text`, kept for the text last asked about. */
function depthsOf(text: string): number[] {
  if (depthsCache?.text !== text) {
    depthsCache = { text, depths: braceDepths(text) };
  }
  return depthsCache.depths;
}

/**
 * The values a module exports, as ranges of the text: the initialiser of
 * `export const view = ...`, of a `const` named in `export { view }` or
 * `export default view`, and the expression after `export default`.
 */
function exportedValues(text: string): [number, number][] {
  if (exportsOf?.text === text) return exportsOf.ranges;
  const code = codeOnly(text);
  const ranges: [number, number][] = [];
  // Each declarator of the declaration whose keyword ends at `at`, in
  // turn (`const version = 1, view = { ... }`), with where its value is.
  const declarators = (at: number) => {
    const found: { name: string; from: number; to: number }[] = [];
    const declarator = /\s*([\w$]+)\s*(?::[^=;]+)?(?:=(?![=>])\s*)?/y;
    const comma = /\s*,/y;
    for (;;) {
      declarator.lastIndex = at;
      const match = declarator.exec(code);
      if (!match) return found;
      const from = at + match[0].length;
      const to = expressionEnd(text, from, { commas: true });
      found.push({ name: match[1]!, from, to });
      comma.lastIndex = to;
      if (!comma.exec(code)) return found;
      at = comma.lastIndex;
    }
  };
  for (const match of code.matchAll(/\bexport\s+(?:const|let|var)\s/g)) {
    for (const { from, to } of declarators(match.index + match[0].length)) {
      ranges.push([from, to]);
    }
  }
  for (const match of code.matchAll(/\bexport\s+default\b\s*/g)) {
    const from = match.index + match[0].length;
    ranges.push([from, expressionEnd(text, from, { commas: true })]);
  }
  const named = new Set([
    ...[...code.matchAll(/\bexport\s*\{([^}]*)\}/g)].flatMap((match) =>
      match[1]!
        .split(',')
        .map((part) => /^\s*([\w$]+)/.exec(part)?.[1])
        .filter((name): name is string => Boolean(name)),
    ),
    ...[
      ...code.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/gm),
    ].map((match) => match[1]!),
  ]);
  if (named.size) {
    for (const match of code.matchAll(/\b(?:const|let|var)\s/g)) {
      for (const { name, from, to } of declarators(
        match.index + match[0].length,
      )) {
        if (named.has(name)) ranges.push([from, to]);
      }
    }
  }
  exportsOf = { text, ranges };
  return ranges;
}

/**
 * Where a function's parameters are written, in order: a parameter list in
 * brackets, balanced however deep its defaults nest (`(html =
 * String(make()))`), or the single name of an arrow (`markup => ...`).
 * `end` is past what follows it up to a body's `{`, if one follows.
 */
interface FunctionHead {
  index: number;
  end: number;
  params: string;
  list: boolean;
  arrow: boolean;
  brace: boolean;
}

let headsOf: { text: string; heads: FunctionHead[] } | undefined;

/**
 * Past a type written after a parameter list (`): Promise<Page> {`), up
 * to the body's `{` or the arrow; `at` itself when there is none. A type
 * may hold brackets of its own (`): { html: string } {`).
 */
function pastReturnType(code: string, at: number): number {
  const colon = /^\s*:/.exec(code.slice(at));
  if (!colon) return at;
  return typeEnd(code, at + colon[0].length) ?? at;
}

/** Where the type written from `index` ends at a body's `{` or an arrow. */
function typeEnd(code: string, index: number): number | undefined {
  let typed = false;
  let group = false;
  while (index < code.length) {
    const char = code[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    // Whether what came just before is in brackets: a function type's
    // parameters, when an arrow follows.
    const afterGroup = group;
    group = char === '(';
    // A union or intersection goes on past `|` and `&` (`): void | {
    // ok: boolean } {`), and a conditional type past `?` and `:`, so the
    // brace after one is still the type's.
    if ('|&?:'.includes(char)) {
      index++;
      typed = false;
      continue;
    }
    // So does one after a word that a type goes on from (`T extends {`,
    // `keyof {`, `value is {`, `readonly {`).
    const word = /^[A-Za-z_$][\w$]*/.exec(code.slice(index, index + 40));
    if (word) {
      index += word[0].length;
      typed = !/^(?:extends|keyof|is|readonly)$/.test(word[0]);
      continue;
    }
    if (typed && char === '{') return index;
    if (typed && code.startsWith('=>', index)) {
      // After brackets, the arrow may be a function type's (`): () =>
      // void {`), when a body's `{` or arrow still follows its type.
      return (afterGroup ? typeEnd(code, index + 2) : undefined) ?? index;
    }
    if (/[;,)}\]]/.test(char)) return undefined;
    if ('([{'.includes(char)) {
      const close = bracketEnd(code, index);
      if (close === undefined) return undefined;
      index = close + 1;
    } else if (char === '<') {
      let depth = 0;
      for (; index < code.length; index++) {
        if (code[index] === '<') depth++;
        else if (code[index] === '>' && code[index - 1] !== '=') {
          if (--depth === 0) break;
        }
      }
      index++;
    } else {
      index++;
    }
    typed = true;
  }
  return undefined;
}

function functionHeads(text: string): FunctionHead[] {
  if (headsOf?.text === text) return headsOf.heads;
  const code = codeOnly(text);
  const heads: FunctionHead[] = [];
  const after = /\s*(=>)?\s*(\{)?/y;
  const opens: number[] = [];
  for (let at = 0; at < code.length; at++) {
    if (code[at] === '(') opens.push(at);
    else if (code[at] === ')') {
      const open = opens.pop();
      if (open === undefined) continue;
      // A function type in a declaration's annotation (`const later:
      // (html: string) => void = ...`) is no function.
      if (
        /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*$/.test(
          code.slice(0, open),
        )
      ) {
        continue;
      }
      const typed = pastReturnType(code, at + 1);
      after.lastIndex = typed;
      const tail = after.exec(text)!;
      heads.push({
        index: open,
        end: typed + tail[0].length,
        params: text.slice(open + 1, at),
        list: true,
        arrow: tail[1] !== undefined,
        brace: tail[2] !== undefined,
      });
    }
  }
  for (const match of code.matchAll(
    /(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>\s*(\{)?/g,
  )) {
    heads.push({
      index: match.index,
      end: match.index + match[0].length,
      params: match[1]!,
      list: false,
      arrow: true,
      brace: match[2] !== undefined,
    });
  }
  heads.sort((a, b) => a.index - b.index);
  headsOf = { text, heads };
  return heads;
}

/**
 * The bodies of the functions (`function`, methods and arrows, braced or
 * concise) that `at` is inside.
 */
function functionsAround(
  text: string,
  depths: number[],
  at: number,
): FunctionBody[] {
  const found: FunctionBody[] = [];
  for (const head of functionHeads(text)) {
    if (head.index >= at) break;
    const { arrow, brace } = head;
    if (!arrow && (!brace || !head.list)) continue;
    // `if (x) {` and `catch (e) {` open blocks, not functions.
    if (
      !arrow &&
      /\b(?:if|for|while|switch|with|catch)\s*$/.test(text.slice(0, head.index))
    ) {
      continue;
    }
    const start = head.end;
    let end: number;
    if (brace) {
      end = start;
      while (end < text.length && depths[end]! >= depths[start]!) end += 1;
    } else {
      end = expressionEnd(text, start, { commas: true });
    }
    if (at < start || at >= end) continue;
    const before = withoutTypeParameters(text.slice(0, head.index), arrow);
    // Named by a declaration past its type (`const render: Fn = () =>`),
    // by a key written out (`['render']() {`, `'render': function () {`),
    // or else by what comes just before it.
    const keyed =
      /(?:\[\s*(['"\x60])([A-Za-z_$][\w$]*)\1\s*\]|(['"])([A-Za-z_$][\w$]*)\3)\s*(?::\s*(?:async\s*)?(?:function\s*\*?\s*)?)?$/.exec(
        before,
      );
    const named =
      /(?<=\b(?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*:(?:[^=;]|=>)+=\s*(?:async\s*)?(?:function\s*\*?\s*)?$/.exec(
        before,
      ) ??
      (keyed
        ? Object.assign(
            [keyed[0], keyed[2] ?? keyed[4]] as unknown as RegExpExecArray,
            {
              index: keyed.index,
            },
          )
        : null) ??
      /([A-Za-z_$][\w$]*)\s*(?:[:=]\s*(?:async\s*)?(?:function\s*\*?\s*)?)?$/.exec(
        before,
      );
    // A method: named by a property (`render: ...`) or a shorthand
    // (`render() {`), not by `function` or an assignment.
    const method =
      named !== null &&
      !named[0].includes('=') &&
      (named[0].includes(':') ||
        !/\bfunction\s*\*?\s*$/.test(text.slice(0, named.index)));
    let owner: string | null | undefined;
    let ownerClass: FunctionBody['ownerClass'];
    let ownerExported = false;
    let ownerDeclared: number | undefined;
    if (method) {
      let brace = named.index - 1;
      while (
        brace >= 0 &&
        !(text[brace] === '{' && depths[brace] === depths[named.index]! - 1)
      ) {
        brace -= 1;
      }
      // `const view = {`, a later declarator (`const n = 0, view = {`), with
      // a type however it is written (`view: Record<string, () => void>`).
      const holder =
        brace >= 0
          ? /(?:\b(?:const|let|var)\s+|,\s*)([\w$]+)\s*(?::(?:[^=;]|=>)+)?=\s*$/.exec(
              text.slice(0, brace),
            )
          : null;
      owner = holder?.[1] ?? null;
      ownerDeclared = holder?.index;
      // Anywhere inside what a module exports (`export const view = {`,
      // `export default [...]`, `export { view }`), however deep in objects
      // and arrays it sits. Not an object held by a local of a function
      // that is exported (`export default function App() { const view =
      // {`): only that function can reach it.
      ownerExported = exportedValues(text).some(
        ([from, to]) =>
          named.index >= from &&
          named.index < to &&
          (owner === null ||
            !functionsAround(text, depths, named.index).some(
              (outer) => outer.start >= from && outer.start < to,
            )),
      );
      const header =
        brace >= 0
          ? /\bclass\b(?:\s+([A-Za-z_$][\w$]*))?[^{};]*$/.exec(
              text.slice(0, brace),
            )
          : null;
      if (header) {
        ownerClass = {
          ...(header[1] ? { name: header[1] } : {}),
          at: header.index,
        };
      }
    }
    found.push({
      declared: named?.index,
      start,
      end,
      name: named?.[1],
      params: head.params,
      paramsAt: head.list ? head.index + 1 : head.index,
      ...(method ? { owner } : {}),
      ...(ownerDeclared !== undefined ? { ownerDeclared } : {}),
      ...(ownerClass ? { ownerClass } : {}),
      ...(ownerExported ? { ownerExported } : {}),
    });
  }
  return found;
}

/** A call's optional type arguments, `<string>` or `<Map<K, V>>`, and the space after. */
const TYPE_ARGUMENTS = String.raw`(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>\s*)?`;

/**
 * Each name an HTML sink is handed, where, and the member it reads of it:
 * `root.innerHTML = bundle.safe` and `bundle['safe']` read `safe` of
 * `bundle`. React's shorthand, `dangerouslySetInnerHTML={{ __html }}`,
 * hands over the binding called `__html`.
 */
function namedSinks(
  text: string,
  depths: number[],
  seeds: readonly string[] = [],
): { index: number; name: string; member: string | undefined }[] {
  const sinks: { index: number; name: string; member: string | undefined }[] =
    [];
  // Every name in what a sink is handed, not only the first:
  // `innerHTML = sanitize(markup)` hands over `markup`. A name that is
  // called (`sanitize(`) is the function, not the value; what it returns
  // is read as its own expression.
  for (const { from, end, member } of sinkExpressions(text, depths, seeds)) {
    const code = codeOnly(text.slice(from, end));
    // A part read of a value that is only a name (`opts.safe` with `opts =
    // bundle`) is that part of the name.
    const only =
      member !== undefined &&
      new RegExp(String.raw`^\s*[A-Za-z_$][\w$]*(?:${MEMBER_STEP})*\s*$`).test(
        code,
      );
    for (const id of code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
      if (NOT_A_BINDING.has(id[0])) continue;
      const at = from + id.index;
      const rest = text.slice(at + id[0].length, end);
      // Called, type arguments and all (`templates<string>()`).
      if (new RegExp(String.raw`^\s*(?:${TYPE_ARGUMENTS}\(|=>)`).test(rest)) {
        continue;
      }
      // The whole static chain: `bundle.section.safe` is `section.safe`
      // of `bundle`, and `markup.trim()` uses all of `markup`.
      const chain = new RegExp(`^(?:${MEMBER_STEP})+`).exec(rest)?.[0] ?? '';
      const path = chainPath(chain);
      if (/^\s*\(/.test(rest.slice(chain.length))) {
        const method = path.pop()!;
        // A method of an object written out here (`templates.safe()`) is
        // read through what it returns, not the whole object; a method of
        // anything else (`markup.trim()`) uses the whole value.
        if (
          method !== undefined &&
          methodReturns(text, depths, id[0], path, method) !== undefined
        ) {
          continue;
        }
      }
      if (only) path.push(member);
      sinks.push({
        index: at,
        name: id[0],
        member: path.length > 0 ? path.join('.') : undefined,
      });
    }
  }
  for (const match of text.matchAll(/[{,]\s*__html\s*(?=[,}])/g)) {
    sinks.push({
      index: match.index + match[0].indexOf('__html'),
      name: '__html',
      member: undefined,
    });
  }
  return sinks;
}

/**
 * Where the call whose `(` opens `code` ends: just past its `)`. `code` has
 * been through `codeOnly`, so no bracket inside a string is left to count.
 */
function callEnd(code: string): number | undefined {
  const open = code.indexOf('(');
  let depth = 0;
  for (let at = open; at < code.length; at++) {
    const char = code[at]!;
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char) && --depth === 0) return at + 1;
  }
  return undefined;
}

/**
 * What reaches an HTML sink, as ranges of the text: each sink's own
 * expression, and what the local helpers it calls return (`innerHTML =
 * render()` with `function render() { return '<img>' }`), a few calls
 * deep. `returned` marks the second kind.
 */
function sinkExpressions(
  text: string,
  depths: number[],
  // Helpers another file calls at a sink, by the name they are exported
  // under here: what they return reaches that sink, or the part of it
  // read after the call (`render.hero` for `render().hero`).
  seeds: readonly string[] = [],
): SinkExpression[] {
  const expressions: SinkExpression[] = [];
  for (const match of text.matchAll(
    new RegExp(HTML_SINK.source.slice(0, -1), 'g'),
  )) {
    // A sink in a function nothing runs hands over nothing, and so does
    // nothing to what the helpers it calls return.
    if (
      functionsAround(text, depths, match.index).some((fn) =>
        unreferenced(text, fn),
      )
    ) {
      continue;
    }
    const from = match.index + match[0].length;
    const call = /[(,]\s*$/.test(match[0]);
    expressions.push({
      from,
      end: expressionEnd(text, from, { commas: !call }),
      kind: 'sink',
    });
  }
  for (const seed of seeds) {
    // `render.hero`: the part `hero` of what `render` returns.
    // `await render`: called and awaited.
    const [name, member] = splitEntry(seed.replace(/^await /, ''));
    for (const returned of exportedReturns(
      text,
      depths,
      name,
      seed.startsWith('await '),
    )) {
      if (member === undefined) {
        expressions.push({ ...returned, kind: 'returned' });
        continue;
      }
      for (const [from, end] of renderedRange(
        text,
        depths,
        returned.from,
        member,
        (alias, part, index) =>
          expressions.push({
            from: index,
            end: index + alias.length,
            kind: 'returned',
            member: part,
          }),
      )) {
        expressions.push({ from, end, kind: 'returned' });
      }
    }
  }
  // One value read by two parts (`opts.safe`, `opts.hero`) is two reads.
  const identity = (expression: SinkExpression) =>
    `${expression.from}:${expression.member ?? ''}`;
  const seen = new Set(expressions.map(identity));
  const add = (expression: SinkExpression) => {
    if (seen.has(identity(expression))) return;
    seen.add(identity(expression));
    expressions.push(expression);
  };
  // A parameter's default is read in that function's scope: a name in it
  // may be an earlier parameter (`(markup, html = markup)`), which is what
  // callers pass for that one. Where each default's function body starts.
  const scopes = new Map<number, number>();
  for (let index = 0; index < expressions.length && index < 60; index++) {
    const { from, end, member: part } = expressions[index]!;
    const code = codeOnly(text.slice(from, end));
    const scope = scopes.get(from);
    // A default that is only a name is read by the part the sink reads.
    const carried =
      scope !== undefined && /^\s*[A-Za-z_$][\w$]*\s*$/.test(code)
        ? part
        : undefined;
    for (const name of code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
      if (NOT_A_BINDING.has(name[0])) continue;
      const at = from + name.index;
      const after = code.slice(name.index + name[0].length);
      // A helper it calls, optionally or not, or a method it calls on an
      // object written out here: what that returns, or the part of it read
      // after the call (`templates().hero`, `views.make().hero`), past any
      // type arguments (`templates<() => string>()`).
      const opener = new RegExp(`^${CALL_OPEN}`).exec(after);
      const method = opener
        ? null
        : new RegExp(
            String.raw`^((?:\s*\??\.\s*[A-Za-z_$][\w$]*)+)${CALL_OPEN}`,
          ).exec(after);
      const call = opener ?? method;
      if (call) {
        const open = call[0].length - 1;
        const called = callEnd(after.slice(open));
        const close = called === undefined ? undefined : open + called;
        const read = memberAfterCall(
          text.slice(from, end),
          name.index,
          name.index + name[0].length + open,
        );
        // A default that is only this call (`opts = templates()`) is read
        // by the part the sink reads of it.
        const whole =
          scope !== undefined &&
          close !== undefined &&
          code.slice(0, name.index).trim() === '' &&
          after.slice(close).trim() === '';
        const member =
          [read, whole ? part : undefined].filter(Boolean).join('.') ||
          undefined;
        const path = method
          ? method[1]!
              .replace(/\s+/g, '')
              .replace(/\?\./g, '.')
              .split('.')
              .filter(Boolean)
          : [];
        const returns = method
          ? (methodReturns(
              text,
              depths,
              name[0],
              path,
              path.pop()!,
              awaitedAt(code, name.index),
            ) ?? [])
          : returnedExpressions(
              text,
              depths,
              name[0],
              awaitedAt(code, name.index),
            );
        for (const returned of returns) {
          if (member === undefined) {
            add({ ...returned, kind: 'returned' });
            continue;
          }
          for (const [rangeFrom, rangeEnd] of renderedRange(
            text,
            depths,
            returned.from,
            member,
            // `return bundle`: that part of the name it returns.
            (alias, part, index) =>
              add({
                from: index,
                end: index + alias.length,
                kind: 'returned',
                member: part,
              }),
          )) {
            add({ from: rangeFrom, end: rangeEnd, kind: 'returned' });
          }
        }
        if (opener) continue;
      }
      // A parameter of the function it is in: what that function's
      // callers pass for it (`render('<img>')`).
      const where = scope ?? at;
      // Read by the part the sink reads of it (`opts.safe`).
      const chain = new RegExp(`^(?:${MEMBER_STEP})+`).exec(after)?.[0];
      const read = [...(chain ? chainPath(chain) : []), carried].filter(
        (step): step is string => Boolean(step),
      );
      for (const argument of passedFor(text, depths, name[0], where)) {
        const member = joinMember(argument.member, read);
        if (member !== null) add({ ...argument, kind: 'argument', member });
      }
      // And what it is when a caller leaves it out.
      for (const fallback of parameterDefaults(text, depths, name[0], where)) {
        const member = joinMember(fallback.member, read);
        if (member === null) continue;
        scopes.set(fallback.from, fallback.body);
        add({
          from: fallback.from,
          end: fallback.end,
          kind: 'argument',
          member,
        });
      }
    }
  }
  return expressions;
}

/**
 * What `method` of the object `base.path` returns, when `base` is declared
 * here as an object written out and that object has the method; undefined
 * when `base` is anything else, so the caller can treat the value whole.
 */
function methodReturns(
  text: string,
  depths: number[],
  base: string,
  path: string[],
  method: string,
  awaited = false,
): { from: number; end: number }[] | undefined {
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRegExp(base)}(?![\\w$])\\s*(?::(?:[^=;]|=>)+)?=\\s*`,
  ).exec(text);
  if (!declaration) return undefined;
  let start = declaration.index + declaration[0].length;
  for (const part of path) {
    const ranges = renderedRange(text, depths, start, part);
    if (ranges.length !== 1) return undefined;
    start = ranges[0]![0];
  }
  const open = /^\s*\{/.exec(text.slice(start));
  if (!open) return undefined;
  const inside = start + open[0].length;
  const end = expressionEnd(text, start, { commas: true });
  for (const found of text
    .slice(inside, end)
    .matchAll(
      new RegExp(`(?<![\\w$.])${escapeRegExp(method)}\\s*(\\(|:\\s*)`, 'g'),
    )) {
    const at = inside + found.index;
    if (depths[at] !== depths[inside]) continue;
    const header = found[1]!.startsWith('(')
      ? new RegExp(`${escapeRegExp(method)}\\s*\\(`, 'y')
      : new RegExp(
          String.raw`(?:async\s*)?(?:function\b[^(]*\(|${typeArguments}\s*(?=\(|[A-Za-z_$][\w$]*\s*=>))`,
          'y',
        );
    header.lastIndex = found[1]!.startsWith('(') ? at : at + found[0].length;
    return returnedFrom(text, depths, header.exec(text), awaited);
  }
  return undefined;
}

interface SinkExpression {
  from: number;
  end: number;
  /**
   * `sink`: what a sink is handed. `returned`: what a helper it calls
   * returns, of which only the top-level literals are the helper's own.
   * `argument`: what a caller passes for a parameter a sink reads.
   */
  kind: 'sink' | 'returned' | 'argument';
  /** For an argument destructured by the parameter, the part it takes. */
  member?: string;
}

/**
 * When `name` at `at` is a parameter of the nearest function that has
 * one of that name, the argument each call of that function passes for
 * it. A function nothing calls by name passes nothing.
 */
function passedFor(
  text: string,
  depths: number[],
  name: string,
  at: number,
): { from: number; end: number; member?: string }[] {
  const fn = functionsAround(text, depths, at)
    .sort((a, b) => b.start - a.start)
    .find((candidate) => parameterNames(candidate.params ?? '').includes(name));
  if (!fn?.name || /^(?:function|async)$/.test(fn.name)) return [];
  const parameter = parameterBindings(fn.params ?? '').find(
    (binding) => binding.name === name,
  )!;
  const found: { from: number; end: number; member?: string }[] = [];
  for (const call of text.matchAll(
    new RegExp(referenceTo({ ...fn, name: fn.name }), 'g'),
  )) {
    if (
      call.index === fn.declared ||
      signature(text, call.index, call.index + call[0].length)
    ) {
      continue;
    }
    // A rest parameter holds this argument and each after it, the one
    // it is by its index in the rest (`@1`).
    const passed: { from: number; end: number; member?: string }[] = [];
    const wrapper = storedBind(text, call.index, call.index + call[0].length);
    for (let index = 0; index < (parameter.rest ? 50 : 1); index++) {
      const position = parameter.position + index;
      const argument = argumentAt(
        text,
        call.index,
        call.index + call[0].length,
        position,
      );
      // Past the bound ones, what each call of the wrapper passes.
      const arguments_ =
        argument === undefined && wrapper
          ? wrapper.calls.flatMap(
              (open) => nthArgument(text, open, position - wrapper.count) ?? [],
            )
          : argument
            ? [argument]
            : [];
      if (arguments_.length === 0) break;
      for (const each of arguments_) {
        passed.push({
          ...each,
          member: parameter.rest ? `@${index}` : parameter.member,
        });
      }
    }
    if (passed.length === 0) continue;
    if (!refersTo(text, depths, fn, call.index)) continue;
    // A call in a function that never runs passes nothing. One inside
    // `fn` itself runs whenever `fn` does, so what it passes counts too.
    if (
      functionsAround(text, depths, call.index).some((outer) =>
        unreferenced(text, outer),
      )
    ) {
      continue;
    }
    found.push(...passed);
  }
  return found;
}

/**
 * The names a parameter list binds, with the position of the argument
 * each comes from and the part of that argument it is: `(a, { b, c: d },
 * [e], ...f)` binds a (0), b (1, `b`), d (1, `c`), e (2, `0`) and f (3).
 */
function parameterBindings(params: string): ParameterBinding[] {
  const found: ParameterBinding[] = [];
  const list = `${params})`;
  // TypeScript's `this: T` first is no parameter a caller passes.
  let shift = 0;
  for (let index = 0; ; index++) {
    const part = nthArgument(list, 0, index);
    if (!part) break;
    let text = list.slice(part.from, part.end);
    if (index === 0 && /^\s*this\s*(?::|$)/.test(text)) {
      shift = 1;
      continue;
    }
    const position = index - shift;
    // Its decorators (`@Inject(TOKEN) html = ...`), then a parameter
    // property's modifiers (`public html = ...`).
    const lead =
      /^(?:\s*@[\w$.]+\s*(?:\((?:[^()]|\([^()]*\))*\))?)*\s*(?:(?:public|private|protected|readonly|override)\s+)*/.exec(
        text,
      )![0].length;
    const from = part.from + lead;
    text = text.slice(lead);
    const open = /^\s*[{[]/.exec(text);
    if (!open) {
      const name =
        /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*(?:[:=?][\s\S]*)?$/.exec(
          text,
        )?.[1];
      // `markup = '<img>'`, or `markup: string = '<img>'`, past a type
      // however it is written (`on: () => void = ...`).
      const typed = pastAnnotation(
        text,
        /^\s*[A-Za-z_$][\w$]*\s*\??/.exec(text)?.[0].length ?? 0,
      );
      const head = /^\s*=(?![=>])\s*/.exec(text.slice(typed));
      if (name) {
        found.push({
          name,
          position,
          ...(/^\s*\.\.\./.test(text) ? { rest: true } : {}),
          ...(head ? { fallback: from + typed + head[0].length } : {}),
        });
      }
      continue;
    }
    const patternAt = open[0].length - 1;
    const close = bracketEnd(text, patternAt);
    if (close === undefined) continue;
    // `({ markup } = { markup: '<img>' })`: a default for the whole
    // argument, which each name reads its own part of.
    const typed = pastAnnotation(text, close + 1);
    const whole = /^\s*=(?![=>])\s*/.exec(text.slice(typed));
    const wholeFallback = whole ? from + typed + whole[0].length : undefined;
    patternBindings(text, patternAt, from, [], (binding) =>
      found.push({
        ...binding,
        position,
        ...(wholeFallback !== undefined ? { wholeFallback } : {}),
      }),
    );
  }
  return found;
}

/**
 * The names a destructuring pattern at `at` in `text` binds, however deep
 * it nests (`{ nested: { markup = '<img>' } }`), each with the path of
 * the part it takes (`nested.markup`) and where its own default starts,
 * shifted by `base`. A rest stands for the whole of its level, from where
 * it starts in an array.
 */
function patternBindings(
  text: string,
  at: number,
  base: number,
  path: string[],
  bind: (binding: PatternBinding) => void,
  // Where each pattern this one sits in has a default of its own, by the
  // path of the part it stands for (`nested`), shifted by `base`.
  parentDefaults: Record<string, number> = {},
): void {
  const close = bracketEnd(text, at);
  if (close === undefined) return;
  const array = text[at] === '[';
  const list = `${text.slice(0, close)})`;
  // The keys an object's rest leaves out, taken before it.
  const taken: string[] = [];
  for (let index = 0; ; index++) {
    const entry = nthArgument(list, at + 1, index);
    if (!entry) break;
    const source = text.slice(entry.from, entry.end);
    const lead = source.length - source.trimStart().length;
    const rest = /^\s*\.\.\.\s*([\w$]+)/.exec(source);
    if (rest) {
      // One past the first elements of an array (`[skip, ...rest]`)
      // starts there: `~1`, which `joinMember` shifts what is read by.
      // One of an object holds all but the keys taken before it
      // (`{ safe, ...others }`): `!safe`, which it reads as nothing.
      const marker = array
        ? index
          ? `~${index}`
          : undefined
        : taken.length
          ? `!${taken.join(',')}`
          : undefined;
      const member = [...path, ...(marker ? [marker] : [])];
      bind({
        name: rest[1]!,
        ...(member.length ? { member: member.join('.') } : {}),
      });
      continue;
    }
    // `key: target`, a shorthand `key`, or for an array just `target`.
    const keyed = array
      ? undefined
      : /^\s*(?:(['"])([^'"]*)\1|([\w$]+)|\[\s*(['"`])([^'"`$]*)\4\s*\]|\[[^\]]*\])\s*(:)?\s*/.exec(
          source,
        );
    if (!array && !keyed) continue;
    // A key worked out when it runs (`[key]: html`) may be any: one no
    // value is read as writing, so its default stays reachable.
    const key = array
      ? `${index}`
      : pathKey(keyed![2] ?? keyed![3] ?? keyed![5] ?? COMPUTED_KEY);
    taken.push(key);
    const targetAt = entry.from + (keyed?.[6] ? keyed[0].length : lead);
    if (/^[{[]/.test(text[targetAt] ?? '')) {
      const inner = bracketEnd(text, targetAt);
      const defaulted =
        inner === undefined
          ? null
          : /^\s*=(?![=>])\s*/.exec(text.slice(inner + 1, entry.end));
      patternBindings(
        text,
        targetAt,
        base,
        [...path, key],
        bind,
        defaulted
          ? {
              ...parentDefaults,
              [[...path, key].join('.')]:
                base + inner! + 1 + defaulted[0].length,
            }
          : parentDefaults,
      );
      continue;
    }
    const target = /^([\w$]+)\s*(=(?![=>])\s*)?/.exec(
      text.slice(targetAt, entry.end),
    );
    if (!target) continue;
    bind({
      name: target[1]!,
      member: [...path, key].join('.'),
      ...(Object.keys(parentDefaults).length ? { parentDefaults } : {}),
      ...(target[2] ? { fallback: base + targetAt + target[0].length } : {}),
    });
  }
}

/** What stands for a key a pattern works out when it runs. */
const COMPUTED_KEY = '[computed]';

/** A name a destructuring pattern binds: see `patternBindings`. */
interface PatternBinding {
  name: string;
  member?: string;
  fallback?: number;
  parentDefaults?: Record<string, number>;
}

/** A name a parameter list binds: see `parameterBindings`. */
interface ParameterBinding {
  name: string;
  position: number;
  member?: string;
  /** `...html`: every argument from `position` on, `html[1]` the next. */
  rest?: boolean;
  /** Where its own default value starts in the list, if it has one. */
  fallback?: number;
  /**
   * Where the patterns above it that have defaults of their own have
   * them, by the path of the part each stands for (`nested`).
   */
  parentDefaults?: Record<string, number>;
  /**
   * For a name in a pattern, where the default for the whole pattern
   * starts (`({ markup } = { ... })`), which it reads `member` of.
   */
  wholeFallback?: number;
}

/**
 * When `name` at `at` is a parameter of the nearest function that has one
 * of that name, the defaults it can be given where a caller leaves it out,
 * with the part of each it takes: what the sink renders then (`function
 * render(markup = '<img>')`, `function render({ markup } = { markup:
 * '<img>' })`).
 */
function parameterDefaults(
  text: string,
  depths: number[],
  name: string,
  at: number,
): { from: number; end: number; member?: string; body: number }[] {
  const fn = functionsAround(text, depths, at)
    .sort((a, b) => b.start - a.start)
    .find((candidate) => parameterNames(candidate.params ?? '').includes(name));
  if (!fn || fn.paramsAt === undefined) return [];
  const paramsAt = fn.paramsAt;
  const parameter = parameterBindings(fn.params ?? '').find(
    (binding) => binding.name === name,
  );
  if (!parameter) return [];
  // `= defaults` with `const defaults = { ... }` in scope: that value.
  const wholeValue = (at: number) => {
    const name = /^\s*([A-Za-z_$][\w$]*)\s*(?:[,)]|$)/.exec(
      text.slice(at, expressionEnd(text, at, { commas: true }) + 1),
    )?.[1];
    return (
      (name ? visibleConst(text, depths, name, at, true) : undefined) ?? at
    );
  };
  const range = (offset: number) => {
    const from = paramsAt + offset;
    return {
      from,
      end: expressionEnd(text, from, { commas: true }),
      body: fn.start,
    };
  };
  const found: { from: number; end: number; member?: string; body: number }[] =
    [];
  if (
    parameter.fallback !== undefined &&
    defaultReachable(
      text,
      depths,
      fn,
      parameter,
      parameter.wholeFallback === undefined
        ? undefined
        : wholeValue(paramsAt + parameter.wholeFallback),
    )
  ) {
    found.push(range(parameter.fallback));
  }
  // The whole pattern's default is used only when the argument itself is
  // left out, not merely a part of it.
  if (
    parameter.wholeFallback !== undefined &&
    defaultReachable(text, depths, fn, { position: parameter.position })
  ) {
    found.push({ ...range(parameter.wholeFallback), member: parameter.member });
  }
  return found;
}

/**
 * Whether a caller of `fn` can leave `parameter` out, so its default is
 * used. Callers this file cannot see (an unnamed function, a class's
 * method, an export) or one it is handed to (`onClick={show}`) may; so may
 * a call, its own recursive ones included, that passes too few
 * arguments, `undefined`, a spread, or, for a destructured part, a value
 * not written out here that holds it.
 */
function defaultReachable(
  text: string,
  depths: number[],
  fn: FunctionBody,
  parameter: {
    position: number;
    member?: string;
    parentDefaults?: Record<string, number>;
  },
  // Where the whole pattern's default starts, when a call that leaves the
  // argument out gets that instead: it reaches this part's default only
  // if it does not hold the part.
  whole?: number,
): boolean {
  // A call that leaves the argument out reaches a part's default only
  // through the whole pattern's default, when that lacks the part: with
  // none, destructuring `undefined` throws first.
  const omitted = () =>
    parameter.member === undefined ||
    (whole !== undefined &&
      !suppliesPart(
        text,
        depths,
        whole,
        parameter.member,
        0,
        parentDefaultsAt(fn, parameter),
      ));
  // Whether a caller, whose arguments the call named from `at` to `end`
  // passes, can leave the argument out.
  const leaves = (at: number, end: number): boolean => {
    // `</Show>` closes an element; `<Show ... />` renders the component
    // with its attributes as the props, the one argument it is given.
    const before = text.slice(Math.max(0, at - 2), at);
    if (/<\/\s*$/.test(before)) return false;
    if (/<\s*$/.test(before)) return propsLeave(end);
    const argument = argumentAt(text, at, end, parameter.position);
    // A function bound and kept (`const later = show.bind(self, a)`) is
    // passed, past the bound arguments, what each call of that passes.
    const wrapper =
      argument === undefined ? storedBind(text, at, end) : undefined;
    if (argument === undefined && (!wrapper || wrapper.escapes)) {
      return true;
    }
    for (const passed of argument !== undefined
      ? [argument]
      : wrapper!.calls.map(
          (open) =>
            nthArgument(text, open, parameter.position - wrapper!.count) ??
            null,
        )) {
      if (!passed) {
        if (omitted()) return true;
        continue;
      }
      const value = text.slice(passed.from, passed.end).trim();
      if (value.startsWith('...')) return true;
      // Destructuring `null` throws before any default of a part is used.
      if (parameter.member !== undefined && value === 'null') continue;
      if (!definitelyDefined(text, depths, value, passed.from)) {
        if (omitted()) return true;
        continue;
      }
      if (
        parameter.member !== undefined &&
        !suppliesPart(
          text,
          depths,
          passed.from,
          parameter.member,
          0,
          parentDefaultsAt(fn, parameter),
        )
      ) {
        return true;
      }
    }
    return false;
  };
  // Whether the element whose name ends at `end` leaves the part out.
  const propsLeave = (end: number): boolean => {
    if (parameter.position !== 0) return true;
    if (parameter.member === undefined) return false;
    const [key, ...rest] = parameter.member.split('.');
    const attributes = new Map<string, { from: number; end: number } | true>();
    let at = end;
    for (;;) {
      at += /^\s*/.exec(text.slice(at))![0].length;
      if (/^\/?>/.test(text.slice(at, at + 2))) break;
      // A spread (`{...props}`) may set any of them, over those before it.
      if (text[at] === '{') {
        attributes.clear();
        at = (bracketEnd(text, at) ?? text.length) + 1;
        continue;
      }
      const name = /^[A-Za-z_$][\w$:.-]*/.exec(text.slice(at))?.[0];
      if (!name) break;
      at += name.length;
      const equals = /^\s*=\s*/.exec(text.slice(at));
      if (!equals) {
        attributes.set(name, true);
        continue;
      }
      at += equals[0].length;
      const close =
        text[at] === '{'
          ? bracketEnd(text, at)
          : text[at] === '"' || text[at] === "'"
            ? quoteEnd(text, at)
            : undefined;
      // A value not read here (`icon=<b />`) ends what is read.
      if (close === undefined) break;
      // A string is defined, and holds no parts.
      attributes.set(
        name,
        text[at] === '{' ? { from: at + 1, end: close } : true,
      );
      at = close + 1;
    }
    const value = attributes.get(key!);
    if (value === undefined) return true;
    if (value === true) return rest.length > 0;
    const written = text.slice(value.from, value.end).trim();
    if (!definitelyDefined(text, depths, written, value.from)) return true;
    return (
      rest.length > 0 &&
      !suppliesPart(
        text,
        depths,
        value.from,
        rest.join('.'),
        0,
        parentDefaultsAt(fn, parameter),
      )
    );
  };
  // A private method (`private show(`, `#show(`) runs only by a call in
  // its own class: through `this`, the class itself for a static one
  // (`View.show()`), or another instance (`other.#show()`).
  if (
    fn.ownerClass &&
    fn.name &&
    fn.declared !== undefined &&
    (text[fn.declared - 1] === '#' ||
      /\bprivate\s+(?:(?:static|readonly|async|override)\s+)*$/.test(
        text.slice(Math.max(0, fn.declared - 40), fn.declared),
      ))
  ) {
    const open = text.indexOf('{', fn.ownerClass.at);
    const source = text.slice(open, bracketEnd(text, open));
    const body = codeOnly(source);
    const self = fn.ownerClass.name
      ? `(?:this|${escapeRegExp(fn.ownerClass.name)})`
      : 'this';
    // A key worked out when it runs (`this[action]()`) may name it.
    if (
      new RegExp(
        String.raw`(?<![\w$.])${self}\s*(?:\?\.)?\[(?!\s*['"\x60\d])`,
      ).test(body)
    ) {
      return true;
    }
    // Read from what is written, where a key in quotes is still there,
    // through whatever it is read off (`this.items[0].show()`).
    for (const use of source.matchAll(
      new RegExp(
        String.raw`(?<=[\w$)\]]\s*)(?:\??\.\s*#?${escapeRegExp(fn.name)}(?![\w$])|(?:\?\.)?\[\s*(['"\x60])${escapeRegExp(fn.name)}\1\s*\])`,
        'g',
      ),
    )) {
      // From where what it is read off starts, as far as a name and the
      // steps after it go (`this.list.show`).
      const from = Math.max(0, use.index - 200);
      const receiver =
        /[A-Za-z_$][\w$]*(?:\s*\??\.\s*#?[A-Za-z_$][\w$]*)*\s*$/.exec(
          source.slice(from, use.index),
        );
      const at = open + (receiver ? from + receiver.index : use.index);
      if (
        body[use.index] !== source[use.index] ||
        functionsAround(text, depths, at).some((outer) =>
          unreferenced(text, outer),
        )
      ) {
        continue;
      }
      if (leaves(at, open + use.index + use[0].length)) return true;
    }
    return false;
  }
  // A constructor of a class this file keeps to itself runs only by each
  // `new View(...)` here.
  if (fn.ownerClass && fn.name === 'constructor') {
    const built = constructions(text, fn.ownerClass);
    if (!built) return true;
    return built.some(
      ([at, end]) =>
        !functionsAround(text, depths, at).some((outer) =>
          unreferenced(text, outer),
        ) && leaves(at, end),
    );
  }
  // One without a name that is called where it is written (`(function
  // (html) { ... })('<p>')`) runs only by that call.
  const invoked =
    !fn.name || /^(?:function|async)$/.test(fn.name)
      ? immediateCall(text, fn)
      : undefined;
  if (invoked) return leaves(...invoked);
  if (
    !fn.name ||
    /^(?:function|async)$/.test(fn.name) ||
    fn.ownerClass ||
    fn.ownerExported ||
    calledElsewhere(text, fn) ||
    fn.declared === undefined ||
    namedExpression(text, fn.declared) ||
    /\bexport\b[^;{}]*$/.test(
      text.slice(Math.max(0, fn.declared - 60), fn.declared),
    )
  ) {
    return true;
  }
  // Only code refers to it: not a string that spells its name, nor a
  // property of that name (`{ show: 1 }`).
  const code = codeOnly(text);
  for (const use of text.matchAll(
    new RegExp(referenceTo({ ...fn, name: fn.name }), 'g'),
  )) {
    if (
      use.index === fn.declared ||
      signature(text, use.index, use.index + use[0].length)
    ) {
      continue;
    }
    if (code[use.index] !== text[use.index]) continue;
    // `typeof show`, in a type or not, neither calls it nor hands it on,
    // and nor does reading its `length`.
    if (/\btypeof\s*$/.test(code.slice(0, use.index))) continue;
    if (inspectedAt(text, use.index + use[0].length)) continue;
    if (intrinsicTag(text, use.index, fn.name)) continue;
    if (writtenAt(text, use.index + use[0].length)) continue;
    if (!refersTo(text, depths, fn, use.index)) continue;
    if (
      /[{,]\s*$/.test(code.slice(0, use.index)) &&
      /^\s*:/.test(code.slice(use.index + use[0].length))
    ) {
      continue;
    }
    // A call in a function that never runs passes nothing. One inside
    // `fn` itself runs whenever `fn` does, so it counts like any other.
    if (
      functionsAround(text, depths, use.index).some((outer) =>
        unreferenced(text, outer),
      )
    ) {
      continue;
    }
    if (leaves(use.index, use.index + use[0].length)) return true;
  }
  return false;
}

/**
 * Each `new View(` of a class this file declares and keeps to itself, as
 * where its name starts and ends; `undefined` when the class is exported,
 * has no name, or is used any other way (`extends View`, handed on).
 */
function constructions(
  text: string,
  ownerClass: NonNullable<FunctionBody['ownerClass']>,
): [number, number][] | undefined {
  const { name, at } = ownerClass;
  if (
    !name ||
    /\bexport\b[^;{}]*$/.test(text.slice(Math.max(0, at - 60), at))
  ) {
    return undefined;
  }
  const code = codeOnly(text);
  const found: [number, number][] = [];
  for (const use of code.matchAll(
    new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`, 'g'),
  )) {
    const before = code.slice(Math.max(0, use.index - 12), use.index);
    if (/\bclass\s+$/.test(before)) continue;
    if (!/\bnew\s+$/.test(before)) return undefined;
    found.push([use.index, use.index + use[0].length]);
  }
  return found;
}

/**
 * Whether a value written out at `at` is certainly not `undefined`, so it
 * never lets a default through: a literal as a whole (a string, a number,
 * `true`, `false`, `null`, an object, an array, JSX), a function, a `new`
 * object, a string with more added to it, or a name whose declaration in
 * scope there is a `const` holding one of those. Anything else (another
 * name, a member, a call, `[][0]`) may be `undefined`.
 */
function definitelyDefined(
  text: string,
  depths: number[],
  value: string,
  at: number,
  depth = 0,
): boolean {
  value = unwrapped(value);
  // `{ value: undefined }` is still an object; only then may what it
  // names (`ready ? html : undefined`) leave the value `undefined`.
  if (wholeLiteral(value)) return true;
  // A conditional is defined when each of its branches is.
  const branches = conditionalBranches(codeOnly(value));
  if (branches && depth <= 3) {
    return branches.every(([from, to]) =>
      definitelyDefined(
        text,
        depths,
        value.slice(from, to).trim(),
        at,
        depth + 1,
      ),
    );
  }
  // `maybe ?? '<p>safe</p>'` is defined when what it falls back to is.
  const fallback = fallbackOperand(codeOnly(value));
  if (fallback !== undefined) {
    return definitelyDefined(
      text,
      depths,
      value.slice(fallback).trim(),
      at,
      depth + 1,
    );
  }
  if (mayBeUndefined(value)) return false;
  const name = /^[A-Za-z_$][\w$]*$/.exec(value)?.[0];
  if (!name || depth > 3) return false;
  const from = visibleConst(text, depths, name, at);
  if (from === undefined) return false;
  const initial = text
    .slice(from, expressionEnd(text, from, { commas: true }))
    .trim();
  return definitelyDefined(text, depths, initial, from, depth + 1);
}

/**
 * `value` without what leaves it as it is when it runs: brackets around
 * it (of a sequence in them, the last), and TypeScript's `as T`,
 * `satisfies T`, `<T>` and `!`.
 */
function unwrapped(value: string): string {
  for (;;) {
    const code = codeOnly(value);
    const typed = /\s(?:as|satisfies)\s+[^()]*$/.exec(code);
    // `<Options>{ ... }`, not an element (`<b>{html}</b>`).
    const cast = /^<[^<>]*(?:<[^<>]*>[^<>]*)*>(?![\s\S]*>\s*$)/.exec(code);
    const next = typed
      ? value.slice(0, typed.index).trim()
      : cast
        ? value.slice(cast[0].length).trim()
        : code.endsWith('!')
          ? value.slice(0, -1).trim()
          : code.startsWith('(') && bracketEnd(code, 0) === code.length - 1
            ? value.slice(lastOperand(value, 0, value.length - 1), -1).trim()
            : value;
    if (next === value) return value;
    value = next;
  }
}

/**
 * The key an entry of an object written out starts with (`hero`, `'hero'`,
 * `0` or `['hero']`, past `get`, `set`, `async` or `*` before a method's)
 * and where it ends in `entry`; `null` for a computed key that may be any
 * (`[key]`). `accessor` is `get` or `set` for an accessor's.
 */
function entryKey(
  entry: string,
): { key: string; end: number; accessor?: string } | null | undefined {
  const match =
    /^\s*(?:(get|set|async)\s+|\*\s*)?(?:(['"])([^'"]*)\2|([A-Za-z_$][\w$]*|\d+)|\[\s*(['"`])([^'"`$]*)\5\s*\])/.exec(
      entry,
    );
  if (match) {
    return {
      key: pathKey((match[3] ?? match[4] ?? match[6])!),
      end: match[0].length,
      ...(match[1] === 'get' || match[1] === 'set'
        ? { accessor: match[1] }
        : {}),
    };
  }
  return /^\s*\[/.test(entry) ? null : undefined;
}

/**
 * Whether the object or array written out at `from` certainly lacks part
 * `key`: no entry writes it and no spread may bring it.
 */
function lacksPart(text: string, from: number, key: string): boolean {
  const open = /^\s*([{[])/.exec(text.slice(from));
  if (!open) return false;
  const start = from + open[0].length;
  const array = open[1] === '[';
  for (let position = 0; ; position++) {
    const entry = nthArgument(text, start, position);
    if (!entry) return true;
    const value = text.slice(entry.from, entry.end);
    if (/^\s*\.\.\./.test(value)) return false;
    if (array) {
      if (`${position}` === key) return false;
      continue;
    }
    const written = entryKey(value);
    if (written === null) return false;
    if (
      written?.key === key &&
      /^\s*(?:[:(]|$)/.test(value.slice(written.end))
    ) {
      return false;
    }
  }
}

/**
 * Where the value of part `key` starts in the object or array written out
 * at `from`, when it is written there and no spread after it may replace
 * it.
 */
function partAt(text: string, from: number, key: string): number | undefined {
  const open = /^\s*([{[])/.exec(text.slice(from));
  if (!open) return undefined;
  const start = from + open[0].length;
  const array = open[1] === '[';
  let found: number | undefined;
  for (let position = 0; ; position++) {
    const entry = nthArgument(text, start, position);
    if (!entry) return found;
    const value = text.slice(entry.from, entry.end);
    if (/^\s*\.\.\./.test(value)) {
      if (array) return undefined;
      found = undefined;
      continue;
    }
    if (array) {
      if (`${position}` === key) {
        return entry.from + value.length - value.trimStart().length;
      }
      continue;
    }
    const written = entryKey(value);
    if (written === null) {
      found = undefined;
      continue;
    }
    const colon =
      written?.key === key ? /^\s*:\s*/.exec(value.slice(written.end)) : null;
    if (colon) found = entry.from + written!.end + colon[0].length;
  }
}

/**
 * Where the value of `name` starts, as seen at `at`, when the declaration
 * visible there is a `const`: the nearest before `at` whose block encloses
 * it, or else one at the module's top level. A parameter of that name
 * around `at` hides both, and a `let` or `var` may change.
 */
function visibleConst(
  text: string,
  depths: number[],
  name: string,
  at: number,
  // When its properties are what is read: a `const` object whose parts
  // are written, deleted or assigned over anywhere may not hold them.
  properties = false,
): number | undefined {
  let visible: RegExpMatchArray | undefined;
  for (const declaration of text.matchAll(
    new RegExp(
      String.raw`\b(const|let|var)\s+${escapeRegExp(name)}(?![\w$])\s*(?::(?:[^=;]|=>)+)?=(?![=>])\s*`,
      'g',
    ),
  )) {
    if (declaration.index < at) {
      if (encloses(depths, declaration.index, at)) visible = declaration;
    } else if (!visible && depths[declaration.index] === 0) {
      visible = declaration;
    }
  }
  if (!visible || visible[1] !== 'const') return undefined;
  const shadow = shadowingFunction(text, depths, name, at);
  if (
    shadow !== undefined &&
    outsideBody(text, depths, shadow, visible.index!)
  ) {
    return undefined;
  }
  const declared = visible.index!;
  // A use of the name that another binding of it holds (a parameter, its
  // list included, or a declaration nearer the use) says nothing about
  // this one.
  const ours = (use: number) => boundTo(text, depths, name, declared, use);
  const code = codeOnly(text);
  if (
    properties &&
    [
      ...code.matchAll(
        new RegExp(
          String.raw`(?<![\w$.])${escapeRegExp(name)}\s*(?:\?\.)?(?:\.\s*[\w$]+|\[[^\]]*\])+\s*(?:[-+*/%&|^]|\?\?|\|\||&&|<<|>>>?|\*\*)?=(?!=)|\bdelete\s+${escapeRegExp(name)}\s*[.[]|\bObject\.(?:assign|defineProperty|defineProperties)\(\s*${escapeRegExp(name)}(?![\w$])`,
          'g',
        ),
      ),
    ].some((use) =>
      // Where the name itself is in what matched (`delete opts.x`).
      ours(
        use.index +
          use[0].search(new RegExp(`(?<![\\w$.])${escapeRegExp(name)}`)),
      ),
    )
  ) {
    return undefined;
  }
  // Nor one handed on anywhere but here (`clear(opts)`, `[opts]`), which
  // other code may write to.
  if (
    properties &&
    [
      ...code.matchAll(
        new RegExp(
          String.raw`(?<![\w$.])${escapeRegExp(name)}(?![\w$])(?!\s*(?:\??\.|\[|=(?!=)|:|[=!]==?|[<>]=?))`,
          'g',
        ),
      ),
    ].some(
      (use) =>
        (use.index < at || text.slice(at, use.index).trim() !== '') &&
        !/(?:\b(?:const|let|var|typeof)|\}\s*=(?:\s*\()*)\s*$/.test(
          text.slice(Math.max(0, use.index - 12), use.index),
        ) &&
        ours(use.index),
    )
  ) {
    return undefined;
  }
  return declared + visible[0].length;
}

/**
 * Whether `name` written at `use` is the one declared at `declared`: not
 * a parameter (its list included) of a function the declaration is not
 * in, nor a declaration nearer the use.
 */
function boundTo(
  text: string,
  depths: number[],
  name: string,
  declared: number,
  use: number,
): boolean {
  const around = shadowingFunction(text, depths, name, use);
  if (around !== undefined && outsideBody(text, depths, around, declared)) {
    return false;
  }
  return ![
    ...text.matchAll(
      new RegExp(
        String.raw`\b(?:const|let|var)\s+${escapeRegExp(name)}(?![\w$])`,
        'g',
      ),
    ),
  ].some(
    (other) =>
      other.index !== declared &&
      other.index < use &&
      encloses(depths, other.index, use) &&
      depths[other.index]! > depths[declared]!,
  );
}

/**
 * Whether `value` is a literal from its first character to its last, not
 * one that something after it reads from (`[][0]`, `{}.hero`). A string
 * that more is added to (`'<p>' + name`) is still a string.
 */
function wholeLiteral(value: string): boolean {
  if (/^-?(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:e[+-]?\d+)?n?$/i.test(value)) {
    return true;
  }
  if (/^(?:true|false|null)$/.test(value)) return true;
  // An arrow function: all that follows `=>` is its body.
  if (/^(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
    return true;
  }
  if (value.startsWith('<')) return value.endsWith('>');
  // A regular expression (`/{/g`) is an object.
  if (value.startsWith('/')) return regexEnd(value, 0) === value.length;
  let close: number | undefined;
  const first = value[0];
  if (first === '"' || first === "'") close = quoteEnd(value, 0);
  else if (first === '`') close = templateEnd(value, 0);
  else if (first === '[' || first === '{') close = bracketEnd(value, 0);
  else if (/^(?:async\s+)?function\b/.test(value)) {
    close = bracketEnd(value, value.indexOf('{'));
  } else {
    const made = /^new\s+[A-Za-z_$][\w$.]*\s*/.exec(value);
    if (!made) return false;
    close =
      value[made[0].length] === '('
        ? bracketEnd(value, made[0].length)
        : made[0].trimEnd().length - 1;
  }
  if (close === undefined) return false;
  const rest = value.slice(close + 1).trim();
  if (rest === '') return true;
  return /^['"`]/.test(value) && rest.startsWith('+');
}

/** The bracket that closes the one opened at `open` in `value`, if any. */
function bracketEnd(value: string, open: number): number | undefined {
  if (open < 0) return undefined;
  let depth = 0;
  for (let at = open; at < value.length; at++) {
    const char = value[at]!;
    if (char === '"' || char === "'" || char === '`') {
      const close = char === '`' ? templateEnd(value, at) : quoteEnd(value, at);
      if (close === undefined) return undefined;
      at = close;
      continue;
    }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char) && --depth === 0) return at;
  }
  return undefined;
}

/**
 * Whether a method may be called under a name this file does not tie to
 * it: its object is handed on as a value (`register(view)`, `[view]`),
 * or the method is taken out of it (`const { render } = view`).
 */
function calledElsewhere(text: string, fn: FunctionBody): boolean {
  if (fn.owner === undefined || !fn.name) return false;
  const code = codeOnly(text);
  // A use of the owner's name that another binding holds is not of it.
  // A named owner is always one declared (`const view = {`).
  const ours = (use: number) =>
    boundTo(text, depthsOf(text), fn.owner!, fn.ownerDeclared!, use);
  // A key worked out when it runs (`view[action]()`) may name any method.
  if (
    typeof fn.owner === 'string' &&
    [
      ...code.matchAll(
        new RegExp(
          String.raw`(?<![\w$.])(?:${escapeRegExp(fn.owner)}|this)\s*(?:\?\.)?\[(?!\s*['"\`\d\]])`,
          'g',
        ),
      ),
    ].some(
      (use) =>
        (code.startsWith('this', use.index) || ours(use.index)) &&
        runs(text, use.index),
    )
  ) {
    return true;
  }
  if (
    typeof fn.owner === 'string' &&
    [
      ...code.matchAll(
        new RegExp(
          String.raw`(?<![\w$.])${escapeRegExp(fn.owner)}(?![\w$])(?!\s*(?:\??\.|\[|=(?!=)|:))`,
          'g',
        ),
      ),
    ].some(
      (use) =>
        // Its declaration, and a pattern read out of it, are not.
        !/(?:\b(?:const|let|var)|\}\s*=)\s*$/.test(
          text.slice(Math.max(0, use.index - 12), use.index),
        ) &&
        ours(use.index) &&
        runs(text, use.index),
    )
  ) {
    return true;
  }
  return [
    ...code.matchAll(
      new RegExp(
        String.raw`\{[^{}]*(?<![\w$.])${escapeRegExp(fn.name)}(?![\w$])[^{}]*\}\s*=\s*${
          fn.owner === null
            ? ''
            : String.raw`(?:${escapeRegExp(fn.owner)}|this)(?![\w$])`
        }`,
        'g',
      ),
    ),
  ].some((pattern) => runs(text, pattern.index));
}

/**
 * Whether the name of `fn` written at `at` is `fn`: not another
 * declaration of that name, and not inside a block or function that
 * declares its own (`function outer() { function show() {} show(); }`).
 * A method is reached through its owner, so it is when that is the
 * owner's own binding.
 */
function refersTo(
  text: string,
  depths: number[],
  fn: FunctionBody,
  at: number,
): boolean {
  // A method is reached through its owner: the one declared where it
  // is, not another binding of that name (`this` is always it).
  if (fn.owner !== undefined) {
    return (
      !overwrittenBefore(text, fn, at) &&
      (typeof fn.owner !== 'string' ||
        fn.ownerDeclared === undefined ||
        text.startsWith('this', at) ||
        boundTo(text, depths, fn.owner, fn.ownerDeclared, at))
    );
  }
  if (!fn.name || fn.declared === undefined) return true;
  const name = escapeRegExp(fn.name);
  // A block that encloses both `from` and `to` from the depth at `from`.
  const within = (from: number, to: number) => {
    const depth = depths[from]!;
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
      if (depths[index]! < depth) return false;
    }
    return true;
  };
  // `fn` itself must be in scope here: a function declared inside another
  // one is not seen by a sibling.
  if (!within(fn.declared, at)) return false;
  for (const other of text.matchAll(
    new RegExp(
      String.raw`\b(?:function\s*\*?\s*|(?:const|let|var|class)\s+)(${name})(?![\w$])`,
      'g',
    ),
  )) {
    const declared = other.index + other[0].length - fn.name.length;
    if (declared === fn.declared) continue;
    // Another declaration visible here, nearer than `fn`'s, hides it.
    if (depths[declared]! > depths[fn.declared]! && within(declared, at)) {
      return false;
    }
  }
  // So does a name a destructuring pattern binds (`const { show } =
  // handlers`), by where its declaration starts.
  for (const declaration of codeOnly(text).matchAll(
    /\b(?:const|let|var)\s*(?=[{[])/g,
  )) {
    if (
      depths[declaration.index]! <= depths[fn.declared]! ||
      !within(declaration.index, at)
    ) {
      continue;
    }
    let binds = false;
    patternBindings(
      text,
      declaration.index + declaration[0].length,
      0,
      [],
      (bound) => {
        binds ||= bound.name === fn.name;
      },
    );
    if (binds) return false;
  }
  // A parameter of that name, in a function `fn` is declared outside of.
  const shadow = shadowingFunction(text, depths, fn.name, at);
  return (
    shadow === undefined || !outsideBody(text, depths, shadow, fn.declared)
  );
}

/** The defaults of the patterns above `parameter`, placed in the text. */
function parentDefaultsAt(
  fn: FunctionBody,
  parameter: { parentDefaults?: Record<string, number> },
): Record<string, number> {
  const placed: Record<string, number> = {};
  for (const [path, offset] of Object.entries(parameter.parentDefaults ?? {})) {
    placed[path] = (fn.paramsAt ?? 0) + offset;
  }
  return placed;
}

/**
 * Whether a value written out may be `undefined`, which lets a default
 * through: nothing, `undefined`, `void 0`, or anything that names
 * `undefined` (`ready ? html : undefined`).
 */
function mayBeUndefined(value: string): boolean {
  return (
    value === '' ||
    /^void\b/.test(value) ||
    /(?<![\w$.])undefined(?![\w$])/.test(codeOnly(value))
  );
}

/**
 * Whether the method `fn` of an object held by a name is set to something
 * else before `at` (`view.show = () => {}`), so what is called there by
 * that name is not `fn`.
 */
function overwrittenBefore(
  text: string,
  fn: FunctionBody,
  at: number,
): boolean {
  if (typeof fn.owner !== 'string' || !fn.name) return false;
  const name = escapeRegExp(fn.name);
  // Only a write that runs: not one in a function nothing calls.
  return [
    ...text
      .slice(0, at)
      .matchAll(
        new RegExp(
          String.raw`(?<![\w$.])${escapeRegExp(fn.owner)}\s*(?:\??\.\s*${name}(?![\w$])|\[\s*(['"\x60])${name}\1\s*\])\s*=(?![=>])`,
          'g',
        ),
      ),
  ].some((write) => runs(text, write.index));
}

/** Whether code at `at` may run: no function it is in is one nothing calls. */
function runs(text: string, at: number): boolean {
  return !functionsAround(text, depthsOf(text), at).some((outer) =>
    unreferenced(text, outer),
  );
}

/**
 * Whether what is named up to `end` is set there (`view.show = ...`),
 * which neither calls it nor hands it on.
 */
function writtenAt(text: string, end: number): boolean {
  return /^\s*=(?![=>])/.test(text.slice(end));
}

/**
 * Whether `name` at `at` is the tag of an element that is no component:
 * a lowercase one (`<show />`, `</show>`) is an element of the page.
 */
function intrinsicTag(text: string, at: number, name: string): boolean {
  return (
    /^[a-z]/.test(name) && /<\/?\s*$/.test(text.slice(Math.max(0, at - 3), at))
  );
}

/**
 * Where the value written at `at` starts: past a type asserted before it
 * (`<Options>`), and inside brackets that only group it, with nothing
 * after them but what keeps its value (`({ ... }) as Options`), at the
 * last of a sequence there.
 */
function valueStart(text: string, at: number): number {
  for (;;) {
    at += /^\s*/.exec(text.slice(at))![0].length;
    const cast = /^<[^<>]*(?:<[^<>]*>[^<>]*)*>/.exec(text.slice(at, at + 200));
    if (cast) {
      at += cast[0].length;
      continue;
    }
    const close = text[at] === '(' ? bracketEnd(text, at) : undefined;
    if (
      close === undefined ||
      !/^(?:\s*!|\s+(?:as|satisfies)\b[\s\S]*)?\s*$/.test(
        codeOnly(
          text.slice(close + 1, expressionEnd(text, at, { commas: true })),
        ),
      )
    ) {
      return at;
    }
    at = lastOperand(text, at, close);
  }
}

/**
 * Whether the object or array written out at `from` holds `key` (a
 * property name, or an element's index) for certain, so a default for that
 * part is never used. A hole or `undefined` leaves it out; a spread before
 * an element, or after a property, may; and anything not written out here
 * may.
 */
function suppliesPart(
  text: string,
  depths: number[],
  from: number,
  key: string,
  depth = 0,
  // Where the patterns in between have defaults of their own, by path
  // (`nested`). Destructuring a part that is `null`, or missing with no
  // such default, throws before any default under it is used.
  parentDefaults?: Record<string, number>,
  prefix = '',
): boolean {
  from = valueStart(text, from);
  // A conditional holds the part when each of its branches does, read
  // within its own bounds: a value written out, a `const`, or another
  // conditional.
  const holds = (at: number, to: number): boolean => {
    const code = codeOnly(text.slice(at, to));
    const branches = conditionalBranches(code);
    if (branches) return branches.every(([f, t]) => holds(at + f, at + t));
    const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(code)?.[1];
    if (!name) {
      return suppliesPart(text, depths, at, key, depth, parentDefaults, prefix);
    }
    const value =
      depth < 3 ? visibleConst(text, depths, name, at, true) : undefined;
    return (
      value !== undefined &&
      suppliesPart(text, depths, value, key, depth + 1, parentDefaults, prefix)
    );
  };
  const whole = expressionEnd(text, from, { commas: true });
  if (conditionalBranches(codeOnly(text.slice(from, whole)))) {
    return holds(from, whole);
  }
  // `nested.markup`: the part at `nested`, then `markup` of that.
  const dot = key.indexOf('.');
  if (dot !== -1) {
    const first = key.slice(0, dot);
    const path = prefix ? `${prefix}.${first}` : first;
    const next = (at: number) =>
      suppliesPart(
        text,
        depths,
        at,
        key.slice(dot + 1),
        depth,
        parentDefaults,
        path,
      );
    const inner = partAt(text, from, first);
    const value =
      inner === undefined
        ? undefined
        : text
            .slice(inner, expressionEnd(text, inner, { commas: true }))
            .trim();
    if (value === 'null') return parentDefaults !== undefined;
    const missing =
      inner === undefined
        ? lacksPart(text, from, first)
        : value === 'undefined';
    if (missing) {
      if (parentDefaults === undefined) return false;
      const fallback = parentDefaults[path];
      return fallback === undefined ? true : next(fallback);
    }
    return inner !== undefined && next(inner);
  }
  const open = /^\s*([{[])/.exec(text.slice(from));
  if (!open) {
    // `show(opts)` with `const opts = { markup: ... }` in scope.
    const name = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(
      text.slice(from, expressionEnd(text, from, { commas: true })),
    )?.[1];
    const value =
      name && depth < 3
        ? visibleConst(text, depths, name, from, true)
        : undefined;
    return (
      value !== undefined && suppliesPart(text, depths, value, key, depth + 1)
    );
  }
  const start = from + open[0].length;
  const array = open[1] === '[';
  let supplied = false;
  for (let position = 0; ; position++) {
    const entry = nthArgument(text, start, position);
    if (!entry) return supplied;
    const value = text.slice(entry.from, entry.end).trim();
    if (array) {
      // A spread renumbers every element after it.
      if (value.startsWith('...')) return false;
      if (`${position}` === key) {
        return definitelyDefined(text, depths, value, entry.from);
      }
      continue;
    }
    // A later spread may replace the property with anything.
    if (value.startsWith('...')) {
      supplied = false;
      continue;
    }
    // A computed key that may be any may replace it with anything.
    const written = entryKey(value);
    if (written === null) {
      supplied = false;
      continue;
    }
    if (written?.key !== key) continue;
    const property = /^\s*(?:([:(])\s*([\s\S]*))?$/.exec(
      value.slice(written.end),
    );
    if (!property) continue;
    // `{ markup }` is the binding `markup`; `markup() {}` a method, and
    // `get markup() { return ... }` what it returns.
    supplied =
      written.accessor !== undefined
        ? getterDefined(
            text,
            depths,
            entry.from + written.end,
            written.accessor,
          )
        : property[1] === '('
          ? true
          : definitelyDefined(
              text,
              depths,
              property[1] === ':' ? property[2]!.trim() : key,
              entry.from,
            );
  }
}

/**
 * Whether the accessor whose parameters start at `at` gives a value that
 * is defined: a getter whose body only returns one (`get html() { return
 * '<p>safe</p>'; }`). A setter alone gives nothing.
 */
function getterDefined(
  text: string,
  depths: number[],
  at: number,
  accessor: string,
): boolean {
  if (accessor !== 'get') return false;
  const code = codeOnly(text);
  const brace = code.indexOf('{', bracketEnd(code, code.indexOf('(', at)));
  const close = bracketEnd(code, brace);
  // Its value on the line of the `return`: past a line end (`\n`, `\r`,
  // U+2028, U+2029), a bare `return` gives `undefined`.
  const lead = /^\s*return\b[^\S\n\r\u2028\u2029]*(?=[^\s;])/.exec(
    code.slice(brace + 1, close),
  );
  if (!lead) return false;
  const from = brace + 1 + lead[0].length;
  const to = expressionEnd(code, from, { commas: false });
  // The whole body, however its value nests (`return { safe: true };`).
  return (
    /^\s*;?\s*$/.test(code.slice(to, close)) &&
    definitelyDefined(text, depths, code.slice(from, to).trim(), from)
  );
}

/** The names in a parameter list: `(a, { b }, c = 1, ...d)` gives a, b, c, d. */
function parameterNames(params: string): string[] {
  return parameterBindings(params).map((binding) => binding.name);
}

/** The `position`th argument of the call whose `(` ends just before `from`. */
function nthArgument(
  text: string,
  from: number,
  position: number,
): { from: number; end: number } | undefined {
  let start = from;
  let index = 0;
  let depth = 0;
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === '"' || char === "'" || char === '`') {
      const close = char === '`' ? templateEnd(text, at) : quoteEnd(text, at);
      if (close !== undefined) at = close;
      continue;
    }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) {
      if (depth === 0) {
        return index === position && at > start
          ? { from: start, end: at }
          : undefined;
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      if (index === position) return { from: start, end: at };
      index += 1;
      start = at + 1;
    }
  }
  return undefined;
}

/**
 * The expressions a function declared in `text` as `name` returns: each
 * `return` in its own body, not a nested function's, or a concise arrow's
 * body.
 */
function returnedExpressions(
  text: string,
  depths: number[],
  name: string,
  awaited = false,
): { from: number; end: number }[] {
  const escaped = escapeRegExp(name);
  return returnedFrom(
    text,
    depths,
    new RegExp(
      `\\bfunction\\s*\\*?\\s*${escaped}${typeArguments}\\s*\\(|\\b(?:const|let|var)\\s+${escaped}\\s*(?::(?:[^=;]|=>)+)?=\\s*(?:async\\s*)?(?:function\\b[^(]*\\(|${typeArguments}\\s*(?=\\(|[A-Za-z_$][\\w$]*\\s*=>))`,
    ).exec(text),
    awaited,
  );
}

/**
 * Whether the call whose callee starts at `at` in the expression `code`
 * is awaited: `await make()`, `(await make()).hero`, `await (make())`, or
 * inside what is awaited (`await Promise.resolve(make())`).
 */
function awaitedAt(code: string, at: number): boolean {
  return [...code.slice(0, at).matchAll(/\bawait\s+(?:new\s+)?/g)].some(
    (awaited) => operandEnd(code, awaited.index + awaited[0].length) > at,
  );
}

/**
 * Where the operand of a prefix operator that starts at `from` ends: a
 * name or a bracket, and the members, calls and `!` after it (`await
 * view.make<T>()`, `await (a, make())`), not what a comma or an operator
 * adds (`await safe(), make()`).
 */
function operandEnd(code: string, from: number): number {
  let at = from + (/^[\w$#]+/.exec(code.slice(from))?.[0].length ?? 0);
  for (;;) {
    const step =
      /^\s*(?:(?:\?\.\s*)?(?:<[^<>()=]*>\s*)?[([]|\??\.\s*#?[\w$]+|!)/.exec(
        code.slice(at),
      );
    if (!step) return at;
    at += step[0].length;
    if ('(['.includes(step[0].at(-1)!)) {
      at = (bracketEnd(code, at - 1) ?? code.length) + 1;
    }
  }
}

/**
 * What the helper this file exports as `exported` returns, by the name it
 * is declared under here: `export { make as render }` is `make`, and
 * `default` is whatever `export default` names or declares.
 */
function exportedReturns(
  text: string,
  depths: number[],
  exported: string,
  awaited: boolean,
): { from: number; end: number }[] {
  if (exported === 'default') {
    const named =
      /\bexport\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(
        text,
      )?.[1] ??
      /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|$)/m.exec(text)?.[1];
    if (named) return returnedExpressions(text, depths, named, awaited);
    return returnedFrom(
      text,
      depths,
      new RegExp(
        String.raw`\bexport\s+default\s+(?:async\s*)?(?:function\s*\*?\s*\(|${typeArguments}\s*(?=\(|[A-Za-z_$][\w$]*\s*=>))`,
      ).exec(text),
      awaited,
    );
  }
  const local = new RegExp(
    `\\bexport\\s*\\{[^}]*?(?<![\\w$])([\\w$]+)\\s+as\\s+${escapeRegExp(exported)}(?![\\w$])`,
  ).exec(text)?.[1];
  return returnedExpressions(text, depths, local ?? exported, awaited);
}

/**
 * The expressions returned by the function whose header `declaration`
 * matched. Calling an async one gives a promise, which is what it returns
 * only once `awaited`; calling a generator gives an iterator.
 */
function returnedFrom(
  text: string,
  depths: number[],
  declaration: RegExpExecArray | null,
  awaited = false,
): { from: number; end: number }[] {
  if (!declaration) return [];
  const before = text.slice(0, declaration.index);
  if (
    (!awaited &&
      (/\basync\s*$/.test(before) || /\basync\b/.test(declaration[0]))) ||
    /\*\s*$/.test(before) ||
    /\bfunction\s*\*/.test(declaration[0])
  ) {
    return [];
  }
  let at = declaration.index + declaration[0].length;
  if (declaration[0].endsWith('(')) {
    // A `function`: past its parameters to the brace that opens its body.
    let depth = 1;
    while (at < text.length && depth > 0) {
      if (text[at] === '(') depth += 1;
      else if (text[at] === ')') depth -= 1;
      at += 1;
    }
  } else {
    const arrow = text.indexOf('=>', at);
    if (arrow === -1) return [];
    at = arrow + 2;
    while (/\s/.test(text[at] ?? '')) at += 1;
    if (text[at] !== '{') {
      return [{ from: at, end: expressionEnd(text, at, { commas: true }) }];
    }
  }
  const open = text.indexOf('{', at);
  if (open === -1) return [];
  const start = open + 1;
  let end = start;
  while (end < text.length && depths[end]! >= depths[start]!) end += 1;
  const expressions: { from: number; end: number }[] = [];
  for (const statement of text.slice(start, end).matchAll(/\breturn\b\s*/g)) {
    const index = start + statement.index;
    const innermost = functionsAround(text, depths, index).reduce(
      (latest, fn) => Math.max(latest, fn.start),
      -1,
    );
    if (innermost !== start) continue;
    const from = index + statement[0].length;
    expressions.push({
      from,
      end: expressionEnd(text, from, { commas: true }),
    });
  }
  return expressions;
}

/**
 * What the local helpers called in the expression at `from` return
 * (`{ html = make() }`), by `member` of it when the sink reads one.
 */
function calledReturns(
  text: string,
  depths: number[],
  from: number,
  member: string | undefined,
  follow: Follow,
): [number, number][] {
  const end = expressionEnd(text, from, { commas: true });
  const code = codeOnly(text.slice(from, end));
  const ranges: [number, number][] = [];
  for (const call of code.matchAll(
    new RegExp(String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)${CALL_OPEN}`, 'g'),
  )) {
    if (NOT_A_BINDING.has(call[1]!)) continue;
    // `templates().hero`: the part read of what it returns, then the part
    // the sink reads of that.
    const read = memberAfterCall(
      text.slice(from, end),
      call.index,
      call.index + call[0].length - 1,
    );
    const path = [read, member].filter(Boolean).join('.') || undefined;
    for (const returned of returnedExpressions(
      text,
      depths,
      call[1]!,
      awaitedAt(code, call.index),
    )) {
      ranges.push(
        ...(path === undefined
          ? topLevelLiterals(text, returned.from, returned.end)
          : renderedRange(text, depths, returned.from, path, follow)),
      );
    }
  }
  return ranges;
}

/**
 * The string and template literals at the top level of the expression in
 * `[from, end)`: `cond ? '<img>' : ''` has two; `html.replace('<img>',
 * '')` has none, since an argument is handed to a call, not returned.
 */
function topLevelLiterals(
  text: string,
  from: number,
  end: number,
): [number, number][] {
  const literals: [number, number][] = [];
  let depth = 0;
  for (let at = from; at < end; at += 1) {
    const char = text[at]!;
    if (char === '"' || char === "'" || char === '`') {
      const close = char === '`' ? templateEnd(text, at) : quoteEnd(text, at);
      if (close === undefined) continue;
      if (depth === 0) literals.push([at, close + 1]);
      at = close;
    } else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
  }
  return literals;
}

/** Words that read like names in an expression and are not bindings. */
const NOT_A_BINDING = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'new',
  'typeof',
  'void',
  'await',
  'this',
  'in',
  'of',
  'instanceof',
  'function',
  'class',
  'async',
  'yield',
]);

/**
 * `code` with the contents of its strings and template literals blanked
 * and what `${...}` holds kept, length for length.
 */
function codeOnly(code: string): string {
  let out = '';
  let quote: string | undefined;
  // For each open `${`, how many plain braces are open inside it.
  const holes: number[] = [];
  for (let at = 0; at < code.length; at++) {
    const char = code[at]!;
    if (quote) {
      if (char === '\\') {
        out += '  ';
        at++;
      } else if (quote === '`' && char === '$' && code[at + 1] === '{') {
        holes.push(0);
        quote = undefined;
        out += '  ';
        at++;
      } else if (char === quote) {
        quote = undefined;
        out += char;
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
    } else if (char === '{' && holes.length > 0) {
      holes[holes.length - 1]! += 1;
      out += char;
    } else if (char === '}' && holes.length > 0) {
      if (holes[holes.length - 1] === 0) {
        holes.pop();
        quote = '`';
        out += ' ';
      } else {
        holes[holes.length - 1]! -= 1;
        out += char;
      }
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * An entry for a call of a helper (`render()`, `await render().hero`), by
 * the `()` right after its name: one in a key read off an export
 * (`bundle.hero()x`) is no call.
 */
const CALL_ENTRY = /^(await )?([\w$]+)\(\)/;

/** `bundle.section.safe` as the name `bundle` and the path `section.safe`. */
function splitEntry(entry: string): [string, string | undefined] {
  const dot = entry.indexOf('.');
  return dot === -1
    ? [entry, undefined]
    : [entry.slice(0, dot), entry.slice(dot + 1)];
}

/** The project source file `specifier` names, imported from `from`. */
function resolveModule(
  sources: ProjectFileLike[],
  from: string,
  specifier: string,
  aliases: Alias[] = [],
): ProjectFileLike | undefined {
  if (!/^\.{1,2}\//.test(specifier)) {
    // A project alias, `@/components/card`: each place it may point, in
    // the order the project lists them. A package resolves to nothing.
    for (const [prefix, targets] of aliases) {
      if (!specifier.startsWith(prefix)) continue;
      for (const target of targets) {
        const found = resolveModule(
          sources,
          '',
          `./${normalizePath(`${target}/${specifier.slice(prefix.length)}`)}`,
        );
        if (found) return found;
      }
    }
    return undefined;
  }
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const stem = normalizePath(`${dir}/${specifier}`).replace(
    /\.(?:m|c)?js$/,
    '',
  );
  return sources.find((candidate) =>
    [
      stem,
      ...['', '/index'].flatMap((tail) =>
        ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].map(
          (ext) => `${stem}${tail}.${ext}`,
        ),
      ),
    ].includes(candidate.path),
  );
}

/** An import prefix and the project directories it stands for. */
type Alias = [prefix: string, targets: string[]];

/**
 * The import aliases a project configures: `compilerOptions.paths` in a
 * tsconfig or jsconfig (`"@/*": ["./src/*"]`, against its baseUrl), and a
 * Vite config's `alias` entries that name a directory. With none, the
 * `@/` the generated stack uses, to `src/` (internal PR 239 review).
 */
function projectAliases(files: ProjectFileLike[]): Alias[] {
  const aliases: Alias[] = [];
  for (const file of files) {
    if (!/(?:^|\/)(?:tsconfig[\w.-]*|jsconfig)\.json$/.test(file.path)) {
      continue;
    }
    let config: {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    try {
      config = JSON.parse(
        withoutScriptComments(file.content, { regex: false }).replace(
          /,(\s*[}\]])/g,
          '$1',
        ),
      ) as typeof config;
    } catch {
      continue;
    }
    const dir = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : '';
    const base = normalizePath(
      `${dir}/${config.compilerOptions?.baseUrl ?? '.'}`,
    );
    for (const [pattern, targets] of Object.entries(
      config.compilerOptions?.paths ?? {},
    )) {
      if (!Array.isArray(targets)) continue;
      aliases.push([
        pattern.replace(/\*$/, ''),
        targets
          .filter((target): target is string => typeof target === 'string')
          .map((target) =>
            normalizePath(`${base}/${target.replace(/\*$/, '')}`),
          ),
      ]);
    }
  }
  for (const file of files) {
    if (!/(?:^|\/)vite\.config\.[mc]?[jt]s$/.test(file.path)) continue;
    for (const entry of file.content.matchAll(
      /["']([@~#$][\w/-]*)["']\s*:\s*[^,}]{0,120}?["']\.?\/?([\w./-]+?)\/?["']/g,
    )) {
      aliases.push([
        entry[1]!.endsWith('/') ? entry[1]! : `${entry[1]!}/`,
        [normalizePath(entry[2]!)],
      ]);
    }
  }
  if (aliases.length === 0) aliases.push(['@/', ['src']]);
  return aliases;
}

/**
 * Whether a `render(` or `hydrateRoot(` at `at` is React's: hydrateRoot,
 * `ReactDOM.render`, a render imported from react-dom, or `.render` on
 * what `createRoot()` returns, directly or through the name it is bound
 * to. `renderer.render(scene, camera)` is not (internal PR 239 review).
 */
function reactRender(text: string, at: number, call: string): boolean {
  const before = text.slice(Math.max(0, at - 400), at);
  if (/\bReactDOM\s*\.\s*$/.test(before)) return true;
  // hydrateRoot and createRoot as react-dom exports them, not a helper of
  // the file's own by that name (internal PR 239 review).
  if (call.startsWith('hydrateRoot')) {
    return !/\.\s*$/.test(before) && fromReactDom(text, 'hydrateRoot');
  }
  const receiver = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before);
  if (receiver) {
    return (
      !declaresOwn(text, 'createRoot') &&
      new RegExp(
        `\\b(?:const|let|var)\\s+${escapeRegExp(receiver[1]!)}\\s*=\\s*(?:ReactDOM\\s*\\.\\s*)?createRoot\\s*\\(`,
      ).test(text)
    );
  }
  const chained = /\)\s*\.\s*$/.exec(before);
  if (chained) {
    let depth = 0;
    for (let i = before.length - chained[0].length; i >= 0; i -= 1) {
      const char = before[i];
      if (char === ')') depth += 1;
      else if (char === '(') {
        depth -= 1;
        if (depth === 0) {
          const callee = /(\bReactDOM\s*\.\s*)?\bcreateRoot\s*$/.exec(
            before.slice(0, i),
          );
          return (
            callee !== null &&
            (callee[1] !== undefined || !declaresOwn(text, 'createRoot'))
          );
        }
      }
    }
    return false;
  }
  if (/\.\s*$/.test(before)) return false;
  return /\bimport\s*\{[^}]*\brender\b[^}]*\}\s*from\s*["']react-dom["']/.test(
    text,
  );
}

/**
 * Whether a root render's argument, from its opening parenthesis, is an
 * element named `local` inside nothing but other elements' opening and
 * closing tags: its ancestors, with no sibling beside it. hydrateRoot's
 * container argument comes first.
 */
function wrapsArgument(argument: string, local: string): boolean {
  for (const found of argument.matchAll(
    new RegExp(`<${escapeRegExp(local)}(?![\\w$.])`, 'g'),
  )) {
    const end = jsxElementEnd(argument, found.index, local);
    if (end === -1) continue;
    let before = argument
      .slice(0, found.index)
      .replace(/^\(\s*(?:[^<]*?,\s*)?/, '');
    let ancestors = true;
    while ((before = before.trimStart()).length > 0) {
      if (!before.startsWith('<') || before.startsWith('</')) {
        ancestors = false;
        break;
      }
      const tag = readJsxTag(before, 0);
      if (/\/\s*>$/.test(tag) || !tag.endsWith('>')) {
        ancestors = false;
        break;
      }
      before = before.slice(tag.length);
    }
    if (
      ancestors &&
      /^(?:\s*<\/[\w$.]*\s*>)*\s*,?\s*\)?\s*$/.test(argument.slice(end))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where the element named `name` that opens at `start` ends, past its
 * closing tag, or -1.
 */
function jsxElementEnd(text: string, start: number, name: string): number {
  const opening = readJsxTag(text, start);
  if (!opening.endsWith('>')) return -1;
  if (/\/\s*>$/.test(opening)) return start + opening.length;
  let depth = 1;
  const tags = new RegExp(`<(\\/?)${escapeRegExp(name)}(?![\\w$.])`, 'g');
  tags.lastIndex = start + opening.length;
  for (let tag = tags.exec(text); tag; tag = tags.exec(text)) {
    if (tag[1]) {
      depth -= 1;
      if (depth === 0) {
        const close = text.indexOf('>', tag.index);
        return close === -1 ? -1 : close + 1;
      }
    } else if (!/\/\s*>$/.test(readJsxTag(text, tag.index))) {
      depth += 1;
    }
  }
  return -1;
}

/**
 * Whether a file binds `name` to react-dom's export of it, imported under
 * that name, and declares nothing of its own by that name.
 */
function fromReactDom(text: string, name: string): boolean {
  const local = escapeRegExp(name);
  return (
    !declaresOwn(text, name) &&
    new RegExp(
      `\\bimport\\s*\\{[^}]*(?<![\\w$])${local}(?![\\w$])(?!\\s+as\\b)[^}]*\\}\\s*from\\s*["']react-dom(?:/client)?["']`,
    ).test(text)
  );
}

/**
 * Whether a file declares a function, variable or parameter of its own
 * named `name`, which shadows any import of it.
 */
function declaresOwn(text: string, name: string): boolean {
  const local = escapeRegExp(name);
  // Not the import list itself: `import { a, hydrateRoot, b }` binds it.
  const code = text.replace(/\bimport\s[^;]*?\bfrom\s*["'][^"']+["']/g, '');
  return new RegExp(
    `\\b(?:function\\s+|(?:const|let|var)\\s+)${local}\\b|[(,]\\s*${local}\\s*[,)=:]`,
  ).test(code);
}

/** Where a value that is only another name goes next. */
type Follow = (name: string, member: string | undefined, at: number) => void;

/**
 * What a sink renders of the value that starts at `start`: all of it, or,
 * handed `member` of it (`bundle.safe`), that property alone when the
 * value is an object written out, and nothing when it has no such
 * property. A part that is only another name (`{ hero: markup }`, the
 * shorthand `{ markup }`, or a property a spread `{ ...base }` may bring)
 * renders nothing here and is handed to `follow` instead.
 */
function renderedRange(
  text: string,
  depths: number[],
  start: number,
  member: string | undefined,
  follow?: Follow,
  // Where the value ends, when that is before the expression does: one
  // branch of a conditional.
  until = Infinity,
): [number, number][] {
  const end = Math.min(expressionEnd(text, start, { commas: true }), until);
  const alias = new RegExp(
    String.raw`^\s*([A-Za-z_$][\w$]*)((?:${MEMBER_STEP})*)\s*$`,
  ).exec(text.slice(start, end));
  if (follow && alias && !NOT_A_BINDING.has(alias[1]!)) {
    follow(
      alias[1]!,
      [...chainPath(alias[2]!), member].filter(Boolean).join('.') || undefined,
      start + alias[0].indexOf(alias[1]!),
    );
    return [];
  }
  if (member === undefined) return [[start, end]];
  // Inside brackets that only group it, with only what keeps its value
  // after them (`({ hero })`, `({ hero }) as Views`), and each branch of a
  // conditional (`wide ? { hero } : { hero: '' }`).
  const code = codeOnly(text.slice(start, end));
  // Past a type asserted before it (`<Views>{ hero }`).
  const cast = /^\s*<[^<>]*(?:<[^<>]*>[^<>]*)*>/.exec(code);
  if (cast) {
    return renderedRange(
      text,
      depths,
      start + cast[0].length,
      member,
      follow,
      end,
    );
  }
  const group = /^\s*\(/.exec(code);
  const close = group && bracketEnd(code, group[0].length - 1);
  if (
    close != null &&
    /^(?:\s*!|\s+(?:as|satisfies)\b[\s\S]*)?\s*$/.test(code.slice(close + 1))
  ) {
    return renderedRange(
      text,
      depths,
      lastOperand(text, start + group![0].length - 1, start + close),
      member,
      follow,
    );
  }
  const branches = conditionalBranches(code);
  if (branches) {
    return branches.flatMap(([from, to]) =>
      renderedRange(text, depths, start + from, member, follow, start + to),
    );
  }
  const dot = member.indexOf('.');
  const first = dot === -1 ? member : member.slice(0, dot);
  const rest = dot === -1 ? undefined : member.slice(dot + 1);
  // `pages[1]`: that element of an array written out, unless a spread
  // before it leaves its position unknown.
  const list = /^\s*\[/.exec(text.slice(start, end));
  if (list && /^\d+$/.test(first)) {
    const inside = start + list[0].length;
    for (let position = 0; ; position++) {
      const element = nthArgument(text, inside, position);
      if (!element) return [];
      if (/^\s*\.\.\./.test(text.slice(element.from, element.end))) {
        return [[start, end]];
      }
      if (position === Number(first)) {
        return renderedRange(text, depths, element.from, rest, follow);
      }
    }
  }
  const open = /^\s*\{/.exec(text.slice(start, end));
  if (!open) return [[start, end]];
  // `section.safe`: one property at a time, as far as the objects are
  // written out. The last write of the property is what reaches the sink:
  // `hero: ...`, the shorthand `{ hero }` (the binding `hero`), and after
  // either, whatever a spread (`...base`, `...{ hero }`) may bring over it.
  const inside = start + open[0].length;
  const body = text.slice(inside, end);
  const key = escapeRegExp(first.replaceAll(KEY_DOT, '.'));
  const writes = [
    ...[
      ...body.matchAll(
        new RegExp(
          `(?<![\\w$.])(?:(["']?)${key}\\1|\\[\\s*(["'\x60])${key}\\2\\s*\\])\\s*:`,
          'g',
        ),
      ),
    ].map((match) => ({ kind: 'value' as const, match })),
    ...[
      ...body.matchAll(new RegExp(`(?<=(?:^|,)\\s*)${key}(?=\\s*[,}])`, 'g')),
    ].map((match) => ({ kind: 'shorthand' as const, match })),
    ...[...body.matchAll(/\.\.\.\s*/g)].map((match) => ({
      kind: 'spread' as const,
      match,
    })),
  ]
    .filter(({ match }) => depths[inside + match.index] === depths[inside])
    .sort((a, b) => a.match.index - b.match.index);
  let last = 0;
  for (const [at, write] of writes.entries()) {
    if (write.kind !== 'spread') last = at;
  }
  const ranges: [number, number][] = [];
  for (const { kind, match } of writes.slice(last)) {
    const at = inside + match.index + match[0].length;
    if (kind === 'value') {
      ranges.push(...renderedRange(text, depths, at, rest, follow));
    } else if (kind === 'shorthand') {
      follow?.(first, rest, inside + match.index);
    } else {
      ranges.push(...renderedRange(text, depths, at, member, follow));
    }
  }
  return ranges;
}

/**
 * Where the last operand inside the brackets that open at `open` and
 * close at `close` starts: past every comma of a sequence at their top
 * level (`({ a }, { b })` is `{ b }`), or just inside them.
 */
function lastOperand(text: string, open: number, close: number): number {
  const code = codeOnly(text.slice(open + 1, close));
  let depth = 0;
  let last = 0;
  for (let at = 0; at < code.length; at++) {
    const char = code[at]!;
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === ',' && depth === 0) last = at + 1;
  }
  return open + 1 + last;
}

/**
 * The two branches of a conditional that is all of `code` (`wide ? a :
 * b`), as ranges of it, past a condition that may hold `?.` and `??`.
 */
function conditionalBranches(code: string): [number, number][] | undefined {
  let depth = 0;
  let question: number | undefined;
  let nested = 0;
  for (let at = 0; at < code.length; at++) {
    const char = code[at]!;
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth !== 0) continue;
    else if (char === '?') {
      if (code[at + 1] === '?' || /^\.(?!\d)/.test(code.slice(at + 1))) {
        at++;
      } else if (question === undefined) {
        question = at;
      } else {
        nested++;
      }
    } else if (char === ':' && question !== undefined) {
      if (nested === 0) {
        return [
          [question + 1, at],
          [at + 1, code.length],
        ];
      }
      nested--;
    }
  }
  return undefined;
}

/**
 * Where the last operand of `??` or `||` that is all of `code` starts
 * (`maybe ?? '<p>safe</p>'`): what the value is when all before it are
 * `undefined`. `undefined` when `code` is no such fallback.
 */
function fallbackOperand(code: string): number | undefined {
  let depth = 0;
  let last: number | undefined;
  for (let at = 0; at < code.length; at++) {
    const char = code[at]!;
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth !== 0) continue;
    else if (/^(?:\?\?|\|\|)/.test(code.slice(at, at + 2))) last = at + 2;
    // An assignment (`html = maybe ?? ...`, `html ??= ...`) takes in all
    // of the rest.
    else if (/^=(?!=)/.test(code.slice(at, at + 2))) {
      if (!/[=!<>]/.test(code[at - 1] ?? '')) return undefined;
    }
  }
  return last;
}

/** One step of a static member chain: `.safe`, `?.safe`, `["safe"]` or `[0]`. */
const MEMBER_STEP = String.raw`(?:\s*\??\.\s*[A-Za-z_$][\w$]*|\s*(?:\?\.\s*)?\[\s*(?:"[^"\\\n]*"|'[^'\\\n]*'|\x60[^\x60\\\n$]*\x60|\d+)\s*\])`;

/**
 * The properties a static member chain (`.section["safe"][0]`,
 * `['hero-image']`) walks.
 */
function chainPath(chain: string): string[] {
  return [
    ...chain.matchAll(
      /\.\s*([A-Za-z_$][\w$]*)|\[\s*(?:(["'`])(.*?)\2|(\d+))\s*\]/g,
    ),
  ].map(
    (part) => part[1] ?? (part[3] === undefined ? part[4]! : pathKey(part[3])),
  );
}

/**
 * Past a type written at `at` (`: { html?: string }`), to the `=` after
 * it; `at` itself when there is none, or no `=` ends it.
 */
function pastAnnotation(text: string, at: number): number {
  const colon = /^\s*:/.exec(text.slice(at, at + 64));
  if (!colon) return at;
  for (let index = at + colon[0].length; index < text.length; index++) {
    const char = text[index]!;
    if (char === '=' && !/[=>]/.test(text[index + 1] ?? '')) return index;
    if (/[;)\]}]/.test(char)) return at;
    if ('([{'.includes(char)) {
      const close = bracketEnd(text, index);
      if (close === undefined) return at;
      index = close;
    }
  }
  return at;
}

/**
 * The part read of what a call returns (`templates().hero`, `(await
 * templates()).hero`): the member chain after the call whose callee
 * starts at `start` in `source` and whose `(` is at `open`, past brackets
 * that only group the call.
 */
function memberAfterCall(
  source: string,
  start: number,
  open: number,
): string | undefined {
  const code = codeOnly(source);
  const close = callEnd(code.slice(open));
  if (close === undefined) return undefined;
  let after = open + close;
  let before = code.slice(0, start);
  for (;;) {
    const group = /(?<![\w$)\]]\s*)\(\s*(?:await\s+)?$/.exec(before);
    const closing = /^\s*\)/.exec(code.slice(after));
    if (!group || !closing) break;
    before = before.slice(0, group.index);
    after += closing[0].length;
  }
  // Read from what is written, where a key in quotes is still there.
  const chain = new RegExp(`^(?:${MEMBER_STEP})+`).exec(
    source.slice(after),
  )?.[0];
  return chain ? chainPath(chain).join('.') : undefined;
}

/**
 * Where `name` was destructured from, visible at `at`, with `member` of it
 * still to walk: `const { hero } = bundle` makes `hero` the `hero` of
 * `bundle`, `const { hero: html } = views.home` makes `html` `home.hero`
 * of `views`, and `const [, html] = pages` makes `html` `1` of `pages`.
 * From a value written out in place (`const [html] = ['<img>']`) it is
 * that part of the value, or nothing when there is no such part.
 */
function destructuredFrom(
  text: string,
  depths: number[],
  name: string,
  at: number,
  member: string | undefined,
):
  | ((
      | { name: string; member: string | undefined }
      | { ranges: [number, number][] }
    ) & { fallback?: number; assigned: number })
  | undefined {
  let found:
    | ((
        | { name: string; member: string | undefined }
        | { ranges: [number, number][] }
      ) & { fallback?: number; assigned: number })
    | undefined;
  // Each declaration visible at `at` in turn: a later one wins. A pattern
  // is walked however deep it nests (`const { nested: { html = '<img>' }
  // } = ...`), as a parameter's is.
  const code = codeOnly(text);
  for (const declaration of code.matchAll(/\b(?:const|let|var)\s*(?=[{[])/g)) {
    const open = declaration.index + declaration[0].length;
    const close = bracketEnd(text, open);
    if (close === undefined) continue;
    const visible =
      declaration.index < at
        ? encloses(depths, declaration.index, at)
        : depths[declaration.index] === 0;
    if (!visible) continue;
    // Past a type written after the pattern (`}: { html?: string } =`).
    const typed = pastAnnotation(text, close + 1);
    // What it destructures, inside brackets that only group it (`= ({})`),
    // the last of a sequence there (`= (a, {})`).
    const equals = /^\s*=(?![=>])\s*/.exec(text.slice(typed));
    if (!equals) {
      // Each element of a loop (`for (const { html = '<img>' } of list)`)
      // is not followed, so its default may be used.
      let looped: PatternBinding | undefined;
      if (/^\s*(?:of|in)\b/.test(text.slice(typed))) {
        patternBindings(text, open, 0, [], (bound) => {
          if (bound.name === name) looped = bound;
        });
      }
      if (looped) {
        found = {
          ranges: [],
          ...(looped.fallback === undefined
            ? {}
            : { fallback: looped.fallback }),
          assigned: typed,
        };
      }
      continue;
    }
    let value = typed + equals[0].length;
    for (;;) {
      const close = text[value] === '(' ? bracketEnd(text, value) : undefined;
      if (
        close === undefined ||
        !/^\s*(?:[;,)]|$)/m.test(text.slice(close + 1))
      ) {
        break;
      }
      value = lastOperand(text, value, close);
      value += /^\s*/.exec(text.slice(value))![0].length;
    }
    // A conditional (`= wide ? { hero } : bundle`) is read branch by
    // branch, and its default is used unless every branch holds the part.
    const branches = conditionalBranches(
      codeOnly(text.slice(value, expressionEnd(text, value, { commas: true }))),
    );
    const source = branches
      ? Object.assign([''], { index: 0 })
      : new RegExp(
          String.raw`^(?:([A-Za-z_$][\w$]*(?:${MEMBER_STEP})*)|(?=[[{]))`,
        ).exec(text.slice(value));
    if (!source) continue;
    let binding: PatternBinding | undefined;
    patternBindings(text, open, 0, [], (bound) => {
      if (bound.name === name) binding = bound;
    });
    if (!binding) continue;
    // Where its `=` is, from which what is set to it later is read.
    const assigned = typed + equals[0].indexOf('=');
    const key = binding.member;
    const path = joinMember(binding.member, member ? member.split('.') : []);
    // A key an object's rest leaves out holds nothing.
    if (path === null) {
      found = { ranges: [], assigned };
      continue;
    }
    const fallback =
      binding.fallback === undefined ? {} : { fallback: binding.fallback };
    const parentDefaults = binding.parentDefaults ?? {};
    const from = value + source[0].length;
    if (source[1] === undefined) {
      // A value written out here that holds the part never lets the
      // default through: `{ hero = '<img>' } = { hero: '<p>' }`, nor does
      // a `const` that holds it, in every branch of a conditional.
      const holds = (at: number, to: number): boolean => {
        const code = codeOnly(text.slice(at, to));
        const inner = conditionalBranches(code);
        if (inner) {
          return inner.every(([f, t]) => holds(at + f, at + t));
        }
        const named = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(code)?.[1];
        const start = named
          ? visibleConst(text, depths, named, declaration.index, true)
          : at + /^\s*/.exec(code)![0].length;
        return (
          start !== undefined &&
          suppliesPart(text, depths, start, key!, 0, parentDefaults)
        );
      };
      const supplied =
        key !== undefined &&
        (branches
          ? branches.every(([f, t]) => holds(from + f, from + t))
          : suppliesPart(text, depths, from, key, 0, parentDefaults));
      let handed: { name: string; member: string | undefined } | undefined;
      const ranges = renderedRange(text, depths, from, path, (name, member) => {
        handed ??= { name, member };
      });
      found = {
        ...(ranges.length || !handed ? { ranges } : handed),
        ...(supplied ? {} : fallback),
        assigned,
      };
    } else {
      const chain = /^[A-Za-z_$][\w$]*/.exec(source[1])![0];
      // `= bundle` with `const bundle = { hero: ... }` in scope holds the
      // part for certain, so its default is never used.
      const value =
        key !== undefined && chain === source[1].trim()
          ? visibleConst(text, depths, chain, declaration.index, true)
          : undefined;
      const held =
        value !== undefined &&
        suppliesPart(text, depths, value, key!, 0, parentDefaults);
      found = {
        ...(held ? {} : fallback),
        assigned,
        name: chain,
        member:
          [...chainPath(source[1].slice(chain.length)), path]
            .filter(Boolean)
            .join('.') || undefined,
      };
    }
  }
  return found;
}

/**
 * A call of a member of a name, in code whose strings are blanked:
 * `templates.render(`, `t.render?.(`, or by a key written out
 * (`templates['render'](`), which `calledMember` reads.
 */
const MEMBER_CALL = new RegExp(
  String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\??\.\s*([A-Za-z_$][\w$]*)|(?:\?\.)?\[\s*(["'\x60])[^"'\x60\n]*\3\s*\])${CALL_OPEN}`,
  'g',
);

/**
 * The member a `MEMBER_CALL` match in the code of `source` calls: named
 * after a dot, or the key in brackets as `source` writes it.
 */
function calledMember(source: string, call: RegExpMatchArray): string {
  return (
    call[2] ??
    /\[\s*(["'\x60])(.*?)\1\s*\]/.exec(
      source.slice(call.index!, call.index! + call[0].length),
    )![2]!
  );
}

/**
 * For each file, the names it exports that another file imports and hands
 * to an HTML sink: `import { markup } from './markup'; root.innerHTML =
 * markup` renders what `markup.ts` exports as `markup`. Only relative
 * imports of files in the project are followed.
 */
function sunkExports(files: ProjectFileLike[]): Map<string, Set<string>> {
  const sunk = new Map<string, Set<string>>();
  const sources = files.filter((file) => SOURCE.test(file.path));
  for (const file of sources) {
    const text = file.content + templateSinks(file);
    // Each name a sink is handed, with the member it reads of it
    // (`templates.hero` is `hero` of `templates`; '' is the whole value).
    // A sink in a function that never runs hands over nothing.
    const depths = braceDepths(text);
    const names = new Map<string, Set<string>>();
    // Helpers a sink calls, by name, each as the entries of its calls
    // (`render()`, `render().hero` for the part read of what it returns,
    // `await render()` for one awaited): what they return reaches the sink.
    const callees = new Map<string, Set<string>>();
    // `templates.render()`: the members of a namespace called, as entries.
    const memberCallees = new Map<string, Set<string>>();
    const entry = (name: string, part: string | undefined, awaited: boolean) =>
      `${awaited ? 'await ' : ''}${name}()${part ? `.${part}` : ''}`;
    const called = (
      into: Map<string, Set<string>>,
      key: string,
      value: string,
    ) => {
      const values = into.get(key) ?? new Set<string>();
      values.add(value);
      into.set(key, values);
    };
    // Whether a name called at `at` is a binding of this file (a
    // function, a declaration or a parameter around it), not an import.
    const bindingHere = (name: string, at: number) =>
      shadowingFunction(text, depths, name, at) !== undefined ||
      [
        ...text.matchAll(
          new RegExp(
            String.raw`\b(?:function\s*\*?\s*|(?:const|let|var|class)\s+)${escapeRegExp(name)}(?![\w$])`,
            'g',
          ),
        ),
      ].some((declaration) =>
        declaration.index < at
          ? encloses(depths, declaration.index, at)
          : depths[declaration.index] === 0,
      );
    // What a call in `code` reads of what it returns, its callee starting
    // at `start` and its `(` the last character of `match`.
    const read = (source: string, start: number, match: string) =>
      memberAfterCall(source, start, start + match.length - 1);
    for (const sink of namedSinks(text, depths)) {
      if (
        functionsAround(text, depths, sink.index).some((fn) =>
          unreferenced(text, fn),
        )
      ) {
        continue;
      }
      // A parameter of the same name, around the sink, is what it is
      // handed, not the import. A local binding is too, unless what
      // reaches the sink through it is another name (`const html =
      // markup`, `{ hero: markup }`), which is followed.
      const pending = [
        { name: sink.name, member: sink.member, at: sink.index },
      ];
      for (let step = 0; step < pending.length && step < 20; step++) {
        const { name, member, at } = pending[step]!;
        if (shadowingFunction(text, depths, name, at) !== undefined) continue;
        const local = [
          ...text.matchAll(
            new RegExp(
              `\\b(?:const|let|var)\\s+${escapeRegExp(name)}(?![\\w$])(?:\\s*:\\s*(?:[^=;\\n]|=>)+?)?\\s*=(?![=>])`,
              'g',
            ),
          ),
        ]
          // Visible here: before it and around it, or at the module's top
          // level. One later, in another function, is not.
          .filter((declaration) =>
            declaration.index < at
              ? encloses(depths, declaration.index, at)
              : depths[declaration.index] === 0,
          )
          .pop();
        if (!local) {
          // `const { hero } = bundle` is `hero` of `bundle`; from a value
          // written out here, nothing imported.
          const from = destructuredFrom(text, depths, name, at, member);
          if (from?.fallback !== undefined) {
            renderedRange(
              text,
              depths,
              from.fallback,
              member,
              (next, nextMember, index) =>
                pending.push({ name: next, member: nextMember, at: index }),
            );
            const source = text.slice(
              from.fallback,
              expressionEnd(text, from.fallback, { commas: true }),
            );
            const code = codeOnly(source);
            // Helpers the default calls (`{ html = make() }`, `{ html =
            // templates.make() }`).
            for (const call of code.matchAll(
              new RegExp(
                String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)${CALL_OPEN}`,
                'g',
              ),
            )) {
              if (NOT_A_BINDING.has(call[1]!)) continue;
              if (bindingHere(call[1]!, from.fallback + call.index)) continue;
              called(
                callees,
                call[1]!,
                entry(
                  call[1]!,
                  read(source, call.index, call[0]),
                  awaitedAt(code, call.index),
                ),
              );
            }
            for (const call of code.matchAll(MEMBER_CALL)) {
              const member = calledMember(source, call);
              if (bindingHere(call[1]!, from.fallback + call.index)) continue;
              called(
                memberCallees,
                call[1]!,
                entry(
                  member,
                  read(source, call.index, call[0]),
                  awaitedAt(code, call.index),
                ),
              );
            }
          }
          if (from && 'ranges' in from) continue;
          if (from) {
            pending.push({ name: from.name, member: from.member, at });
            continue;
          }
          const members = names.get(name) ?? new Set<string>();
          members.add(member ?? '');
          names.set(name, members);
          continue;
        }
        for (const value of reachingValues(
          text,
          depths,
          local,
          name,
          member,
          at,
        )) {
          const copy = new RegExp(
            String.raw`^\s*([A-Za-z_$][\w$]*)((?:${MEMBER_STEP})*)\s*(?:;|\n|$)`,
          ).exec(text.slice(value.start));
          if (copy && !NOT_A_BINDING.has(copy[1]!)) {
            pending.push({
              name: copy[1]!,
              member:
                [...chainPath(copy[2]!), value.member]
                  .filter(Boolean)
                  .join('.') || undefined,
              at: value.start + copy[0].indexOf(copy[1]!),
            });
            continue;
          }
          renderedRange(
            text,
            depths,
            value.start,
            value.member,
            (next, nextMember, index) =>
              pending.push({ name: next, member: nextMember, at: index }),
          );
        }
      }
    }
    for (const { from, end } of sinkExpressions(text, depths)) {
      const source = text.slice(from, end);
      const code = codeOnly(source);
      for (const callee of code.matchAll(
        new RegExp(String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)${CALL_OPEN}`, 'g'),
      )) {
        if (NOT_A_BINDING.has(callee[1]!)) continue;
        const at = from + callee.index;
        if (
          bindingHere(callee[1]!, at) ||
          functionsAround(text, depths, at).some((fn) => unreferenced(text, fn))
        ) {
          continue;
        }
        called(
          callees,
          callee[1]!,
          entry(
            callee[1]!,
            read(source, callee.index, callee[0]),
            awaitedAt(code, callee.index),
          ),
        );
      }
      // `templates.render()`: the member called, by the namespace.
      for (const callee of code.matchAll(MEMBER_CALL)) {
        const at = from + callee.index;
        const member = calledMember(source, callee);
        if (
          bindingHere(callee[1]!, at) ||
          functionsAround(text, depths, at).some((fn) => unreferenced(text, fn))
        ) {
          continue;
        }
        called(
          memberCallees,
          callee[1]!,
          entry(
            member,
            read(source, callee.index, callee[0]),
            awaitedAt(code, callee.index),
          ),
        );
      }
    }
    if (names.size === 0 && callees.size === 0 && memberCallees.size === 0) {
      continue;
    }
    const resolve = (specifier: string) =>
      resolveModule(sources, file.path, specifier);
    const mark = (target: ProjectFileLike | undefined, exported: string[]) => {
      if (!target || exported.length === 0) return;
      const into = sunk.get(target.path) ?? new Set<string>();
      for (const name of exported) into.add(name);
      sunk.set(target.path, into);
    };
    // `import * as templates from './markup'`: the members read of it.
    for (const statement of text.matchAll(
      /\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      mark(resolve(statement[2]!), [
        ...[...(names.get(statement[1]!) ?? [])].filter(Boolean),
        ...(memberCallees.get(statement[1]!) ?? []),
      ]);
    }
    for (const statement of text.matchAll(
      /\bimport\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      const bindings: [local: string, exported: string][] = [];
      if (statement[1]) bindings.push([statement[1], 'default']);
      for (const part of (statement[2] ?? '').split(',')) {
        const named = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
        if (named) bindings.push([named[2] ?? named[1]!, named[1]!]);
      }
      // `bundle.safe` of an imported `bundle` is `safe` of what it
      // exports; an imported helper a sink calls is marked `render()`,
      // or `render().hero` for the part of what it returns read.
      const entries = [
        ...bindings
          .filter(([local]) => names.has(local))
          .flatMap(([local, exported]) =>
            [...names.get(local)!].map((member) =>
              member ? `${exported}.${member}` : exported,
            ),
          ),
        ...bindings
          .filter(([local]) => callees.has(local))
          .flatMap(([local, exported]) =>
            [...callees.get(local)!].map((call) =>
              call.replace(`${local}()`, () => `${exported}()`),
            ),
          ),
      ];
      if (entries.length === 0) continue;
      mark(resolve(statement[3]!), entries);
    }
  }
  // A barrel passes on what is sunk of it: `export { markup } from
  // './markup'`, `export { markup as hero } from ...` and `export * from
  // ...` send it on to the module that declares it.
  const queue = [...sunk].flatMap(([path, entries]) =>
    [...entries].map((entry) => [path, entry] as const),
  );
  const seen = new Set(queue.map(([path, entry]) => `${path}\0${entry}`));
  while (queue.length > 0) {
    const [path, entry] = queue.shift()!;
    const file = sources.find((candidate) => candidate.path === path);
    if (!file) continue;
    // `render()` is the helper `render`, called; `render().hero` the
    // part `hero` of what it returns; `await render()` it, awaited.
    const call = new RegExp(`${CALL_ENTRY.source}(?:\\.(.*))?$`).exec(entry);
    const [name, member] = call ? [call[2]!, call[3]] : splitEntry(entry);
    for (const statement of file.content.matchAll(
      /\bexport\s*(\*\s*as\s+([\w$]+)|\*|\{([^}]*)\})\s*from\s*["'](\.{1,2}\/[^"']+)["']/g,
    )) {
      let original: string | undefined;
      let forwarded = member;
      if (statement[2] !== undefined) {
        // `export * as templates from './markup'`: `templates.hero` is
        // `hero` of that module.
        if (statement[2] !== name || member === undefined) continue;
        [original, forwarded] = splitEntry(member);
      } else if (statement[1] === '*') {
        const declaredHere = new RegExp(
          `\\b(?:const|let|var|function|class)\\s+${escapeRegExp(name)}(?![\\w$])`,
        ).test(file.content);
        if (name !== 'default' && !declaredHere) original = name;
      } else {
        for (const part of statement[3]!.split(',')) {
          const named = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
          if (named && (named[2] ?? named[1]) === name) original = named[1];
        }
      }
      if (original === undefined) continue;
      const target = resolveModule(sources, file.path, statement[4]!);
      if (!target) continue;
      const next = call
        ? `${call[1] ?? ''}${original}()${forwarded ? `.${forwarded}` : ''}`
        : forwarded
          ? `${original}.${forwarded}`
          : original;
      const key = `${target.path}\0${next}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const into = sunk.get(target.path) ?? new Set<string>();
      into.add(next);
      sunk.set(target.path, into);
      queue.push([target.path, next]);
    }
  }
  return sunk;
}

let typesOf: { text: string; ranges: [number, number][] } | undefined;

/**
 * What `text` writes only as types, as ranges of it: the body of each
 * `interface`, and what each `type` alias is set to, up to a `;` or a line
 * end where it does not go on.
 */
function typeRanges(text: string): [number, number][] {
  if (typesOf?.text === text) return typesOf.ranges;
  const code = codeOnly(text);
  const ranges: [number, number][] = [];
  for (const match of code.matchAll(
    /\binterface\s+[A-Za-z_$][\w$]*[^{;]*\{/g,
  )) {
    const end = bracketEnd(code, match.index + match[0].length - 1);
    if (end !== undefined) ranges.push([match.index, end]);
  }
  for (const match of code.matchAll(
    /(?:^|[;{}\n])\s*(?:export\s+)?(?:declare\s+)?type\s+[A-Za-z_$][\w$]*\s*(?:<[^=;]*>)?\s*=/g,
  )) {
    const from = match.index + match[0].length;
    let depth = 0;
    let at = from;
    for (; at < code.length; at++) {
      const char = code[at]!;
      if ('([{<'.includes(char)) depth++;
      else if (')]}'.includes(char) || (char === '>' && code[at - 1] !== '=')) {
        depth--;
      } else if (depth === 0 && char === ';') break;
      else if (
        depth === 0 &&
        char === '\n' &&
        !/(?:[=|&,:?]|=>|\b(?:extends|keyof|typeof|infer|readonly|unique|in|is|as))\s*$/.test(
          code.slice(match.index, at),
        ) &&
        !/^\s*[|&?:]/.test(code.slice(at))
      ) {
        break;
      }
    }
    ranges.push([from, at]);
  }
  typesOf = { text, ranges };
  return ranges;
}

/** Where the bracket still open at `at` in `code` opens; -1 for none. */
function openBracket(code: string, at: number): number {
  let depth = 0;
  for (let index = at - 1; index >= 0; index--) {
    const char = code[index]!;
    if (')]}'.includes(char)) depth++;
    else if ('([{'.includes(char) && depth-- === 0) return index;
  }
  return -1;
}

/**
 * What a type goes on through before it reaches a name in it: other types
 * of a union or intersection (`Other | `), brackets it is in (`(`, `[`),
 * and a function type's parameters (`() => `). One it is an argument of
 * (`Map<string, `) is a type argument.
 */
const TYPE_LEAD = String.raw`(?:[\w$.]+(?:<[^<>;]*>)?(?:\[\])*\s*[|&]\s*|[(\[]\s*|(?:new\s+)?\([^()]*\)\s*=>\s*)*`;

/**
 * Whether the name at `at` is written as a type, where it never runs: in
 * a `type` alias or an `interface`, after `as`, `satisfies`, `implements`,
 * `keyof` or `typeof`, as a type argument (`useRef<View>(`), or in the
 * annotation of a declaration, a parameter, a class's field or what a
 * function returns (`const view: View`, `(view: View)`, `): View {`).
 */
function typeOnlyAt(text: string, at: number, end: number): boolean {
  if (typeRanges(text).some(([from, to]) => at >= from && at < to)) {
    return true;
  }
  const code = codeOnly(text);
  const before = code.slice(Math.max(0, at - 200), at);
  if (
    /\b(?:as|satisfies|keyof|typeof)\s+$/.test(before) ||
    /\bimplements\s+(?:[\w$.]+(?:<[^<>]*>)?\s*,\s*)*$/.test(before)
  ) {
    return true;
  }
  // A type argument, not an element (`return <View />`) nor a value
  // compared (`count < View.limit`, `x < View > 1`).
  if (
    /(?<![\w$])(?!(?:return|yield|await|case|default|else|do|in|of|typeof|new|delete|void)\s*<)[A-Za-z_$][\w$.]*\s*<\s*(?:[^<>;=()]*,\s*)?$/.test(
      before,
    ) &&
    typeArgumentsAt(code, end)
  ) {
    return true;
  }
  if (annotationAt(code, at, before)) return true;
  // Inside brackets a type is written in (`{ current: View | null }`,
  // `[number, View]`).
  const open = openBracket(code, at);
  return (
    open !== -1 && typeOnlyAt(text, open, (bracketEnd(code, open) ?? open) + 1)
  );
}

/**
 * Whether the type arguments that a name ending at `end` is one of close
 * with a `>` that nothing a value starts with follows: `f<View>(`,
 * `Map<string, View>`, not `x < View > 1` nor `count < View`.
 */
function typeArgumentsAt(code: string, end: number): boolean {
  let depth = 0;
  for (let at = end; at < code.length; at++) {
    const char = code[at]!;
    if ('([{'.includes(char)) {
      at = bracketEnd(code, at) ?? code.length;
    } else if (')]};'.includes(char)) {
      return false;
    } else if (char === '<') {
      depth++;
    } else if (char === '>' && code[at - 1] !== '=' && depth-- === 0) {
      return !/^(?:=|\s*(?!(?:as|satisfies|extends|is|in|instanceof|keyof)\b)(?:[\w$'"!~+-]|\[\s*[^\]\s]))/.test(
        code.slice(at + 1),
      );
    }
  }
  return false;
}

/**
 * Whether the name at `at` is in an annotation (`before` is the code up to
 * it): of a declaration, a parameter, a class's field or what a function
 * returns (`const view: View`, `(view: View)`, `): View {`).
 */
function annotationAt(code: string, at: number, before: string): boolean {
  const annotated = new RegExp(`:\\s*${TYPE_LEAD}$`).exec(before);
  if (!annotated) return false;
  const colon = at - before.length + annotated.index;
  const lead = code.slice(Math.max(0, colon - 200), colon);
  // `const view: View`, and `): View {` after a function's parameters.
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*!?\s*$/.test(lead)) {
    return true;
  }
  if (
    /\)\s*$/.test(lead) &&
    pastReturnType(code, lead.trimEnd().length + colon - lead.length) > at
  ) {
    return true;
  }
  const open = openBracket(code, colon);
  // `(view: View)`: a parameter's name, or a pattern, right before it.
  if (code[open] === '(') {
    const start = Math.max(
      open + 1,
      ...[...code.slice(open + 1, colon).matchAll(/,/g)]
        .map((comma) => open + 1 + comma.index + 1)
        .filter((after) => openBracket(code, after) === open),
    );
    return /^\s*(?:\.\.\.)?\s*(?:[A-Za-z_$][\w$]*|[{[][\s\S]*[}\]])\s*\??\s*$/.test(
      code.slice(start, colon),
    );
  }
  // `class Box { item?: View }`: a field's name at the start of it.
  return (
    code[open] === '{' &&
    /\bclass\b[^{;]*$/.test(code.slice(Math.max(0, open - 200), open)) &&
    /(?:^|[;{}\n])\s*(?:(?:public|private|protected|readonly|static|declare|override|accessor)\s+)*#?[A-Za-z_$][\w$]*\s*[?!]?\s*$/.test(
      lead,
    )
  );
}

/**
 * For a function expression that nothing names, what stands for it where
 * it is written, from where that starts to where it ends: the brackets
 * that hold only it (`(function (html) { ... })`, `((html) => ...)`),
 * whatever follows them (`(...)`, `.call(`), or the function itself when
 * a call follows it (`(function (html) { ... }(`).
 */
function immediateCall(
  text: string,
  fn: FunctionBody,
): [number, number] | undefined {
  const expression = fn.name
    ? fn.declared!
    : fn.paramsAt! - (text[fn.paramsAt! - 1] === '(' ? 1 : 0);
  const start = /(?:\basync\s+)?$/.exec(text.slice(0, expression))!.index;
  const lead = /\(\s*$/.exec(text.slice(0, start));
  const close = lead ? bracketEnd(text, lead.index) : undefined;
  if (close !== undefined && /^\s*$/.test(text.slice(fn.end, close))) {
    return [lead!.index, close + 1];
  }
  // Only a `function` is called with no brackets around it: an arrow's
  // body would take the call in.
  const after = /^\s*(?=\()/.exec(text.slice(fn.end));
  return fn.name &&
    after &&
    !/\bexport\s+default\s*$/.test(text.slice(0, start))
    ? [start, fn.end + after[0].length]
    : undefined;
}

/**
 * Whether nothing in `text` refers to `fn` by name, and it is not
 * exported: code that cannot run.
 */
function unreferenced(text: string, fn: FunctionBody): boolean {
  // Asked again while working it out (a write in one function that
  // replaces the other's method, and back): as far as that goes, it runs.
  if (unreferencedAsked.has(fn.start)) return false;
  unreferencedAsked.add(fn.start);
  try {
    return unreferencedHere(text, fn);
  } finally {
    unreferencedAsked.delete(fn.start);
  }
}

const unreferencedAsked = new Set<number>();

function unreferencedHere(text: string, fn: FunctionBody): boolean {
  // A class's methods run when something uses the class: React calls a
  // component's `render`, and whatever holds an instance calls the rest.
  // So a method is unreferenced only when its class is: not exported and
  // never named again.
  if (fn.ownerClass) {
    const { name, at } = fn.ownerClass;
    if (/\bexport\b[^;{}]*$/.test(text.slice(Math.max(0, at - 60), at))) {
      return false;
    }
    if (!name) return false;
    return ![
      ...text.matchAll(
        new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`, 'g'),
      ),
    ].some(
      (use) =>
        use.index !== text.indexOf(name, at) &&
        !typeOnlyAt(text, use.index, use.index + name.length),
    );
  }
  if (!fn.name || fn.declared === undefined) return false;
  if (/^(?:function|async)$/.test(fn.name)) return false;
  if (fn.ownerExported) return false;
  if (calledElsewhere(text, fn)) return false;
  if (namedExpression(text, fn.declared)) return false;
  if (
    /\bexport\b[^;{}]*$/.test(
      text.slice(Math.max(0, fn.declared - 60), fn.declared),
    )
  ) {
    return false;
  }
  for (const use of text.matchAll(
    new RegExp(referenceTo({ ...fn, name: fn.name }), 'g'),
  )) {
    if (
      use.index === fn.declared ||
      signature(text, use.index, use.index + use[0].length)
    ) {
      continue;
    }
    if (use.index >= fn.start && use.index < fn.end) continue;
    if (inspectedAt(text, use.index + use[0].length)) continue;
    if (intrinsicTag(text, use.index, fn.name)) continue;
    if (writtenAt(text, use.index + use[0].length)) continue;
    if (overwrittenBefore(text, fn, use.index)) continue;
    // `typeof show`, in a type or not, does not run it.
    if (
      /\btypeof\s*$/.test(text.slice(Math.max(0, use.index - 20), use.index))
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Whether `fn` is called by name between `from` and `to`, other than from
 * inside itself, by a call that runs: one inside another function that
 * `to` is not in counts only if that function is called in turn.
 */
function calledBefore(
  text: string,
  depths: number[],
  fn: FunctionBody,
  from: number,
  to: number,
  // The functions already on the way here: a cycle proves nothing runs.
  seen = new Set<number>(),
): boolean {
  if (!fn.name || /^(?:function|async)$/.test(fn.name)) return false;
  for (const call of text.matchAll(
    new RegExp(referenceTo({ ...fn, name: fn.name }), 'g'),
  )) {
    if (call.index < from || call.index >= to) continue;
    if (!invokedAt(text, call.index, call.index + call[0].length)) {
      continue;
    }
    if (
      call.index === fn.declared ||
      signature(text, call.index, call.index + call[0].length)
    ) {
      continue;
    }
    if (call.index >= fn.start && call.index < fn.end) continue;
    const via = new Set([...seen, fn.start]);
    const runs = functionsAround(text, depths, call.index).every(
      (outer) =>
        (to >= outer.start && to < outer.end) ||
        (!via.has(outer.start) &&
          calledBefore(text, depths, outer, from, to, via)),
    );
    if (runs) return true;
  }
  return false;
}

/**
 * Whether the statement at `at` runs on a condition of its own: `if (...)`
 * or `else` in front of it, or a `&&`, `||` or `?` it hangs off.
 */
function conditional(text: string, at: number): boolean {
  const start = Math.max(
    text.lastIndexOf(';', at - 1),
    text.lastIndexOf('{', at - 1),
    text.lastIndexOf('}', at - 1),
  );
  return (
    /(?:^\s*(?:else\b|if\s*\()|&&|\|\||\?)/.test(text.slice(start + 1, at)) ||
    afterControlHeader(text, at)
  );
}

/**
 * Whether the statement at `at` is the unbraced body of an `if`, `for` or
 * `while`: `for (const x of xs) m = '<p>'` may run no times at all.
 */
function afterControlHeader(text: string, at: number): boolean {
  let close = at - 1;
  while (close >= 0 && /\s/.test(text[close]!)) close -= 1;
  if (text[close] !== ')') return false;
  let depth = 0;
  for (let index = close; index >= 0; index--) {
    if (text[index] === ')') depth += 1;
    else if (text[index] === '(') {
      depth -= 1;
      if (depth === 0) {
        return /\b(?:if|for|while)\s*$/.test(
          text.slice(Math.max(0, index - 12), index),
        );
      }
    }
  }
  return false;
}

/** The `{` depth before each character of `text`. */
function braceDepths(text: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    depths.push(depth);
    // A brace in a string, template or regular expression is not a block.
    const end =
      char === '"' || char === "'"
        ? quoteEnd(text, at)
        : char === '`'
          ? templateEnd(text, at)
          : char === '/' &&
              text[at + 1] !== '/' &&
              text[at + 1] !== '*' &&
              startsValue(text.slice(Math.max(0, at - 40), at))
            ? regexEnd(text, at)
            : undefined;
    if (end !== undefined) {
      const last = char === '/' ? end - 1 : end;
      for (let skipped = at + 1; skipped <= last; skipped += 1) {
        depths.push(depth);
      }
      at = last;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(0, depth - 1);
  }
  depths.push(depth);
  return depths;
}

/**
 * Whether the block a declaration at `from` sits in is still open at
 * `to`: no `}` in between takes the depth below where it started.
 */
function encloses(depths: number[], from: number, to: number): boolean {
  const depth = depths[from]!;
  for (let at = from; at <= to; at += 1) {
    if (depths[at]! < depth) return false;
  }
  return true;
}

/**
 * Where the expression that starts at `from` ends: at a `;`, a line end,
 * or a `,` outside any bracket, or at the bracket that closes the one it
 * sits in. Quoted strings are stepped over whole.
 */
function expressionEnd(
  text: string,
  from: number,
  { commas }: { commas: boolean },
): number {
  // Read from the syntax tree where the script parses: the grammar decides
  // where a line end, a `<` or a `:` ends an expression, which the text
  // rules below can only approximate. A call's arguments (`commas: false`)
  // and script that does not parse keep the text rules.
  if (commas) {
    const parsed = parsedExpressionEnd(text, from);
    if (parsed !== undefined) return parsed;
  }
  return scannedExpressionEnd(text, from, { commas });
}

/**
 * Where the expression that starts at `from` ends, by the syntax tree, at
 * the character the text rules would stop on (`;`, `,`, a closing bracket
 * or the line end) when that follows it, so either answer reads the same.
 */
/**
 * Whether the expression from `from` to `end` is one `void x`, which hands
 * over `undefined` whatever `x` is. `void 0 || x` is not: `void` binds
 * tighter than `||`, `??` or `?:`, so it hands over what follows. Read from
 * the syntax tree; `false` when the text does not parse, so the expression
 * is still read.
 */
function wholeVoid(text: string, from: number, end: number): boolean {
  const keyword = /^\s*void(?![\w$])\s*/.exec(text.slice(from, end));
  if (!keyword) return false;
  const operand = expressionEnds(text)?.get(from + keyword[0].length);
  return operand !== undefined && text.slice(operand, end).trim() === '';
}

function parsedExpressionEnd(text: string, from: number): number | undefined {
  let start = from;
  while (start < text.length && /\s/.test(text[start]!)) start += 1;
  const end = expressionEnds(text)?.get(start);
  if (end === undefined) return undefined;
  let at = end;
  while (text[at] === ' ' || text[at] === '\t') at += 1;
  return at >= text.length || ';,)]}\n'.includes(text[at]!) ? at : end;
}

function scannedExpressionEnd(
  text: string,
  from: number,
  { commas }: { commas: boolean },
): number {
  let depth = 0;
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === '"' || char === "'" || char === '`') {
      const end = char === '`' ? templateEnd(text, at) : quoteEnd(text, at);
      if (end !== undefined) {
        at = end;
        continue;
      }
    }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) {
      if (depth === 0) return at;
      depth -= 1;
    } else if (depth === 0 && (char === ';' || (commas && char === ','))) {
      return at;
    } else if (depth === 0 && char === '\n' && !continues(text, from, at)) {
      return at;
    }
  }
  return text.length;
}

/**
 * Whether the expression from `from` carries on past the line end at `at`:
 * nothing written yet (`root.innerHTML =` then a new line), a line that
 * ends on an operator, or a next line that starts with one or with a
 * call, index or template.
 */
function continues(text: string, from: number, at: number): boolean {
  const before = text.slice(from, at).trim();
  if (before === '') return true;
  // A line end after `value++`, `value--` or a bare `yield` ends it: not
  // a member of that name (`obj.yield`, `this.#yield`). `yield` is read
  // as the operator: a module, a class and strict code name nothing so.
  if (/[\w$)\]]\s*(?:\+\+|--)$/.test(before)) return false;
  if (/(?<![\w$#]|\.\s*)yield$/.test(before)) return false;
  if (/(?:[=?:+\-*/%&|^,(<>]|\.\.\.)$/.test(before)) return true;
  // `new` takes what follows it, past a line end: not a member of that
  // name (`obj.new`, `this.#new`), nor a word that ends in it (`renew`).
  if (/(?<![\w$#]|\.\s*)new$/.test(before)) return true;
  // A line end ends nothing before a `(`, `[` or template: the line
  // before is called, indexed or tagged (`foo /*\n*/ ('<img>')`).
  return /^\s*(?:[?:+\-*/%&|^.([\x60]|\?\?)/.test(text.slice(at + 1));
}

/**
 * A component template's raw-HTML directives (Vue's `v-html` and
 * `:innerHTML`, Svelte's `{@html ...}`, Astro's `set:html`), written as
 * script statements that hand each expression to an HTML sink, so a
 * binding the template renders is read as rendered.
 */
function templateSinks(file: ProjectFileLike): string {
  if (!/\.(vue|svelte|astro)$/i.test(file.path)) return '';
  const template = mapScripts(file.content, (code) =>
    code.replace(/[^\n]/g, ' '),
  );
  const expressions = [
    ...template.matchAll(
      /\s(?:v-html|(?:v-bind)?:innerHTML)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    ),
    ...template.matchAll(/\{@html\s+([^{}]*)\}/g),
    ...template.matchAll(/\sset:html\s*=\s*\{([^{}]*)\}/g),
  ].map((match) => match[1] ?? match[2]!);
  return expressions
    .map((expression) => `\n;document.body.innerHTML = (${expression});`)
    .join('');
}

/**
 * Whether `at` is in a JSX branch that can never render, directly or
 * inside another: `{false && <img />}`, `{null ? <img /> : ...}`, or
 * `{true ? ... : <img />}`.
 */
function deadBranch(text: string, depths: number[], at: number): boolean {
  const falsy = String.raw`(?:false|null|undefined|0|""|''|\x60\x60)`;
  const dead = [
    new RegExp(String.raw`^\s*${falsy}\s*(?:&&|\?[^:]*$)`),
    /^\s*true\s*\?[\s\S]*:\s*\(?\s*$/,
  ];
  for (let inner = at; depths[inner]! > 0;) {
    // The `{` of the expression container, or block, around `inner`.
    let open = inner - 1;
    while (
      open >= 0 &&
      !(text[open] === '{' && depths[open] === depths[inner]! - 1)
    ) {
      open -= 1;
    }
    if (open < 0) return false;
    const before = text.slice(open + 1, inner);
    if (dead.some((pattern) => pattern.test(before))) return true;
    inner = open;
  }
  return false;
}

/** Template tags whose literal is rendered as markup. */
const MARKUP_TAGS = new Set(['html', 'svg', 'htm']);

/**
 * Script that is about to hand a string to something that parses it as
 * markup: React's `__html`, `innerHTML`/`outerHTML`, `insertAdjacentHTML`
 * and `document.write`. A string there is rendered, so it is not blanked.
 */
const HTML_SINK =
  /(?:(?:\b__html|"__html"|'__html'|`__html`)\s*:|(?:\.\s*|\[\s*["'`])(?:inner|outer)HTML(?:["'`]\s*\])?\s*\+?=|\binsertAdjacentHTML\s*\([^()]*,|\bdocument\.write(?:ln)?\s*\()\s*$/;

/** The closing quote of a one-line string opened at `at`, if it has one. */
function quoteEnd(text: string, at: number): number | undefined {
  const quote = text[at];
  for (let index = at + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === quote) return index;
    else if (text[index] === '\n') return undefined;
  }
  return undefined;
}

/**
 * The closing backtick of a template literal opened at `at`, past any
 * `${...}` in it, if it has one.
 */
function templateEnd(text: string, at: number): number | undefined {
  let depth = 0;
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\\') index += 1;
    else if (depth === 0 && char === '`') return index;
    else if (char === '$' && text[index + 1] === '{') {
      depth += 1;
      index += 1;
    } else if (depth > 0 && char === '{') depth += 1;
    else if (depth > 0 && char === '}') depth -= 1;
  }
  return undefined;
}

/**
 * Whether a value can start after `before`: it ends in an operator, an
 * opening bracket or a keyword, not in a value. So a `/` there opens a
 * regular expression rather than dividing, and a quote opens a string.
 * `<` is left out, so JSX's `</div>` is never read as one.
 */
function startsValue(before: string): boolean {
  const last = /(\S)\s*$/.exec(before);
  if (!last) return true;
  if ('(,=:[!&|?{};+-*%>~^'.includes(last[1]!)) return true;
  return /(?:^|[^\w$.])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|instanceof|new|throw)\s*$/.test(
    before,
  );
}

/**
 * The braces of script read so far, so a `/` after a `}` can be told
 * apart: after a block (`if (ready) {} /<img>/.test(s)`) it opens a
 * regular expression; after an object or an expression in JSX
 * (`{} / 2`, `{count}/{total}`, `style={{ ... }} />`) it divides.
 */
class Braces {
  private open: boolean[] = [];
  private closedBlock = false;

  /** Note `char`, about to be written after `before`. */
  read(char: string, before: string): void {
    if (char === '{') {
      // A label in a block (`done: {`, `case 1: {`, `default: {`), not a
      // property of an object (`{ done: {} }`).
      const inBlock = this.open[this.open.length - 1] ?? true;
      this.open.push(
        opensBlock(before) ||
          (inBlock &&
            /(?:^|[;{}])\s*(?:case\b[^;{}]*|[A-Za-z_$][\w$]*)\s*:\s*$/.test(
              before,
            )),
      );
    } else if (char === '}') this.closedBlock = this.open.pop() ?? false;
  }

  /** Whether a `/` after `before` opens a regular expression. */
  opensPattern(before: string): boolean {
    if (/\}\s*$/.test(before)) return this.closedBlock;
    // `value++` is a whole operand: a `/` after it divides.
    if (/[\w$)\]]\s*(?:\+\+|--)\s*$/.test(before)) return false;
    return startsValue(before);
  }
}

/**
 * Whether a `{` after `before` opens a block rather than an object: it
 * starts a statement, or follows `)`, `=>`, a name or a keyword such as
 * `else`, but not one that takes a value (`return {`, `export default {`).
 */
function opensBlock(before: string): boolean {
  if (
    /(?:^|[^\w$.])(?:return|typeof|case|in|of|void|yield|await|delete|instanceof|new|throw|default)\s*$/.test(
      before,
    )
  ) {
    return false;
  }
  return /(?:^|[;{})\w$]|=>)\s*$/.test(before);
}

/**
 * Where the regular expression literal opened at `at` ends, past its flags,
 * or `undefined` when the line ends first and it was never one.
 */
function regexEnd(text: string, at: number): number | undefined {
  let inClass = false;
  for (let index = at + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\n') return undefined;
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      let end = index + 1;
      while (end < text.length && /[a-z]/i.test(text[end]!)) end += 1;
      return end;
    }
  }
  return undefined;
}

/**
 * `/media/` paths the code references that the library does not hold.
 *
 * One finding per missing path, however often it is referenced, naming
 * what does exist so the repair can pick a real file or drop the element.
 */
function mediaFindings(
  mediaPaths: readonly string[],
  files: ProjectFileLike[],
  corpus: string,
): DesignFinding[] {
  // The library, and anything the project ships itself under public/media/,
  // which Vite serves at the same /media/ path.
  const known = new Set([
    ...mediaPaths,
    ...files
      .filter((file) => file.path.startsWith('public/media/'))
      .map((file) => file.path.slice('public/'.length)),
  ]);
  // A root-relative /media/ path only: not one inside another URL
  // (https://cdn.example.com/media/a.jpg) or a longer path.
  const referenced = new Set(
    [
      ...corpus.matchAll(
        /(?<![\w./-])\/(media\/[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+)(?![\w-]|\.\w)/gi,
      ),
    ].map((match) => match[1]!),
  );
  const available =
    mediaPaths.length > 0
      ? `The library has: ${mediaPaths.map((path) => `/${path}`).join(', ')}.`
      : 'The library is empty, so the page cannot use any /media/ file.';
  return [...referenced]
    .filter((path) => !known.has(path))
    .map((path) => ({
      severity: 'error' as const,
      check: 'media',
      detail: `The code references /${path}, which is not in the media library, so it will show as broken. ${available} Use one of those, or paint the space in CSS instead.`,
    }));
}

/**
 * Check a finished project against its spec and the universal rules.
 *
 * The spec is read from the project's own DESIGN.md, so a project from
 * before specs, or one whose spec did not parse, gets the universal checks
 * and nothing it was never asked to meet.
 */
/** For `design-checks.test.ts`, which holds it to the regex it replaced. */
export { cssRuleMatches };

export function checkDesign(
  files: ProjectFileLike[],
  options: {
    /**
     * The media library's paths (`media/<slug>.<ext>`), when the caller
     * knows them. Given, any `/media/` path the code references that is not
     * one of them is an error: it is an image or a video the page will
     * show as broken. Absent, the check is skipped rather than guessed at.
     */
    mediaPaths?: readonly string[];
  } = {},
): DesignReport {
  // Comments out first, of every file, so a stylesheet that imports
  // another reads that one without its comments too.
  const uncommented = files.map((file) =>
    SOURCE.test(file.path) || STYLE.test(file.path)
      ? { path: file.path, content: withoutComments(file) }
      : file,
  );
  const clean = uncommented.map((file) =>
    STYLE.test(file.path)
      ? {
          path: file.path,
          content: withResolvedQueries(file.path, file.content, uncommented),
        }
      : file,
  );
  const css = clean
    .filter((file) => STYLE.test(file.path))
    .map((file) => file.content)
    .join('\n');
  const source = clean
    .filter((file) => SOURCE.test(file.path))
    .map((file) => file.content)
    .join('\n');
  const design = files.find((file) => file.path === DESIGN_MD_PATH);
  const spec = design ? readDesignSpec(design.content) : undefined;

  const findings = universalFindings(clean, css, source, files);
  if (options.mediaPaths) {
    findings.push(
      ...mediaFindings(options.mediaPaths, files, css + '\n' + source),
    );
  }
  if (spec) {
    findings.push(
      ...specFindings(
        spec,
        css,
        normalizeCssValue(css),
        source,
        normalizeCssValue(css + '\n' + withoutTextNodes(source)),
        normalizeText(source),
        normalizeText(visibleText(source)),
        files.some((file) => /tailwindcss/i.test(file.content)),
        clean
          .filter((file) => TAILWIND_CONFIG.test(file.path))
          .map((file) => file.content)
          .join('\n'),
      ),
    );
  }
  return {
    hasSpec: spec !== undefined,
    errors: findings.filter((finding) => finding.severity === 'error'),
    warnings: findings.filter((finding) => finding.severity === 'warning'),
  };
}

/** Most findings a repair prompt lists, so a runaway report cannot crowd out the fix. */
export const MAX_FINDINGS_IN_PROMPT = 30;

/**
 * The findings as lines a repair prompt can carry, errors first.
 */
export function describeFindings(report: DesignReport): string {
  return [...report.errors, ...report.warnings]
    .slice(0, MAX_FINDINGS_IN_PROMPT)
    .map((finding) => `- [${finding.check}] ${finding.detail}`)
    .join('\n');
}
