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
import type { DerivedPalette, PaletteScheme } from './palette-derive.ts';

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

const THEME_COLOR =
  /<meta[^>]+name\s*=\s*["']theme-color["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i;

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
  stylesheets: readonly string[] = [],
): PageColors {
  const head = html.slice(0, MAX_SCAN_CHARS);

  let themeColor: string | null = null;
  const declared = THEME_COLOR.exec(head);
  if (declared?.[1]) {
    const [literal] = readColorLiterals(declared[1]);
    themeColor = literal ?? null;
  }

  const literals = readColorLiterals(head);
  for (const sheet of stylesheets) {
    literals.push(...readColorLiterals(sheet));
  }
  return { themeColor, literals };
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
  stylesheets: readonly string[] = [],
  scheme: PaletteScheme = 'analogous',
): ExtractedPalette | null {
  const colors = readPageColors(html, stylesheets);
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

  const palette = derivePalette(seed);
  if (!palette) return null;

  return {
    palette,
    source,
    declared: colors.themeColor === source,
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
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  const found: string[] = [];
  const seen = new Set<string>();
  const links = html.slice(0, MAX_SCAN_CHARS).matchAll(/<link\b([^>]*)>/gi);

  for (const link of links) {
    const attributes = link[1] ?? '';
    if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(attributes)) continue;
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i.exec(
      attributes,
    );
    const value = href?.[2] ?? href?.[3] ?? href?.[4];
    if (!value) continue;

    let resolved: URL;
    try {
      resolved = new URL(value, base);
    } catch {
      continue;
    }
    if (resolved.origin !== base.origin) continue;
    const absolute = resolved.toString();
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    found.push(absolute);
    if (found.length >= limit) break;
  }
  return found;
}
