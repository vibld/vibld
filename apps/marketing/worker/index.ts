import {
  type AnalyticsDataset,
  type Attribution,
  attributionFrom,
  pathOf,
  record,
} from './analytics.ts';
import { secured } from '@vibld/security-headers';
import { markdownFor, varyByAccept } from './markdown.ts';
import {
  handleRoadmapVote,
  handleRoadmapVotes,
  methodNotAllowed,
} from './roadmap-api.ts';
import { type RoadmapD1Database, sweep } from './roadmap-store.ts';

export interface Env {
  /**
   * Worker secret, pairs with the public site key the roadmap's vote widget
   * uses (docs/decisions.md L29); checked by worker/roadmap-api.ts through
   * worker/turnstile.ts. Unset means a vote from a browser the Worker does
   * not know yet is refused with a 503, not let through.
   */
  TURNSTILE_SECRET_KEY?: string;
  /** Workers Analytics Engine dataset. Absent in local dev; see worker/analytics.ts. */
  ANALYTICS?: AnalyticsDataset;
  /**
   * The prerendered build, bound by wrangler.jsonc's `assets`.
   *
   * Production used to serve pages from these assets without invoking this
   * Worker at all (`run_worker_first: ["/api/*"]`). That is no longer true,
   * and the reason is `canonicalHost` below: a redirect can only be issued
   * by something the request reaches, and a page request never reached here.
   *
   * Typed by the one method this file calls rather than as `Fetcher`, which
   * would mean pulling the Workers type package into an app that otherwise
   * needs none of it.
   */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /**
   * Set to "1" on preview deployments only (wrangler.preview.jsonc).
   *
   * A preview of this site is a byte-for-byte copy of vibld.com on a public
   * hostname. Left indexable it competes with the real site for the name,
   * which is the exact problem the marketing work is trying to solve, so a
   * copy that can outrank the original is worse than having no preview.
   */
  VIBLD_NOINDEX?: string;
  /**
   * The roadmap's votes (worker/roadmap-api.ts), bound by wrangler.jsonc.
   * Deliberately absent on the preview deployment, where /api/roadmap/*
   * answers 503: a vote cast while reviewing a change is not a vote.
   */
  ROADMAP_DB?: RoadmapD1Database;
}

/**
 * Every request arrives here now (`run_worker_first: true`), not only
 * `/api/*`, and the site's own pages are served from the `ASSETS` binding at
 * the bottom of this handler.
 *
 * That changed to make one hostname canonical. `_redirects`, the mechanism
 * built for exactly this, cannot do it: Cloudflare documents domain-level
 * redirects as unsupported there, and says in as many words that its rules
 * are not applied to requests a Worker serves. A second Worker bound to
 * `www.vibld.com` alone would have kept the apex free of invocations, but a
 * custom domain belongs to one Worker at a time, so moving it is a step
 * nothing in CI can take unattended, and a marketing site that is down
 * because a deploy needed a human is worse than one that costs a Worker
 * invocation per request.
 *
 * So that is the trade, stated rather than buried: every asset request on
 * this site now runs this script. At this site's size that is a rounding
 * error against the Workers Paid request allowance, and the thing bought
 * with it is that `vibld.com` is the only hostname that ever answers 200.
 */
