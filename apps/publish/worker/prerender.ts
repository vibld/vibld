/**
 * Pages rendered for crawlers and link unfurlers (D204).
 *
 * Most published sites are single-page apps: the HTML a request gets is a
 * shell, and the page is drawn by its scripts. A person's browser runs
 * them; most bots do not, and the ones that do run them later and less
 * often. So a request from a known bot gets the page as a browser drew it,
 * rendered once by Cloudflare Browser Rendering and kept beside the
 * revision it was drawn from. People always get the site as it was built.
 *
 * Everything here gives way: a bot gets the ordinary response whenever a
 * render is not cached and cannot be had (no binding, over the limit, a
 * page that does not load in time), so a render can make a page better for
 * a crawler and never make it fail.
 *
 * Only the slice of puppeteer used here is typed, so tests can lend a fake
 * browser and `node --test` never loads the package.
 */

/**
 * The crawlers and preview fetchers a render is for, matched in the
 * User-Agent. Search engines, the AI crawlers and assistants
 * robots.txt already welcomes (D179), and the link unfurlers of the apps
 * people paste links into. Bots that run no scripts gain the most; the ones
 * that do (Googlebot, Bingbot) get the page without waiting for a second
 * pass.
 *
 * Headless Chrome is not on it, and must never be: the renderer's own
 * request for the page comes in as one, and rendering it would loop.
 */
const RENDER_BOTS = new RegExp(
  [
    // Search engines.
    'googlebot',
    'google-inspectiontool',
    'bingbot',
    'yandexbot',
    'baiduspider',
    'duckduckbot',
    'applebot',
    'slurp',
    'petalbot',
    'seznambot',
    // AI crawlers and assistants fetching a page.
    'gptbot',
    'oai-searchbot',
    'chatgpt-user',
    'claudebot',
    'claude-searchbot',
    'claude-user',
    'perplexitybot',
    'perplexity-user',
    // Link previews.
    'facebookexternalhit',
    'meta-externalagent',
    'twitterbot',
    'linkedinbot',
    'slackbot',
    'discordbot',
    'telegrambot',
    'whatsapp',
    'pinterestbot',
    'redditbot',
    'embedly',
    'skypeuripreview',
    'iframely',
    'bluesky',
    'mastodon',
  ].join('|'),
  'i',
);

export function isRenderBot(userAgent: string | null): boolean {
  if (!userAgent || /headlesschrome/i.test(userAgent)) return false;
  return RENDER_BOTS.test(userAgent);
}

/**
 * Whether a page is drawn by scripts it loads, so a render would show a bot
 * something the HTML does not. A page with no script file is already what
 * a browser would show, and rendering it would spend browser time for
 * nothing.
 */
export function drawnByScripts(html: string): boolean {
  return /<script\b[^>]*\bsrc\s*=/i.test(html);
}

/** How long the page has to load. Bots wait; this bounds how long. */
export const NAVIGATION_TIMEOUT_MS = 10_000;
/** How long to wait, after it loads, for its requests to settle. */
export const NETWORK_IDLE_TIMEOUT_MS = 3_000;
/** The largest render kept and served, in characters. */
export const MAX_RENDER_LENGTH = 1_000_000;

/**
 * Sent with the renderer's request for the page itself, and only that
 * one, so this Worker answers it with the HTML as built. Its own head
 * tags would otherwise be in the render already, taken from the shell, and
 * the pass made over the render (`injectHead`) keeps tags it finds: a
 * route whose scripts set its own title would unfurl with the shell's.
 * Anyone can send it and get the site's own HTML, which is public anyway.
 */
export const RENDER_HEADER = 'x-vibld-render';

export interface RenderRequest {
  url(): string;
  isNavigationRequest(): boolean;
  headers(): Record<string, string>;
  continue(overrides?: { headers?: Record<string, string> }): Promise<void>;
}

