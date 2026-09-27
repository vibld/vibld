/**
 * The parts of an HTML page a browser would apply as style, read the way
 * a browser reads them.
 *
 * One definition, used by everything that reads someone else's page for
 * its design: the measurements handed to a build (`design-spec.ts`) and the
 * stylesheets the reference fetch follows (`palette-extract.ts`). Two
 * definitions of "live" had drifted apart, and a `<link>` quoted inside a
 * `<style>` was one's markup and the other's text.
 */

/**
 * Whether a media query is one a screen matches.
 *
 * A comma-separated list applies if any one of its queries does, and `not`
 * inverts the query it leads. Detecting type names without reading the `not`
 * gets both cases exactly backwards: `not screen` was accepted for
 * containing `screen` and `not print` refused for containing `print`.
 *
 * Generous about feature queries on purpose: `(min-width: 40em)` describes
 * which screen rather than whether, so it counts as applying. That is the
 * right answer for deciding whether to fetch a sheet at all. Deciding
 * whether its rules are in force is a different question, and
 * `alwaysOnScreen` below is the stricter test used for that.
 */
export function appliesOnScreen(media: string): boolean {
  const value = media.trim().toLowerCase();
  if (value.length === 0) return true;

  for (const query of value.split(',')) {
    const one = query.trim();
    const names = /\b(?:screen|all)\b/.test(one);
    const other =
      /\b(?:print|speech|aural|braille|tty|tv|projection|handheld)\b/.test(one);
    if (/^not\b/.test(one)) {
      // `not print` applies on a screen; `not screen` and `not all` do not.
      if (!names) return true;
      continue;
    }
    if (names || !other) return true;
  }
  return false;
}

/**
 * Elements whose content is text, not markup: a `<style>` inside one of
 * these is something the page shows or runs, not CSS it applies. The first
 * closer ends each of them, as it does in a browser.
 *
 * `<template>` is not one of these. Its content is markup, parsed but never
 * rendered, so it can hold another template, and is counted instead.
 */
const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'noscript',
  'noembed',
  'noframes',
  'iframe',
  'textarea',
  'title',
  'xmp',
]);

/** Longest single tag read for attributes; a tag longer than this is not a real one. */
const MAX_TAG_CHARS = 4_096;

export interface LiveMarkup {
  /** The text of every `<style>` block a browser would apply. */
  styles: string[];
  /** Every `style` attribute's value, in any of HTML's three quote forms. */
  styleAttributes: string[];
  /**
   * Every stylesheet `<link>` a browser would apply: `rel` has the token
   * `stylesheet` and not `alternate`, it is not `disabled`, and its media
   * can apply on a screen. `at` is where the tag starts in the input, for
   * putting linked sheets and `<style>` blocks in document order.
   */
  stylesheets: { href: string; at: number }[];
  /** The first live `<base href>`, which relative URLs resolve against. */
  base?: string;
}

/**
 * `text` with A to Z lowered and nothing else touched, so every offset in
 * it is the same offset in `text`. `toLowerCase` is not that: `İ` lowers
 * to two UTF-16 units, and every position after it would point one place
 * off in the original, so tags found in the lowered copy would be read from
 * the wrong place in the real one. Tag names and the CSS keywords looked
 * for here are ASCII, so nothing is lost.
 */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
}

/**
 * The parts of a page a browser would render as style, in one pass.
 *
 * One forward scan with `indexOf`, never a pattern that searches from every
 * opener, because this reads a fetched reference page (up to 512 KiB of
 * someone else's markup) inside a Worker's CPU budget: a page of unmatched
 * `<style>` openers must cost a single read, not one read per opener.
 *
 * A comment, an inert element or a `<style>` with no closer runs to the end
 * of the input, as it would in a browser. That matters because the input is
 * often cut off at a byte cap: a `<script>` truncated before its `</script>`
 * is still a script, and whatever `<style>` text is inside it is not CSS.
 */
