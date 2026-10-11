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

/**
 * What the site's owner tells search engines and link previews, set in
 * the builder (`0056_project_seo.sql`). An absent field leaves the page's
 * own; `indexing` false is the owner's opt-out (D202).
 */
export interface SiteSeo {
  title?: string;
  description?: string;
  /** An https URL, or a path on the site such as `/og.png`. */
  image?: string;
  indexing: boolean;
}

/** The owner's fields as `injectHead` applies them, the image made absolute. */
export interface HeadOverrides {
  title?: string;
  description?: string;
  image?: string;
}

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

/** One tag's attributes, lower-cased names. */
function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attributePattern =
    /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const attribute of source.matchAll(attributePattern)) {
    attributes.set(
      attribute[1].toLowerCase(),
      attribute[2] ?? attribute[3] ?? attribute[4] ?? '',
    );
  }
  return attributes;
}

/** Each `<meta>` and `<link>` tag's attributes, lower-cased names. */
function tags(head: string, name: 'meta' | 'link'): Map<string, string>[] {
  const tagPattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  return [...head.matchAll(tagPattern)].map((tag) => attributesOf(tag[1]));
}

/**
 * The head without the `<meta>` tags whose `name` or `property` `drop`
 * says to, so an owner's field replaces what the page said rather than
 * sitting beside it.
 */
function withoutMetas(head: string, drop: (key: string) => boolean): string {
  return head.replace(/<meta\b([^>]*)>/gi, (tag, source: string) => {
    const attributes = attributesOf(source);
    const key = (
      attributes.get('property') ??
      attributes.get('name') ??
      ''
    ).toLowerCase();
    return drop(key) ? '' : tag;
  });
}

/**
 * The page's head with what the owner set taking the place of what the
 * page said: its `<title>` and description, their Open Graph and Twitter
 * copies, and every preview image tag.
 */
function overridden(head: string, owner: HeadOverrides): string {
  let result = head;
  if (owner.title !== undefined) {
    result = result.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
  }
  return withoutMetas(
    result,
    (key) =>
      (owner.title !== undefined &&
        (key === 'og:title' || key === 'twitter:title')) ||
      (owner.description !== undefined &&
        (key === 'description' ||
          key === 'og:description' ||
          key === 'twitter:description')) ||
      // The card size follows the image, so the page's own card goes too.
      (owner.image !== undefined &&
        (key.startsWith('og:image') ||
          key.startsWith('twitter:image') ||
          key === 'twitter:card')),
  );
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
 * nothing is said about a site that its owner did not write, unless the
 * owner set their own (`owner`), which replaces the page's. A page with no
 * `<head>` is returned as it is.
 */
export function injectHead(
  html: string,
  canonical: string,
  owner: HeadOverrides = {},
): string {
  const head = headOf(html);
  if (!head) return html;
  const original = html.slice(head.start, head.end);
  const inside = overridden(original, owner);
  const metas = tags(inside, 'meta');
  const links = tags(inside, 'link');

  const has = (key: 'property' | 'name', value: string) =>
    metas.some((meta) => meta.get(key)?.toLowerCase() === value);
  const content = (key: 'property' | 'name', value: string) =>
    metas
      .find((meta) => meta.get(key)?.toLowerCase() === value)
      ?.get('content');

  // Values already encoded for an attribute: the owner's are plain text,
  // the page's are HTML source (`copied`).
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(inside);
  const title =
    owner.title !== undefined
      ? escapeHtml(owner.title)
      : titleMatch
        ? copied(titleMatch[1])
        : '';
  const description =
    owner.description !== undefined
      ? escapeHtml(owner.description)
      : copied(content('name', 'description') ?? '');
  // A page that names its own canonical address keeps it, and its Open
  // Graph URL says the same thing rather than this Worker's.
  const ownCanonical = links
    .find((link) => link.get('rel')?.toLowerCase() === 'canonical')
    ?.get('href');

  const added: string[] = [];
  if (owner.title !== undefined) added.push(`<title>${title}</title>`);
  if (owner.description !== undefined) {
    added.push(`<meta name="description" content="${description}">`);
  }
  if (owner.image !== undefined) {
    added.push(
      `<meta property="og:image" content="${escapeHtml(owner.image)}">`,
    );
  }
  if (ownCanonical === undefined) {
    added.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  }
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
        owner.image !== undefined || has('property', 'og:image')
          ? 'summary_large_image'
          : 'summary'
      }">`,
    );
  }
  if (added.length === 0 && inside === original) return html;
  return `${html.slice(0, head.start)}${inside}${added.join('')}${html.slice(head.end)}`;
}

/**
 * Every crawler welcome, and where the sitemap is (D202). A site whose
 * owner turned indexing off names no sitemap but still lets crawlers in:
 * a page they cannot fetch is one they never see the `noindex` of, and a
 * blocked address can still be listed from links to it.
 */
export function robotsTxt(origin: string, indexing = true): string {
  return indexing
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nAllow: /\n';
}

/**
 * The owner's preview image as an absolute address: a path on the site is
 * taken on the address the site is canonical at.
 */
export function imageUrl(origin: string, image: string): string {
  return image.startsWith('/') ? `${origin}${image}` : image;
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
