/**
 * Markdown for agents: a page requested with `Accept: text/markdown` is
 * answered with the Markdown the build wrote for it (scripts/markdown.ts),
 * and HTML stays the answer for everything else.
 *
 * Cloudflare's own "Markdown for Agents" does this at the edge, but only on
 * a Pro plan or higher; vibld.com is on Free, where the zone setting is off
 * and not editable. The response follows Cloudflare's: `text/markdown`,
 * `Vary: Accept`, and an `x-markdown-tokens` estimate.
 */

/**
 * Where a page's Markdown lives in the asset store: the page's own path
 * with `.md` added (llmstxt.org's convention), and `/index.md` for the home
 * page. Shared by the build that writes the files and the Worker that
 * serves them.
 */
export function markdownPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return path === '' ? '/index.md' : `${path}.md`;
}

/** A representation this Worker can answer with: its type and parameters. */
interface Served {
  type: string;
  params: Record<string, string>;
}

/** The Markdown: UTF-8, in GitHub's syntax (pipe tables), RFC 7763's `GFM`. */
const MARKDOWN: Served = {
  type: 'text/markdown',
  params: { charset: 'utf-8', variant: 'gfm' },
};

/** The HTML the site's pages are. */
const HTML: Served = { type: 'text/html', params: { charset: 'utf-8' } };

interface Range {
  type: string;
  params: Record<string, string>;
  q: number;
}

/** Each media range in an Accept header: its type, parameters and quality. */
function ranges(accept: string): Range[] {
  return accept.split(',').map((part) => {
    const [type = '', ...pieces] = part.split(';').map((piece) => piece.trim());
    const params: Record<string, string> = {};
    let q = 1;
    for (const piece of pieces) {
      const [name = '', ...rest] = piece.split('=');
      const key = name.trim().toLowerCase();
      const value = rest.join('=').trim().replace(/^"|"$/g, '').toLowerCase();
      if (key === 'q') {
        const number = Number(value);
        q = Number.isFinite(number) ? number : 0;
      } else if (key) {
        params[key] = value;
      }
    }
    return { type: type.toLowerCase(), params, q };
  });
}

/**
 * The range that decides `served`'s quality (RFC 9110 12.5.1): of those
 * that match it (the type, its `major/*` or `*\/*`, and every parameter the
 * range names), the most specific, a type before a wildcard and then the
 * range naming more parameters.
 */
function bestMatch(parsed: Range[], served: Served): Range | undefined {
  const major = served.type.split('/')[0];
  const rank = (type: string) =>
    type === served.type
      ? 2
      : type === `${major}/*`
        ? 1
        : type === '*/*'
          ? 0
          : -1;
  let best: Range | undefined;
  for (const range of parsed) {
    if (rank(range.type) < 0) continue;
    const names = Object.keys(range.params);
    if (names.some((name) => served.params[name] !== range.params[name])) {
      continue;
    }
    if (
      !best ||
      rank(range.type) > rank(best.type) ||
      (rank(range.type) === rank(best.type) &&
        names.length > Object.keys(best.params).length)
    ) {
      best = range;
    }
  }
  return best;
}

/**
 * True when the client names `text/markdown` and does not prefer HTML to it.
 * Both qualities come from the range that matches each most specifically,
 * parameters included: `text/markdown;q=0.5, text/*;q=0.8` gets HTML, and a
 * Markdown range with a parameter this Markdown does not have (another
 * charset or variant) does not match it. A browser never names
 * `text/markdown`, and a wildcard alone (`text/*`, `*\/*`) is never read
 * as asking for it, so a browser always gets HTML.
 */
export function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const parsed = ranges(accept);
  const markdown = bestMatch(parsed, MARKDOWN);
  if (!markdown || markdown.type !== MARKDOWN.type || !markdown.q) return false;
  return markdown.q >= (bestMatch(parsed, HTML)?.q ?? 0);
}

/**
 * A rough count of the tokens in the Markdown, for `x-markdown-tokens`.
 * About four characters a token for English prose; an estimate, as
 * Cloudflare's own header is.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The page's Markdown, or null when this request should be answered as it
 * always was: not a GET or HEAD, not asking for Markdown, a path that is a
 * file rather than a page, or a page the build wrote no Markdown for.
 */
export async function markdownFor(
  request: Request,
  assets: { fetch(request: Request): Promise<Response> },
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!wantsMarkdown(request.headers.get('accept'))) return null;
  const url = new URL(request.url);
  // A file (`/og-image.png`, `/llms.txt`) is served as itself.
  if (/\.[^/]*$/.test(url.pathname)) return null;
  // A trailing slash, and an `/index` alias, are redirected to the page's
  // one address first, as they are for HTML, and the Markdown is served
  // there.
  if (url.pathname !== '/' && url.pathname.endsWith('/')) return null;
  if (/\/index$/.test(url.pathname)) return null;

  const source = await assets.fetch(
    new Request(new URL(markdownPath(url.pathname), url)),
  );
  if (source.status !== 200) return null;
  const text = await source.text();

  // The page's own address, as the build wrote it into the front matter
  // (the production site, the same as the HTML's canonical), so a preview
  // deployment does not name itself canonical.
  const written = /^---\n[\s\S]*?^url: ("[^"\n]*")$/m.exec(text)?.[1];
  const canonical = written
    ? (JSON.parse(written) as string)
    : new URL(url.pathname, url).toString();
  const headers = new Headers({
    'content-type': 'text/markdown; charset=utf-8; variant=GFM',
    vary: 'accept',
    'x-markdown-tokens': String(estimateTokens(text)),
    link: `<${canonical}>; rel="canonical"`,
  });
  const cacheControl = source.headers.get('cache-control');
  if (cacheControl) headers.set('cache-control', cacheControl);
  return new Response(request.method === 'HEAD' ? null : text, {
    status: 200,
    headers,
  });
}

/**
 * An HTML page's response, marked as varying by `Accept`, so a cache in
 * between does not hand an agent's Markdown to a browser or the reverse.
 */
export function varyByAccept(response: Response): Response {
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('text/html')) return response;
  const headers = new Headers(response.headers);
  const vary = headers.get('vary');
  if (vary && /(^|,)\s*accept\s*(,|$)/i.test(vary)) return response;
  headers.set('vary', vary ? `${vary}, accept` : 'accept');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
