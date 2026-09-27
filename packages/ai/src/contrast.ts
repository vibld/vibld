/**
 * WCAG relative luminance and contrast ratio, in the smallest form that
 * answers the question this package actually asks: does this text colour
 * clear 4.5:1 against the surface it sits on?
 *
 * UX BASELINE has required that ratio since it was written, but nothing
 * checked it -- the requirement lived only in the prompt, so a palette
 * could ship a failing pair and nobody would know until someone looked.
 * These functions exist so the catalogues in this package are verified by
 * their own tests rather than by assertion.
 *
 * Pure arithmetic on purpose: no dependency, no canvas, no colour library.
 * It runs anywhere the rest of this package runs, which is what makes it
 * reusable for checking a *generated* project's tokens later (#27) rather
 * than only this repo's own.
 *
 * Formulae are WCAG 2.2, sections "relative luminance" and "contrast
 * ratio". `contrastRatio` accepts only 6-digit hex: everything in this
 * package's catalogues is written that way, and quietly accepting a
 * shorthand or a named colour would let an unverifiable value through the
 * check. A generated project's tokens are also read as `oklch()`
 * (`tokenLuminance`), because that is how shadcn/ui writes them.
 */

export function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

/** The sRGB transfer function, undone. */
function linearise(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(linearise) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The WCAG contrast ratio between two colours, 1 to 21, or null if either
 * is not a 6-digit hex. Order does not matter.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal-size text. The figure UX BASELINE names. */
export const AA_NORMAL_TEXT = 4.5;
/** WCAG AA for large text (18.66px bold, or 24px), and for UI borders. */
export const AA_LARGE_TEXT = 3;

export function meetsAA(foreground: string, background: string): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= AA_NORMAL_TEXT;
}

/**
 * The custom properties declared on `:root` in a stylesheet.
 *
 * Deliberately not a CSS parser. It finds `:root` blocks, reads
 * `--name: value` declarations out of them, and ignores everything else.
 * That is enough for the token convention this package emits and asks for,
 * and a real parser would be a dependency and a maintenance surface for no
 * additional answer.
 *
 * Later declarations win, which is what the cascade does within one file.
 *
 * Scanned with `indexOf` and `split` rather than matched with a regex, and
 * that is not a style preference. The obvious patterns here -- `:root[^{]*\{`
 * for the block and `(--[\w-]+)\s*:` for a declaration -- both backtrack
 * polynomially, so a stylesheet of ten thousand repetitions of `:root` or of
 * `-` takes quadratic time. The input is a generated project's CSS, and
 * model output is untrusted input (ADR-0007), so that is a way to pin the
 * Worker with one plausible-looking file. Scanning is linear and, as it
 * turns out, easier to read.
 */
function readDeclarations(
  block: string,
  into: Map<string, string>,
  important: Set<string> = new Set(),
): void {
  for (const declaration of block.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    // A custom property, and a plausible one: a name carrying whitespace or a
    // brace means the block was not shaped the way this assumes.
    if (!name.startsWith('--') || name.length < 3) continue;
    if (/[\s{}]/.test(name)) continue;
    // `!important` is not part of the value, and holds over a later
    // declaration that lacks it (#239 review).
    const raw = declaration.slice(colon + 1).trim();
    const flagged = /\s*!\s*important\s*$/i.exec(raw);
    const value = flagged ? raw.slice(0, flagged.index) : raw;
    if (value.length === 0) continue;
    if (!flagged && important.has(name)) continue;
    into.set(name, value);
    if (flagged) important.add(name);
  }
}

/**
 * A root or dark-root selector's specificity, as one number: classes and
 * pseudo-classes outweigh element names. The forms read here have at most
 * three of each.
 */
function specificity(selector: string): number {
  const classes = (selector.match(/[.:]/g) ?? []).length;
  const types = (selector.match(/\b(?:html|body)\b/g) ?? []).length;
  return classes * 10 + types;
}

/**
 * A block's declarations over what is already read, where the cascade
 * would apply them: at least as specific as the selector that set each
 * before, later winning a tie. `html.dark` holds over a later `.dark`
 * (#239 review).
 */
