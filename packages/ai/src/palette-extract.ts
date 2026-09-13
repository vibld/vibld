/**
 * A palette taken from a page someone pointed at.
 *
 * The reference URL already exists: `apps/web/worker/reference-fetch.ts`
 * fetches it and reduces it to plain text for the model to read. That throws
 * the markup away, and the markup is where the colours are, so this reads
 * them on the way past.
 *
 * What it gets is honestly partial, and the design follows from that. Only
 * the HTML is fetched, never the stylesheets it links, so a site that keeps
 * every colour in an external file offers nothing here.
 *
 * Two signals, in order. `<meta name="theme-color">` is a site stating its
 * own brand colour, which beats anything inferred from counting. Failing
 * that, every colour literal anywhere in the document.
 *
 * Anywhere, rather than in the places a stylesheet would put them, because
 * the first version read only `<style>` blocks and `style` attributes and
 * found nothing at all on four real sites. Hacker News was the one that made
 * it obvious: its orange is `bgcolor="#ff6600"`, an attribute that predates
 * CSS, and no amount of looking in the right modern places finds it. Colour
 * shows up in `bgcolor`, in inline SVG fills, in theme blobs and in
 * attributes nobody writes any more, and a scan that knows about markup
 * misses most of them. The saturation and lightness filters below are what
 * keep the noise out, so the scan itself does not need to be clever.
 *
 * When those yield nothing usable the answer is null and the caller carries
 * on as before. A palette guessed from no evidence is worse than no palette,
 * because the request still had a perfectly good default waiting behind it.
 *
 * Nothing here trusts what it reads. Every candidate is a string from
 * somebody else's page, so it is matched against a strict pattern, converted
 * to a hex through `color-space.ts`, and only ever used as a hue and a
 * saturation fed into the same solver the shipped library uses. A hostile
 * page can make this pick an ugly colour. It cannot make it emit anything
 * that is not a six-digit hex, and it cannot make it emit a failing pair.
 */

import { hexToHsl, oklchToHex } from './color-space.ts';
import { derivePalette, seedFromHex } from './palette-derive.ts';
import type {
  DerivedPalette,
  PaletteMode,
  PaletteScheme,
} from './palette-derive.ts';

/** `#abc` and `#aabbcc`, the two forms a stylesheet actually uses. */
const HEX_PATTERN = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;

/** `rgb(1, 2, 3)` and `rgba(1, 2, 3, .5)`, including the space-separated form. */
const RGB_PATTERN =
  /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+))?\s*\)/gi;

/**
 * `oklch(70.4% .191 22.216)`, with an optional `/ alpha`.
 *
 * Tailwind 4 emits every colour this way, which makes it the format a large
 * share of modern sites now publish. Without it, vibld.com's own stylesheet
 * yielded zero colours: the scan found plenty of `#0000` shadows and nothing
 * that was actually a colour.
 */
const OKLCH_PATTERN =
  /oklch\(\s*([\d.]+)(%?)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:deg)?(?:[\s,/]+([\d.]+%?))?\s*\)/gi;

/**
 * `<meta ...>` tags, and one attribute out of a tag's attribute list.
 *
 * Parsed in two steps rather than as one pattern per tag shape, because HTML
 * does not order attributes: `<meta content="#00add8" name="theme-color">`
 * is exactly as valid as the other way round, and a pattern that insists on
 * name-then-content silently demotes the site's own declaration to an
 * ordinary counted literal.
 */
/**
 * What ends a name in HTML and in CSS, which is not what `\b` thinks.
 *
 * A word boundary sits either side of a hyphen, so `\bbody\b` fires inside
 * `<body-copy>`, `.body-copy` and `data-body`, and `\bstyle\s*=` fires
 * inside `data-style="..."`. Every one of those is a different thing wearing
 * the name of a root element or a real attribute, and each was read as the
 * genuine article: a custom element decided the page's mode, a data
 * attribute was parsed as an inline style.
 *
 * So the rule is written once here and used at every name in this file,
 * rather than at whichever one was being looked at when it last went wrong.
 */