export default {
  /**
   * One exit, so a route added later cannot forget the headers.
   *
   * `secured` is applied here rather than at each `return` below for the
   * reason this site had no security headers at all: they were nobody's
   * job at any particular return statement. A `_headers` file cannot help
   * here, because Cloudflare never applies one to a response a Worker
   * generated and this Worker generates every response on the site
   * (`run_worker_first: true`, for the www redirect).
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return secured(await route(request, env));
  },

  /**
   * wrangler.jsonc's cron: deletes rate-limit rows whose window has closed
   * and salts from earlier days, so a hashed address is not kept longer than
   * the window it was counted in when nobody votes to trigger the same
   * cleanup (worker/roadmap-store.ts).
   */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (env.ROADMAP_DB) await sweep(env.ROADMAP_DB, Date.now());
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // First, before any route or asset. A redirect that runs after the thing
  // it is redirecting away from has already answered is not a redirect.
  const canonical = canonicalHost(url);
  if (canonical) {
    return new Response(null, {
      // A 301 turns a POST into a GET in most clients, which for
      // `/api/roadmap/vote` or `/api/hit` would silently discard the body.
      // 308 is the same permanent redirect with the method and body
      // preserved, so the two are split by method rather than one being
      // chosen for both.
      // GET and HEAD keep 301 because it is the status every crawler and
      // link checker already understands.
      status: request.method === 'GET' || request.method === 'HEAD' ? 301 : 308,
      headers: { location: canonical },
    });
  }

  if (url.pathname === '/api/hit' && request.method === 'POST') {
    return handleHit(request, env);
  }
  if (url.pathname === '/api/roadmap/votes') {
    return request.method === 'GET'
      ? handleRoadmapVotes(request, env)
      : methodNotAllowed('GET');
  }
  if (url.pathname === '/api/roadmap/vote') {
    return request.method === 'POST'
      ? handleRoadmapVote(request, env)
      : methodNotAllowed('POST');
  }

  // Every other `/api/` path, before the asset store sees it: Static Assets
  // answers a POST with 405, so a retired write endpoint such as
  // `/api/waitlist` (D168) would otherwise read as "wrong method" rather
  // than "not here".
  if (url.pathname.startsWith('/api/')) {
    return new Response('Not found', { status: 404 });
  }

  // Last, so an `/api/` route is never served as a page. `VIBLD_NOINDEX` is
  // set on the preview deployment only, and keeps a byte-for-byte copy of
  // this site out of the index; production serves the same bytes without
  // that header.
  if (env.ASSETS) {
    // An agent that asks for Markdown gets the page as Markdown (see
    // worker/markdown.ts); everyone else gets the HTML, marked as varying by
    // the same header.
    const markdown = await markdownFor(request, env.ASSETS);
    if (markdown) {
      return env.VIBLD_NOINDEX === '1' ? noindex(markdown) : markdown;
    }
    const response = varyByAccept(
      permanentRedirect(
        request.method,
        hashedAssetHeaders(
          url.pathname,
          discoveryHeaders(
            url.pathname,
            fontHeaders(url.pathname, await env.ASSETS.fetch(request)),
          ),
        ),
      ),
    );
    return env.VIBLD_NOINDEX === '1' || isLayerDemo(url.pathname)
      ? noindex(response)
      : response;
  }
  return new Response('Not found', { status: 404 });
}

/**
 * A layer's reference page (app/layers.ts, D101): a demonstration of a
 * made-up product, served as it is, so it says nothing about vibld and is
 * kept out of search results. Its page on /templates is indexed as usual.
 */
export function isLayerDemo(pathname: string): boolean {
  return pathname === '/layers' || pathname.startsWith('/layers/');
}

/**
 * Where this request should have gone, or null when it is already there.
 *
 * Only a leading `www.` is stripped, and only that: this Worker answers on
 * `vibld.com`, on `www.vibld.com`, and on a `workers.dev` preview hostname,
 * and the preview must keep serving itself rather than redirecting reviewers
 * to production.
 *
 * The path and query survive, so a shared `www` link to a legal page or a
 * campaign URL lands on the same page with its UTM parameters intact rather
 * than on the home page. The fragment is not handled because it is never
 * sent: the browser reattaches it to whatever this points at.
 */
export function canonicalHost(url: URL): string | null {
  if (!url.hostname.startsWith('www.')) return null;
  const canonical = new URL(url.toString());
  canonical.hostname = url.hostname.slice('www.'.length);
  return canonical.toString();
}

/**
 * The self-hosted fonts, cached for a year and typed as fonts.
 *
 * The asset store's default is to revalidate every file on every use, which
 * is right for pages and wrong for these: every page preloads two of them,
 * and they never change at a given URL, because each filename carries the
 * Fontsource version it was copied from (app.css). A new version is a new
 * file, so `immutable` cannot pin a reader to a stale one.
 *
 * The content type is set here rather than trusted, because a preload with
 * `type="font/woff2"` is ignored by a browser that is sent anything else.
 * Only a successful response is touched: a 404 for a missing font must not
 * be cached for a year.
 */