function readWeighted(
  block: string,
  weight: Weight,
  tokens: Map<string, string>,
  weights: Map<string, Weight>,
) {
  const declared = new Map<string, string>();
  const important = new Set<string>();
  readDeclarations(block, declared, important);
  for (const [name, value] of declared) {
    const own = { ...weight, important: important.has(name) };
    const before = weights.get(name);
    if (before && outweighs(before, own)) continue;
    tokens.set(name, value);
    weights.set(name, own);
  }
}

/**
 * Where the cascade places a declaration: its cascade layer, then its
 * selector's specificity, then where its block sits in the stylesheet.
 * The layer is the rank of each layer it sits in, outermost first; an
 * empty list is outside every layer (#239 review).
 */
interface Weight {
  layer: number[];
  specificity: number;
  at: number;
  /** Declared `!important`. */
  important?: boolean;
}

/**
 * How two layer positions order: a later layer holds over an earlier one,
 * and a declaration outside any layer (at a level) holds over those in
 * one, as the cascade has it.
 */
export function compareLayers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? Number.POSITIVE_INFINITY;
    const y = b[i] ?? Number.POSITIVE_INFINITY;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `a` holds over `b`: important over normal, then a later layer
 * (an earlier one among important declarations), or the same layer and
 * more specific, or as specific and later in the stylesheet.
 */
function outweighs(a: Weight, b: Weight): boolean {
  // A descendant's own declaration (`body.dark`) holds over what it
  // inherits, important or not.
  const aOwn = a.specificity === Number.POSITIVE_INFINITY;
  const bOwn = b.specificity === Number.POSITIVE_INFINITY;
  if (aOwn !== bOwn) return aOwn;
  // An important declaration holds over a normal one, and among important
  // ones the layer order is reversed: an earlier layer wins, and one
  // outside every layer loses to those in one (#239 review).
  if (Boolean(a.important) !== Boolean(b.important)) {
    return Boolean(a.important);
  }
  const layers = compareLayers(a.layer, b.layer);
  if (layers !== 0) return a.important ? layers < 0 : layers > 0;
  return (
    a.specificity > b.specificity ||
    (a.specificity === b.specificity && a.at > b.at)
  );
}

interface WeightedTokens {
  tokens: Map<string, string>;
  weights: Map<string, Weight>;
}

/**
 * Whether a position in the stylesheet sits inside a conditional at-rule,
 * `@media`, `@supports` or `@container`, whose declarations hold only some
 * of the time and so do not define a theme (#239 review), and the cascade
 * layers it sits in. `@layer` is not conditional: shadcn/ui's tokens often
 * sit in `@layer base`.
 *
 * Asked at positions that only move forward, it reads each character once,
 * which keeps the readers that use it linear.
 */
export function blockTracker(
  css: string,
): (at: number) => { conditional: boolean; layer: number[] } {
  let scanned = 0;
  let header = 0;
  const stack: Array<{ conditional: boolean; layer?: string }> = [];
  let conditional = 0;
  // Cascade layers, ranked where each is first named: `@layer a, b;` or
  // `@layer a { ... }`, nested ones under their parent's name
  // (#239 review).
  const ranks = new Map<string, number>();
  let anonymous = 0;
  const current = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]!.layer !== undefined) return stack[i]!.layer;
    }
    return undefined;
  };
  const name = (layer: string): string => {
    const parent = current();
    const full = parent === undefined ? layer : `${parent}.${layer}`;
    const parts = full.split('.');
    for (let i = 1; i <= parts.length; i += 1) {
      const prefix = parts.slice(0, i).join('.');
      if (!ranks.has(prefix)) ranks.set(prefix, ranks.size);
    }
    return full;
  };
  // A brace inside a string, `content: "{"`, opens nothing (#239 review).
  let quote: string | undefined;
  return (at: number) => {
    for (; scanned < at; scanned += 1) {
      const char = css[scanned];
      if (quote !== undefined) {
        if (char === '\\') scanned += 1;
        else if (char === quote || char === '\n') quote = undefined;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '{') {
        const head = css.slice(header, scanned);
        const opens = /^\s*@(?:media|supports|container)\b/.test(head);
        const layer = /^\s*@layer\b\s*([\w.-]*)\s*$/.exec(head);
        stack.push({
          conditional: opens,
          layer: layer
            ? name(layer[1] || `\u0000${(anonymous += 1)}`)
            : undefined,
        });
        if (opens) conditional += 1;
        header = scanned + 1;
      } else if (char === '}') {
        if (stack.pop()?.conditional) conditional -= 1;
        header = scanned + 1;
      } else if (char === ';') {
        const statement = /^\s*@layer\s+([\w.,\s-]+)$/.exec(
          css.slice(header, scanned),
        );
        if (statement) {
          for (const layer of statement[1]!.split(',')) {
            if (layer.trim()) name(layer.trim());
          }
        }
        header = scanned + 1;
      }
    }
    const inside = current();
    const parts = inside === undefined ? [] : inside.split('.');
    return {
      conditional: conditional > 0,
      layer: parts.map((_, i) => ranks.get(parts.slice(0, i + 1).join('.'))!),
    };
  };
}

