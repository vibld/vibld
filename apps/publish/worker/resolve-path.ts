/**
 * Static-hosting path resolution for a published project (ADR-0008's
 * "check static hosting behavior for deep links and missing routes"
 * requirement, applied here at serve time rather than at generation time).
 *
 * Ordered candidates for a request path, most specific first: the literal
 * path, then `path.html` (an extensionless route to a prerendered page),
 * then `path/index.html` (a route that is itself a directory-shaped
 * prerendered page). The public fetch handler serves the first one R2
 * actually has.
 */

export function candidatePaths(requestPath: string): string[] {
  const clean = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean === '') return ['index.html'];
  return [clean, `${clean}.html`, `${clean}/index.html`];
}

/**
 * What to serve when none of `candidatePaths` exists, in order, with the
 * status each one is served with.
 *
 * A missing asset stays a plain 404: a script or stylesheet answered with
 * an HTML page makes the browser report a MIME error that hides the real
 * one, which is that the file is not there. So the question is whether the
 * request is for a page, and a dot in the path cannot answer it alone:
 * `/releases/v1.2` is a client-side route and `/missing.html` is a page.
 *
 * - A path ending `.html` or `.htm` asked for a page that does not exist,
 *   so it gets the site's own not-found page, and nothing else: serving an
 *   SPA shell under a `.html` URL would render some other page there.
 * - Any other path is a page when `navigation` says so (the browser's own
 *   `Sec-Fetch-Mode: navigate`, or an `Accept` that asks for HTML), or when
 *   its last segment has no extension at all. Otherwise it is an asset.
 *
 * For a page, in order:
 * - `__spa-fallback.html` is React Router's shell for a route it did not
 *   prerender (`ssr: false`): the page exists, it is rendered once the
 *   shell hydrates, and React Router's own hosting guidance rewrites to it
 *   with a 200. Serving it as a 404 would render the right page and still
 *   tell crawlers and monitoring the route is missing.
 * - `404.html` is a static site's own not-found page, so the path really is
 *   unknown and says so: 404.
 * - `index.html` is a single-page app's shell. Generation produces a React
 *   and Vite app, and one with client-side routes has exactly one HTML file,
 *   so `/about` exists only once that shell has loaded and its router has
 *   run. Without this a visitor following a link to `/about`, or reloading
 *   it, got "Not found." from the host rather than the page. Served 200,
 *   which is what every static host's SPA mode does; the app's router
 *   renders its own not-found view for a path it does not know.
 */
export function fallbackPaths(
  requestPath: string,
  navigation = false,
): { path: string; status: 200 | 404 }[] {
  const clean = requestPath.replace(/^\/+/, '').replace(/\/+$/, '');
  const last = clean.split('/').pop() ?? '';
  if (/\.html?$/i.test(last)) return [{ path: '404.html', status: 404 }];
  if (last.includes('.') && !navigation) return [];
  return [
    { path: '__spa-fallback.html', status: 200 },
    { path: '404.html', status: 404 },
    { path: 'index.html', status: 200 },
  ];
}

/**
 * Whether a request is a page navigation, from what the browser says about
 * it. `Sec-Fetch-Mode: navigate` is exact where it is sent; an `Accept`
 * that names `text/html` is what every browser sends for a page and no
 * browser sends for a script, a stylesheet or an image.
 */
export function isNavigation(headers: Headers): boolean {
  if (headers.get('sec-fetch-mode') === 'navigate') return true;
  return /\btext\/html\b/i.test(headers.get('accept') ?? '');
}