const NAME_ENDS = '(?![\\w-])';
const NAME_BEGINS = '(?:^|[\\s/])';
/** The same rule looking the other way: nothing joined onto the front. */
const NAME_ENDS_BEHIND = '(?<![\\w-])';

/**
 * Bounded like everything else that walks a fetched page: an unterminated
 * comment or style block must not send the scan off to the end of the
 * document from every position that looks like an opener.
 */
const HTML_COMMENT = /<!--[\s\S]{0,20000}?-->/g;
const CSS_COMMENT = /\/\*[\s\S]{0,20000}?\*\//g;
const STYLE_BLOCK = /<style\b[^>]{0,2000}>([\s\S]{0,200000}?)<\/style\s*>/gi;
const SCRIPT_BLOCK = /<script\b[^>]{0,2000}>[\s\S]{0,200000}?<\/script\s*>/gi;

/**
 * The document with the parts a browser does not treat as markup removed.
 *
 * A commented-out `<link>`, or a `<link ...>` quoted inside a script
 * payload, is a tag the page is carrying rather than one it loads. Read off
 * the raw document they both look live, and the difference is a request
 * this Worker makes that no browser would.
 *
 * The replacement keeps a space rather than closing the gap, so nothing
 * either side of a removed span is accidentally joined into a new tag.
 */
function markupOnly(html: string): string {
  return html.replace(HTML_COMMENT, ' ').replace(SCRIPT_BLOCK, ' ');
}

const META_TAG = new RegExp(`<meta${NAME_ENDS}([^>]*)>`, 'gi');

function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(
    `${NAME_BEGINS}${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s">]+))`,
    'i',
  ).exec(attributes);
  return found?.[2] ?? found?.[3] ?? found?.[4] ?? null;
}

/** The `content` of the first `<meta name="...">` matching, or null. */
function metaContent(html: string, name: string): string | null {
  for (const tag of html.matchAll(META_TAG)) {
    const attributes = tag[1] ?? '';
    const declared = attribute(attributes, 'name');
    if (!declared || declared.trim().toLowerCase() !== name) continue;
    const content = attribute(attributes, 'content');
    if (content) return content;
  }
  return null;
}

/**
 * Where a page states its own ground, and how that is recognised.
 *
 * Only the root elements count. An earlier version counted every
 * `background:` declaration it could find and got two of seven real sites
 * wrong, both of them light sites called dark: a utility stylesheet defines
 * a rule for every colour it offers, so counting declarations counts what a
 * framework can do rather than what the page does. `html`, `body` and
 * `:root` are the ground by definition, and there is no counting to get
 * wrong.
 *
 * Every quantifier here is bounded, and that is the point of them. This
 * reads somebody else's page inside a Worker with a CPU budget, so a
 * pattern's worst case is an input an attacker gets to choose. An earlier
 * version scanned lazily for the next `{`, which backtracks from every
 * delimiter it has passed: 60,000 semicolons with no brace after them cost
 * 3.3 seconds, and the character cap allows three times that. Measured, not
 * suspected. A selector past 300 characters, a declaration block past 4,000
 * and a tag past 2,000 are not real markup, so refusing to look further
 * costs nothing and keeps the work linear in the size of the page.
 */
const ROOT_TAG = new RegExp(`<(?:html|body)${NAME_ENDS}([^>]{0,2000})>`, 'gi');
// A lookbehind rather than a consumed delimiter: a rule ends on the `}` that
// the next rule needs in front of it, so consuming it made every second rule
// in `body{...}body{...}` invisible.
const CSS_RULE = /(?<![^{};])([^{}]{0,300})\{([^{}]{0,4000})\}/g;
/**
 * A property name is not a suffix of another one. `--card-background:` ends
 * in `background:`, so an unanchored pattern reads a custom property as a
 * declaration on the root, and a rule defining `--page-background` and
 * `--card-background` handed the page whichever came last.
 */
const BACKGROUND_DECLARATION = new RegExp(
  `${NAME_ENDS_BEHIND}background(?:-color)?\\s*:\\s*([^;{}"']{0,200})`,
  'gi',
);