export function readRootTokens(css: string): Map<string, string> {
  return readRootWeighted(css).tokens;
}

function readRootWeighted(css: string): WeightedTokens {
  const tokens = new Map<string, string>();
  const weights = new Map<string, Weight>();
  const context = blockTracker(css);
  let cursor = 0;
  while (cursor < css.length) {
    const selector = css.indexOf(':root', cursor);
    if (selector === -1) break;
    // The first `{` after the selector opens the block, and the first `}`
    // closes it. Nested rules inside :root would break this, but :root
    // carries declarations, not rules.
    const open = css.indexOf('{', selector);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    // Only a block whose selector list has a member that is the root
    // itself, one compound: `:root`, `html:root` or `:host`. `:root.dark`
    // is the dark theme, and `.scope :root` or `:root :root` select nothing
    // (#239 review). The list is read back from the brace to the rule,
    // block or declaration before it, stopping at the last block read. Not
    // one inside `@media`, which holds only some of the time (#239 review).
    let start = open;
    while (start > cursor && !'{};'.includes(css[start - 1]!)) start -= 1;
    const members = css
      .slice(start, open)
      .split(',')
      .map((member) => member.trim())
      .filter((member) => /^(?:(?:html)?(?::root)+|:host)$/.test(member));
    const { conditional, layer } = context(start);
    if (!conditional && members.length > 0) {
      readWeighted(
        css.slice(open + 1, close),
        {
          layer,
          specificity: Math.max(...members.map(specificity)),
          at: start,
        },
        tokens,
        weights,
      );
    }
    cursor = close + 1;
  }
  return { tokens, weights };
}

/**
 * An `oklch()` colour, as linear-light sRGB channels, or null if it is not
 * one this can measure.
 *
 * shadcn/ui writes every token this way (`--primary: oklch(0.205 0 0)`), so
 * a generated project on that stack has no hex to read, and the check
 * measured nothing at all. OKLCH is exact arithmetic from Björn Ottosson's
 * OKLab definition, not an approximation: lightness and chroma to OKLab, to
 * LMS, to linear sRGB. A colour outside sRGB is clipped, as a browser shows
 * it.
 *
 * Only an opaque colour: a translucent one's contrast depends on what shows
 * through it, which a token alone does not say. Lightness may be written as
 * a fraction or a percentage, and hue in degrees with or without the unit.
 */
function parseOklch(value: string): [number, number, number] | null {
  const parsed = readOklch(value);
  return parsed && parsed.alpha >= 1 ? parsed.linear : null;
}

/**
 * An `oklch()` colour as 8-bit sRGB channels and its alpha, or null. For
 * comparing a colour written one way with the same colour written another
 * (`oklch(0 0 0 / 0.5)` is `rgba(0,0,0,.5)`), where translucency is part of
 * what is compared rather than a reason to stop.
 */
