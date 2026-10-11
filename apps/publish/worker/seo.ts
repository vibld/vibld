/**
 * What a search engine or a link preview reads from a published site
 * (docs/decisions.md D194).
 *
 * Generated sites are Vite single-page apps (D92), whose `index.html`
 * carries a title and a description and nothing else, so a crawler or a
 * chat app unfurling a link sees one address of many and no preview card.
 * This Worker fills that in at serve time rather than at build time, so
 * every site already published gets it without being built again, and a
 * site that ships its own `robots.txt`, `sitemap.xml` or tags keeps them:
 * the site's own files are served first, and a tag the page already has
 * is never added twice.
 *
 * Pure functions. `index.ts` decides when they apply.
 */

/** `&`, `<`, `>` and `"` for an attribute value or element text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Text copied from the page's own markup into an attribute. It is already
 * HTML source, so its character references (`&amp;`, `&nbsp;`, `&#38;`)
 * are kept as written, and mean in the attribute what they meant where
 * they were; only what could end the attribute or open a tag is escaped.
 * Whitespace runs collapse to one space.
 */
function copied(source: string): string {
  return source
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The `<head>` element's contents, or undefined for a page without one. */
function headOf(html: string): { start: number; end: number } | undefined {
  const open = /<head(\s[^>]*)?>/i.exec(html);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const close = html.slice(start).search(/<\/head\s*>/i);
  if (close === -1) return undefined;
  return { start, end: start + close };
}

/** Each `<meta>` and `<link>` tag's attributes, lower-cased names. */
function tags(head: string, name: 'meta' | 'link'): Map<string, string>[] {
  const found: Map<string, string>[] = [];
  const tagPattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  for (const tag of head.matchAll(tagPattern)) {
    const attributes = new Map<string, string>();
    const attributePattern =
      /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    for (const attribute of tag[1].matchAll(attributePattern)) {
      attributes.set(
        attribute[1].toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
      );
    }
    found.push(attributes);
  }
  return found;
}

/**
 * A client-side route's canonical address: the canonical origin and the
 * path asked for, without the query or a trailing slash, since the single
 * page app's shell answers `/menu` and `/menu/` alike.
 */
export function canonicalUrl(origin: string, pathname: string): string {
  let path = pathname.replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/+$/, '');
  return `${origin}${path || '/'}`;
}

/**
 * The files that would be served instead of `file` at its short address,
 * by `candidatePaths`' order: `/about` tries `about`, then `about.html`,
 * then `about/index.html`.
 */
export function shadowsOf(file: string): string[] {
  const dir = /^(.+)\/index\.html$/.exec(file);
  if (dir) return [dir[1], `${dir[1]}.html`];
  const flat = /^(.+)\.html$/.exec(file);
  if (flat && flat[1] !== 'index') return [flat[1]];
  return [];
}

/**
 * The address a site's own HTML file is canonical at: the shortest one
 * `candidatePaths` resolves to it. `about.html` is `/about` and
 * `about/index.html` is `/about` too, unless another file `has` says
 * exists would answer that address first (`shadowsOf`), in which case the
 * file keeps its full path so two different pages never share one name.
 */
export function pagePath(file: string, has: (path: string) => boolean): string {
  if (file === 'index.html') return '/';
  if (shadowsOf(file).some(has)) return `/${file}`;
  const short = /^(.+?)(?:\/index)?\.html$/.exec(file);
  return short ? `/${short[1]}` : `/${file}`;
}

/**
 * The page with a canonical link and Open Graph and Twitter card tags it
 * did not already have, added at the end of its `<head>`.
 *
 * The preview text is the page's own `<title>` and meta description, so
 * nothing is said about a site that its owner did not write. A page with no
 * `<head>` is returned as it is.
 */
export function injectHead(html: string, canonical: string): string {
  const head = headOf(html);
  if (!head) return html;
  const inside = html.slice(head.start, head.end);
  const metas = tags(inside, 'meta');
  const links = tags(inside, 'link');

  const has = (key: 'property' | 'name', value: string) =>
    metas.some((meta) => meta.get(key)?.toLowerCase() === value);
  const content = (key: 'property' | 'name', value: string) =>
    metas
      .find((meta) => meta.get(key)?.toLowerCase() === value)
      ?.get('content');

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(inside);
  const title = titleMatch ? copied(titleMatch[1]) : '';
  const description = copied(content('name', 'description') ?? '');
  // A page that names its own canonical address keeps it, and its Open
  // Graph URL says the same thing rather than this Worker's.
  const ownCanonical = links
    .find((link) => link.get('rel')?.toLowerCase() === 'canonical')
    ?.get('href');

  const added: string[] = [];
  if (ownCanonical === undefined) {
    added.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  }
  // Values already encoded for an attribute.
  const og: [string, string][] = [
    ['og:type', 'website'],
    [
      'og:url',
      ownCanonical === undefined ? escapeHtml(canonical) : copied(ownCanonical),
    ],
    ['og:title', title],
    ['og:description', description],
  ];
  for (const [property, value] of og) {
    if (value && !has('property', property)) {
      added.push(`<meta property="${property}" content="${value}">`);
    }
  }
  if (!has('name', 'twitter:card')) {
    added.push(
      `<meta name="twitter:card" content="${
        has('property', 'og:image') ? 'summary_large_image' : 'summary'
      }">`,
    );
  }
  if (added.length === 0) return html;
  return `${html.slice(0, head.end)}${added.join('')}${html.slice(head.end)}`;
}

/** Every crawler welcome, and where the sitemap is (D202). */
export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

/**
 * The pages a revision has, by their canonical address (`pagePath`).
 *
 * `paths` are the revision's file paths. Only `.html` pages (any case) are listed,
 * since those are what this Worker serves as pages, and not the two that
 * stand in for other pages: `404.html` and React Router's
 * `__spa-fallback.html`. A single-page app lists only its home page, which
 * is everything that can be known about it without running it.
 */
export function sitemapXml(origin: string, paths: string[]): string {
  const files = new Set(paths);
  const pages = new Set<string>();
  for (const path of paths) {
    const name = path.split('/').pop() ?? '';
    if (!/\.html$/i.test(name)) continue;
    if (name === '404.html' || name === '__spa-fallback.html') continue;
    pages.add(`${origin}${pagePath(path, (other) => files.has(other))}`);
  }
  if (pages.size === 0) pages.add(`${origin}/`);
  const entries = [...pages]
    .sort()
    .map((loc) => `  <url><loc>${escapeHtml(loc)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