export function scanLiveMarkup(html: string): LiveMarkup {
  const lower = asciiLower(html);
  const found: LiveMarkup = {
    styles: [],
    styleAttributes: [],
    stylesheets: [],
  };
  // Templates open, innermost last: `true` for an inert one, whose content
  // is parsed but never rendered, so nothing in it is collected; `false`
  // for a declarative shadow root (`shadowrootmode`), which the browser
  // attaches and renders, so its styles are the page's. Its own tags are
  // still read, so a template inside one is counted and its closer does not
  // end the outer.
  const templates: boolean[] = [];
  let inert = 0;
  // Foreign content open, innermost last: `svg` and `math`, and `html` for
  // a <foreignObject> inside SVG. A <link> or <base> in SVG or MathML is not
  // an HTML element, and the browser neither loads nor resolves against it.
  const namespaces: string[] = [];
  const inForeign = () => {
    const top = namespaces[namespaces.length - 1];
    return top === 'svg' || top === 'math';
  };
  let at = 0;
  while (at < html.length) {
    const open = lower.indexOf('<', at);
    if (open === -1) break;
    if (lower.startsWith('<!--', open)) {
      const close = lower.indexOf('-->', open + 4);
      if (close === -1) break;
      at = close + 3;
      continue;
    }
    // CDATA (inline SVG and MathML carry it) is character data to its
    // `]]>`, so a <style> or <link> written inside it is text. Any other
    // `<!...>` (a doctype) or `<?...>` is a bogus comment to its first `>`.
    if (lower.startsWith('<![cdata[', open)) {
      const close = lower.indexOf(']]>', open + 9);
      if (close === -1) break;
      at = close + 3;
      continue;
    }
    if (lower.startsWith('<!', open) || lower.startsWith('<?', open)) {
      const close = lower.indexOf('>', open + 2);
      if (close === -1) break;
      at = close + 1;
      continue;
    }
    const closing = /^<\/([a-z][a-z0-9-]*)/.exec(
      lower.slice(open, open + 40),
    )?.[1];
    if (closing !== undefined) {
      if (closing === 'template' && templates.length > 0) {
        if (templates.pop()) inert -= 1;
      }
      if (
        closing === 'svg' ||
        closing === 'math' ||
        closing === 'foreignobject'
      ) {
        const opened = namespaces.lastIndexOf(
          closing === 'foreignobject' ? 'html' : closing,
        );
        if (opened !== -1) namespaces.length = opened;
      }
      // The whole end tag, quoted attributes and all: a browser reads
      // `</div data-x="<style>...">` as one end tag, so nothing in it is
      // markup. One cut off before its `>` runs to the end.
      const endTag = readTag(html, open + 2 + closing.length);
      if (endTag === undefined) break;
      at = endTag.end + 1;
      continue;
    }
    const name = /^<([a-z][a-z0-9-]*)/.exec(lower.slice(open, open + 40))?.[1];
    if (name === undefined) {
      at = open + 1;
      continue;
    }
    const tag = readTag(html, open + 1 + name.length);
    if (tag === undefined) break;
    at = tag.end + 1;

    // Everything after <plaintext> is text, to the end of the document.
    if (name === 'plaintext') break;
    if (name === 'template') {
      const isInert = !tag.attributes.has('shadowrootmode');
      templates.push(isInert);
      if (isInert) inert += 1;
      continue;
    }
    const selfClosing = html[tag.end - 1] === '/';
    if ((name === 'svg' || name === 'math') && !selfClosing) {
      namespaces.push(name);
    } else if (name === 'foreignobject' && inForeign() && !selfClosing) {
      namespaces.push('html');
    }
    if (RAW_TEXT_ELEMENTS.has(name) || name === 'style') {
      const close = closingTag(lower, name, at);
      if (
        name === 'style' &&
        inert === 0 &&
        isCssType(tag.attributes.get('type')) &&
        onScreen(tag.attributes.get('media'))
      ) {
        found.styles.push(html.slice(at, close === -1 ? html.length : close));
      }
      if (close === -1) break;
      // Past the whole end tag, quoted attributes and all: a browser reads
      // `</script data-x="<style>...">` as one end tag, so nothing in it is
      // markup. An end tag cut off before its `>` runs to the end.
      const endTag = readTag(html, close + 2 + name.length);
      if (endTag === undefined) break;
      at = endTag.end + 1;
      continue;
    }
    if (inert > 0) continue;
    const style = tag.attributes.get('style');
    if (style !== undefined) found.styleAttributes.push(style);
    const rel = (tag.attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    // `alternate stylesheet` is one the page offers, not one it applies.
    if (
      name === 'link' &&
      !inForeign() &&
      rel.includes('stylesheet') &&
      !rel.includes('alternate') &&
      !tag.attributes.has('disabled') &&
      isCssType(tag.attributes.get('type')) &&
      onScreen(tag.attributes.get('media'))
    ) {
      const href = tag.attributes.get('href');
      if (href !== undefined) {
        found.stylesheets.push({
          href,
          at: open,
        });
      }
    }
    if (name === 'base' && !inForeign() && found.base === undefined) {
      const href = tag.attributes.get('href');
      if (href !== undefined) found.base = href;
    }
  }
  return found;
}

/**
 * Where the raw-text element `name` ends: the first `</name` that is the
 * whole tag name, followed by whitespace, `/`, `>` or the end of input, as
 * the HTML tokenizer requires. `</scripture>` does not end a `<script>`.
 * -1 when there is none. Each miss moves forward, so this stays one pass.
 */
function closingTag(lower: string, name: string, from: number): number {
  const opener = `</${name}`;
  let at = lower.indexOf(opener, from);
  while (at !== -1) {
    const next = lower[at + opener.length];
    if (next === undefined || /[\s/>]/.test(next)) return at;
    at = lower.indexOf(opener, at + opener.length);
  }
  return -1;
}

/** The named references an attribute value is likely to carry. */
const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * An attribute value with its character references decoded, as a browser
 * decodes them before anything reads the value: `style="font-family:
 * &quot;Open Sans&quot;"` is a quoted family, and `href="...&amp;family=B"`
 * is two families. Numeric references and the common named ones; anything
 * else is left as written.
 */
function decodeReferences(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi,
    (whole, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined)
        return NAMED_REFERENCES[name.toLowerCase()] ?? whole;
      const code = decimal !== undefined ? Number(decimal) : parseInt(hex!, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/**
 * One start tag's attributes and where it ends, read the way the HTML
 * tokenizer reads them: a quoted value runs to its own closing quote,
 * whatever it contains, so `title="1 > 0"` does not end the tag and
 * `title=" style=..."` is not a style attribute. The first of a repeated
 * attribute wins, as it does in a browser. `undefined` when the tag, or a
 * quoted value in it, is never closed.
 *
 * `from` is just past the tag name. One pass: the caller resumes after
 * `end`, so no character is read twice.
 */
function readTag(
  html: string,
  from: number,
): { end: number; attributes: Map<string, string> } | undefined {
  const attributes = new Map<string, string>();
  const isSpace = (char: string | undefined) =>
    char !== undefined && /\s/.test(char);
  let at = from;
  for (;;) {
    while (isSpace(html[at]) || html[at] === '/') at += 1;
    if (at >= html.length) return undefined;
    if (html[at] === '>') return { end: at, attributes };

    const nameStart = at;
    while (
      at < html.length &&
      !isSpace(html[at]) &&
      html[at] !== '/' &&
      html[at] !== '>' &&
      (html[at] !== '=' || at === nameStart)
    ) {
      at += 1;
    }
    const attributeName = html.slice(nameStart, at).toLowerCase();
    while (isSpace(html[at])) at += 1;

    let value = '';
    if (html[at] === '=') {
      at += 1;
      while (isSpace(html[at])) at += 1;
      const quote = html[at];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1);
        if (close === -1) return undefined;
        value = decodeReferences(html.slice(at + 1, close));
        at = close + 1;
      } else {
        const start = at;
        while (at < html.length && !isSpace(html[at]) && html[at] !== '>') {
          at += 1;
        }
        value = decodeReferences(html.slice(start, at));
      }
    }
    if (attributeName && !attributes.has(attributeName)) {
      attributes.set(attributeName, value.slice(0, MAX_TAG_CHARS));
    }
  }
}

/**
 * Whether a `<style type>` or a stylesheet `<link type>` is CSS the browser applies: no type, an empty
 * one, or `text/css` (parameters allowed). `text/plain`, `text/less` and
 * the like are payloads the page carries, not styles it uses.
 */
function isCssType(type: string | undefined): boolean {
  if (type === undefined) return true;
  const value = type.trim().toLowerCase().split(';')[0]!.trim();
  return value === '' || value === 'text/css';
}

/**
 * Whether a `media` attribute or `@media` prelude can apply to a screen, by
 * `appliesOnScreen`, so the palette and the measurements agree on which CSS
 * is the page's. Absent means yes.
 */
export function onScreen(media: string | undefined): boolean {
  return media === undefined || appliesOnScreen(media);
}
