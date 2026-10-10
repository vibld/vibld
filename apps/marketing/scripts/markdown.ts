/**
 * A prerendered page as Markdown, for an agent that asks for one with
 * `Accept: text/markdown` (worker/index.ts's `markdownFor`).
 *
 * Cloudflare does this conversion at the edge on Pro plans and up ("Markdown
 * for Agents"); vibld.com is on the Free plan, where the setting is off and
 * cannot be turned on, so the build writes the same thing once instead.
 * The shape follows Cloudflare's: YAML front matter from the page's meta
 * tags, then the body of `<main>`, without navigation, scripts or styles.
 *
 * The HTML here is React's own prerender output, not arbitrary markup, which
 * is why a handful of regular expressions is enough: every tag is
 * well-formed and every attribute is double-quoted.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

function meta(html: string, attribute: 'name' | 'property', key: string) {
  const tag = new RegExp(`<meta\\b[^>]*\\b${attribute}="${key}"[^>]*>`).exec(
    html,
  )?.[0];
  const content = tag && /\bcontent="([^"]*)"/.exec(tag)?.[1];
  return content ? decode(content) : undefined;
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source']);

/**
 * The HTML without any element marked `aria-hidden="true"`: what a screen
 * reader skips (the template cards' miniature page previews, decorative
 * marks) is not content an agent needs either. Matched by counting nested
 * tags of the same name, since these elements nest.
 */
export function dropHidden(html: string): string {
  const open = /<([a-z][a-z0-9-]*)\b[^>]*\baria-hidden="true"[^>]*>/g;
  let out = '';
  let from = 0;
  for (let match = open.exec(html); match; match = open.exec(html)) {
    const name = match[1]!;
    out += html.slice(from, match.index);
    let end = match.index + match[0].length;
    if (!VOID.has(name) && !match[0].endsWith('/>')) {
      const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
      tags.lastIndex = end;
      let depth = 1;
      for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
        if (tag[0].endsWith('/>')) continue;
        depth += tag[1] ? -1 : 1;
        if (depth === 0) {
          end = tag.index + tag[0].length;
          break;
        }
      }
      if (depth !== 0) end = html.length;
    }
    from = end;
    open.lastIndex = end;
  }
  return out + html.slice(from);
}

/** Text of a fragment, with a space where tags met, for a link's label. */
function label(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*→\s*$/, '')
    .trim();
}

/**
 * A link. One that wraps a whole card (a heading, paragraphs) keeps the
 * card's content and links its heading, or adds the link after it, rather
 * than squeezing the card into one line of link text.
 */
function link(href: string, inner: string, url: string): string {
  const target = href.startsWith('#') ? null : new URL(decode(href), url);
  if (!/<(h[1-6]|p|div|ul|ol|li|dl)\b/.test(inner)) {
    const text = label(inner);
    if (!text) return '';
    return target ? `[${text}](${target})` : text;
  }
  if (!target) return inner;
  let linked = false;
  const withHeading = inner.replace(
    /(<h[1-6]\b[^>]*>)([\s\S]*?)(<\/h[1-6]>)/,
    (_, start, text, end) => {
      linked = true;
      return `${start}[${label(text)}](${target})${end}`;
    },
  );
  return linked
    ? withHeading
    : `${inner}\n\n[${label(inner).slice(0, 80)}](${target})\n`;
}

/**
 * Text decoded for Markdown: an angle bracket written as an entity in the
 * page's prose (`vibld/&lt;revision&gt;`) is escaped, so a Markdown reader
 * shows it rather than taking it for inline HTML.
 */