export function oklchToRgb(
  value: string,
): { rgb: [number, number, number]; alpha: number } | null {
  const parsed = readOklch(value);
  if (!parsed) return null;
  const encode = (channel: number) =>
    Math.round(
      (channel <= 0.0031308
        ? channel * 12.92
        : 1.055 * channel ** (1 / 2.4) - 0.055) * 255,
    );
  const [r, g, b] = parsed.linear;
  return { rgb: [encode(r), encode(g), encode(b)], alpha: parsed.alpha };
}

function readOklch(
  value: string,
): { linear: [number, number, number]; alpha: number } | null {
  // A real oklch() is a few dozen characters. The pattern below backtracks
  // over long runs of digits, and a token's value is model output.
  if (value.length > 80) return null;
  const match =
    /^oklch\(\s*(\d*\.?\d+)(%?)\s+(\d*\.?\d+)(%?)\s+(-?\d*\.?\d+)(?:deg)?\s*(?:\/\s*(\d*\.?\d+)(%?)\s*)?\)$/i.exec(
      value.trim(),
    );
  if (!match) return null;
  const alpha =
    match[6] === undefined
      ? 1
      : Math.min(1, Number(match[6]) / (match[7] ? 100 : 1));
  const lightness = Number(match[1]) / (match[2] ? 100 : 1);
  // A chroma percentage is of 0.4, which CSS Color 4 defines as 100%.
  const chroma = match[4] ? (Number(match[3]) / 100) * 0.4 : Number(match[3]);
  const hue = (Number(match[5]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (channel: number) => Math.min(1, Math.max(0, channel));
  return {
    linear: [
      clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ],
    alpha,
  };
}

/**
 * The relative luminance of a token's value: a 6-digit hex or an opaque
 * `oklch()`, the two ways a generated project writes its tokens. Anything
 * else is null, so it is skipped rather than guessed at.
 */
export function tokenLuminance(value: string): number | null {
  const hex = relativeLuminance(value);
  if (hex !== null) return hex;
  const linear = parseOklch(value);
  if (!linear) return null;
  const [r, g, b] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function tokenContrast(a: string, b: string): number | null {
  const la = tokenLuminance(a);
  const lb = tokenLuminance(b);
  if (la === null || lb === null) return null;
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The custom properties a `.dark` class block declares: shadcn/ui's dark
 * theme, which redefines the same token names over `:root`'s. Read the
 * same linear way as `:root`, for the same reason.
 */
/**
 * A selector for the dark theme on the page itself: `.dark`, or the class
 * on the root, `html.dark`, `:root.dark` or `html:root.dark` (#239 review). Nothing more:
 * a combinator, `.dark .card`, selects something inside it, and any other
 * condition, `.dark:hover` or `.dark.compact`, holds only some of the time
 * (#239 review).
 */
function darkRoot(selector: string): boolean {
  // Only forms that can be the root or host: `body:root` never is
  // (#239 review).
  return /^(?:html(?::root)?|:root|:host|body)?\.dark$|^(?:html)?\.dark:root$/.test(
    selector,
  );
}

export function readDarkTokens(css: string): Map<string, string> {
  return readDarkWeighted(css).tokens;
}

function readDarkWeighted(css: string): WeightedTokens {
  const tokens = new Map<string, string>();
  const weights = new Map<string, Weight>();
  const context = blockTracker(css);
  let cursor = 0;
  while (cursor < css.length) {
    const selector = css.indexOf('.dark', cursor);
    if (selector === -1) break;
    const open = css.indexOf('{', selector);
    if (open === -1) break;
    // Only a block with the dark root in its selector list: `.dark .card`
    // or `.darker` declares something else, and `.dark, [data-theme=dark]`
    // applies to `.dark` (#239 review). The list is read back from the
    // brace to the rule, block or declaration before it; the walk back
    // stops at the last block read, so the whole pass stays linear.
    let start = open;
    while (start > cursor && !'{};'.includes(css[start - 1]!)) start -= 1;
    const head = css.slice(start, open);
    const close = css.indexOf('}', open);
    if (close === -1) break;
    // Not one inside `@media`, `@supports` or `@container`: it holds only
    // some of the time, and must not replace the theme's values
    // (#239 review).
    const members = head
      .split(',')
      .map((member) => member.trim())
      .filter(darkRoot);
    const { conditional, layer } = context(start);
    if (!conditional && members.length > 0) {
      // `body.dark` sets its properties on body, which holds them over
      // what body inherits from the root, whatever the root's selector or
      // layer.
      // Only when every member is on body: with `.dark, body.dark` and
      // the class on the root, `.dark` is what applies (#239 review).
      const onBody = members.every((member) => member.startsWith('body'));
      readWeighted(
        css.slice(open + 1, close),
        {
          layer: onBody ? [Number.POSITIVE_INFINITY] : layer,
          specificity: onBody
            ? Number.POSITIVE_INFINITY
            : Math.max(
                ...members
                  .filter((member) => !member.startsWith('body'))
                  .map(specificity),
              ),
          at: start,
        },
        tokens,
        weights,
      );
    }
    cursor = close + 1;
  }
  return { tokens, weights };
}

/**
 * The .dark declarations the cascade applies over :root's. With the class
 * on the root element, `html:root { --foreground: #666 }` holds over a
 * later `.dark` block's foreground (#239 review).
 */
function appliedDark(
  root: WeightedTokens,
  dark: WeightedTokens,
): Map<string, string> {
  const applied = new Map<string, string>();
  for (const [name, value] of dark.tokens) {
    const over = root.weights.get(name);
    if (over && outweighs(over, dark.weights.get(name)!)) continue;
    applied.set(name, value);
  }
  return applied;
}

export interface ContrastFinding {
  foreground: string;
  background: string;
  foregroundValue: string;
  backgroundValue: string;
  ratio: number;
  /** Set when the pair fails in the `.dark` theme rather than the default. */
  theme?: 'dark';
}

/**
 * Every declared text-on-surface pair that falls under 4.5:1, in the default
 * theme and, where a `.dark` block redefines tokens, in the dark one.
 *
 * Pairs are found by the naming convention this package emits, which is also
 * shadcn/ui's: `--x` with `--x-foreground`, plus `--background` with
 * `--foreground`. A token whose value is not a 6-digit hex or an opaque
 * `oklch()` is skipped rather than guessed at -- `rgb()` and `var()` are
 * legitimate too, and reporting a pair as passing when it was never
 * measured would be worse than reporting nothing.
 *
 * Hairlines are not checked. WCAG's 3:1 applies to interactive control
 * boundaries, not to a decorative rule between two surfaces, and holding a
 * `--border` token to it produces heavy-lined output no design system ships.
 */
/**
 * Colour tokens a Tailwind v4 `@theme` block declares with a literal value,
 * under the names the pairing convention uses: `--color-primary` is read
 * as `--primary`. A `var()` there points back at `:root`, which is read
 * directly, so only literals are taken.
 */
export function readThemeTokens(css: string): Map<string, string> {
  const declared = new Map<string, string>();
  let cursor = 0;
  while (cursor < css.length) {
    const at = css.indexOf('@theme', cursor);
    if (at === -1) break;
    const open = css.indexOf('{', at);
    if (open === -1) break;
    const close = css.indexOf('}', open);
    if (close === -1) break;
    readDeclarations(css.slice(open + 1, close), declared);
    cursor = close + 1;
  }
  const tokens = new Map<string, string>();
  for (const [name, value] of declared) {
    if (!name.startsWith('--color-')) continue;
    if (value.includes('var(')) continue;
    tokens.set(`--${name.slice('--color-'.length)}`, value);
  }
  return tokens;
}

/**
 * The stylesheet without its comments, in one pass: a commented-out
 * `@theme` or `:root` block is not a token the page draws (#239 review).
 * An unclosed comment runs to the end, as in CSS.
 */
function withoutCssComments(css: string): string {
  let out = '';
  let cursor = 0;
  // A `/*` inside a string, `content: "/*"`, starts no comment
  // (#239 review). A string ends at its quote or, unclosed, at the end of
  // the line, as in CSS; a backslash escapes the character after it.
  let copied = 0;
  while (cursor < css.length) {
    const char = css[cursor]!;
    if (char === '"' || char === "'") {
      cursor += 1;
      while (cursor < css.length) {
        const inner = css[cursor]!;
        if (inner === '\\') {
          cursor += 2;
          continue;
        }
        if (inner === char || inner === '\n') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      continue;
    }
    if (char === '/' && css[cursor + 1] === '*') {
      out += css.slice(copied, cursor);
      const close = css.indexOf('*/', cursor + 2);
      if (close === -1) return out;
      cursor = close + 2;
      copied = cursor;
      continue;
    }
    cursor += 1;
  }
  return out + css.slice(copied);
}

export function findContrastFailures(raw: string): ContrastFinding[] {
  const css = withoutCssComments(raw);
  // Utilities read --color-*. readThemeTokens keeps only the literal
  // ones: a `var()` there delegates to :root, the shadcn pattern, and is
  // left for :root to answer. So a literal @theme value is what the
  // utility draws, over a :root property of the same name, and .dark,
  // which only redefines :root's properties, does not reach it
  // (#239 review).
  const theme = readThemeTokens(css);
  const rootWeighted = readRootWeighted(css);
  const rootTokens = rootWeighted.tokens;
  // A block can also set the property a utility reads, `--color-*`, over
  // the @theme value (#239 review).
  const root = new Map([
    ...rootTokens,
    ...theme,
    ...colorOverrides(rootTokens, rootTokens),
  ]);
  const darkWeighted = readDarkWeighted(css);
  const dark = appliedDark(rootWeighted, darkWeighted);
  const findings = failingPairs(root);
  if (darkWeighted.tokens.size > 0) {
    // The dark theme is :root with .dark's declarations over it where the
    // cascade applies them. A pair that fails in both themes is reported
    // once, for the default.
    const base = new Map([...rootTokens, ...dark]);
    const merged = new Map([
      ...base,
      ...theme,
      ...colorOverrides(rootTokens, base),
      ...colorOverrides(dark, base),
    ]);
    const reported = new Set(
      findings.map((f) => `${f.foreground} ${f.background}`),
    );
    for (const finding of failingPairs(merged)) {
      const key = `${finding.foreground} ${finding.background}`;
      if (reported.has(key)) continue;
      findings.push({ ...finding, theme: 'dark' });
    }
  }
  return findings;
}

/**
 * The `--color-*` properties a block sets, under the names the pairing
 * convention uses, as readThemeTokens reads them: `--color-surface` is
 * `--surface`. A `var(--x)` there is resolved against `tokens`, and left
 * out when it cannot be.
 */
function colorOverrides(
  block: Map<string, string>,
  tokens: Map<string, string>,
): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const [name, value] of block) {
    if (!name.startsWith('--color-')) continue;
    const key = `--${name.slice('--color-'.length)}`;
    if (!value.includes('var(')) {
      overrides.set(key, value);
      continue;
    }
    const pointer = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
    const target = pointer ? tokens.get(pointer[1]!) : undefined;
    if (target !== undefined && !target.includes('var(')) {
      overrides.set(key, target);
    }
  }
  return overrides;
}

function failingPairs(tokens: Map<string, string>): ContrastFinding[] {
  const pairs: Array<[string, string]> = [];

  for (const name of tokens.keys()) {
    if (!name.endsWith('-foreground')) continue;
    const surface = name.slice(0, -'-foreground'.length);
    if (tokens.has(surface)) pairs.push([name, surface]);
  }
  if (tokens.has('--foreground') && tokens.has('--background')) {
    pairs.push(['--foreground', '--background']);
  }

  const findings: ContrastFinding[] = [];
  for (const [foreground, background] of pairs) {
    const foregroundValue = tokens.get(foreground)!;
    const backgroundValue = tokens.get(background)!;
    const ratio = tokenContrast(foregroundValue, backgroundValue);
    if (ratio === null) continue; // not measurable, so not claimed
    if (ratio >= AA_NORMAL_TEXT) continue;
    findings.push({
      foreground,
      background,
      foregroundValue,
      backgroundValue,
      ratio,
    });
  }
  return findings;
}