/**
 * Not preceded by a letter or a hyphen, because `prefers-color-scheme:
 * dark` contains `color-scheme: dark`. A pattern that does not say so reads
 * every site with a dark-mode media query as a dark site: that made four of
 * seven real sites come back dark, two of them wrong, and it hid the fact
 * that the background scan underneath was never being reached.
 */
const COLOR_SCHEME_DECLARATION = new RegExp(
  `${NAME_ENDS_BEHIND}color-scheme\\s*:\\s*([a-z\\s]{0,40})`,
  'i',
);

/** `dark` or `light` out of a `color-scheme` value, or null. */
function schemeWord(value: string): PaletteMode | null {
  // `dark light` means the site prefers dark and will do light; the first of
  // the two named is the preference, and `only dark` says it more firmly.
  const first = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .find((word) => word === 'dark' || word === 'light');
  return first === 'dark' || first === 'light' ? first : null;
}

function schemeIn(block: string): PaletteMode | null {
  const found = COLOR_SCHEME_DECLARATION.exec(block);
  return found?.[1] ? schemeWord(found[1]) : null;
}

function backgroundsIn(block: string): string[] {
  const found: string[] = [];
  for (const declaration of block.matchAll(BACKGROUND_DECLARATION)) {
    // A shorthand can be a gradient, a url, or `transparent`. Anything that
    // is not a colour literal contributes nothing and is skipped.
    found.push(...readColorLiterals(declaration[1] ?? ''));
  }
  return found;
}

/**
 * Whether this selector list actually selects the document root.
 *
 * Tokenised rather than pattern-matched, because CSS punctuation is not word
 * characters and a word boundary therefore fires inside `.body`, `#body`,
 * `[data-body]`, `.html-preview` and `body-copy`. Every one of those is an
 * ordinary component whose background would otherwise decide what the whole
 * page's mode is.
 *
 * The rightmost compound selector is the one the rule is about: in
 * `.dark body` the subject is `body`, and in `body .card` it is `.card`. So
 * the subject is taken and then required to begin with the element or the
 * pseudo-class itself, with nothing glued to it.
 */