function escapedDecode(text: string): string {
  return decode(
    text
      .replace(/&lt;|&#0*60;|&#x0*3c;/gi, '\\<')
      .replace(/&gt;|&#0*62;|&#x0*3e;/gi, '\\>'),
  );
}

/**
 * Lists, once every other tag is gone: `1.` in an ordered list, `-`
 * otherwise. Every line of an item's content is indented to where its text
 * starts (as \u0002, which whitespace clean-up leaves alone), so a second
 * paragraph, a nested list or a heading stays in the item, and the item's
 * first block (a heading too) sits on its marker's line.
 */
function lists(text: string): string {
  const open: { ordered: boolean; count: number }[] = [];
  // Where the content of each open item starts.
  const items: number[] = [];
  let first = false;
  return text
    .split(/(<\/?(?:ul|ol|li)\b[^>]*>)/)
    .map((part, index) => {
      if (index % 2 === 0) {
        let content = part;
        if (first && content.trim()) {
          content = content.replace(/^\s+/, '');
          first = false;
        }
        const indent = items.at(-1) ?? 0;
        return indent
          ? content.replace(/\n/g, `\n${'\u0002'.repeat(indent)}`)
          : content;
      }
      const [, close, name] = /^<(\/?)(\w+)/.exec(part)!;
      if (name !== 'li') {
        if (close) open.pop();
        else open.push({ ordered: name === 'ol', count: 0 });
        // The outermost list is set apart from the text around it, so the
        // text after it is not read as a lazy continuation of its last item.
        // A nested list follows its item's text line by line: each item
        // starts its own line.
        return open.length === (close ? 0 : 1) ? '\n\n' : '';
      }
      if (close) {
        items.pop();
        return '';
      }
      const list = open.at(-1);
      const marker = list?.ordered ? `${++list.count}.` : '-';
      const base = items.at(-1) ?? 0;
      items.push(base + marker.length + 1);
      first = true;
      return `\n${'\u0002'.repeat(base)}${marker} `;
    })
    .join('');
}

/** One cell's content on one line, with its own pipes escaped. */
function cell(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|');
}

/** A table as a Markdown table, its first row the header. */
function table(html: string): string {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
      cell(c[1]!),
    ),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  return `\n\n${[
    line(rows[0]!),
    line(Array(width).fill('---')),
    ...rows.slice(1).map(line),
  ].join('\n')}\n\n`;
}

/** A YAML string, quoted, so a colon or a leading dash cannot change it. */
function yaml(value: string): string {
  return JSON.stringify(value);
}

/**
 * The page's Markdown, or null for a page an agent should not be handed as
 * a page of this site: one marked noindex (the layer demos, D101, are
 * pages about a made-up product), or one with no `<main>`.
 */
export function toMarkdown(html: string, url: string): string | null {
  if (/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/.test(html)) {
    return null;
  }
  const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1];
  if (main === undefined) return null;

  const title =
    meta(html, 'name', 'title') ??
    meta(html, 'property', 'og:title') ??
    decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
  const description =
    meta(html, 'name', 'description') ??
    meta(html, 'property', 'og:description');
  const image = meta(html, 'property', 'og:image');
  const front = [
    '---',
    title && `title: ${yaml(title)}`,
    description && `description: ${yaml(description)}`,
    image && `image: ${yaml(image)}`,
    `url: ${yaml(url)}`,
    '---',
  ].filter(Boolean);

  // Preformatted blocks keep their line breaks, so they are set aside before
  // whitespace is collapsed and put back as fenced code afterwards.
  const blocks: string[] = [];
  // Inline code is set aside the same way, so the angle brackets in it stay
  // literal while those in prose are escaped below.
  const spans: string[] = [];
  const body = escapedDecode(
    lists(
      dropHidden(main)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (_, inner: string) => {
          const code = decode(
            inner
              // The home page's code sample draws each line as its own span.
              .replace(/<span class="lb-l">/g, '\n')
              .replace(/<[^>]+>/g, ''),
          ).replace(/^\n+|\s+$/g, '');
          const fence = '`'.repeat(
            Math.max(
              3,
              ...(code.match(/`{3,}/g) ?? []).map((run) => run.length + 1),
            ),
          );
          blocks.push(`${fence}\n${code}\n${fence}`);
          return `\n\n\u0000${blocks.length - 1}\u0000\n\n`;
        })
        .replace(
          /<(script|style|svg|form|nav|template|noscript)\b[\s\S]*?<\/\1>/g,
          '',
        )
        // A button is a control, and its one label is dropped, but one drawn
        // as a card, its text in several parts (the home page's featured
        // styles), keeps what the card says.
        .replace(/<button\b[^>]*>([\s\S]*?)<\/button>/g, (_, inner: string) =>
          (inner.match(/<(span|div|p|h[1-6]|strong|img)\b/g) ?? []).length > 1
            ? inner
            : '',
        )
        .replace(/<img\b[^>]*>/g, (tag) => {
          const alt = /\balt="([^"]*)"/.exec(tag)?.[1];
          const src = /\bsrc="([^"]*)"/.exec(tag)?.[1];
          return alt && src ? `![${alt}](${new URL(src, url)})` : '';
        })
        .replace(
          /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
          (_, href: string, inner: string) => link(href, inner, url),
        )
        .replace(
          /<h([1-6])\b[^>]*>/g,
          (_, level) => `\n\n${'#'.repeat(+level)} `,
        )
        .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, (_, _tag, text) =>
          text.trim() ? `**${text.trim()}**` : '',
        )
        .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/g, (_, _tag, text) =>
          text.trim() ? `_${text.trim()}_` : '',
        )
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_, inner: string) => {
          const code = decode(inner.replace(/<[^>]+>/g, ''));
          const tick = '`'.repeat(
            1 +
              Math.max(
                0,
                ...(code.match(/`+/g) ?? []).map((run) => run.length),
              ),
          );
          const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
          spans.push(`${tick}${pad}${code}${pad}${tick}`);
          return `\u0001${spans.length - 1}\u0001`;
        })
        .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/g, (_, inner: string) =>
          table(inner),
        )
        // Inline pieces set side by side ("$19" and "a month") need a space.
        .replace(/<\/(span|small)>/g, '</$1> ')
        .replace(/<small\b/g, ' <small')
        // A quotation is fenced by \u0003 and \u0004 and given its `>` markers
        // once its lines are final.
        .replace(/<blockquote\b[^>]*>/g, '\n\n\u0003')
        .replace(/<\/blockquote>/g, '\u0004\n\n')
        // A paragraph or a heading is set apart by a blank line; other blocks
        // end their line.
        .replace(/<\/(p|h[1-6])>/g, '\n\n')
        .replace(
          /<\/(dt|dd|tr|div|section|article|aside|header|footer|main|address|details|summary|fieldset|legend|dl|table|figure|figcaption)>/g,
          '\n',
        )
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<(?!\/?(?:ul|ol|li)\b)[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n'),
    ),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/(\u0002+) +/g, '$1')
    // An item with nothing in it, and the indent of an empty line.
    .replace(/^\u0002*(?:-|\d+\.) *$/gm, '')
    .replace(/^\u0002+$/gm, '')
    .replace(/\u0002/g, ' ')
    .replace(/ +([,.;:)])/g, '$1')
    .replace(/\u0003\s*([\s\S]*?)\s*\u0004/g, (_, quote: string) =>
      quote
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\u0001(\d+)\u0001/g, (_, index) => spans[+index]!)
    .replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[+index]!);

  return `${front.join('\n')}\n\n${body}\n`;
}