export function fontHeaders(pathname: string, response: Response): Response {
  if (!/^\/fonts\/[^/]+\.woff2$/.test(pathname) || response.status !== 200) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('content-type', 'font/woff2');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The MCP Server Card (D182), readable from any origin: SEP-1649 asks for
 * these headers so a browser-based client elsewhere can discover `/mcp`.
 */
export function discoveryHeaders(
  pathname: string,
  response: Response,
): Response {
  if (pathname !== '/.well-known/mcp/server-card.json') return response;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET');
  headers.set('access-control-allow-headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The build's own scripts and stylesheets, cached for a year.
 *
 * Vite names every file it writes to `/assets/` after a hash of its
 * contents, so a file at a given URL never changes: a new build is a new
 * name, and the page that asks for it is revalidated on every visit. The
 * asset store's default (`max-age=0, must-revalidate`) made every page view
 * ask again for roughly 300 KB of JavaScript that could not have changed.
 *
 * Only a name that carries a hash is touched, and only a 200, for the same
 * reason as `fontHeaders`: a missing file must not be cached for a year.
 */
export function hashedAssetHeaders(
  pathname: string,
  response: Response,
): Response {
  if (
    !/^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(pathname) ||
    response.status !== 200
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The asset store's own redirects, made permanent.
 *
 * `html_handling: "drop-trailing-slash"` answers `/pricing/`,
 * `/pricing/index.html` and `/index.html` with a 307 to the canonical form.
 * A 307 says "temporary", so a crawler keeps the old URL on file and comes
 * back to it; the move is not temporary, and a 301 is the status that says
 * so. Only GET and HEAD, for the reason `canonicalHost`'s caller gives: a
 * 301 turns a POST into a GET.
 */
export function permanentRedirect(
  method: string,
  response: Response,
): Response {
  if (response.status !== 307 || (method !== 'GET' && method !== 'HEAD')) {
    return response;
  }
  return new Response(null, { status: 301, headers: response.headers });
}

/**
 * The same response, told not to be indexed.
 *
 * Rebuilt rather than mutated: an immutable `Headers` on a response from a
 * binding throws on `set`, and a preview that 500s is not a preview.
 */
function noindex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Resolves the attribution the caller reported. The page beacon sends the
 * page's own URL and referrer, because the Worker sees only its own `/api/*`
 * URL -- not the page the visitor was actually on.
 *
 * Two candidates, in order, and the same rule applied to both: it counts only
 * if it names a page on this site.
 *
 * The rule is one function rather than a check at each branch because the
 * first version of this checked only the `Referer` fallback and trusted
 * whatever `page_url` a caller sent. `/api/hit` takes unauthenticated posts,
 * so that was an open door: anyone could write `/their/page` and
 * `utm_campaign=whatever` straight into this site's traffic report.
 * Per-branch checks are how the second branch gets forgotten.
 *
 * The last resort is deliberately not `request.url`. When `page_url` is
 * empty, falling back to the Worker's own URL would file the event under an
 * `/api/` path nobody visited, splitting the real page's numbers rather than
 * merely rounding them. A browser sends `Referer` with a same-origin post as
 * the full URL, so the query string and its UTM parameters survive with it.
 *
 * What this does not claim: a caller can still send a plausible same-host URL
 * and be believed. Every field here is reported by the client and none of it
 * can be proved. The check removes the ability to write arbitrary paths and
 * campaigns from anywhere, which is worth having; it does not make an
 * unauthenticated beacon trustworthy, and nothing short of not having one
 * would.
 */
function attributionOf(
  request: Request,
  pageUrl: string,
  pageReferrer: string,
): { attribution: Attribution; path: string } {
  const selfHost = new URL(request.url).hostname;
  const url =
    onThisSite(pageUrl, selfHost) ??
    onThisSite(request.headers.get('referer'), selfHost) ??
    '';
  return {
    attribution: attributionFrom(url, pageReferrer, selfHost),
    // With nothing believable to go on, "/" is an honest guess at where a
    // visitor was. `pathOf` answers "/" for a value it cannot parse.
    path: pathOf(url),
  };
}

/** A URL, but only when it names a page on this site. */
function onThisSite(
  candidate: string | null | undefined,
  selfHost: string,
): string | null {
  if (!candidate) return null;
  try {
    return new URL(candidate).hostname === selfHost ? candidate : null;
  } catch {
    // Relative, malformed, or not a URL at all. All the same answer: this is
    // not something to record a path from.
    return null;
  }
}

/**
 * The pageview beacon. Answers 204 unconditionally and as early as possible:
 * the caller is a fire-and-forget `sendBeacon` that ignores the response, and
 * a failed measurement must never surface to a visitor.
 */
async function handleHit(request: Request, env: Env): Promise<Response> {
  try {
    const form = await request.formData();
    const { attribution, path } = attributionOf(
      request,
      String(form.get('page_url') ?? ''),
      String(form.get('page_referrer') ?? ''),
    );
    record(env.ANALYTICS, 'pageview', request, attribution, path);
  } catch (error) {
    console.error('hit failed', error);
  }
  return new Response(null, { status: 204 });
}
