import { INSPECTOR_PATH, INSPECTOR_SCRIPT } from '@vibld/core';

/**
 * Select and Annotate (D188) on a sandbox preview.
 *
 * The builder frames the preview from another origin, so it cannot add
 * anything to the page itself. This Worker can: it serves the inspector at
 * `INSPECTOR_PATH` on the preview's own origin, and adds a tag loading it
 * to each HTML page it proxies. Same origin and not inline, so a project
 * whose own Content-Security-Policy allows `'self'` still runs it.
 *
 * Only the preview's own URL, the one the builder frames: a share link is
 * routed before this and is left exactly as the dev server serves it.
 * Nothing is written into the project, so nothing of this reaches an
 * export, a push or a published site.
 */

/** A request for the inspector itself. The script is public and the same for everyone. */
export function isInspectorRequest(url: URL): boolean {
  return url.pathname === INSPECTOR_PATH;
}

export function inspectorResponse(): Response {
  return new Response(INSPECTOR_SCRIPT, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * The tag added to the page's `<head>`. Synchronous and first, so the
 * inspector's listeners are in place before any of the app's code runs.
 */
export const INSPECTOR_TAG = `<script src="${INSPECTOR_PATH}"></script>`;

/**
 * A GET that loads a page into a frame or a tab. An HTML file the app
 * fetches for itself is data, and is passed on untouched. Browsers that
 * do not say where a response goes ask for HTML by name when navigating.
 */
function isNavigation(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest !== null) return dest === 'document' || dest === 'iframe';
  return /\btext\/html\b/i.test(request.headers.get('accept') ?? '');
}

/**
 * The request as the dev server gets it. A navigation goes without its
 * conditional headers: a copy cached before the inspector was added would
 * otherwise come back as a 304, and the page would load without it.
 */
export function toSandbox(request: Request): Request {
  if (!isNavigation(request)) return request;
  if (
    !request.headers.has('if-none-match') &&
    !request.headers.has('if-modified-since')
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  return new Request(request, { headers });
}

/**
 * Whether a proxied response is a page to add the tag to: a successful
 * HTML document, fetched with GET by a navigation. Vite answers its modules, styles and
 * HMR with other types, so in practice this is index.html and nothing
 * else.
 */
export function shouldAddInspector(
  request: Request,
  response: Response,
): boolean {
  if (!isNavigation(request)) return false;
  if (response.status !== 200) return false;
  const type = response.headers.get('content-type') ?? '';
  return /^text\/html\b/i.test(type);
}

/**
 * A proxied response as the browser gets it: the tag added to a page
 * loaded into a frame, and every HTML response kept out of the browser's
 * cache. The same URL is served two ways (with the tag to a frame, without
 * to the app's own fetch), so a cached copy, or a 304 that revalidates
 * one, could hand either to the other.
 */
export function forBrowser(request: Request, response: Response): Response {
  const page = shouldAddInspector(request, response)
    ? withInspector(response)
    : response;
  const type = page.headers.get('content-type') ?? '';
  if (!/^text\/html\b/i.test(type)) return page;
  const headers = new Headers(page.headers);
  headers.set('cache-control', 'no-store');
  headers.delete('etag');
  headers.delete('last-modified');
  headers.append('vary', 'Sec-Fetch-Dest, Accept');
  return new Response(page.body, {
    status: page.status,
    statusText: page.statusText,
    headers,
  });
}

/** The page with the tag at the top of its `<head>`. */
export function withInspector(response: Response): Response {
  return new HTMLRewriter()
    .on('head', {
      element(head) {
        head.prepend(INSPECTOR_TAG, { html: true });
      },
    })
    .transform(response);
}