export interface RenderPage {
  setRequestInterception(enabled: boolean): Promise<void>;
  on(event: 'request', handler: (request: RenderRequest) => void): unknown;
  goto(
    url: string,
    options: { waitUntil: 'load'; timeout: number },
  ): Promise<{ status(): number } | null>;
  waitForNetworkIdle(options: {
    idleTime: number;
    timeout: number;
  }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
}

export interface RenderBrowser {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
}

/** The binding, as `@cloudflare/puppeteer` takes it. */
export interface BrowserBinding {
  fetch: typeof fetch;
}

/** Opens a browser on the binding; loaded only when a render is needed. */
export async function launchBrowser(
  binding: BrowserBinding,
): Promise<RenderBrowser> {
  const puppeteer = (await import('@cloudflare/puppeteer')).default;
  return (await puppeteer.launch(binding)) as unknown as RenderBrowser;
}

/**
 * The page at `url` as a browser draws it, or undefined when it did not
 * load as a page (an error status, a page that ended on another origin, or
 * past `MAX_RENDER_LENGTH`). Throws
 * when the browser cannot be had or the page does not load in time; the
 * caller serves the ordinary response then. The browser is closed whatever
 * happens.
 */
export async function renderPage(
  launch: () => Promise<RenderBrowser>,
  url: string,
): Promise<string | undefined> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // Only the page's own document is marked, never its scripts' requests
    // or another site's: a header on those could fail their CORS checks.
    const origin = new URL(url).origin;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const own =
        request.isNavigationRequest() &&
        new URL(request.url()).origin === origin;
      void request
        .continue(
          own
            ? { headers: { ...request.headers(), [RENDER_HEADER]: '1' } }
            : undefined,
        )
        .catch(() => undefined);
    });
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response || response.status() !== 200) return undefined;
    // A page that polls never goes quiet: it is taken as it is then.
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => undefined);
    // A page whose scripts sent it elsewhere (a sign-in, a checkout) is
    // not this site's page, and keeping it would serve another origin's
    // HTML under this route.
    if (new URL(page.url()).origin !== origin) return undefined;
    const html = await page.content();
    return html.length > MAX_RENDER_LENGTH ? undefined : html;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * How many renders a revision keeps at most. A bot, or anyone sending a
 * bot's User-Agent, can ask for any number of client-side routes and
 * queries; the rate limits bound how fast renders are made, and this
 * bounds how many are kept: a new one takes the slot its name falls in,
 * replacing what was there.
 */
export const RENDER_SLOTS = 64;

/**
 * The renders' corner of a revision. Reserved: a site's own file here is
 * dropped when it is published (`handlePublish`) and never served, so a
 * render can neither overwrite one nor be fetched as one.
 */
export const RENDER_PREFIX = '__vibld/prerender/';

/**
 * Where a render is kept, under the revision it was drawn from
 * (`published/<slug>/<generation>/`), so it goes when the revision does:
 * a new publish is a new prefix, and pruning and takedowns already delete
 * prefixes whole. `__vibld/` is this Worker's own corner of a revision,
 * beside the media manifest. Not `.html`, so the sitemap never lists one,
 * and at most `RENDER_SLOTS` of them, so they never crowd the site's own
 * files out of a listing.
 *
 * Named by what the render depends on beyond the revision's files: the
 * address it was asked for (origin, path and query), the address it is
 * canonical at (which changes when a custom domain starts serving), and
 * the owner's preview fields. Changing any of them asks for a new render
 * rather than serving a page that says the old thing. The name is kept
 * with the render (`keepRender`), since a slot holds one of many.
 */
export async function renderSlot(
  key: unknown,
): Promise<{ path: string; name: string }> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(key)),
  );
  const bytes = new Uint8Array(digest);
  const name = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { path: `${RENDER_PREFIX}${bytes[0]! % RENDER_SLOTS}.txt`, name };
}

/** A render as kept in its slot: its name on the first line. */
export function keepRender(name: string, html: string): string {
  return `${name}\n${html}`;
}

/** The render a slot holds, if it is the one named. */
export function keptRender(name: string, kept: string): string | undefined {
  return kept.startsWith(`${name}\n`) ? kept.slice(name.length + 1) : undefined;
}