function selectsRoot(selectorList: string): boolean {
  for (const selector of selectorList.split(',')) {
    const compounds = selector
      .trim()
      .split(/[\s>+~]+/)
      .filter(Boolean);
    const subject = compounds[compounds.length - 1];
    if (!subject) continue;
    if (new RegExp(`^(?:html|body|:root)${NAME_ENDS}`, 'i').test(subject)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the page is a light page or a dark one, from the page's own words
 * first and the colour it paints its root second.
 *
 * `color-scheme` is a site stating this outright, so it is taken as stated,
 * but only where it applies to the whole page: in the meta tag, on a root
 * element's `style`, or in a rule whose subject is a root. A component that
 * scopes `color-scheme: dark` to its own subtree is not the page saying it
 * is dark, and the unrestricted search this replaces could not tell the
 * difference (nor tell either of them from the same words inside a comment
 * or a script).
 *
 * Failing that, the first ground colour the page actually sets decides.
 * Null when it sets none, which is the one case where guessing from the
 * brand colour beats having nothing.
 */
function readGroundMode(
  html: string,
  stylesheets: readonly Stylesheet[],
  pageUrl: string | undefined,
): PaletteMode | null {
  const text = withoutDarkOverrides(markupOnly(html.slice(0, MAX_SCAN_CHARS)));

  const meta = metaContent(text, 'color-scheme');
  const declared = meta ? schemeWord(meta) : null;
  if (declared) return declared;

  // Kept apart because they do not rank the same way. Among rules the later
  // one wins, which is the cascade; between a rule and the element's own
  // `style` the inline one wins wherever it sits in the file, which is
  // specificity. Collapsing the two into one list and taking the first
  // qualifying literal got both backwards.
  const fromRules: string[] = [];
  const fromInline: string[] = [];
  let inlineScheme: PaletteMode | null = null;
  let ruleScheme: PaletteMode | null = null;

  // The root elements themselves. A page that writes its ground inline, as
  // `<body style="background:#0d1117">`, is stating it as plainly as a
  // stylesheet does, and reading only the legacy `bgcolor` attribute missed
  // every site that does.
  for (const tag of text.matchAll(ROOT_TAG)) {
    const attributes = tag[1] ?? '';
    // The whole tag, not just its `style`, because a page can state its
    // scheme on the root element through the class list too: astro.build
    // writes `class="... [color-scheme:dark] ..."`, Tailwind's arbitrary
    // property syntax, and reading only `style` called that dark site light.
    // A `color-scheme:` written anywhere on `html` or `body` is the page
    // saying it whichever attribute carries it.
    inlineScheme = schemeIn(attributes) ?? inlineScheme;
    const style = attribute(attributes, 'style');
    if (style) fromInline.push(...backgroundsIn(style));
    const legacy = attribute(attributes, 'bgcolor');
    // A presentational attribute, which the cascade puts below a stylesheet
    // rule rather than above it.
    if (legacy) fromRules.push(...readColorLiterals(legacy));
  }

  for (const css of cssInDocumentOrder(text, stylesheets, pageUrl)) {
    const rules = withoutDarkOverrides(
      css.slice(0, MAX_SCAN_CHARS).replace(CSS_COMMENT, ' '),
    );
    for (const rule of rules.matchAll(CSS_RULE)) {
      if (!selectsRoot(rule[1] ?? '')) continue;
      const block = rule[2] ?? '';
      // The last applicable one, not the first. Two root rules both setting
      // `color-scheme` are not ambiguous: the browser takes the later, the
      // same way it takes the later background, and keeping the first was
      // this scan disagreeing with itself.
      ruleScheme = schemeIn(block) ?? ruleScheme;
      fromRules.push(...backgroundsIn(block));
    }
  }

  const scheme = inlineScheme ?? ruleScheme;
  if (scheme) return scheme;
  return modeOf(fromInline) ?? modeOf(fromRules);
}

/**
 * A stylesheet the caller fetched, and where it was linked from.
 *
 * The URL is what puts it back in its place in the document. Without it a
 * sheet can only be assumed to come before every inline block, which is
 * usually true and is wrong exactly when a page links a theme and then
 * overrides it in a `<style>` further down.
 */
export interface Stylesheet {
  url: string;
  text: string;
}

/**
 * Every piece of CSS the document applies, in the order it applies them.
 *
 * Order is the whole point: `modeOf` takes the last ground, so scanning all
 * the style blocks and then all the linked sheets hands the page to the
 * sheet no matter where it was linked. A `<style>` after a `<link>`
 * overrides it in a browser and has to here.
 *
 * A sheet passed without a URL cannot be placed, so it goes first, which is
 * where a linked sheet usually is.
 */
function cssInDocumentOrder(
  markup: string,
  stylesheets: readonly Stylesheet[],
  pageUrl: string | undefined,
): string[] {
  const byUrl = new Map(stylesheets.map((sheet) => [sheet.url, sheet.text]));
  const placed = new Set<string>();
  const ordered: { at: number; css: string }[] = [];

  for (const block of markup.matchAll(STYLE_BLOCK)) {
    ordered.push({ at: block.index ?? 0, css: block[1] ?? '' });
  }
  for (const link of pageUrl ? stylesheetLinks(markup, pageUrl) : []) {
    const text = byUrl.get(link.url);
    if (text === undefined) continue;
    placed.add(link.url);
    ordered.push({ at: link.at, css: text });
  }
  ordered.sort((one, other) => one.at - other.at);

  const unplaced = stylesheets
    .filter((sheet) => !placed.has(sheet.url))
    .map((sheet) => sheet.text);
  return [...unplaced, ...ordered.map((entry) => entry.css)];
}

/**
 * The mode of the last of these grounds that has one.
 *
 * The last rather than the first, because a stylesheet that sets a root
 * background twice is not ambiguous: the browser applies the later one. A
 * mid-tone ground has no mode, and saying so is better than rounding it to
 * whichever side it happens to be nearer, so the scan keeps looking back
 * through the earlier ones.
 */
function modeOf(grounds: readonly string[]): PaletteMode | null {
  for (let at = grounds.length - 1; at >= 0; at -= 1) {
    const hsl = hexToHsl(grounds[at]!);
    if (!hsl) continue;
    if (hsl.lightness >= 60) return 'light';
    if (hsl.lightness <= 40) return 'dark';
  }
  return null;
}

/**
 * `source` with every `prefers-color-scheme: dark` block removed.
 *
 * Those blocks are what a light site says when the reader has asked for
 * dark, not what the site is. Left in, they make a light site with a dark
 * mode read as dark. Brace-matched rather than pattern-matched, because a
 * media block contains rules and a rule contains braces.
 */
function withoutDarkOverrides(source: string): string {
  // Bounded for the reason the patterns above are: `@media` followed by a
  // long run with no brace backtracks from every position it passed, and a
  // media query is not a thousand characters long.
  const opener =
    /@media[^{]{0,500}prefers-color-scheme\s*:\s*dark[^{]{0,500}\{/gi;
  let out = '';
  let cursor = 0;
  for (const match of source.matchAll(opener)) {
    const start = match.index;
    if (start === undefined || start < cursor) continue;
    let depth = 1;
    let at = start + match[0].length;
    while (at < source.length && depth > 0) {
      if (source[at] === '{') depth += 1;
      else if (source[at] === '}') depth -= 1;
      at += 1;
    }
    out += source.slice(cursor, start);
    cursor = at;
  }
  return out + source.slice(cursor);
}

/**
 * How much of the document is scanned for colours.
 *
 * The caller already caps what it reads off the network, but that cap exists
 * to bound the fetch. This one bounds the regex work, which is a separate
 * cost and the one that runs on every reference URL. The interesting colours
 * are in the head and the first screenful anyway.
 */
const MAX_SCAN_CHARS = 180_000;

function expandShorthand(hex: string): string {
  const body = hex.slice(1);
  if (body.length === 6) return `#${body.toLowerCase()}`;
  return `#${body
    .toLowerCase()
    .split('')
    .map((char) => char + char)
    .join('')}`;
}

function rgbToHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some((channel) => channel < 0 || channel > 255)) return null;
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Every colour literal in a chunk of CSS or markup, in the order found. */
export function readColorLiterals(source: string): string[] {
  const text = source.slice(0, MAX_SCAN_CHARS);
  const found: string[] = [];

  for (const match of text.matchAll(HEX_PATTERN)) {
    found.push(expandShorthand(match[0]));
  }
  for (const match of text.matchAll(OKLCH_PATTERN)) {
    const alpha = match[5];
    if (alpha !== undefined) {
      const value = Number.parseFloat(alpha);
      const fraction = alpha.endsWith('%') ? value / 100 : value;
      if (Number.isFinite(fraction) && fraction < 0.25) continue;
    }
    const raw = Number.parseFloat(match[1]!);
    const hex = oklchToHex(
      match[2] === '%' ? raw / 100 : raw,
      Number.parseFloat(match[3]!),
      Number.parseFloat(match[4]!),
    );
    if (hex) found.push(hex);
  }
  for (const match of text.matchAll(RGB_PATTERN)) {
    // A fully transparent colour is not a colour anyone sees, and it is a
    // common way to write "nothing here".
    const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
    if (Number.isFinite(alpha) && alpha < 0.25) continue;
    const hex = rgbToHex(
      Number.parseInt(match[1]!, 10),
      Number.parseInt(match[2]!, 10),
      Number.parseInt(match[3]!, 10),
    );
    if (hex) found.push(hex);
  }
  return found;
}

export interface PageColors {
  /** The site's own declared colour, when it declares one. */
  themeColor: string | null;
  /** Every colour literal in the document, in the order found. */
  literals: string[];
  /**
   * Whether the page itself is light or dark, when it says so or shows so.
   * Null when there is no evidence either way, which is the only case where
   * a guess from the brand colour is better than nothing.
   */
  groundMode: PaletteMode | null;
}

/**
 * The colour evidence a page offers, without judging it yet.
 *
 * `stylesheets` is whatever the caller managed to fetch alongside the HTML.
 * Each source is scanned under its own cap rather than concatenated, so one
 * enormous stylesheet cannot push the page's own markup out of the window.
 */
export function readPageColors(
  html: string,
  stylesheets: readonly (string | Stylesheet)[] = [],
  pageUrl?: string,
): PageColors {
  // A bare string is a sheet whose place in the document is unknown, which
  // is the shape most callers and every test uses.
  const sheets: Stylesheet[] = stylesheets.map((sheet) =>
    typeof sheet === 'string' ? { url: '', text: sheet } : sheet,
  );
  const head = html.slice(0, MAX_SCAN_CHARS);

  let themeColor: string | null = null;
  const declared = metaContent(head, 'theme-color');
  if (declared) {
    const [literal] = readColorLiterals(declared);
    themeColor = literal ?? null;
  }

  const literals = readColorLiterals(head);
  for (const sheet of sheets) {
    literals.push(...readColorLiterals(sheet.text));
  }

  return {
    themeColor,
    literals,
    groundMode: readGroundMode(head, sheets, pageUrl),
  };
}

/**
 * The one colour that most looks like the page's brand colour, or null.
 *
 * Frequency alone picks the wrong thing. The commonest colour on almost any
 * page is its text or its background, which is a near-black, a near-white or
 * a grey, and a palette seeded from those is a palette with no colour in it.
 * So the near-neutrals and the near-extremes are set aside first and the
 * commonest of what remains wins.
 *
 * A declared `theme-color` skips all of that. It is the site saying which
 * colour is its own, and no amount of counting beats being told.
 */
export function dominantBrandColor(colors: PageColors): string | null {
  if (colors.themeColor) {
    const hsl = hexToHsl(colors.themeColor);
    // Still filtered: plenty of sites declare white or black here, which is
    // true and useless as a brand colour.
    if (
      hsl &&
      hsl.saturation >= 12 &&
      hsl.lightness > 6 &&
      hsl.lightness < 94
    ) {
      return colors.themeColor;
    }
  }

  const counts = new Map<string, number>();
  for (const literal of colors.literals) {
    const hsl = hexToHsl(literal);
    if (!hsl) continue;
    if (hsl.saturation < 18) continue;
    if (hsl.lightness < 12 || hsl.lightness > 90) continue;
    counts.set(literal, (counts.get(literal) ?? 0) + 1);
  }

  let best: { hex: string; count: number } | null = null;
  for (const [hex, count] of counts) {
    // Ties go to the more saturated colour, which is the more likely brand
    // colour of two that appear equally often.
    if (!best || count > best.count) {
      best = { hex, count };
      continue;
    }
    if (count === best.count) {
      const a = hexToHsl(hex);
      const b = hexToHsl(best.hex);
      if (a && b && a.saturation > b.saturation) best = { hex, count };
    }
  }
  return best?.hex ?? null;
}

export interface ExtractedPalette {
  palette: DerivedPalette;
  /** The colour the page was seeded from, so a caller can say where it came from. */
  source: string;
  /** Whether the site declared it or it was counted out of the CSS. */
  declared: boolean;
  /**
   * The mode the palette was built for, so a caller re-deriving it later
   * gets the same one rather than re-guessing from the hex.
   */
  mode: PaletteMode;
}

/**
 * A palette derived from a page's own colours, or null when the page does
 * not offer enough to derive one.
 *
 * The result is an ordinary `DerivedPalette`, identical in kind to a library
 * entry and built by the same solver, so everything downstream treats the two
 * the same and the contrast guarantee is the same guarantee.
 */
export function paletteFromPage(
  html: string,
  stylesheets: readonly (string | Stylesheet)[] = [],
  scheme: PaletteScheme = 'analogous',
  pageUrl?: string,
): ExtractedPalette | null {
  const colors = readPageColors(html, stylesheets, pageUrl);
  const source = dominantBrandColor(colors);
  if (!source) return null;

  const seed = seedFromHex(
    source,
    'reference',
    'From the reference site',
    `Derived from ${source}, the dominant colour of the page you pointed at.`,
    scheme,
  );
  if (!seed) return null;

  // The page's own evidence outranks the seed's lightness. `seedFromHex`
  // reads a mode off the colour because a bare hex is all it has; here there
  // is a whole document, and what it says about its own ground beats an
  // inference drawn from one accent.
  const palette = derivePalette(
    colors.groundMode ? { ...seed, mode: colors.groundMode } : seed,
  );
  if (!palette) return null;

  return {
    palette,
    source,
    declared: colors.themeColor === source,
    mode: palette.mode,
  };
}

/**
 * Same-origin stylesheet URLs a page links, absolute, deduplicated, capped.
 *
 * Most sites keep their colours nowhere this module can otherwise see them.
 * Of six real sites tried, three (vibld.com, ruby-lang.org, mozilla.org)
 * returned not one colour literal from their HTML, because everything lives
 * in a linked file. Reading those files is the difference between a feature
 * that usually works and one that usually returns null.
 *
 * Same-origin only, and not because cross-origin CSS is hard to fetch. The
 * page has already been fetched, so its own origin is one the caller decided
 * to reach; every other origin on the page is one the caller never named,
 * and following those turns "fetch the URL I gave you" into "fetch whatever
 * that page links", which is a different and much larger promise. It also
 * happens to fix a wrong answer: counting colours across a whole page gave
 * Stripe's site Google's blue, from an embedded button, and a third-party
 * stylesheet would have supplied far more of the same.
 *
 * Capped at two because this is a latency budget someone is waiting inside
 * of, and the first stylesheets a page links are the ones carrying its
 * chrome.
 */
export function sameOriginStylesheets(
  html: string,
  pageUrl: string,
  limit = 2,
): string[] {
  return stylesheetLinks(html, pageUrl, limit).map((link) => link.url);
}

/** The same links, each with where in the document it was written. */
function stylesheetLinks(
  html: string,
  pageUrl: string,
  limit = 2,
): { url: string; at: number }[] {
  let origin: URL;
  try {
    origin = new URL(pageUrl);
  } catch {
    return [];
  }

  // `<base href>` is what the browser resolves relative URLs against, so it
  // is what this has to resolve them against too: a page served at `/` with
  // `<base href="/assets/">` links `theme.css` meaning `/assets/theme.css`,
  // and resolving against the page instead fetches a path that is not there.
  //
  // It changes where a relative href points, not which origins may be
  // reached. The same-origin test below still compares against the page's
  // own origin, so a base pointing somewhere else makes the sheets
  // cross-origin and they are dropped, which is the right answer.
  let base = origin;
  const declared = new RegExp(`<base${NAME_ENDS}([^>]{0,2000})>`, 'i').exec(
    html.slice(0, MAX_SCAN_CHARS),
  );
  const href = declared ? attribute(declared[1] ?? '', 'href') : null;
  if (href) {
    try {
      base = new URL(href, origin);
    } catch {
      // A base this module cannot parse is a base it ignores.
    }
  }

  const found: { url: string; at: number }[] = [];
  const seen = new Set<string>();
  // Markup only, for the reason the rule scan is: a `<link>` inside a
  // comment or quoted in a script payload is a tag the page is carrying,
  // not one the browser loads, and following it made this Worker fetch a
  // URL no browser would have asked for.
  const links = markupOnly(html.slice(0, MAX_SCAN_CHARS)).matchAll(
    new RegExp(`<link${NAME_ENDS}([^>]*)>`, 'gi'),
  );

  for (const link of links) {
    const attributes = link[1] ?? '';
    // Read as an attribute and compared token by token. The word-boundary
    // pattern this replaces matched `data-rel="stylesheet"` and the rel
    // token `stylesheet-preview`, and would then have fetched whatever the
    // href pointed at as if it were CSS. It is the same boundary rule as the
    // rest of the file; this was the one place still doing it by hand.
    const rel = attribute(attributes, 'rel');
    if (!rel) continue;
    if (!rel.trim().toLowerCase().split(/\s+/).includes('stylesheet')) {
      continue;
    }
    const value = attribute(attributes, 'href');
    if (!value) continue;

    let resolved: URL;
    try {
      resolved = new URL(value, base);
    } catch {
      continue;
    }
    if (resolved.origin !== origin.origin) continue;
    const absolute = resolved.toString();
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    found.push({ url: absolute, at: link.index ?? 0 });
    if (found.length >= limit) break;
  }
  return found;
}
